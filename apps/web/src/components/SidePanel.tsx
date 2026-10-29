import type { GrantInfo, SampleWithUrl, SessionPlan, TokenInfo } from "@jam/shared";
import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AccountSection } from "@/features/auth/AccountSection";
import type { Profile } from "@/features/auth/authContext";
import { ConnectSection } from "@/features/connect/ConnectSection";
import { LibrarySection } from "@/features/library/LibrarySection";
import { PlanSection } from "@/features/plan/PlanSection";
import type { PrepHandle } from "@/features/prep/usePrep";
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
}

export function SidePanel(props: SidePanelProps) {
  const { profile, plan, tokens, freshToken, grants } = props;
  // "Connect" is collapsed once a key or a connected app exists, and opens to show a
  // new key. A manual toggle holds until the next new key.
  const [manual, setManual] = useState<{ forToken: string | null; open: boolean } | null>(null);
  const autoOpen = !profile || (tokens.length === 0 && grants.length === 0) || !!freshToken;
  const connectOpen = manual && manual.forToken === freshToken ? manual.open : autoOpen;
  const setConnectOpen = (open: boolean) => setManual({ forToken: freshToken, open });

  return (
    <aside className="h-full min-h-0 border-border bg-background md:border-l" aria-label="Side panel">
      <ScrollArea className="h-full">
        <div className="flex min-h-full flex-col gap-4 p-3 md:p-4">
          <PanelCard title="Today we paint" coach>
            <PlanSection plan={plan} signedIn={!!profile} />
          </PanelCard>
          <PanelCard title="Library">
            <LibrarySection
              signedIn={!!profile}
              samples={props.samples}
              uploading={props.uploadingSample}
              onUpload={props.onUploadSample}
              onDelete={props.onDeleteSample}
              prep={props.prep}
            />
          </PanelCard>
          <PanelCard title="Connect an assistant" coach open={connectOpen} onOpenChange={setConnectOpen}>
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
          <footer className="mt-auto flex justify-center gap-2 py-2 text-xs text-muted-foreground">
            <a
              className="hover:text-foreground"
              href="https://github.com/tejasnafde/jam"
              target="_blank"
              rel="noopener"
            >
              Source (AGPL-3.0)
            </a>
            <span aria-hidden="true">&middot;</span>
            <a className="hover:text-foreground" href="https://strudel.cc" target="_blank" rel="noopener">
              Made with Strudel
            </a>
          </footer>
        </div>
      </ScrollArea>
    </aside>
  );
}
