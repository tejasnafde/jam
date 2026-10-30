import { SAMPLE_MAX_BYTES, type Sample } from "@jam/shared";

const TYPES: Record<string, Sample["contentType"]> = { mp3: "audio/mpeg", wav: "audio/wav" };

/** The upload content type, from the file extension. Null for anything but mp3 and wav. */
export function contentTypeOf(fileName: string): Sample["contentType"] | null {
  return TYPES[fileName.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

/** A Strudel-safe, unused sample name from a file name: "My Song (v2).mp3" -> "my_song_v2". */
export function toSampleName(fileName: string, taken: ReadonlySet<string>): string {
  let base = fileName
    .replace(/\.[^.]*$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "")
    .slice(0, 34);
  if (base.length < 2) base = "sample";
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
  return name;
}

/** Duration in seconds, read by the browser's own decoder. */
export function durationOf(file: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (fn: () => void) => {
      URL.revokeObjectURL(url);
      fn();
    };
    audio.onloadedmetadata = () => done(() => resolve(Number.isFinite(audio.duration) ? audio.duration : 0));
    audio.onerror = () => done(() => reject(new Error("The browser cannot read this audio file.")));
    audio.preload = "metadata";
    audio.src = url;
  });
}

/** "3.2 s · 92 BPM · F# minor" */
export function sampleFacts(s: Sample): string {
  const facts = [`${s.durationSec.toFixed(1)} s`];
  if (s.bpm) facts.push(`${Math.round(s.bpm)} BPM`);
  if (s.key) facts.push(s.key);
  if (s.stem) facts.push(s.stem);
  return facts.join(" · ");
}

/** Why a file cannot be a sample, or null when it can: the same rules as the Upload button. */
export function audioFileProblem(file: Pick<File, "name" | "size">): string | null {
  if (!contentTypeOf(file.name)) return "is not an mp3 or wav file";
  if (file.size > SAMPLE_MAX_BYTES) return "is larger than 50 MB";
  if (file.size === 0) return "is empty";
  return null;
}

/** Splits dropped files into the ones to upload and the ones to refuse, with the reason. */
export function sortDroppedFiles<T extends Pick<File, "name" | "size">>(files: Iterable<T>) {
  const accepted: T[] = [];
  const rejected: { name: string; reason: string }[] = [];
  for (const f of files) {
    const reason = audioFileProblem(f);
    if (reason) rejected.push({ name: f.name, reason });
    else accepted.push(f);
  }
  return { accepted, rejected };
}
