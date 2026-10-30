import type { GrantInfo, SampleWithUrl, SessionPlan, TokenInfo } from "@jam/shared";
import { useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AccountSection } from "@/features/auth/AccountSection";
import type { Profile } from "@/features/auth/authContext";
import { ConnectSection } from "@/features/connect/ConnectSection";
import { LibrarySection } from "@/features/library/LibrarySection";
import { PlanSection } from "@/features/plan/PlanSection";
import { SessionsSection } from "@/features/sessions/SessionsSection";
import type { SessionsHandle } from "@/features/sessions/useSessions";
import type { PrepHandle } from "@/features/prep/usePrep";
import { soundCount, type SoundItem } from "@/features/sounds/catalog";
import { SoundsSection } from "@/features/sounds/SoundsSection";
import { useSoundCatalog } from "@/features/sounds/useSoundCatalog";
import { useLocalStorageFlag } from "@/hooks/useLocalStorage";
import { PanelCard } from "./PanelCard";

export interface SidePanelProps {
  profile: Profile | null;
  plan: SessionPlan | null;
  tokens: TokenInfo[];
  freshToken: string | null;
  grants: GrantInfo[];
  origin: string;
  onSignIn: () => void;
  onSignOut: () => void;
  onCreateToken: (label: string) => void;
  onRevokeToken: (id: string) => void;
  onRevokeGrant: (id: string) => void;
  samples: SampleWithUrl[];
  uploadingSample: boolean;
  onUploadSample: (file: File) => void;
  onDeleteSample: (id: string) => void;
  prep?: PrepHandle;
  sessions?: SessionsHandle;
  /** Inserts a sound at the editor's cursor. False when the editor is not ready. */
  onInsertSound?: (item: SoundItem) => boolean;
}

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n.toLocaleString()} ${many}`);

export function SidePanel(props: SidePanelProps) {
  const { profile, plan, tokens, freshToken, grants } = props;
  // "Connect" is collapsed once a key or a connected app exists, and opens to show a
  // new key. A manual toggle holds until the next new key.
  const [manual, setManual] = useState<{ forToken: string | null; open: boolean } | null>(null);
  const autoOpen = !profile || (tokens.length === 0 && grants.length === 0) || !!freshToken;
  const connectOpen = manual && manual.forToken === freshToken ? manual.open : autoOpen;
  const setConnectOpen = (open: boolean) => setManual({ forToken: freshToken, open });

  const yours = useMemo(() => props.samples.map((s) => s.name), [props.samples]);
  const sounds = useSoundCatalog(yours);
  const [soundsOpen, setSoundsOpen] = useLocalStorageFlag("jam:sounds", true);
  const soundsMeta = sounds.source === "loading" ? "Loading" : count(soundCount(sounds.catalog), "sound", "sounds");

  const [sessionsOpen, setSessionsOpen] = useLocalStorageFlag("jam:sessions", true);
  const sessionCount = props.sessions?.sessions.length ?? 0;

  const connected = tokens.length + grants.length;
  const planMeta = plan
    ? plan.currentStage >= plan.stages.length
      ? "Finished"
      : `Stage ${plan.currentStage + 1} of ${plan.stages.length}`
    : undefined;

  return (
    <aside className="h-full min-h-0 border-hairline bg-background md:border-l" aria-label="Side panel">
      {/* Radix wraps the content in a display: table box that grows with long names; keep it to the panel width. */}
      <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:!block">
        <div className="flex min-h-full flex-col divide-y divide-hairline px-4 pt-4 md:px-5">
          <PanelCard title="Today we paint" coach meta={planMeta}>
            <PlanSection plan={plan} signedIn={!!profile} />
          </PanelCard>
          {props.sessions && (
            <PanelCard
              title="Sessions"
              meta={profile && sessionCount > 0 ? count(sessionCount, "session", "sessions") : undefined}
              open={sessionsOpen}
              onOpenChange={setSessionsOpen}
            >
              <SessionsSection signedIn={!!profile} sessions={props.sessions} />
            </PanelCard>
          )}
          <PanelCard title="Sounds" meta={soundsMeta} open={soundsOpen} onOpenChange={setSoundsOpen}>
            <SoundsSection
              catalog={sounds.catalog}
              source={sounds.source}
              onInsert={props.onInsertSound ?? (() => false)}
            />
          </PanelCard>
          <PanelCard title="Library" meta={profile ? count(props.samples.length, "sample", "samples") : undefined}>
            <LibrarySection
              signedIn={!!profile}
              samples={props.samples}
              uploading={props.uploadingSample}
              onUpload={props.onUploadSample}
              onDelete={props.onDeleteSample}
              prep={props.prep}
            />
          </PanelCard>
          <PanelCard
            title="Connect an assistant"
            coach
            meta={profile && connected > 0 ? count(connected, "connected", "connected") : undefined}
            open={connectOpen}
            onOpenChange={setConnectOpen}
          >
            <ConnectSection
              signedIn={!!profile}
              origin={props.origin}
              tokens={tokens}
              fresh={freshToken}
              grants={grants}
              onCreate={props.onCreateToken}
              onRevoke={props.onRevokeToken}
              onRevokeGrant={props.onRevokeGrant}
            />
          </PanelCard>
          <PanelCard title="Account">
            <AccountSection profile={profile} onSignIn={props.onSignIn} onSignOut={props.onSignOut} />
          </PanelCard>
          <footer className="mt-auto flex gap-3 py-4 text-xs text-muted-foreground">
            <a
              className="rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              href="https://github.com/tejasnafde/jam"
              target="_blank"
              rel="noopener"
            >
              Source, AGPL-3.0
            </a>
            <a
              className="rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              href="https://strudel.cc"
              target="_blank"
              rel="noopener"
            >
              Made with Strudel
            </a>
          </footer>
        </div>
      </ScrollArea>
    </aside>
  );
}
