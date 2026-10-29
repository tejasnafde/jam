import type { GetIdToken } from "@/lib/api";
import { createUploadUrl, registerSample } from "@/lib/samples-api";
import { computeStats, encodeWav } from "./dsp/wav";

/** Other features (the library) listen for this to refresh and register samples with Strudel. */
export const SAMPLES_CHANGED = "jam:samples-changed";

export interface TakeMeta {
  name: string;
  ops: string[];
  bpm?: number;
  key?: string;
}

/** Encodes the rendered take as WAV, uploads it to the signed URL and registers it as a "take". */
export async function saveTake(getIdToken: GetIdToken, audio: AudioBuffer, meta: TakeMeta) {
  const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
  const mono = new Float32Array(audio.length);
  for (const ch of channels)
    for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] ?? 0) + (ch[i] ?? 0) / channels.length;

  const { id, uploadUrl, storagePath } = await createUploadUrl(getIdToken, {
    name: meta.name,
    contentType: "audio/wav",
  });
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "audio/wav" },
    body: new Blob([encodeWav(channels, audio.sampleRate)], { type: "audio/wav" }),
  });
  if (!put.ok) throw new Error(`Upload failed (HTTP ${put.status})`);

  const sample = await registerSample(getIdToken, {
    id,
    name: meta.name,
    kind: "take",
    storagePath,
    contentType: "audio/wav",
    durationSec: audio.duration,
    bpm: meta.bpm,
    key: meta.key,
    stats: computeStats(mono, audio.sampleRate),
    ops: meta.ops,
  });
  window.dispatchEvent(new CustomEvent(SAMPLES_CHANGED, { detail: sample }));
  return sample;
}
