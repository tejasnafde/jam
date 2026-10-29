"""jam prep worker: one Cloud Run job execution handles one prep job.

Env from the execution overrides (apps/server/src/prep/runner.ts):
  JAM_UID, JAM_JOB_ID, JAM_SAMPLE_ID, JAM_OPS (JSON of PrepRequest.ops)
Writes WAV results to users/{uid}/samples/{id}.wav, registers each as a Sample,
sets bpm/key on the source sample and keeps users/{uid}/prep_jobs/{jobId} up to date.
"""

import logging
import os
import subprocess
import sys
import tempfile
import traceback
from collections.abc import Iterator, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import librosa
import soundfile as sf

from analysis import detect_bpm, detect_key
from ops import Ops, PrepError, free_names, op_labels, parse_ops, shift_key, tempo_source
from publish import Output, publish

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "teejayproject")
DATABASE = os.environ.get("FIRESTORE_DATABASE", "jam-db")
BUCKET = os.environ.get("SAMPLE_BUCKET", "jam-samples-teejayproject")  # SAMPLE_BUCKET in samples.ts
MAX_SECONDS = 10 * 60
SR = 44100

log = logging.getLogger("prep")


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def probe_seconds(src: Path) -> float | None:
    """The container's duration from ffprobe, without a decode. None when the file does not say."""
    try:
        out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(src)]).stdout
    except subprocess.CalledProcessError:
        raise PrepError("Could not read the source audio.") from None
    try:
        return float(out.strip())
    except ValueError:
        return None


def check_length(src: Path, max_seconds: float = MAX_SECONDS) -> None:
    """Refuses a long source before the decode. A 50 MB low-bitrate file can hold hours of audio."""
    seconds = probe_seconds(src)
    if seconds is not None and seconds > max_seconds:
        raise PrepError(f"The source is longer than {max_seconds // 60:g} minutes.")


def decode(src: Path, dst: Path, max_seconds: float = MAX_SECONDS) -> None:
    """Any upload format to 44.1 kHz stereo 16-bit WAV. -t stops it one second past the limit."""
    try:
        run(
            ["ffmpeg", "-nostdin", "-v", "error", "-i", str(src), "-t", f"{max_seconds + 1:g}"]
            + ["-ac", "2", "-ar", str(SR), "-c:a", "pcm_s16le", str(dst)]
        )
    except subprocess.CalledProcessError:
        raise PrepError("Could not decode the source audio.") from None
    if sf.info(str(dst)).duration > max_seconds:
        raise PrepError(f"The source is longer than {max_seconds // 60:g} minutes.")


def separate(wav: Path, out_dir: Path) -> dict[str, Path]:
    """Demucs htdemucs on the CPU. The weights are baked into the image (TORCH_HOME)."""
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    model = get_model("htdemucs")
    model.eval()
    data, sr = sf.read(str(wav), dtype="float32", always_2d=True)
    mix = torch.from_numpy(data.T.copy())
    ref = mix.mean(0)
    mean, std = ref.mean(), ref.std().clamp_min(1e-8)
    with torch.no_grad():
        sources = apply_model(model, ((mix - mean) / std)[None], device="cpu", overlap=0.25, progress=False)[0]
    stems = {}
    for name, source in zip(model.sources, sources * std + mean):
        stems[name] = out_dir / f"{name}.wav"
        sf.write(str(stems[name]), source.numpy().T, sr, subtype="PCM_16")
    return stems


def stretch(src: Path, dst: Path, ops: Ops, source_bpm: float | None) -> None:
    """Rubber Band R3: tempo and pitch change independently."""
    cmd = ["rubberband", "-q", "--fine"]
    if ops.tempo is not None:
        if not source_bpm:
            raise PrepError("Could not detect the tempo of the source, so it cannot be matched.")
        cmd += ["-T", f"{ops.tempo / source_bpm:.6f}"]
    if ops.semitones:
        cmd += ["-p", str(ops.semitones)]
    run(cmd + [str(src), str(dst)])


