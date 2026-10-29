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
from datetime import datetime, timezone
from pathlib import Path

import librosa
import soundfile as sf
from google.cloud import firestore, storage

from analysis import detect_bpm, detect_key
from ops import Ops, PrepError, op_labels, output_name, parse_ops, shift_key

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "teejayproject")
DATABASE = os.environ.get("FIRESTORE_DATABASE", "jam-db")
BUCKET = os.environ.get("SAMPLE_BUCKET", "jam-samples-teejayproject")  # SAMPLE_BUCKET in samples.ts
MAX_SECONDS = 10 * 60
SR = 44100

log = logging.getLogger("prep")


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, capture_output=True)


def decode(src: Path, dst: Path) -> None:
    """Any upload format to 44.1 kHz stereo 16-bit WAV."""
    try:
        run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(src), "-ac", "2", "-ar", str(SR), "-c:a", "pcm_s16le", str(dst)])
    except subprocess.CalledProcessError:
        raise PrepError("Could not decode the source audio.") from None


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


def prep(db: firestore.Client, bucket: storage.Bucket, uid: str, sample_id: str, ops: Ops, work: Path) -> list[str]:
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
    wav = work / "source.wav"
    decode(raw, wav)
    if sf.info(str(wav)).duration > MAX_SECONDS:
        raise PrepError(f"The source is longer than {MAX_SECONDS // 60} minutes.")

    y, sr = librosa.load(str(wav), sr=22050, mono=True)
    bpm, key = detect_bpm(y, sr), detect_key(y, sr)
    source_ref.update({k: v for k, v in {"bpm": bpm, "key": key}.items() if v is not None})
    log.info("analysed source: bpm=%s key=%s", bpm, key)

    parts: dict[str | None, Path] = separate(wav, work) if ops.split else {None: wav}  # type: ignore[assignment]
    taken = {d.get("name") for d in samples.select(["name"]).stream()}
    labels = op_labels(ops, bpm)
    made = []
    for stem, part in parts.items():
        out = part
        if ops.stretch:
            out = work / f"{stem or 'source'}.prepared.wav"
            stretch(part, out, ops, bpm)
        ref = samples.document()
        storage_path = f"users/{uid}/samples/{ref.id}.wav"
        bucket.blob(storage_path).upload_from_filename(str(out), content_type="audio/wav")
        name = output_name(source.get("name"), stem, ops, taken)
        taken.add(name)
        doc = {
            "id": ref.id,
            "userId": uid,
            "name": name,
            "kind": "stem" if stem else "prepared",
            "storagePath": storage_path,
            "contentType": "audio/wav",
            "durationSec": round(sf.info(str(out)).duration, 3),
            "bpm": ops.tempo if ops.tempo is not None else bpm,
            "key": shift_key(key, ops.semitones),
            "parentId": sample_id,
            "stem": stem,
            "ops": labels,
            "createdAt": now(),
        }
        ref.set({k: v for k, v in doc.items() if v is not None})
        made.append(ref.id)
        log.info("made %s (%s)", name, ref.id)
    return made


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    uid, job_id, sample_id = os.environ["JAM_UID"], os.environ["JAM_JOB_ID"], os.environ["JAM_SAMPLE_ID"]
    db = firestore.Client(project=PROJECT, database=DATABASE)
    job = db.document(f"users/{uid}/prep_jobs/{job_id}")
    try:
        ops = parse_ops(os.environ.get("JAM_OPS", ""))
        job.update({"status": "running", "updatedAt": now()})
        with tempfile.TemporaryDirectory() as tmp:
            ids = prep(db, storage.Client(project=PROJECT).bucket(BUCKET), uid, sample_id, ops, Path(tmp))
        job.update({"status": "done", "sampleIds": ids, "updatedAt": now()})
        return 0
    except Exception as e:
        log.error("prep %s failed: %s", job_id, traceback.format_exc())
        error = str(e) if isinstance(e, PrepError) else "Prep failed. Try a shorter clip, or try again later."
        job.update({"status": "failed", "error": error, "updatedAt": now()})
        return 1


if __name__ == "__main__":
    sys.exit(main())
