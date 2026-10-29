"""Unit tests: python -m unittest test_prep (needs requirements-audio.txt)."""

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf

import main
from analysis import detect_bpm, detect_key
from ops import Ops, PrepError, free_names, op_labels, output_name, parse_ops, shift_key, tempo_source
from publish import Output, publish

SR = 22050


def click_track(bpm: float, seconds: float = 12.0) -> np.ndarray:
    y = np.zeros(int(SR * seconds), dtype=np.float32)
    click = np.sin(2 * np.pi * 1000 * np.arange(int(0.01 * SR)) / SR) * np.hanning(int(0.01 * SR))
    for t in np.arange(0, seconds, 60 / bpm):
        i = int(t * SR)
        y[i : i + len(click)] += click[: len(y) - i]
    return y


def chords(progression: list[list[float]], seconds_each: float = 1.0) -> np.ndarray:
    """Each chord is a list of MIDI notes, played as sine tones."""
    t = np.arange(int(SR * seconds_each)) / SR
    out = []
    for chord in progression:
        tone = sum(np.sin(2 * np.pi * 440 * 2 ** ((m - 69) / 12) * t) for m in chord)
        out.append(tone / len(chord))
    return np.concatenate(out * 3).astype(np.float32)


class TestAnalysis(unittest.TestCase):
    def test_bpm_of_click_tracks(self):
        for bpm in (90, 120, 140):
            with self.subTest(bpm=bpm):
                self.assertAlmostEqual(detect_bpm(click_track(bpm), SR), bpm, delta=3)

    def test_bpm_of_silence(self):
        self.assertIsNone(detect_bpm(np.zeros(SR * 4, dtype=np.float32), SR))

    def test_key_c_major(self):
        # C - F - G - C
        y = chords([[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]])
        self.assertEqual(detect_key(y, SR), "C major")

    def test_key_a_minor(self):
        # Am - Dm - E - Am (harmonic minor, so not mistaken for C major)
        y = chords([[57, 60, 64], [62, 65, 69], [64, 68, 71], [57, 60, 64]])
        self.assertEqual(detect_key(y, SR), "A minor")

    def test_key_of_silence(self):
        self.assertIsNone(detect_key(np.zeros(SR * 2, dtype=np.float32), SR))


class TestOps(unittest.TestCase):
    def test_parses_valid_ops(self):
        self.assertEqual(parse_ops('{"split": true}'), Ops(split=True))
        self.assertEqual(parse_ops('{"tempo": 120, "semitones": -2}'), Ops(tempo=120.0, semitones=-2))
        self.assertEqual(parse_ops('{"semitones": 3.0}').semitones, 3)

    def test_rejects_bad_ops(self):
        for raw in [
            "not json",
            "[]",
            "{}",
            '{"semitones": 0}',
            '{"split": "yes"}',
            '{"tempo": 39}',
            '{"tempo": 221}',
            '{"tempo": true}',
            '{"semitones": 1.5}',
            '{"semitones": 13}',
            '{"split": true, "voice": "someone"}',
            '{"split": true, "sourceBpm": 60}',
            '{"tempo": 90, "sourceBpm": 10}',
            '{"tempo": 90, "sourceBpm": "60"}',
        ]:
            with self.subTest(raw=raw), self.assertRaises(PrepError):
                parse_ops(raw)

    def test_shift_key(self):
        self.assertEqual(shift_key("A minor", 3), "C minor")
        self.assertEqual(shift_key("C major", -1), "B major")
        self.assertEqual(shift_key("F# minor", 12), "F# minor")
        self.assertIsNone(shift_key(None, 2))

    def test_parses_a_confirmed_source_tempo(self):
        self.assertEqual(parse_ops('{"tempo": 90, "sourceBpm": 60}'), Ops(tempo=90.0, source_bpm=60.0))

    def test_labels(self):
        ops = Ops(split=True, tempo=120.0, semitones=2)
        self.assertEqual(op_labels(ops, 98.5), ["split:htdemucs", "tempo:98.5->120", "semitones:+2"])

    def test_labels_without_a_source_tempo(self):
        self.assertEqual(op_labels(Ops(tempo=90.0), None), ["tempo:?->90"])

    def test_tempo_source(self):
        # The user's halved 60 wins over the octave-folded 120.
        self.assertEqual(tempo_source(Ops(tempo=90.0, source_bpm=60.0), 120.0), 60.0)
        self.assertEqual(tempo_source(Ops(tempo=90.0), 120.0), 120.0)
        self.assertIsNone(tempo_source(Ops(split=True), None))
        with self.assertRaisesRegex(PrepError, "Could not detect the tempo"):
            tempo_source(Ops(tempo=90.0), None)

    def test_free_names_skip_taken_ones(self):
        names = free_names("song", "vocals", Ops(split=True), {"song_vocals", "song_vocals_2"}, 3)
        self.assertEqual(names, ["song_vocals_3", "song_vocals_4", "song_vocals_5"])

    def test_names_are_strudel_safe_and_unique(self):
        ops = Ops(split=True, tempo=120.0, semitones=-2)
        self.assertEqual(output_name("song", "vocals", ops, set()), "song_vocals_120bpm_down2")
        self.assertEqual(output_name("song", None, Ops(semitones=1), {"song_up1"}), "song_up1_2")
        long = output_name("a" * 40, "drums", ops, set())
        self.assertLessEqual(len(long), 40)
        self.assertTrue(long.endswith("_drums_120bpm_down2"))



