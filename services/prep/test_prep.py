"""Unit tests: python -m unittest test_prep (needs requirements-audio.txt)."""

import unittest

import numpy as np

from analysis import detect_bpm, detect_key
from ops import Ops, PrepError, op_labels, output_name, parse_ops, shift_key

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
        ]:
            with self.subTest(raw=raw), self.assertRaises(PrepError):
                parse_ops(raw)

    def test_shift_key(self):
        self.assertEqual(shift_key("A minor", 3), "C minor")
        self.assertEqual(shift_key("C major", -1), "B major")
        self.assertEqual(shift_key("F# minor", 12), "F# minor")
        self.assertIsNone(shift_key(None, 2))

    def test_labels(self):
        ops = Ops(split=True, tempo=120.0, semitones=2)
        self.assertEqual(op_labels(ops, 98.5), ["split:htdemucs", "tempo:98.5->120", "semitones:+2"])

    def test_names_are_strudel_safe_and_unique(self):
        ops = Ops(split=True, tempo=120.0, semitones=-2)
        self.assertEqual(output_name("song", "vocals", ops, set()), "song_vocals_120bpm_down2")
        self.assertEqual(output_name("song", None, Ops(semitones=1), {"song_up1"}), "song_up1_2")
        long = output_name("a" * 40, "drums", ops, set())
        self.assertLessEqual(len(long), 40)
        self.assertTrue(long.endswith("_drums_120bpm_down2"))


if __name__ == "__main__":
    unittest.main()
