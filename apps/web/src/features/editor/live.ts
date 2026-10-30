/** How long the user pauses typing before Live mode evaluates. */
export const LIVE_DEBOUNCE_MS = 700;
/** Live mode stores at most one version per this window (the latest one), so history stays readable. */
export const LIVE_VERSION_MS = 10_000;

interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export interface LiveDeps {
  /** Evaluates code as Ctrl+Enter does, without starting playback. */
  evaluate: (code: string) => void;
  /** Evaluates the last good code again, quietly: no version is stored. */
  revert: (code: string) => void;
  timers?: Timers;
  debounceMs?: number;
}

/**
 * Live mode: evaluates the code after the user pauses typing, while a pattern plays.
 * - Typing while nothing plays does nothing: Live never starts the music.
 * - Code that was already evaluated (good or bad) is not evaluated again.
 * - A syntax error is harmless: Strudel keeps the old pattern when evaluation throws.
 *   A runtime error (the scheduler fails on the new pattern) puts the last good code back.
 */
export class LiveController {
  private timer: unknown = null;
  private lastTried: string | null = null;
  private lastGood: string | null = null;
  private liveTry = false;
  private liveActive: string | null = null;
  private fallback: string | null = null;
  private readonly timers: Timers;
  private readonly debounceMs: number;

  constructor(private deps: LiveDeps) {
    this.timers = deps.timers ?? realTimers;
    this.debounceMs = deps.debounceMs ?? LIVE_DEBOUNCE_MS;
  }

  /** Call on every edit with the editor's code. */
  onEdit(code: string, { enabled, playing }: { enabled: boolean; playing: boolean }) {
    this.cancel();
    if (!enabled || !playing || code === this.lastTried) return;
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      if (code === this.lastTried) return;
      this.lastTried = code;
      this.liveTry = true;
      this.deps.evaluate(code);
    }, this.debounceMs);
  }

  /** Any evaluation finished well (Live or Ctrl+Enter): this code is now the good one. */
  onEvaluated(code: string) {
    const live = this.liveTry && code === this.lastTried;
    // Only a pattern Live put in place is taken back on a runtime error; Ctrl+Enter is the user's call.
    this.fallback = live ? this.lastGood : null;
    this.liveActive = live ? code : null;
    this.lastTried = code;
    this.lastGood = code;
    this.liveTry = false;
  }

  /** An evaluation threw. Strudel kept the old pattern; remember the code so it is not tried again. */
  onEvalError(code: string) {
    this.lastTried = code;
    this.liveTry = false;
  }

  /**
   * The scheduler failed on the running pattern. If Live put that pattern there, the last good
   * code goes back, so the music continues. Returns true when it reverted.
   */
  onSchedulerError(activeCode: string): boolean {
    const back = this.fallback;
    if (this.liveActive !== activeCode || !back || back === activeCode) return false;
    this.liveActive = null;
    this.fallback = null;
    this.lastGood = back;
    this.deps.revert(back);
    return true;
  }

  /** True while a Live evaluation is in flight (its result is not a Ctrl+Enter). */
  get evaluatingLive() {
    return this.liveTry;
  }

  /** The music stopped or started. A Live evaluation waiting from before a stop is dropped. */
  onPlayingChange(playing: boolean) {
    if (!playing) this.cancel();
  }

  cancel() {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }
}

/**
 * Runs async jobs one after another. Strudel reports an evaluation through one pending flag, so two
 * evaluations that overlap would report once; one at a time, each one reports.
 */
export function serial() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job);
    tail = run.catch(() => undefined);
    return run;
  };
}

/**
 * Coalesces Live versions: the first saves at once, the rest wait for the window to pass and save
 * only the latest code. A Ctrl+Enter save goes straight through and drops a waiting Live save,
 * since the explicit one is newer.
 */
export class VersionCoalescer {
  private lastSave = -Infinity;
  private pending: string | null = null;
  private timer: unknown = null;
  private readonly timers: Timers;

  constructor(
    private save: (code: string) => void,
    private now: () => number = Date.now,
    timers?: Timers,
    private windowMs = LIVE_VERSION_MS,
  ) {
    this.timers = timers ?? realTimers;
  }

  /** A version from a Ctrl+Enter: saved now. */
  explicit(code: string) {
    this.drop();
    this.flush(code);
  }

  /** A version from Live mode: saved now, or held until the window ends (latest wins). */
  live(code: string) {
    const wait = this.lastSave + this.windowMs - this.now();
    if (wait <= 0 && this.timer === null) return this.flush(code);
    this.pending = code;
    if (this.timer === null) {
      this.timer = this.timers.setTimeout(
        () => {
          this.timer = null;
          const c = this.pending;
          this.pending = null;
          if (c !== null) this.flush(c);
        },
        Math.max(0, wait),
      );
    }
  }

  private flush(code: string) {
    this.lastSave = this.now();
    this.save(code);
  }

  private drop() {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }

  dispose() {
    this.drop();
  }
}
