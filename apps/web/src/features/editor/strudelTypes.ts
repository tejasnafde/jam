/** The parts of the Strudel REPL state that jam reads. */
export interface StrudelState {
  pending: boolean;
  started: boolean;
  code: string;
  activeCode: string;
  evalError?: Error;
  schedulerError?: Error;
}

/** The CodeMirror 6 EditorView inside StrudelMirror. Only instance methods: the REPL bundles its own CodeMirror. */
export interface EditorViewLike {
  state: {
    doc: { toString(): string; length: number; lines: number; line(n: number): { from: number } };
    selection: { main: { head: number } };
  };
  dom: HTMLElement;
  posAtCoords(coords: { x: number; y: number }, precise: false): number;
  coordsAtPos(pos: number): { left: number; top: number; bottom: number } | null;
  dispatch(spec: {
    changes?: { from: number; insert: string };
    selection?: { anchor: number };
    scrollIntoView?: boolean;
  }): void;
  focus(): void;
}

/** The StrudelMirror instance the <strudel-editor> element exposes. */
export interface StrudelMirror {
  evaluate(): Promise<void>;
  stop(): Promise<void>;
  setCode(code: string): void;
  changeSetting(key: string, value: unknown): void;
  /** The editor's current text. */
  code?: string;
  editor?: EditorViewLike;
  repl?: {
    scheduler?: Scheduler;
    evaluate?: (code: string, autostart?: boolean) => Promise<unknown>;
  };
}

export interface StrudelEditorElement extends HTMLElement {
  editor?: StrudelMirror;
}

/** The parts of Strudel's scheduler (Cyclist) that a share recording reads. */
export interface Scheduler {
  cps?: number;
  started?: boolean;
  /** The evaluated pattern. It stays after stop(). */
  pattern?: unknown;
  /** Seconds ahead of the clock that haps are scheduled. */
  latency?: number;
  /** The audio time of the first tick since start (or since a tempo change). */
  seconds_at_cps_change?: number;
  num_ticks_since_cps_change?: number;
  start(): Promise<void> | void;
  stop(): void;
}
