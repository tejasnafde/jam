// The parts of Strudel that the REPL's prebake puts on globalThis (evalScope copies every
// @strudel/webaudio export there). The REPL is a bundle, so importing superdough here would
// load a second copy with an empty sound map; globalThis is the one the music uses.
import type { SoundItem, StrudelSoundEntry } from "./catalog";
import { isPitched } from "./snippet";

interface SoundMapStore {
  get(): Record<string, StrudelSoundEntry | undefined>;
  listen(cb: () => void): () => void;
}

interface StrudelScope {
  soundMap?: SoundMapStore;
  superdough?: (value: Record<string, unknown>, t: number, duration: number) => Promise<unknown>;
  getAudioContext?: () => AudioContext;
}

const scope = () => globalThis as StrudelScope;

/** Strudel's live sound map, or null before the REPL has loaded. */
export const strudelSoundMap = (): SoundMapStore | null => {
  const m = scope().soundMap;
  return m && typeof m.get === "function" && typeof m.listen === "function" ? m : null;
};

// A separate orbit, so a preview does not pick up the delay or reverb the user set on the music.
const PREVIEW_ORBIT = 15;
/** How far ahead a preview is scheduled, in seconds. */
export const PREVIEW_LEAD = 0.05;

/**
 * Plays one sound once through superdough, on the same AudioContext as the music. It does not touch
 * the scheduler, so a playing pattern keeps going. Pitched sounds play c3.
 * Returns false when Strudel is not loaded yet.
 *
 * Strudel fetches a sample the first time it plays, and drops the hit when the fetch ends after its
 * time. So when the first call returns late, the sound is loaded now and plays once more.
 */
export async function previewSound(item: SoundItem): Promise<boolean> {
  const { superdough, getAudioContext } = scope();
  if (!superdough || !getAudioContext) return false;
  const ac = getAudioContext();
  if (ac.state !== "running") await ac.resume();
  const pitched = isPitched(item);
  const duration = pitched ? 0.6 : 1.5;
  // A new object for each call: superdough changes the value it gets.
  const value = (): Record<string, unknown> => {
    const v: Record<string, unknown> = { s: item.key, n: 0, gain: 0.8, orbit: PREVIEW_ORBIT };
    if (pitched) v.note = "c3";
    // A release makes a sample stop at the duration, so a long loop or a song previews for a moment only.
    else v.release = 0.05;
    return v;
  };
  const at = ac.currentTime + PREVIEW_LEAD;
  await superdough(value(), at, duration);
  if (ac.currentTime > at) await superdough(value(), ac.currentTime + PREVIEW_LEAD, duration);
  return true;
}
