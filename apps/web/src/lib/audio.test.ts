import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A tiny stand-in for Web Audio: a node has a level, and an analyser reports the loudest node
// connected to it as a constant signal. jsdom has no Web Audio of its own.
class FakeNode {
  declare __jamTapped?: boolean;
  level = 0;
  inputs: FakeNode[] = [];
  constructor(public context: FakeContext) {}
  connect(dest: FakeNode) {
    dest.inputs.push(this);
    return dest;
  }
}
class FakeDestination extends FakeNode {}
class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  smoothingTimeConstant = 0;
  get frequencyBinCount() {
    return this.fftSize / 2;
  }
  getFloatTimeDomainData(buf: Float32Array) {
    buf.fill(Math.max(0, ...this.inputs.map((n) => n.level)));
  }
  getFloatFrequencyData(buf: Float32Array) {
    buf.fill(-30);
  }
}
class FakeContext {
  sampleRate = 48000;
  destination: FakeDestination = new FakeDestination(this);
  createAnalyser() {
    return new FakeAnalyser(this);
  }
}
class FakeOfflineContext extends FakeContext {}

function source(ctx: FakeContext, level: number) {
  const n = new FakeNode(ctx);
  n.level = level;
  return n;
}

const plainConnect = FakeNode.prototype.connect;

/** A fresh module and a fresh tap: the tap patches the prototype once per page. */
async function loadAudio() {
  FakeNode.prototype.connect = plainConnect;
  delete FakeNode.prototype.__jamTapped;
  vi.resetModules();
  const audio = await import("./audio");
  audio.installAudioTap();
  return audio;
}

describe("audio tap", () => {
  beforeEach(() => {
    vi.stubGlobal("AudioNode", FakeNode);
    vi.stubGlobal("AudioDestinationNode", FakeDestination);
    vi.stubGlobal("OfflineAudioContext", FakeOfflineContext);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the music", async () => {
    const { read } = await loadAudio();
    const music = new FakeContext();
    source(music, 0.5).connect(music.destination);
    expect(read()?.rms).toBeCloseTo(0.5);
  });

  // Regression: Strudel renders a .room() reverb in an OfflineAudioContext and connects it to that
  // context's destination. The tap moved its analyser there, so every later snapshot was silence
  // and no audio was saved.
  it("keeps reading the music after a reverb is rendered offline", async () => {
    const { read } = await loadAudio();
    const music = new FakeContext();
    source(music, 0.5).connect(music.destination);
    const offline = new FakeOfflineContext();
    source(offline, 0.9).connect(offline.destination);
    expect(read()?.rms).toBeCloseTo(0.5);
  });

  it("keeps reading Strudel's context after another AudioContext plays", async () => {
    const { read } = await loadAudio();
    const music = new FakeContext();
    vi.stubGlobal("getAudioContext", () => music);
    source(music, 0.5).connect(music.destination);
    const booth = new FakeContext();
    source(booth, 0).connect(booth.destination);
    expect(read()?.rms).toBeCloseTo(0.5);
  });
});
