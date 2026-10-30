import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useAuth } from "@/features/auth/authContext";
import { DEFAULT_CODE, LOCAL_CODE_KEY } from "./defaultCode";
import { EvalNote } from "./EvalNote";
import { LiveController, VersionCoalescer } from "./live";
import { StrudelEditor, type StrudelEditorHandle } from "./StrudelEditor";
import type { StrudelState } from "./strudelTypes";
import { useEvaluationRecorder, type SaveStatus } from "./useEvaluationRecorder";

interface Props {
  /** Owned by the parent, so the top bar can play and stop. */
  editorRef: RefObject<StrudelEditorHandle | null>;
  onPlayingChange: (playing: boolean) => void;
  onSaveStatus: (status: SaveStatus) => void;
  /** Live mode: evaluate after a pause in typing, while the music plays. */
  live?: boolean;
  /** Uploads audio files dropped on the editor. Resolves to the new sample names. */
  onDropFiles?: (files: File[]) => Promise<string[]>;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function EditorPane({ editorRef, onPlayingChange, onSaveStatus, live = false, onDropFiles }: Props) {
  const { api } = useAuth();
  const [note, setNote] = useState<string | null>(null);
  // A runtime error that Live mode took back: the music went back to the last good code,
  // but the user still needs to see what went wrong, until the next good evaluation.
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const playing = useRef(false);
  const liveRef = useRef(live);
  const lastCode = useRef<string | null>(null);
  const reverting = useRef(false);

  const record = useEvaluationRecorder(api, () => playing.current, onSaveStatus);
  const recordRef = useRef(record);
  useLayoutEffect(() => {
    recordRef.current = record;
    liveRef.current = live;
  });

  // Built once the editor is mounted: the controller evaluates through the editor handle.
  const liveMode = useRef<{ controller: LiveController; versions: VersionCoalescer } | null>(null);
  useEffect(() => {
    const versions = new VersionCoalescer((code) => void recordRef.current(code));
    const controller = new LiveController({
      evaluate: (code) => void editorRef.current?.evaluateQuiet(code),
      revert: (code) => {
        reverting.current = true;
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
    if (!live) liveMode.current?.controller.cancel();
  }, [live]);

  const onStateChange = useCallback(
    (s: StrudelState) => {
      if (s.started !== playing.current) {
        playing.current = s.started;
        onPlayingChange(s.started);
      }
      // The editor's own text: a Live revert evaluates older code without changing what the user wrote.
      const code = editorRef.current?.getCode() ?? s.code;
      const controller = liveMode.current?.controller;
      if (code && code !== "// LOADING") {
        localStorage.setItem(LOCAL_CODE_KEY, code);
        if (code !== lastCode.current) {
          lastCode.current = code;
          controller?.onEdit(code, { enabled: liveRef.current, playing: s.started });
        }
      }
      if (s.schedulerError && controller?.onSchedulerError(s.activeCode)) setLiveNote(errorText(s.schedulerError));
      const err = s.evalError ?? s.schedulerError;
      setNote(err ? errorText(err) : null);
    },
    [onPlayingChange, editorRef],
  );

  const onEvaluated = useCallback((s: StrudelState) => {
    if (reverting.current) {
      reverting.current = false;
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

  // Bring back the last saved jam on sign-in, unless the user already has their own code here.
  useEffect(() => {
    if (!api) return;
    const local = localStorage.getItem(LOCAL_CODE_KEY);
    if (local && local !== DEFAULT_CODE) return;
    api
      .latestVersion()
      .then((latest) => latest && editorRef.current?.setCode(latest.code))
      .catch(console.error);
  }, [api, editorRef]);

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
