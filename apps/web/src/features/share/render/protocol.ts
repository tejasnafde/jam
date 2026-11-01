// The messages between the page and the hidden render frame (/render.html).
//
// The page makes a MessageChannel, waits for the frame's "ready", and posts one RenderRequest with
// one port of the channel. The frame answers on that port only: progress, then "done" or "error".

/** Sent by the frame to its parent once its script runs, with the build it belongs to. */
export const FRAME_READY = "jam-render-ready";

/** The build of this page. A frame from another build (a stale cached render.html) is refused. */
export const BUILD_ID: string = __JAM_BUILD__;

export interface FrameReady {
  type: typeof FRAME_READY;
  build: string;
}

export interface RenderRequest {
  type: "render";
  code: string;
  /** Cycles (bars) to render from cycle 0. Haps that start at or after it are cut. */
  cycles: number;
  /** The tempo to start from. A setcps/setcpm in the code still wins, as it does when it plays. */
  cps: number;
  /** Seconds rendered after the last bar, so the reverb fades out. */
  tailSeconds: number;
  /** The user's Library samples (name to URL), registered before the code runs. */
  sampleMap: Record<string, string | string[]>;
}

export interface RenderStats {
  /** The tempo the code ended up at. */
  cps: number;
  /** The rendered length, tail included. */
  seconds: number;
  sampleRate: number;
  /** The loudest absolute sample, 0..1 (before the WAV is encoded). */
  peak: number;
  /** Seconds to the first sample above the silence threshold, or -1 when none. */
  firstSoundSec: number;
  /** Wall time of the whole render in the frame. */
  renderMs: number;
  /** Notes that could not play (a sample that did not load, an unknown sound). */
  failed: number;
  /** The first of those errors, or "". */
  firstError: string;
}

export type RenderReply =
  | { type: "progress"; fraction: number }
  | { type: "done"; wav: ArrayBuffer; peaks: number[]; stats: RenderStats }
  /** `codeError`: the code itself does not run, so recording it in real time would not help. */
  | { type: "error"; message: string; codeError?: boolean };

export type RenderDone = Extract<RenderReply, { type: "done" }>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function isRenderRequest(v: unknown): v is RenderRequest {
  if (!isObject(v) || v.type !== "render") return false;
  const map = v.sampleMap;
  return (
    typeof v.code === "string" &&
    finite(v.cycles) &&
    v.cycles > 0 &&
    finite(v.cps) &&
    v.cps > 0 &&
    finite(v.tailSeconds) &&
    v.tailSeconds >= 0 &&
    isObject(map) &&
    Object.values(map).every(
      (u) => typeof u === "string" || (Array.isArray(u) && u.every((x) => typeof x === "string")),
    )
  );
}

export function isRenderReply(v: unknown): v is RenderReply {
  if (!isObject(v)) return false;
  if (v.type === "progress") return finite(v.fraction);
  if (v.type === "error") return typeof v.message === "string";
  if (v.type !== "done") return false;
  const s = v.stats;
  return (
    // Not instanceof: a buffer from another realm (the frame) is not this realm's ArrayBuffer.
    Object.prototype.toString.call(v.wav) === "[object ArrayBuffer]" &&
    Array.isArray(v.peaks) &&
    v.peaks.every(finite) &&
    isObject(s) &&
    [s.cps, s.seconds, s.sampleRate, s.peak, s.firstSoundSec, s.renderMs, s.failed].every(finite) &&
    typeof s.firstError === "string"
  );
}

/** The frame could not render. `codeError` when the code itself does not run. */
export class RenderFailed extends Error {
  constructor(
    message: string,
    readonly codeError = false,
  ) {
    super(message);
  }
}

/** The render took longer than its time limit. The fallback is offered for it. */
export class RenderTimeout extends Error {
  constructor(seconds: number) {
    super(`The render took more than ${seconds} s.`);
  }
}

export class RenderCancelled extends Error {
  constructor() {
    super("Render cancelled.");
  }
}

/** The page's end of a MessageChannel, or a stand-in in tests. */
export interface PortLike {
  onmessage: ((e: MessageEvent) => void) | null;
  close(): void;
}

