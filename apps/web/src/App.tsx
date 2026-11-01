import { Share2 } from "lucide-react";
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
import type { ShareDraft } from "@/features/share/offlineShare";
import { ShareDialog } from "@/features/share/ShareDialog";
import { ShareStatus } from "@/features/share/ShareStatus";
import { evaluateShown } from "@/features/share/shownCode";
import { copyLink, useShareJob } from "@/features/share/useShareJob";
import { useShares } from "@/features/share/useShares";
import { useSessions, type EditorBridge } from "@/features/sessions/useSessions";
import { preventFileNavigation } from "@/features/sounds/dragState";
import { useLocalStorageFlag } from "@/hooks/useLocalStorage";
import { createApi } from "@/lib/api";
import { cn } from "@/lib/utils";

const previewApi = createApi(async () => "preview");

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
  const { refresh: refreshSessions, getSessionId } = sessions;
  const plan = usePlan(auth.api, sessions.handle.currentId);
  const coach = useCoach(auth.api, sessions.handle.currentId);
  const { refresh: refreshCoach } = coach;
  // A run can add a coach check-in, so the thread is checked at once too.
  // Share needs code of the open session that Strudel has evaluated in this page. Opening another
  // session does not evaluate it, so the mark is per session.
  const [evaluatedIn, setEvaluatedIn] = useState<string | null>(null);
  const evaluated = evaluatedIn !== null && evaluatedIn === sessions.handle.currentId;
  const [shareOpen, setShareOpen] = useState(false);
  const shares = useShares(auth.api);
  const onVersionSaved = useCallback(() => {
    setEvaluatedIn(getSessionId());
    void refreshSessions().catch(console.error);
    void refreshCoach().catch(console.error);
  }, [refreshSessions, refreshCoach, getSessionId]);
  // Set when a background share could not be used and the user chose to record it in real time.
  const [realtimeDraft, setRealtimeDraft] = useState<ShareDraft | null>(null);
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
    shares,
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
  // The dev preview has no account: its API calls go to /api, where a screenshot script can answer them.
  const shareApi = auth.api ?? (panelOverride ? previewApi : null);
  const openSession = panel.sessions?.sessions.find((s) => s.id === panel.sessions?.currentId) ?? null;
  const sampleMap = useMemo(() => Object.fromEntries(library.samples.map((s) => [s.name, s.url])), [library.samples]);
  const shareJob = useShareJob({
    api: shareApi,
    sampleMap,
    onCreated: panel.shares?.added ?? shares.added,
    onRealtime: (draft) => {
      setRealtimeDraft(draft);
      setShareOpen(true);
    },
  });
  const preparing = shareJob.job.kind === "preparing";
  const canShare = !!panel.profile && !!openSession && (evaluated || playing) && !preparing;
  const shareButton = panel.profile ? (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setShareOpen(true)}
      disabled={!canShare}
      title={
        preparing ? "A link is being made" : canShare ? "Share a link to listen" : "Play the code once, then share it"
      }
      className="gap-1.5 text-muted-foreground hover:text-foreground"
    >
      <Share2 className="size-4" />
      <span className="max-sm:hidden">Share</span>
    </Button>
  ) : null;

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
        tools={
          <>
            <ShareStatus
              job={shareJob.job}
              onCopy={(url) => void copyLink(url)}
              onRetry={shareJob.retry}
              onRealtime={shareJob.realtime}
              onDismiss={shareJob.dismiss}
            />
            {shareButton}
            <Booth getCps={() => editor.current?.getCps() ?? null} library={library} />
          </>
        }
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
      {shareOpen && shareApi && openSession && panel.profile && (
        <ShareDialog
          open={shareOpen}
          onOpenChange={(next) => {
            setShareOpen(next);
            if (!next) setRealtimeDraft(null);
          }}
          api={shareApi}
          sessionId={openSession.id}
          sessionName={openSession.name}
          displayName={panel.profile.name}
          getScheduler={() => editor.current?.getScheduler() ?? null}
          getCps={() => editor.current?.getCps() ?? null}
          playCode={(code) => evaluateShown(editor.current, code)}
          flushVersions={() => control.current?.flushVersions()}
          onCreated={panel.shares?.added ?? shares.added}
          startOffline={shareJob.start}
          realtime={realtimeDraft}
        />
      )}
    </div>
  );
}
