import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useAuth } from "@/features/auth/authContext";
import { DEFAULT_CODE, LOCAL_CODE_KEY } from "./defaultCode";
import { EvalNote } from "./EvalNote";
import { StrudelEditor, type StrudelEditorHandle } from "./StrudelEditor";
import type { StrudelState } from "./strudelTypes";
import { useEvaluationRecorder, type SaveStatus } from "./useEvaluationRecorder";

interface Props {
  /** Owned by the parent, so the top bar can play and stop. */
  editorRef: RefObject<StrudelEditorHandle | null>;
  onPlayingChange: (playing: boolean) => void;
  onSaveStatus: (status: SaveStatus) => void;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function EditorPane({ editorRef, onPlayingChange, onSaveStatus }: Props) {
  const { api } = useAuth();
  const [note, setNote] = useState<string | null>(null);
  const playing = useRef(false);

  const record = useEvaluationRecorder(api, () => playing.current, onSaveStatus);

  const onStateChange = useCallback(
    (s: StrudelState) => {
      if (s.started !== playing.current) {
        playing.current = s.started;
        onPlayingChange(s.started);
      }
      if (s.code && s.code !== "// LOADING") localStorage.setItem(LOCAL_CODE_KEY, s.code);
      const err = s.evalError ?? s.schedulerError;
      setNote(err ? errorText(err) : null);
    },
    [onPlayingChange],
  );

  const onEvaluated = useCallback(
    (s: StrudelState) => {
      if (!s.evalError) void record(s.activeCode);
    },
    [record],
  );

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
    <section className="relative flex min-h-0 min-w-0 flex-col" aria-label="Code editor">
      <div className="editor-wrap min-h-0 flex-1 overflow-auto">
        <StrudelEditor
          ref={editorRef}
          initialCode={localStorage.getItem(LOCAL_CODE_KEY) ?? DEFAULT_CODE}
          onEvaluated={onEvaluated}
          onStateChange={onStateChange}
          onLoadError={(err) => setNote(`The editor did not load (${err.message}). Reload the page to try again.`)}
        />
      </div>
      <EvalNote message={note} />
    </section>
  );
}
