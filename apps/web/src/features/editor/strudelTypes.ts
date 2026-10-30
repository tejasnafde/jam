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
    scheduler?: { cps?: number };
    evaluate?: (code: string, autostart?: boolean) => Promise<unknown>;
  };
}

export interface StrudelEditorElement extends HTMLElement {
  editor?: StrudelMirror;
}
