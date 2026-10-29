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
  return <h3 className="text-sm font-semibold">{children}</h3>;
}

function RevokeRow({ title, detail, onRevoke }: { title: string; detail: string; onRevoke: () => void }) {
  return (
    <li className="flex items-center justify-between gap-2 border-b border-hairline py-2 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-sm">{title}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={onRevoke}>
        Revoke
      </Button>
    </li>
  );
}

function Step({ app, children }: { app: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-xs leading-relaxed text-muted-foreground">
      <span className="font-medium text-foreground">{app}</span>
      <span>{children}</span>
    </li>
  );
}

function ConnectorSteps({ origin }: { origin: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      <CopyField value={mcpUrl(origin)} label="connector URL" />
      <ul className="flex flex-col gap-1.5">
        <Step app="claude.ai">Settings, Connectors, Add custom connector. Paste the URL and select Connect.</Step>
        <Step app="ChatGPT">
          Settings, Apps and Connectors, Advanced settings, turn on Developer mode. Then Create, paste the URL and
          choose OAuth.
        </Step>
      </ul>
      <p className="text-xs leading-relaxed text-muted-foreground">A jam page opens. Sign in there and select Allow.</p>
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
    <div className="flex flex-col gap-5">
      <p className="text-sm leading-relaxed text-muted-foreground">{INTRO}</p>

      <section className="flex flex-col gap-2.5" aria-label="claude.ai or ChatGPT">
        <Subheading>claude.ai or ChatGPT</Subheading>
        <ConnectorSteps origin={origin} />
        {signedIn && grants.length > 0 && (
          <ul className="flex flex-col" aria-label="Connected apps">
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

      <section className="flex flex-col gap-2.5" aria-label="Claude Code">
        <Subheading>Claude Code, with a personal key</Subheading>
        {!signedIn ? (
          <p className="text-sm leading-relaxed text-muted-foreground">Sign in to create a key for your assistant.</p>
        ) : (
          <>
            {fresh && (
              <div className="flex flex-col gap-2 border-l-2 border-water pl-3">
                <p className="text-xs font-medium text-water">Copy this key now. It is shown once.</p>
                <CopyField value={fresh} label="key" />
                <p className="pt-1 text-xs text-muted-foreground">Or add it to Claude Code in one line:</p>
                <CopyField value={claudeCommand(origin, fresh)} label="command" />
              </div>
            )}

            {tokens.length > 0 && (
              <ul className="flex flex-col" aria-label="Your keys">
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
                placeholder="Name this key"
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
