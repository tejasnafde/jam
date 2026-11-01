import { afterEach, describe, expect, it, vi } from "vitest";
import {
  awaitReply,
  BUILD_ID,
  FRAME_DID_NOT_LOAD,
  FRAME_OTHER_BUILD,
  FRAME_READY,
  waitForReady,
  isRenderReply,
  isRenderRequest,
  RenderCancelled,
  RenderFailed,
  RenderTimeout,
  type PortLike,
  type RenderReply,
} from "./protocol";

const REQUEST = {
  type: "render",
  code: 's("bd")',
  cycles: 4,
  cps: 0.5,
  tailSeconds: 2,
  sampleMap: { kick: "https://x/k.wav" },
};
const STATS = {
  cps: 0.5,
  seconds: 10,
  sampleRate: 48_000,
  peak: 0.7,
  firstSoundSec: 0,
  renderMs: 900,
  failed: 0,
  firstError: "",
};

/** A port the test drives by hand. */
function fakePort() {
  const port: PortLike & { closed: boolean; send(msg: unknown): void } = {
    onmessage: null,
    closed: false,
    close() {
      port.closed = true;
    },
    send(msg) {
      port.onmessage?.({ data: msg } as MessageEvent);
    },
  };
  return port;
}

afterEach(() => vi.useRealTimers());

describe("isRenderRequest", () => {
  it("accepts a full request", () => expect(isRenderRequest(REQUEST)).toBe(true));
  it.each([
    ["no code", { ...REQUEST, code: 1 }],
    ["zero cycles", { ...REQUEST, cycles: 0 }],
    ["a bad tempo", { ...REQUEST, cps: Number.NaN }],
    ["a negative tail", { ...REQUEST, tailSeconds: -1 }],
    ["a bad sample map", { ...REQUEST, sampleMap: { kick: 3 } }],
    ["another type", { ...REQUEST, type: "play" }],
  ])("refuses %s", (_name, msg) => expect(isRenderRequest(msg)).toBe(false));
});

describe("isRenderReply", () => {
  it("accepts progress, error and done", () => {
    expect(isRenderReply({ type: "progress", fraction: 0.5 })).toBe(true);
    expect(isRenderReply({ type: "error", message: "no" })).toBe(true);
    expect(isRenderReply({ type: "done", wav: new ArrayBuffer(8), peaks: [0, 1], stats: STATS })).toBe(true);
  });
  it("refuses a done without a buffer or with bad stats", () => {
    expect(isRenderReply({ type: "done", wav: "x", peaks: [], stats: STATS })).toBe(false);
    expect(isRenderReply({ type: "done", wav: new ArrayBuffer(8), peaks: [], stats: { ...STATS, peak: "1" } })).toBe(
      false,
    );
  });
});

describe("awaitReply", () => {
  it("reports progress and resolves with done, then closes the port", async () => {
    const port = fakePort();
    const progress: number[] = [];
    const reply = awaitReply(port, { timeoutMs: 1000, onProgress: (f) => progress.push(f) });
    port.send({ type: "progress", fraction: 0.25 });
    port.send({ type: "progress", fraction: 2 });
    port.send({ junk: true });
    const done: RenderReply = { type: "done", wav: new ArrayBuffer(4), peaks: [1], stats: STATS };
    port.send(done);
    await expect(reply).resolves.toBe(done);
    expect(progress).toEqual([0.25, 1]);
    expect(port.closed).toBe(true);
    expect(port.onmessage).toBeNull();
  });

  it("rejects with the frame's error, and keeps the code-error flag", async () => {
    const port = fakePort();
    const reply = awaitReply(port, { timeoutMs: 1000 });
    port.send({ type: "error", message: "The code does not run: x", codeError: true });
    const err = await reply.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderFailed);
    expect((err as RenderFailed).codeError).toBe(true);
  });

  it("rejects with RenderTimeout after the time limit", async () => {
    vi.useFakeTimers();
    const port = fakePort();
    const reply = awaitReply(port, { timeoutMs: 60_000 });
    vi.advanceTimersByTime(60_001);
    await expect(reply).rejects.toBeInstanceOf(RenderTimeout);
    expect(port.closed).toBe(true);
  });

  it("rejects with RenderCancelled on abort", async () => {
    const port = fakePort();
    const controller = new AbortController();
    const reply = awaitReply(port, { timeoutMs: 1000, signal: controller.signal });
    controller.abort();
    await expect(reply).rejects.toBeInstanceOf(RenderCancelled);
  });

  it("works over a real MessageChannel, with the buffer transferred", async () => {
    const channel = new MessageChannel();
    const reply = awaitReply(channel.port1, { timeoutMs: 2000 });
    const wav = new ArrayBuffer(16);
    channel.port2.postMessage({ type: "done", wav, peaks: [0.5], stats: STATS }, [wav]);
    const done = await reply;
    expect(done.wav.byteLength).toBe(16);
    expect(wav.byteLength).toBe(0);
    channel.port2.close();
  });
});

describe("awaitReply limits", () => {
  it("starts the quiet limit again on each progress, up to the hard cap", async () => {
    vi.useFakeTimers();
    const port = fakePort();
    const reply = awaitReply(port, { timeoutMs: 1000, capMs: 2500 });
    const caught = reply.catch((e: unknown) => e);
    vi.advanceTimersByTime(900);
    port.send({ type: "progress", fraction: 0.3 });
    vi.advanceTimersByTime(900);
    port.send({ type: "progress", fraction: 0.6 });
    expect(port.closed).toBe(false);
    vi.advanceTimersByTime(800);
    const err = await caught;
    expect(err).toBeInstanceOf(RenderTimeout);
    expect((err as Error).message).toBe("The render took more than 3 s.");
  });
});

describe("waitForReady", () => {
  const source = {};
  const fromFrame = (e: MessageEvent) => e.source === source;
  const send = (target: EventTarget, data: unknown) =>
    target.dispatchEvent(new MessageEvent("message", { data, origin: location.origin, source: source as Window }));

  it("resolves on a ready of this build", async () => {
    const target = new EventTarget();
    const ready = waitForReady(target, { fromFrame, timeoutMs: 1000 });
    send(target, { type: FRAME_READY, build: BUILD_ID });
    await expect(ready).resolves.toBeUndefined();
  });

  it("fails at once, with the real cause, for a frame of another build (a stale render.html)", async () => {
    const target = new EventTarget();
    const ready = waitForReady(target, { fromFrame, timeoutMs: 60_000 });
    send(target, { type: FRAME_READY, build: "an-older-deploy" });
    const err = await ready.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RenderFailed);
    expect((err as Error).message).toBe(FRAME_OTHER_BUILD);
  });

  it("fails after its own short limit when the frame's script never runs", async () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const ready = waitForReady(target, { fromFrame, timeoutMs: 15_000 });
    const caught = ready.catch((e: unknown) => e);
    // A ready from another window, or from another origin, does not count.
    target.dispatchEvent(
      new MessageEvent("message", { data: { type: FRAME_READY, build: BUILD_ID }, origin: location.origin }),
    );
    vi.advanceTimersByTime(15_001);
    expect(((await caught) as Error).message).toBe(FRAME_DID_NOT_LOAD);
  });
});
