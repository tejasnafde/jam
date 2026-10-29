"""Prep job ops: parse JAM_OPS, name outputs, shift keys. No audio here."""

import json
import re
from dataclasses import dataclass

NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
SAMPLE_NAME = re.compile(r"^[a-z][a-z0-9_]{1,39}$")
NAME_MAX = 40


class PrepError(Exception):
    """A failure the user can understand. Its message goes to the job doc."""


@dataclass(frozen=True)
class Ops:
    split: bool = False
    tempo: float | None = None
    semitones: int = 0
    # The source tempo the user confirmed in the page (packages/shared/src/prepRequest.ts).
    source_bpm: float | None = None

    @property
    def stretch(self) -> bool:
        return self.tempo is not None or self.semitones != 0


def _number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def parse_ops(raw: str) -> Ops:
    """Mirrors PrepOpsSchema in packages/shared/src/prepRequest.ts."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise PrepError(f"ops are not JSON: {e.msg}") from None
    if not isinstance(data, dict):
        raise PrepError("ops must be an object")
    unknown = set(data) - {"split", "tempo", "semitones", "sourceBpm"}
    if unknown:
        raise PrepError(f"unknown ops: {', '.join(sorted(unknown))}")
    split = data.get("split", False)
    tempo = data.get("tempo")
    semitones = data.get("semitones", 0)
    source_bpm = data.get("sourceBpm")
    if not isinstance(split, bool):
        raise PrepError("split must be true or false")
    if tempo is not None and not (_number(tempo) and 40 <= tempo <= 220):
        raise PrepError("tempo must be a number from 40 to 220")
    if not (_number(semitones) and float(semitones).is_integer() and -12 <= semitones <= 12):
        raise PrepError("semitones must be a whole number from -12 to 12")
    if source_bpm is not None and not (_number(source_bpm) and 30 <= source_bpm <= 300):
        raise PrepError("sourceBpm must be a number from 30 to 300")
    if source_bpm is not None and tempo is None:
        raise PrepError("sourceBpm needs a tempo")
    ops = Ops(
        split=split,
        tempo=None if tempo is None else float(tempo),
        semitones=int(semitones),
        source_bpm=None if source_bpm is None else float(source_bpm),
    )
    if not ops.split and not ops.stretch:
        raise PrepError("nothing to do: ask for split, tempo or semitones")
    return ops


def shift_key(key: str | None, semitones: int) -> str | None:
    """'A minor' up 3 is 'C minor'."""
    if key is None or semitones == 0:
        return key
    tonic, mode = key.split(" ", 1)
    return f"{NOTES[(NOTES.index(tonic) + semitones) % 12]} {mode}"


def tempo_source(ops: Ops, detected: float | None) -> float | None:
    """The source tempo to stretch from: the user's choice, else the detected one.

    Raises right after the analysis, before Demucs spends minutes, when a tempo
    match has no source tempo.
    """
    if ops.tempo is None:
        return detected
    bpm = ops.source_bpm or detected
    if not bpm:
        raise PrepError("Could not detect the tempo of the source. Enter it in Match tempo and try again.")
    return bpm


def op_labels(ops: Ops, source_bpm: float | None) -> list[str]:
    """Human readable, for Sample.ops."""
    labels = []
    if ops.split:
        labels.append("split:htdemucs")
    if ops.tempo is not None:
        source = "?" if source_bpm is None else f"{source_bpm:g}"
        labels.append(f"tempo:{source}->{ops.tempo:g}")
    if ops.semitones:
        labels.append(f"semitones:{ops.semitones:+d}")
    return labels


def name_candidates(source: str, stem: str | None, ops: Ops):
    """Strudel-safe names in order of preference, such as 'song_vocals_120bpm_up2', then '..._2'."""
    parts = [stem] if stem else []
    if ops.tempo is not None:
        parts.append(f"{round(ops.tempo)}bpm")
    if ops.semitones:
        parts.append(f"{'up' if ops.semitones > 0 else 'down'}{abs(ops.semitones)}")
    suffix = "_".join(parts)
    for n in range(1, 1000):
        tail = "_".join(p for p in (suffix, "" if n == 1 else str(n)) if p)
        base = source[: NAME_MAX - len(tail) - 1].rstrip("_") or "s"
        name = f"{base}_{tail}"
        assert SAMPLE_NAME.match(name), name
        yield name


def free_names(source: str, stem: str | None, ops: Ops, taken: set[str], count: int = 10) -> list[str]:
    """The first `count` candidates not in `taken`. The create transaction re-checks each one."""
    names = []
    for name in name_candidates(source, stem, ops):
        if name not in taken:
            names.append(name)
            if len(names) == count:
                break
    if not names:
        raise PrepError("could not find a free sample name")
    return names


def output_name(source: str, stem: str | None, ops: Ops, taken: set[str]) -> str:
    """A Strudel-safe name unique among `taken`."""
    return free_names(source, stem, ops, taken, 1)[0]
