import type { SamplesApi } from "@/lib/samples-api";
import { computeStats, encodeWav } from "./dsp/wav";

export interface TakeMeta {
  name: string;
  ops: string[];
  bpm?: number;
  key?: string;
}

/** Encodes the rendered take as WAV, uploads it to the signed URL and registers it as a "take". */
export async function saveTake(client: SamplesApi, audio: AudioBuffer, meta: TakeMeta) {
  const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
  const mono = new Float32Array(audio.length);
  for (const ch of channels)
    for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] ?? 0) + (ch[i] ?? 0) / channels.length;

  const { id, uploadUrl, storagePath } = await client.uploadUrl({ name: meta.name, contentType: "audio/wav" });
  const wav = new Blob([encodeWav(channels, audio.sampleRate)], { type: "audio/wav" });
  await client.put(uploadUrl, wav, "audio/wav");
  return client.register({
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
}
