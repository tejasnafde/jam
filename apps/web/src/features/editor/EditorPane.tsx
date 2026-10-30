import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useAuth } from "@/features/auth/authContext";
import { DEFAULT_CODE, LOCAL_CODE_KEY } from "./defaultCode";
import { EvalNote } from "./EvalNote";
import { LiveController, VersionCoalescer } from "./live";
import { StrudelEditor, type StrudelEditorHandle } from "./StrudelEditor";
import type { StrudelState } from "./strudelTypes";
import { useEvaluationRecorder, type SaveStatus } from "./useEvaluationRecorder";

/** What the sessions can do to the editor. None of it evaluates. */
export interface EditorControl {
  /** Replaces the text. Live mode does not treat it as typing, so it is not evaluated. */
  replaceCode(code: string): void;
  /** Saves a Live version that waits for its window now. */
  flushVersions(): void;
}

interface Props {
  /** Owned by the parent, so the top bar can play and stop. */
  editorRef: RefObject<StrudelEditorHandle | null>;
  onPlayingChange: (playing: boolean) => void;
  onSaveStatus: (status: SaveStatus) => void;
  /** Live mode: evaluate after a pause in typing, while the music plays. */
  live?: boolean;
  /** Uploads audio files dropped on the editor. Resolves to the new sample names. */
  onDropFiles?: (files: File[]) => Promise<string[]>;
  /** Filled in by the pane, for the sessions. */
  controlRef?: RefObject<EditorControl | null>;
  /** The user changed the text (not a replaceCode). */
  onEdit?: (code: string) => void;
  /** The open session, read when a version is saved. */
  getSessionId?: () => string | null;
  onVersionSaved?: () => void;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function EditorPane({
  editorRef,
  onPlayingChange,
  onSaveStatus,
  live = false,
  onDropFiles,
  controlRef,
  onEdit,
  getSessionId,
  onVersionSaved,
}: Props) {
  const { api } = useAuth();
  const [note, setNote] = useState<string | null>(null);
  // A runtime error that Live mode took back: the music went back to the last good code,
  // but the user still needs to see what went wrong, until the next good evaluation.
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const playing = useRef(false);
  const liveRef = useRef(live);
  const lastCode = useRef<string | null>(null);
  // The code a Live revert put back, until its evaluation reports.
  const reverting = useRef<string | null>(null);

  // Code waiting for the editor to load (a session opened before Strudel was ready).
  const pending = useRef<string | null>(null);

  const record = useEvaluationRecorder(api, () => playing.current, onSaveStatus, getSessionId, onVersionSaved);
  const recordRef = useRef(record);
  const onEditRef = useRef(onEdit);
  useLayoutEffect(() => {
    recordRef.current = record;
    liveRef.current = live;
    onEditRef.current = onEdit;
  });

  // Built once the editor is mounted: the controller evaluates through the editor handle.
  const liveMode = useRef<{ controller: LiveController; versions: VersionCoalescer } | null>(null);
  useEffect(() => {
    const versions = new VersionCoalescer((code) => void recordRef.current(code));
    const controller = new LiveController({
      evaluate: (code) => void editorRef.current?.evaluateQuiet(code),
      revert: (code) => {
        reverting.current = code;
        void editorRef.current?.evaluateQuiet(code);
      },
    });
    liveMode.current = { controller, versions };
    return () => {
      controller.cancel();
      versions.dispose();
      liveMode.current = null;
    };
  }, [editorRef]);
  useEffect(() => {
    const controller = liveMode.current?.controller;
    if (!live) return controller?.cancel();
    // Edits made before Live was switched on count too: the music catches up after the usual pause.
    const code = editorRef.current?.getCode();
    if (code && playing.current) controller?.onEdit(code, { enabled: true, playing: true });
  }, [live, editorRef]);

  useEffect(() => {
    if (!controlRef) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const code = pending.current;
      if (code === null) return;
      if (editorRef.current?.getCode() == null) {
        frame = requestAnimationFrame(apply);
        return;
      }
      pending.current = null;
      // Marked as seen first, so the change does not look like typing to Live mode.
      lastCode.current = code;
      localStorage.setItem(LOCAL_CODE_KEY, code);
      editorRef.current.setCode(code);
    };
    controlRef.current = {
      replaceCode: (code) => {
        pending.current = code;
        if (!frame) apply();
      },
      flushVersions: () => liveMode.current?.versions.flush(),
    };
    return () => {
      cancelAnimationFrame(frame);
      controlRef.current = null;
    };
  }, [controlRef, editorRef]);

  const onStateChange = useCallback(
    (s: StrudelState) => {
      if (s.started !== playing.current) {
        playing.current = s.started;
        onPlayingChange(s.started);
      }
      // The editor's own text: a Live revert evaluates older code without changing what the user wrote.
      const code = editorRef.current?.getCode() ?? s.code;
      const controller = liveMode.current?.controller;
      controller?.onPlayingChange(s.started);
      if (code && code !== "// LOADING") {
        localStorage.setItem(LOCAL_CODE_KEY, code);
        // The first text seen is what the editor loaded with, not an edit.
        if (lastCode.current === null) lastCode.current = code;
        if (code !== lastCode.current) {
          lastCode.current = code;
          controller?.onEdit(code, { enabled: liveRef.current, playing: s.started });
          onEditRef.current?.(code);
        }
      }
      if (s.schedulerError && controller?.onSchedulerError(s.activeCode)) setLiveNote(errorText(s.schedulerError));
      const err = s.evalError ?? s.schedulerError;
      setNote(err ? errorText(err) : null);
    },
    [onPlayingChange, editorRef],
  );

  const onEvaluated = useCallback((s: StrudelState) => {
    if (reverting.current !== null && s.activeCode === reverting.current) {
      reverting.current = null;
      return;
    }
    const mode = liveMode.current;
    if (!mode) return;
    const { controller, versions } = mode;
    if (s.evalError) return controller.onEvalError(s.code);
    const wasLive = controller.evaluatingLive;
    controller.onEvaluated(s.activeCode);
    setLiveNote(null);
    if (wasLive) versions.live(s.activeCode);
    else versions.explicit(s.activeCode);
  }, []);

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Code editor">
      <div className="editor-wrap min-h-0 flex-1 overflow-auto">
        <StrudelEditor
          ref={editorRef}
          initialCode={localStorage.getItem(LOCAL_CODE_KEY) ?? DEFAULT_CODE}
          onEvaluated={onEvaluated}
          onStateChange={onStateChange}
          onDropFiles={onDropFiles}
          onLoadError={(err) => setNote(`The editor did not load (${err.message}). Reload the page to try again.`)}
        />
      </div>
      <EvalNote message={note ?? liveNote} onGoToLine={(line) => editorRef.current?.goToLine(line)} />
    </section>
  );
}
