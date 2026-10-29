const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** "A minor" up 3 is "C minor". The same rule as services/prep/ops.py shift_key. */
export function shiftKey(key: string | undefined, semitones: number): string | undefined {
  if (!key || semitones === 0) return key;
  const [tonic = "", ...mode] = key.split(" ");
  const i = NOTES.indexOf(tonic);
  if (i < 0) return undefined;
  return [NOTES[(((i + semitones) % 12) + 12) % 12], ...mode].join(" ");
}
