import type { TokenInfo } from "@jam/shared";
import { useState, type FormEvent } from "react";
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
  onCreate: (label: string) => void;
  onRevoke: (id: string) => void;
}

const INTRO =
  "Your coach reads your code, history and sound through a private key. It can write the session plan, never your music.";

export function ConnectSection({ signedIn, origin, tokens, fresh, onCreate, onRevoke }: Props) {
  const [label, setLabel] = useState("");

  if (!signedIn) {
    return <p className="text-sm text-muted-foreground">Sign in to create a key for your assistant. {INTRO}</p>;
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onCreate(label);
    setLabel("");
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{INTRO}</p>

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
            <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg bg-background py-2 pr-2 pl-3">
              <div className="min-w-0">
                <p className="truncate text-sm">{t.label}</p>
                <p className="text-xs text-muted-foreground">{lastUsed(t.lastUsedAt)}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => onRevoke(t.id)}>
                Revoke
              </Button>
            </li>
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
      <p className="text-xs text-muted-foreground">
        Endpoint: <code className="font-mono">{mcpUrl(origin)}</code>
      </p>
    </div>
  );
}
