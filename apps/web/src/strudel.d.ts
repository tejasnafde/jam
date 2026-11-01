// The Strudel REPL ships no types. It registers the <strudel-editor> element as a side effect.
declare module "@strudel/repl";

/** The build id, set by Vite's `define` (vite.config.ts). */
declare const __JAM_BUILD__: string;
