import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import { installAudioTap } from "@/lib/audio";
import type { StrudelEditorElement, StrudelMirror, StrudelState } from "./strudelTypes";

export interface StrudelEditorHandle {
  play(): Promise<void>;
  stop(): Promise<void>;
  setCode(code: string): void;
}

interface Props {
  initialCode: string;
  onEvaluated: (state: StrudelState) => void;
  onStateChange: (state: StrudelState) => void;
  onLoadError: (err: Error) => void;
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

/**
 * Wraps the Strudel REPL web component. The element is created once and
 * never torn down: it owns an AudioContext and a scheduler, and the REPL
 * inserts its editor as a sibling node it does not clean up.
 */
export function StrudelEditor({ initialCode, onEvaluated, onStateChange, onLoadError, ref }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<StrudelMirror | null>(null);
  const callbacks = useRef({ onEvaluated, onStateChange, onLoadError });
  useLayoutEffect(() => {
    callbacks.current = { onEvaluated, onStateChange, onLoadError };
  });
  const initialCodeRef = useRef(initialCode);

  useImperativeHandle(ref, () => ({
    play: async () => mirrorRef.current?.evaluate(),
    stop: async () => mirrorRef.current?.stop(),
    setCode: (code) => mirrorRef.current?.setCode(code),
  }));

  useEffect(() => {
    const host = hostRef.current;
    if (!host || host.childElementCount > 0) return;
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

  return <div ref={hostRef} className="strudel-host h-full" data-testid="strudel-host" />;
}
