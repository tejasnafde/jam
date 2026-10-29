// Runs the pitch stage off the main thread. See pitchInWorker in effects.ts.
import { pitchTrack } from "./dsp/pitch";
import { pitchStage, type PitchJob } from "./effects";

self.onmessage = (e: MessageEvent<PitchJob>) => {
  const { dry, sampleRate, fx } = e.data;
  const track = e.data.track ?? pitchTrack(dry, sampleRate);
  const x = pitchStage(dry, sampleRate, fx, track);
  // x is always new here (the caller skips the worker when no pitch effect is on).
  self.postMessage({ x, track }, { transfer: [x.buffer, track.buffer] });
};
