import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { SaveStatus } from "@/components/SaveStatus";
import { SidePanel, type SidePanelProps } from "@/components/SidePanel";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/authContext";
import { Booth } from "@/features/booth/Booth";
import { UserAvatar } from "@/features/auth/UserAvatar";
import { useGrants } from "@/features/connect/useGrants";
import { useTokens } from "@/features/connect/useTokens";
import { sortDroppedFiles } from "@/features/library/sampleFile";
import { useSamples } from "@/features/library/useSamples";
import { EditorPane, type EditorControl } from "@/features/editor/EditorPane";
import type { StrudelEditorHandle } from "@/features/editor/StrudelEditor";
import type { SaveStatus as Status } from "@/features/editor/useEvaluationRecorder";
import { useCoach } from "@/features/coach/useCoach";
import { usePlan } from "@/features/plan/usePlan";
import { usePrep } from "@/features/prep/usePrep";
import { SessionName } from "@/features/sessions/SessionName";
import { useSessions, type EditorBridge } from "@/features/sessions/useSessions";
import { preventFileNavigation } from "@/features/sounds/dragState";
import { useLocalStorageFlag } from "@/hooks/useLocalStorage";
import { cn } from "@/lib/utils";

/** Dev-only: fixed panel data for layout screenshots without a real account. */
export type PanelOverride = Partial<SidePanelProps>;

export function App({ panelOverride }: { panelOverride?: PanelOverride }) {
  const auth = useAuth();
  const tokens = useTokens(auth.api);
  const grants = useGrants(auth.api);
  const library = useSamples(auth.api);
  // New stems and prepared samples show up when a prep job ends.
  const { refresh } = library;
  const onPrepDone = useCallback(() => void refresh().catch(console.error), [refresh]);
  const prep = usePrep(auth.api, onPrepDone);
  const editor = useRef<StrudelEditorHandle | null>(null);
  const control = useRef<EditorControl | null>(null);
  const bridge = useMemo<EditorBridge>(
    () => ({
      getCode: () => editor.current?.getCode() ?? null,
      replaceCode: (code) => control.current?.replaceCode(code),
      flushVersions: () => control.current?.flushVersions(),
      stopLive: () => control.current?.stopLive(),
    }),
    [],
  );
  const sessions = useSessions(auth.api, bridge);
  const { refresh: refreshSessions } = sessions;
  const onVersionSaved = useCallback(() => void refreshSessions().catch(console.error), [refreshSessions]);
  const plan = usePlan(auth.api, sessions.handle.currentId);
  const coach = useCoach(auth.api, sessions.handle.currentId);
  const [playing, setPlaying] = useState(false);
  const [panelOpen, setPanelOpen] = useLocalStorageFlag("jam:panel", true);
  const [live, setLive] = useLocalStorageFlag("jam:live", false);
  const [status, setStatus] = useState<{ value: Status; stamp: number }>({ value: "idle", stamp: 0 });
  const onSaveStatus = useCallback((value: Status) => setStatus({ value, stamp: Date.now() }), []);
  // A file dropped a few pixels off the editor or the Library must not replace the page.
  useEffect(() => preventFileNavigation(window), []);

  const insertSound = useCallback<NonNullable<SidePanelProps["onInsertSound"]>>(
    (item) => editor.current?.insertSound(item) ?? false,
    [],
  );

  const panel: SidePanelProps = {
    profile: auth.profile,
    plan,
    tokens: tokens.tokens,
    freshToken: tokens.fresh,
    grants: grants.grants,
    origin: window.location.origin,
    onSignIn: () => void auth.signIn(),
    onSignOut: () => void auth.signOut(),
    onCreateToken: (label) => void tokens.create(label),
    onRevokeToken: (id) => void tokens.revoke(id),
    onRevokeGrant: (id) => void grants.revoke(id),
    samples: library.samples,
    uploadingSample: library.uploading,
    onUploadSample: (file) => void library.upload(file),
    onDeleteSample: (id) => void library.remove(id),
    prep,
    sessions: sessions.handle,
    coach,
    ...panelOverride,
  };

  /** Audio files dropped on the editor: the same checks and upload as the Library, then their names. */
  const uploadDropped = async (files: File[]): Promise<string[]> => {
    const { accepted, rejected } = sortDroppedFiles(files);
    for (const r of rejected) toast.error(`${r.name} ${r.reason}.`);
    if (!accepted.length) return [];
    if (!auth.profile) {
      toast("Sign in to keep your own samples.");
      return [];
    }
    const names = await Promise.all(accepted.map((f) => library.upload(f)));
    return names.filter((n): n is string => !!n);
  };

  const togglePlay = () => void (playing ? editor.current?.stop() : editor.current?.play());

  const account = panel.profile ? (
    <button
      type="button"
      className="rounded-full"
      title={panel.profile.name}
      onClick={() => setPanelOpen(true)}
      aria-label="Account"
    >
      <UserAvatar profile={panel.profile} className="size-8" />
    </button>
  ) : (
    <Button variant="outline" size="sm" onClick={panel.onSignIn} disabled={!auth.ready && !panelOverride}>
      Sign in
    </Button>
  );

  const sessionName = panel.profile && panel.sessions ? <SessionName sessions={panel.sessions} /> : null;

  return (
    <div className="flex h-dvh flex-col max-md:h-auto max-md:min-h-dvh">
      <TopBar
        playing={playing}
        onTogglePlay={togglePlay}
        live={live}
        onLiveChange={(on) => {
          setLive(on);
          if (on && !playing) toast("Live is on. Press play, and the music follows your typing.");
        }}
        session={sessionName}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen(!panelOpen)}
        status={<SaveStatus status={status.value} stamp={status.stamp} />}
        tools={<Booth getCps={() => editor.current?.getCps() ?? null} library={library} />}
        account={account}
      />
      {sessionName && (
        <div className="flex h-10 flex-none items-center border-b border-hairline px-2 md:hidden">{sessionName}</div>
      )}
      <main
        className={cn(
          "grid min-h-0 flex-1 max-md:flex max-md:flex-col",
          panelOpen ? "md:grid-cols-[minmax(0,1fr)_320px]" : "md:grid-cols-[minmax(0,1fr)]",
        )}
      >
        <div className="flex min-h-0 flex-col max-md:h-[60vh] max-md:min-h-80 max-md:border-b max-md:border-border">
          <EditorPane
            editorRef={editor}
            onPlayingChange={setPlaying}
            onSaveStatus={onSaveStatus}
            live={live}
            onDropFiles={uploadDropped}
            controlRef={control}
            onEdit={sessions.onEdit}
            getSessionId={sessions.getSessionId}
            onVersionSaved={onVersionSaved}
            onSessionGone={sessions.onSessionGone}
            onEvalError={sessions.reportError}
          />
        </div>
        <div className={cn("min-h-0 md:h-full", !panelOpen && "md:hidden")}>
          <SidePanel {...panel} onInsertSound={insertSound} />
        </div>
      </main>
    </div>
  );
}
