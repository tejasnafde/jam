import { useCallback, useRef, useState } from "react";
import { SaveStatus } from "@/components/SaveStatus";
import { SidePanel, type SidePanelProps } from "@/components/SidePanel";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/authContext";
import { Booth } from "@/features/booth/Booth";
import { UserAvatar } from "@/features/auth/UserAvatar";
import { useGrants } from "@/features/connect/useGrants";
import { useTokens } from "@/features/connect/useTokens";
import { useSamples } from "@/features/library/useSamples";
import { EditorPane } from "@/features/editor/EditorPane";
import type { StrudelEditorHandle } from "@/features/editor/StrudelEditor";
import type { SaveStatus as Status } from "@/features/editor/useEvaluationRecorder";
import { usePlan } from "@/features/plan/usePlan";
import { usePrep } from "@/features/prep/usePrep";
import { useLocalStorageFlag } from "@/hooks/useLocalStorage";
import { cn } from "@/lib/utils";

/** Dev-only: fixed panel data for layout screenshots without a real account. */
export type PanelOverride = Partial<SidePanelProps>;

export function App({ panelOverride }: { panelOverride?: PanelOverride }) {
  const auth = useAuth();
  const plan = usePlan(auth.api);
  const tokens = useTokens(auth.api);
  const grants = useGrants(auth.api);
  const library = useSamples(auth.api);
  // New stems and prepared samples show up when a prep job ends.
  const { refresh } = library;
  const onPrepDone = useCallback(() => void refresh().catch(console.error), [refresh]);
  const prep = usePrep(auth.api, onPrepDone);
  const editor = useRef<StrudelEditorHandle | null>(null);
  const [playing, setPlaying] = useState(false);
  const [panelOpen, setPanelOpen] = useLocalStorageFlag("jam:panel", true);
  const [status, setStatus] = useState<{ value: Status; stamp: number }>({ value: "idle", stamp: 0 });
  const onSaveStatus = useCallback((value: Status) => setStatus({ value, stamp: Date.now() }), []);

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
    ...panelOverride,
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

  return (
    <div className="flex h-dvh flex-col max-md:h-auto max-md:min-h-dvh">
      <TopBar
        playing={playing}
        onTogglePlay={togglePlay}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen(!panelOpen)}
        status={<SaveStatus status={status.value} stamp={status.stamp} />}
        tools={<Booth getCps={() => editor.current?.getCps() ?? null} library={library} />}
        account={account}
      />
      <main
        className={cn(
          "grid min-h-0 flex-1 max-md:flex max-md:flex-col",
          panelOpen ? "md:grid-cols-[minmax(0,1fr)_320px]" : "md:grid-cols-[minmax(0,1fr)]",
        )}
      >
        <div className="flex min-h-0 flex-col max-md:h-[60vh] max-md:min-h-80 max-md:border-b max-md:border-border">
          <EditorPane editorRef={editor} onPlayingChange={setPlaying} onSaveStatus={onSaveStatus} />
        </div>
        <div className={cn("min-h-0 md:h-full", !panelOpen && "md:hidden")}>
          <SidePanel {...panel} />
        </div>
      </main>
    </div>
  );
}