export interface TalkOptions {
  /** The longest wait without any message from the frame. Each progress message starts it again. */
  timeoutMs: number;
  /** The longest the whole render may take, progress or not. */
  capMs?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Waits on the page's port for the frame's answer. Resolves with "done", rejects on "error", when
 * the frame is quiet for `timeoutMs`, after `capMs` in all, or on abort. Messages that do not fit
 * the protocol are ignored.
 */
export function awaitReply(
  port: PortLike,
  { timeoutMs, capMs = RENDER_CAP_MS, onProgress, signal }: TalkOptions,
): Promise<RenderDone> {
  return new Promise<RenderDone>((resolve, reject) => {
    const finish = (fn: () => void) => {
      clearTimeout(timer);
      clearTimeout(cap);
      signal?.removeEventListener("abort", onAbort);
      port.onmessage = null;
      port.close();
      fn();
    };
    const onAbort = () => finish(() => reject(new RenderCancelled()));
    const timedOut = (ms: number) => () => finish(() => reject(new RenderTimeout(Math.round(ms / 1000))));
    let timer = setTimeout(timedOut(timeoutMs), timeoutMs);
    const cap = setTimeout(timedOut(capMs), capMs);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort);
    port.onmessage = (e: MessageEvent) => {
      const msg: unknown = e.data;
      if (!isRenderReply(msg)) return;
      if (msg.type === "progress") {
        clearTimeout(timer);
        timer = setTimeout(timedOut(timeoutMs), timeoutMs);
        onProgress?.(Math.min(1, Math.max(0, msg.fraction)));
      } else if (msg.type === "error") finish(() => reject(new RenderFailed(msg.message, !!msg.codeError)));
      else finish(() => resolve(msg));
    };
  });
}

/** The longest the frame may stay quiet while it renders. */
export const RENDER_TIMEOUT_MS = 60_000;
/** The longest a whole render may take, even while it reports progress. */
export const RENDER_CAP_MS = 180_000;
/** The longest wait for the frame's script to start. */
export const READY_TIMEOUT_MS = 15_000;

export const FRAME_DID_NOT_LOAD = "The share renderer did not load. Reload the page.";
export const FRAME_OTHER_BUILD = "The share renderer is from another version of jam. Reload the page.";

export interface ReadyOptions {
  /** True for messages that come from the frame's window. */
  fromFrame: (e: MessageEvent) => boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  build?: string;
}

/**
 * Waits for the frame's "ready". Rejects fast with the real cause: a frame from another build, or
 * a frame whose script never ran (a 404 for a chunk after a deploy) within `timeoutMs`.
 */
export function waitForReady(
  target: EventTarget,
  { fromFrame, timeoutMs = READY_TIMEOUT_MS, signal, build = BUILD_ID }: ReadyOptions,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const done = (fn: () => void) => {
      clearTimeout(timer);
      target.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onMessage = (event: Event) => {
      const e = event as MessageEvent;
      if (!fromFrame(e) || e.origin !== location.origin) return;
      const data: unknown = e.data;
      if (!isObject(data) || data.type !== FRAME_READY) return;
      if (data.build !== build) return done(() => reject(new RenderFailed(FRAME_OTHER_BUILD)));
      done(resolve);
    };
    const onAbort = () => done(() => reject(new RenderCancelled()));
    const timer = setTimeout(() => done(() => reject(new RenderFailed(FRAME_DID_NOT_LOAD))), timeoutMs);
    if (signal?.aborted) return onAbort();
    target.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort);
  });
}

/**
 * Renders in a hidden same-origin frame with its own Strudel and audio engine, so the page's
 * AudioContext and scheduler are never touched. The frame is removed afterwards.
 */
export async function renderInFrame(
  request: Omit<RenderRequest, "type">,
  { timeoutMs = RENDER_TIMEOUT_MS, capMs = RENDER_CAP_MS, onProgress, signal }: Partial<TalkOptions> = {},
): Promise<RenderDone> {
  const frame = document.createElement("iframe");
  frame.src = "/render.html";
  frame.title = "Share render";
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText =
    "position:fixed;width:1px;height:1px;left:-10px;top:-10px;border:0;opacity:0;pointer-events:none";
  try {
    const ready = waitForReady(window, { fromFrame: (e) => e.source === frame.contentWindow, signal });
    document.body.appendChild(frame);
    await ready;
    const channel = new MessageChannel();
    const reply = awaitReply(channel.port1, { timeoutMs, capMs, onProgress, signal });
    frame.contentWindow?.postMessage({ ...request, type: "render" } satisfies RenderRequest, location.origin, [
      channel.port2,
    ]);
    return await reply;
  } finally {
    frame.remove();
  }
}
