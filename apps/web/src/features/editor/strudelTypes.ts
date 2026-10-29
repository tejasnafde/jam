/** The parts of the Strudel REPL state that jam reads. */
export interface StrudelState {
  pending: boolean;
  started: boolean;
  code: string;
  activeCode: string;
  evalError?: Error;
  schedulerError?: Error;
}

/** The StrudelMirror instance the <strudel-editor> element exposes. */
export interface StrudelMirror {
  evaluate(): Promise<void>;
  stop(): Promise<void>;
  setCode(code: string): void;
  changeSetting(key: string, value: unknown): void;
}

export interface StrudelEditorElement extends HTMLElement {
  editor?: StrudelMirror;
}
