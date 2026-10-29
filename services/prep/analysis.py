"""Tempo and key detection with librosa."""

import librosa
import numpy as np

from ops import NOTES

# Krumhansl-Kessler key profiles, tonic first.
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def detect_bpm(y: np.ndarray, sr: int) -> float | None:
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
    bpm = float(np.atleast_1d(tempo)[0])
    if bpm <= 0 or len(beats) < 4:
        return None
    # ponytail: octave fold into 70-180 BPM. The beat tracker often halves fast
    # tempos; a real 60 BPM ballad reads as 120. A tempo prior per genre would fix both.
    while bpm < 70:
        bpm *= 2
    while bpm >= 180:
        bpm /= 2
    return round(bpm, 1)


def detect_key(y: np.ndarray, sr: int) -> str | None:
    """Correlates the mean chroma with all 24 rotated profiles; the best one wins."""
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr).mean(axis=1)
    if not np.any(chroma > 0) or np.allclose(chroma, chroma[0]):
        return None
    scores = [
        (np.corrcoef(np.roll(profile, tonic), chroma)[0, 1], f"{NOTES[tonic]} {mode}")
        for mode, profile in (("major", MAJOR), ("minor", MINOR))
        for tonic in range(12)
    ]
    return max(scores)[1]
