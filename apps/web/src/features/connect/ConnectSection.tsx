import type { GrantInfo, TokenInfo } from "@jam/shared";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { claudeCommand, mcpUrl } from "./claudeCommand";
import { CopyField } from "./CopyField";
import { lastUsed } from "./lastUsed";

interface Props {
  signedIn: boolean;
  origin: string;
  tokens: TokenInfo[];
  fresh: string | null;
  grants: GrantInfo[];
  onCreate: (label: string) => void;
  onRevoke: (id: string) => void;
  onRevokeGrant: (id: string) => void;
}

const INTRO = "Your coach reads your code, history and sound. It can write the session plan, never your music.";

function Subheading({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-medium">{children}</h3>;
}

function RevokeRow({ title, detail, onRevoke }: { title: string; detail: string; onRevoke: () => void }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-lg bg-background py-2 pr-2 pl-3">
      <div className="min-w-0">
        <p className="truncate text-sm">{title}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRevoke}>
        Revoke
      </Button>
    </li>
  );
}

function ConnectorSteps({ origin }: { origin: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">Add jam as a custom connector with this URL:</p>
      <CopyField value={mcpUrl(origin)} label="connector URL" />
      <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        <li>
          <span className="text-foreground">claude.ai:</span> Settings, then Connectors, then Add custom connector.
          Paste the URL and select Connect.
        </li>
        <li>
          <span className="text-foreground">ChatGPT:</span> Settings, then Apps and Connectors, then Advanced settings.
          Turn on Developer mode. Then select Create, paste the URL and choose OAuth.
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">A jam page opens. Sign in there and select Allow.</p>
    </div>
  );
}

export function ConnectSection({ signedIn, origin, tokens, fresh, grants, onCreate, onRevoke, onRevokeGrant }: Props) {
  const [label, setLabel] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onCreate(label);
    setLabel("");
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{INTRO}</p>

      <section className="flex flex-col gap-2" aria-label="claude.ai or ChatGPT">
        <Subheading>claude.ai or ChatGPT</Subheading>
        <ConnectorSteps origin={origin} />
        {signedIn && grants.length > 0 && (
          <ul className="flex flex-col gap-2 pt-1" aria-label="Connected apps">
            {grants.map((g) => (
              <RevokeRow
                key={g.id}
                title={g.clientName}
                detail={lastUsed(g.lastUsedAt)}
                onRevoke={() => onRevokeGrant(g.id)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-label="Claude Code">
        <Subheading>Claude Code, with a personal key</Subheading>
        {!signedIn ? (
          <p className="text-sm text-muted-foreground">Sign in to create a key for your assistant.</p>
        ) : (
          <>
            {fresh && (
              <div className="flex flex-col gap-2 rounded-lg border border-water/35 bg-background p-3">
                <p className="text-xs text-muted-foreground">Copy this key now. It is shown once.</p>
                <CopyField value={fresh} label="key" />
                <p className="pt-1 text-xs text-muted-foreground">Claude Code:</p>
                <CopyField value={claudeCommand(origin, fresh)} label="command" />
              </div>
            )}

            {tokens.length > 0 && (
              <ul className="flex flex-col gap-2" aria-label="Your keys">
                {tokens.map((t) => (
                  <RevokeRow
                    key={t.id}
                    title={t.label}
                    detail={lastUsed(t.lastUsedAt)}
                    onRevoke={() => onRevoke(t.id)}
                  />
                ))}
              </ul>
            )}

            <form onSubmit={submit} className="flex gap-2">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={60}
                placeholder="Name, e.g. Claude Code"
                aria-label="Key name"
                className="h-9"
              />
              <Button type="submit" size="lg" variant="secondary">
                Create key
              </Button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