@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "needs ffmpeg")
class TestLength(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.src = self.dir / "src.mp3"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-b:a", "32k", str(self.src)],
            check=True,
        )

    def tearDown(self):
        shutil.rmtree(self.dir)

    def test_probe_reads_the_duration_without_a_decode(self):
        self.assertAlmostEqual(main.probe_seconds(self.src), 8, delta=0.2)

    def test_refuses_a_long_source_before_the_decode(self):
        main.check_length(self.src, max_seconds=10)
        with self.assertRaisesRegex(PrepError, "longer than"):
            main.check_length(self.src, max_seconds=5)

    def test_decode_stops_one_second_past_the_limit(self):
        dst = self.dir / "out.wav"
        with self.assertRaisesRegex(PrepError, "longer than"):
            main.decode(self.src, dst, max_seconds=3)
        self.assertAlmostEqual(sf.info(str(dst)).duration, 4, delta=0.1)

    def test_unreadable_source(self):
        bad = self.dir / "bad"
        bad.write_bytes(b"not audio")
        with self.assertRaises(PrepError):
            main.check_length(bad)


class FakeRef:
    def __init__(self, store, id):
        self.store, self.id = store, id

    def delete(self):
        self.store.docs.pop(self.id, None)


class FakeSamples:
    def __init__(self):
        self.docs, self.n = {}, 0

    def document(self):
        self.n += 1
        return FakeRef(self, f"d{self.n}")


class FakeBlob:
    def __init__(self, bucket, name):
        self.bucket, self.name = bucket, name

    def upload_from_filename(self, path, content_type):
        self.bucket.objects[self.name] = Path(path).read_bytes()

    def delete(self):
        self.bucket.objects.pop(self.name, None)


class FakeBucket:
    def __init__(self):
        self.objects = {}

    def blob(self, name):
        return FakeBlob(self, name)


class TestPublish(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.samples, self.bucket = FakeSamples(), FakeBucket()
        self.taken = {"song_vocals"}  # a name another tab took after the job read the list

    def tearDown(self):
        shutil.rmtree(self.dir)

    def output(self, stem):
        path = self.dir / f"{stem}.wav"
        path.write_bytes(stem.encode())
        return Output(path, {"stem": stem}, [f"song_{stem}", f"song_{stem}_2"])

    def create(self, ref, doc, names):
        """Like create_unique: the first name nobody holds wins."""
        name = next(n for n in names if n not in self.taken)
        self.taken.add(name)
        self.samples.docs[ref.id] = {**doc, "name": name}
        return name

    def test_uploads_then_registers_with_a_free_name(self):
        outs = [self.output("vocals"), self.output("drums")]
        ids = publish(self.samples, self.bucket, "u1", outs, self.create)
        self.assertEqual(ids, ["d1", "d2"])
        self.assertEqual(self.samples.docs["d1"]["name"], "song_vocals_2")
        self.assertEqual(self.samples.docs["d1"]["storagePath"], "users/u1/samples/d1.wav")
        self.assertEqual(set(self.bucket.objects), {"users/u1/samples/d1.wav", "users/u1/samples/d2.wav"})
        self.assertFalse(any(o.path.exists() for o in outs), "temp WAVs are deleted after upload")

    def test_a_failed_register_removes_every_doc_and_blob(self):
        calls = []

        def create(ref, doc, names):
            calls.append(ref.id)
            if len(calls) == 2:
                raise RuntimeError("Firestore said no")
            return self.create(ref, doc, names)

        with self.assertRaises(RuntimeError):
            publish(self.samples, self.bucket, "u1", [self.output("vocals"), self.output("drums")], create)
        self.assertEqual(self.samples.docs, {})
        self.assertEqual(self.bucket.objects, {})

    def test_a_failed_stretch_removes_the_uploaded_blobs(self):
        def outputs():
            yield self.output("vocals")
            raise PrepError("rubberband failed")

        with self.assertRaises(PrepError):
            publish(self.samples, self.bucket, "u1", outputs(), self.create)
        self.assertEqual(self.bucket.objects, {})
        self.assertEqual(self.samples.docs, {})


class FakeJob:
    def __init__(self):
        self.updates = []

    def update(self, patch):
        self.updates.append(patch)


class FakeDb:
    def __init__(self):
        self.job = FakeJob()

    def document(self, path):
        self.path = path
        return self.job


class TestMain(unittest.TestCase):
    ENV = {"JAM_UID": "u1", "JAM_JOB_ID": "j1", "JAM_SAMPLE_ID": "s1", "JAM_OPS": '{"split": true}'}

    def run_main(self, env, prep=None):
        db = FakeDb()
        code = main.main(env, connect=lambda: (db, None), work_prep=prep or (lambda *a: ["p1"]))
        return code, db

    def test_done(self):
        code, db = self.run_main(self.ENV)
        self.assertEqual(code, 0)
        self.assertEqual(db.path, "users/u1/prep_jobs/j1")
        self.assertEqual(db.job.updates[-1]["sampleIds"], ["p1"])

    def test_missing_ops_marks_the_job_failed(self):
        env = {k: v for k, v in self.ENV.items() if k != "JAM_OPS"}
        code, db = self.run_main(env)
        self.assertEqual(code, 1)
        self.assertEqual(db.job.updates[-1]["status"], "failed")

    def test_missing_uid_fails_without_a_crash(self):
        env = {k: v for k, v in self.ENV.items() if k != "JAM_UID"}
        code, db = self.run_main(env)
        self.assertEqual(code, 1)
        self.assertEqual(db.job.updates, [])

    def test_an_unexpected_error_gets_the_generic_message(self):
        def boom(*_):
            raise MemoryError()

        code, db = self.run_main(self.ENV, boom)
        self.assertEqual(code, 1)
        self.assertEqual(db.job.updates[-1]["status"], "failed")
        self.assertIn("Try a shorter clip", db.job.updates[-1]["error"])


if __name__ == "__main__":
    unittest.main()
