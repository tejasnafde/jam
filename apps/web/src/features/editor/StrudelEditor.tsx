import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type DragEvent, type Ref } from "react";
import type { SoundItem } from "@/features/sounds/catalog";
import { draggedSound, hasFiles, hasSound, soundFromDrop } from "@/features/sounds/dragState";
import { insertionFor, insertionForAll } from "@/features/sounds/snippet";
import { installAudioTap } from "@/lib/audio";
import { serial } from "./live";
import type { EditorViewLike, Scheduler, StrudelEditorElement, StrudelMirror, StrudelState } from "./strudelTypes";

export interface StrudelEditorHandle {
  play(): Promise<void>;
  stop(): Promise<void>;
  setCode(code: string): void;
  /** Cycles per second of the running scheduler, or null before Strudel loads. */
  getCps(): number | null;
  /** The text in the editor now (not the last evaluated code). */
  getCode(): string | null;
  /** Strudel's scheduler, or null before Strudel loads. A share recording restarts it from cycle 0. */
  getScheduler(): Scheduler | null;
  /** Evaluates code as Ctrl+Enter does, but never starts playback and does not flash. For Live mode. */
  evaluateQuiet(code: string): Promise<void>;
  /** Moves the cursor to a line (1-based) and highlights it for a moment. */
  goToLine(line: number): void;
  /** Inserts a sound at the cursor. Never evaluates. False before the editor exists. */
  insertSound(item: SoundItem): boolean;
}

interface Props {
  initialCode: string;
  onEvaluated: (state: StrudelState) => void;
  onStateChange: (state: StrudelState) => void;
  onLoadError: (err: Error) => void;
  /** Uploads audio files dropped on the editor. Resolves to the new sample names. */
  onDropFiles?: (files: File[]) => Promise<string[]>;
  ref?: Ref<StrudelEditorHandle>;
}

/** Applies jam's editor settings once the element has built its StrudelMirror. */
function tune(el: StrudelEditorElement, onReady: (mirror: StrudelMirror) => void) {
  const mirror = el.editor;
  if (!mirror) {
    requestAnimationFrame(() => tune(el, onReady));
    return;
  }
  mirror.changeSetting("fontFamily", "'JetBrains Mono Variable', ui-monospace, monospace");
  mirror.changeSetting("fontSize", 15);
  mirror.changeSetting("isLineNumbersDisplayed", true);
  mirror.changeSetting("isLineWrappingEnabled", false);
  onReady(mirror);
}