def create_unique(db: Any, samples: Any, ref: Any, doc: dict[str, Any], names: list[str]) -> str:
    """Creates the Sample doc with the first name nobody holds, in one transaction.

    The same rule as FirestoreSampleStore.create: the transaction re-reads the
    name query, so an upload or another job cannot take the name in between.
    """
    from google.cloud import firestore
    from google.cloud.firestore_v1.base_query import FieldFilter

    @firestore.transactional
    def attempt(tx: Any) -> str:
        for name in names:
            if not list(tx.get(samples.where(filter=FieldFilter("name", "==", name)).limit(1))):
                tx.create(ref, {k: v for k, v in {**doc, "name": name}.items() if v is not None})
                return name
        raise PrepError("Could not find a free sample name.")

    return attempt(db.transaction())


def prep(db: Any, bucket: Any, uid: str, sample_id: str, ops: Ops, work: Path) -> list[str]:
    samples = db.collection(f"users/{uid}/samples")
    source_ref = samples.document(sample_id)
    source = source_ref.get()
    if not source.exists:
        raise PrepError("The source sample does not exist.")
    path = source.get("storagePath")
    if not isinstance(path, str) or not path.startswith(f"users/{uid}/"):
        raise PrepError("The source sample has no file.")

    raw = work / "source"
    bucket.blob(path).download_to_filename(str(raw))
    check_length(raw)
    wav = work / "source.wav"
    decode(raw, wav)
    raw.unlink()

    y, sr = librosa.load(str(wav), sr=22050, mono=True)
    bpm, key = detect_bpm(y, sr), detect_key(y, sr)
    del y
    source_ref.update({k: v for k, v in {"bpm": bpm, "key": key}.items() if v is not None})
    log.info("analysed source: bpm=%s key=%s", bpm, key)
    from_bpm = tempo_source(ops, bpm)  # fails here, before Demucs, when a tempo match has no source tempo

    parts: dict[str | None, Path] = separate(wav, work) if ops.split else {None: wav}  # type: ignore[assignment]
    taken = {d.get("name") for d in samples.select(["name"]).stream()}
    labels = op_labels(ops, from_bpm)
    source_name = source.get("name")

    def outputs() -> Iterator[Output]:
        for stem, part in parts.items():
            out = part
            if ops.stretch:
                out = work / f"{stem or 'source'}.prepared.wav"
                stretch(part, out, ops, from_bpm)
                part.unlink()
            doc = {
                "userId": uid,
                "kind": "stem" if stem else "prepared",
                "contentType": "audio/wav",
                "durationSec": round(sf.info(str(out)).duration, 3),
                "bpm": ops.tempo if ops.tempo is not None else bpm,
                "key": shift_key(key, ops.semitones),
                "parentId": sample_id,
                "stem": stem,
                "ops": labels,
                "createdAt": now(),
            }
            names = free_names(source_name, stem, ops, taken)
            taken.update(names[:1])
            yield Output(out, doc, names)

    return publish(samples, bucket, uid, outputs(), lambda ref, doc, names: create_unique(db, samples, ref, doc, names))


def connect() -> tuple[Any, Any]:
    from google.cloud import firestore, storage

    db = firestore.Client(project=PROJECT, database=DATABASE)
    return db, storage.Client(project=PROJECT).bucket(BUCKET)


def main(env: Mapping[str, str] = os.environ, connect: Any = connect, work_prep: Any = prep) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    job = None
    job_id = env.get("JAM_JOB_ID", "?")
    # Everything is inside the try, so a missing env var or a bad client still marks the job failed
    # when it can. When it cannot (no uid or job id), the server reports the job as stopped later.
    try:
        uid, job_id, sample_id = env["JAM_UID"], env["JAM_JOB_ID"], env["JAM_SAMPLE_ID"]
        db, bucket = connect()
        job = db.document(f"users/{uid}/prep_jobs/{job_id}")
        ops = parse_ops(env.get("JAM_OPS", ""))
        job.update({"status": "running", "updatedAt": now()})
        with tempfile.TemporaryDirectory() as tmp:
            ids = work_prep(db, bucket, uid, sample_id, ops, Path(tmp))
        job.update({"status": "done", "sampleIds": ids, "updatedAt": now()})
        return 0
    except Exception as e:
        log.error("prep %s failed: %s", job_id, traceback.format_exc())
        error = str(e) if isinstance(e, PrepError) else "Prep failed. Try a shorter clip, or try again later."
        if job is not None:
            try:
                job.update({"status": "failed", "error": error, "updatedAt": now()})
            except Exception:  # noqa: BLE001
                log.exception("could not mark prep %s failed", job_id)
        return 1


if __name__ == "__main__":
    sys.exit(main())