/** Puts text into the editor as one transaction and moves the cursor after it. Never evaluates. */
function insert(view: EditorViewLike, from: number, text: string) {
  view.dispatch({ changes: { from, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true });
  view.focus();
}

interface Caret {
  left: number;
  top: number;
  height: number;
  label: string;
}

/**
 * Wraps the Strudel REPL web component. The element is created once and
 * never torn down: it owns an AudioContext and a scheduler, and the REPL
 * inserts its editor as a sibling node it does not clean up.
 */
export function StrudelEditor({ initialCode, onEvaluated, onStateChange, onLoadError, onDropFiles, ref }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<StrudelMirror | null>(null);
  const callbacks = useRef({ onEvaluated, onStateChange, onLoadError });
  useLayoutEffect(() => {
    callbacks.current = { onEvaluated, onStateChange, onLoadError };
  });
  const initialCodeRef = useRef(initialCode);
  const [caret, setCaret] = useState<Caret | null>(null);
  const [flash, setFlash] = useState<{ top: number; height: number; key: number } | null>(null);
  // Quiet evaluations (Live and its revert) run one at a time, so each one reports its result.
  const [queue] = useState(serial);

  const view = () => mirrorRef.current?.editor ?? null;

  useImperativeHandle(ref, () => ({
    play: async () => mirrorRef.current?.evaluate(),
    stop: async () => mirrorRef.current?.stop(),
    setCode: (code) => mirrorRef.current?.setCode(code),
    getCps: () => mirrorRef.current?.repl?.scheduler?.cps ?? null,
    getCode: () => mirrorRef.current?.code ?? null,
    getScheduler: () => mirrorRef.current?.repl?.scheduler ?? null,
    evaluateQuiet: (code) => queue(async () => void (await mirrorRef.current?.repl?.evaluate?.(code, false))),
    goToLine: (line) => {
      const v = view();
      const host = hostRef.current;
      if (!v || !host) return;
      const n = Math.min(Math.max(1, line), v.state.doc.lines);
      const { from } = v.state.doc.line(n);
      v.dispatch({ selection: { anchor: from }, scrollIntoView: true });
      v.focus();
      // Measured after CodeMirror has scrolled the line into view.
      requestAnimationFrame(() => {
        const at = v.coordsAtPos(from);
        if (!at) return;
        const top = at.top - host.getBoundingClientRect().top;
        setFlash({ top, height: at.bottom - at.top, key: Date.now() });
        setTimeout(() => setFlash(null), 1400);
      });
    },
    insertSound: (item) => {
      const v = view();
      if (!v) return false;
      const { from, text } = insertionFor(v.state.doc.toString(), v.state.selection.main.head, item);
      insert(v, from, text);
      return true;
    },
  }));

  useEffect(() => {
    const host = hostRef.current;
    // Marked at once: the import below is async, so StrictMode's second run would otherwise add a second editor.
    if (!host || host.dataset.strudel) return;
    host.dataset.strudel = "1";
    // The tap must exist before Strudel creates its first audio node.
    installAudioTap();
    let wasPending = false;
    import("@strudel/repl")
      .then(() => {
        const el = document.createElement("strudel-editor") as StrudelEditorElement;
        el.setAttribute("code", initialCodeRef.current);
        el.addEventListener("update", (event) => {
          const state = (event as CustomEvent<StrudelState>).detail;
          callbacks.current.onStateChange(state);
          if (wasPending && !state.pending) callbacks.current.onEvaluated(state);
          wasPending = state.pending;
        });
        host.appendChild(el);
        tune(el, (mirror) => (mirrorRef.current = mirror));
      })
      .catch((err: unknown) => callbacks.current.onLoadError(err instanceof Error ? err : new Error(String(err))));
  }, []);

  // Drops are caught in the capture phase, before CodeMirror's own drop handler sees them:
  // CodeMirror would paste the dragged text/plain, or read a dropped file as text.
  const accepts = (e: DragEvent) => hasSound(e.dataTransfer) || (!!onDropFiles && hasFiles(e.dataTransfer));

  const onDragOver = (e: DragEvent) => {
    const v = view();
    const host = hostRef.current;
    if (!v || !host || !accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }, false);
    const item = draggedSound();
    // The caret shows where the text will really go: a drop inside a step moves to the step's end.
    // Files have no name yet, so their label shows the shape of what goes in.
    const ins = insertionFor(v.state.doc.toString(), pos, item ?? { kind: "yours", name: "...", key: "" });
    const at = v.coordsAtPos(ins.from);
    if (!at) return setCaret(null);
    const box = host.getBoundingClientRect();
    const label = item ? ins.text.trim() : `Upload, then insert ${ins.text.trim()}`;
    setCaret({ left: at.left - box.left, top: at.top - box.top, height: at.bottom - at.top, label });
  };

  const onDrop = (e: DragEvent) => {
    const v = view();
    setCaret(null);
    if (!v || !accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }, false);
    if (hasSound(e.dataTransfer)) {
      const item = soundFromDrop(e.dataTransfer);
      if (!item) return;
      const { from, text } = insertionFor(v.state.doc.toString(), pos, item);
      insert(v, from, text);
      return;
    }
    const files = [...e.dataTransfer.files];
    if (!onDropFiles || !files.length) return;
    void onDropFiles(files).then((names) => {
      if (!names.length) return;
      // The user may have typed during the upload; the position is kept, within the new length.
      const now = view();
      if (!now) return;
      const items = names.map((name): SoundItem => ({ kind: "yours", name, key: name }));
      const { from, text } = insertionForAll(now.state.doc.toString(), Math.min(pos, now.state.doc.length), items);
      insert(now, from, text);
    });
  };

  return (
    <div
      ref={hostRef}
      className="strudel-host relative h-full"
      data-testid="strudel-host"
      onDragOverCapture={onDragOver}
      onDropCapture={onDrop}
      onDragLeave={(e) => {
        if (!hostRef.current?.contains(e.relatedTarget as Node | null)) setCaret(null);
      }}
    >
      {/* Spans, not divs: the host's CSS gives its child divs the full height. */}
      {caret && (
        <span
          className="pointer-events-none absolute z-20 block"
          style={{ left: caret.left, top: caret.top }}
          aria-hidden="true"
          data-testid="drop-caret"
        >
          <span className="block w-[2px] rounded-full bg-oil" style={{ height: caret.height }} />
          <span className="absolute top-full left-0 mt-1 block rounded-md border border-oil/50 bg-background px-1.5 py-0.5 font-mono text-xs whitespace-nowrap text-oil shadow-sm">
            {caret.label}
          </span>
        </span>
      )}
      {flash && (
        <span
          key={flash.key}
          className="jam-line-flash pointer-events-none absolute inset-x-0 z-10 block bg-oil/20"
          style={{ top: flash.top, height: flash.height }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
