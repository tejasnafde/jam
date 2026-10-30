import type { Session, VersionEntry } from "@jam/shared";
import { ChevronRight, Copy, Ellipsis, Eye, Loader2, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { relativeTime, versionTime } from "./draft";
import type { SessionsHandle } from "./useSessions";

interface Props {
  signedIn: boolean;
  sessions: SessionsHandle;
}

const versionsText = (n: number) => (n === 1 ? "1 version" : `${n.toLocaleString()} versions`);

/** An inline name field: Enter or leaving the field saves, Escape cancels. */
export function NameField({
  value,
  label,
  onSave,
  onDone,
  className,
}: {
  value: string;
  label: string;
  onSave: (name: string) => void;
  onDone: () => void;
  className?: string;
}) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const name = text.trim();
    if (save && name && name !== value) onSave(name);
    onDone();
  };
  return (
    <Input
      autoFocus
      value={text}
      maxLength={60}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      className={cn("h-7 px-2 text-sm", className)}
    />
  );
}

function PreviewDialog({
  version,
  sessionName,
  onClose,
  onRestore,
}: {
  version: VersionEntry | null;
  sessionName: string;
  onClose: () => void;
  onRestore: (v: VersionEntry) => void;
}) {
  return (
    <Dialog open={!!version} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{version ? `${sessionName}, ${versionTime(version.createdAt)}` : ""}</DialogTitle>
          <DialogDescription>
            Read only. Restore puts this code in the editor as a new edit. It does not play it.
          </DialogDescription>
        </DialogHeader>
        <pre
          className="max-h-[55vh] overflow-auto rounded-md bg-well p-3 font-mono text-xs leading-relaxed"
          aria-label="Version code"
        >
          {version?.code}
        </pre>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => version && onRestore(version)}>
            <Undo2 />
            Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A session's versions, newest first, one page at a time. */
function VersionList({ session, sessions }: { session: Session; sessions: SessionsHandle }) {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<VersionEntry | null>(null);
  const { loadVersions } = sessions;

  const load = async (before: string | null) => {
    setLoading(true);
    setFailed(false);
    try {
      const page = await loadVersions(session.id, before);
      setVersions((v) => (before ? [...v, ...page.versions] : page.versions));
      setNext(page.nextBefore);
    } catch (err) {
      console.error(err);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  // The first page. The parent remounts this list when the session gets a new version.
  useEffect(() => {
    let cancelled = false;
    loadVersions(session.id, null)
      .then((page) => {
        if (cancelled) return;
        setVersions(page.versions);
        setNext(page.nextBefore);
      })
      .catch((err: unknown) => {
        console.error(err);
        if (!cancelled) setFailed(true);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [loadVersions, session.id]);

  const restore = (v: VersionEntry) => {
    setPreview(null);
    void sessions.restore(session.id, v.code);
  };

  return (
    <div className="mb-2 ml-[7px] border-l border-hairline pl-3">
      {versions.length > 0 && (
        <ul aria-label={`${session.name} versions`} className="flex flex-col">
          {versions.map((v) => (
            <li key={v.id} className="group flex items-center gap-2 border-b border-hairline last:border-0">
              <span className="min-w-0 flex-1 truncate py-1.5 font-mono text-xs" title={v.summary}>
                {v.summary}
              </span>
              {/* On a wide screen the actions take the place of the time on hover; a phone shows both. */}
              <time
                dateTime={v.createdAt}
                className="flex-none text-xs text-muted-foreground tabular-nums md:group-focus-within:hidden md:group-hover:hidden"
              >
                {versionTime(v.createdAt)}
              </time>
              <span className="flex flex-none items-center text-muted-foreground md:hidden md:group-focus-within:flex md:group-hover:flex">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setPreview(v)}
                  aria-label={`Preview version from ${versionTime(v.createdAt)}`}
                >
                  <Eye />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => restore(v)}
                  aria-label={`Restore version from ${versionTime(v.createdAt)}`}
                >
                  <Undo2 />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {loading && (
        <p className="flex items-center gap-1.5 py-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          Loading versions
        </p>
      )}
      {!loading && failed && (
        <button
          type="button"
          className="py-1.5 text-xs text-destructive hover:underline"
          onClick={() => void load(versions.at(-1)?.createdAt ?? null)}
        >
          The versions did not load. Try again.
        </button>
      )}
      {!loading && !failed && versions.length === 0 && (
        <p className="py-1.5 text-xs text-muted-foreground">No versions yet. Each Ctrl+Enter saves one.</p>
      )}
      {!loading && next && (
        <button
          type="button"
          onClick={() => void load(next)}
          className="rounded-sm py-1.5 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Show older versions
        </button>
      )}
      <PreviewDialog
        version={preview}
        sessionName={session.name}
        onClose={() => setPreview(null)}
        onRestore={restore}
      />
    </div>
  );
}

function SessionRow({
  session,
  current,
  expanded,
  renaming,
  sessions,
  onToggle,
  onRenaming,
}: {
  session: Session;
  current: boolean;
  expanded: boolean;
  renaming: boolean;
  sessions: SessionsHandle;
  onToggle: () => void;
  onRenaming: (on: boolean) => void;
}) {
  const remove = () => {
    const what = session.versionCount ? ` and its ${versionsText(session.versionCount)}` : "";
    if (!window.confirm(`Delete ${session.name}${what}? This cannot be undone.`)) return;
    void sessions.remove(session.id);
  };
  return (
    <li className="border-b border-hairline last:border-0" aria-current={current ? "true" : undefined}>
      <div className="group flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Hide" : "Show"} versions of ${session.name}`}
          className="flex size-6 flex-none items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
        </button>
        <div className="flex min-w-0 flex-1 flex-col py-2">
          {renaming ? (
            <NameField
              value={session.name}
              label="Session name"
              onSave={(name) => void sessions.rename(session.id, name)}
              onDone={() => onRenaming(false)}
            />
          ) : (
            <button
              type="button"
              disabled={current}
              onClick={() => void sessions.open(session.id)}
              title={current ? "Open now" : `Open ${session.name}`}
              className="flex min-w-0 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default"
            >
              {current && <span className="size-1.5 flex-none rounded-full bg-oil" aria-hidden="true" />}
              <span className={cn("truncate text-sm font-medium", current && "text-oil")}>{session.name}</span>
            </button>
          )}
          <p className="mt-0.5 flex gap-1.5 text-xs text-muted-foreground tabular-nums">
            <span>{versionsText(session.versionCount)}</span>
            <span className="text-gutter" aria-hidden="true">
              /
            </span>
            <span>{relativeTime(session.updatedAt)}</span>
          </p>
        </div>
        <span className="flex flex-none items-center text-muted-foreground transition-colors group-focus-within:text-foreground group-hover:text-foreground">
          {!current && (
            <Button variant="ghost" size="sm" onClick={() => void sessions.open(session.id)}>
              Open
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`More for ${session.name}`}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onSelect={() => onRenaming(true)}>
                <Pencil />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void sessions.duplicate(session.id)}>
                <Copy />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={remove}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      {expanded && (
        // A new version remounts the list, so it shows at the top.
        <VersionList key={session.versionCount} session={session} sessions={sessions} />
      )}
    </li>
  );
}

/** Named pieces: open one to continue it on any computer. The open one gets every new version. */
export function SessionsSection({ signedIn, sessions }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (!signedIn) {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground">
        Sign in to keep named sessions, and pick a piece up again on any computer.
      </p>
    );
  }

  const create = async () => {
    setCreating(true);
    try {
      await sessions.create();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {sessions.sessions.length === 0 ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Loading your sessions
        </p>
      ) : (
        <ul className="flex flex-col" aria-label="Your sessions">
          {sessions.sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              current={s.id === sessions.currentId}
              expanded={expanded === s.id}
              renaming={renaming === s.id}
              sessions={sessions}
              onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
              onRenaming={(on) => setRenaming(on ? s.id : null)}
            />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button variant="secondary" size="lg" disabled={creating} onClick={() => void create()}>
          {creating ? <Loader2 className="animate-spin" /> : <Plus />}
          New session
        </Button>
        <span className="text-xs text-muted-foreground">Your code is kept when you switch.</span>
      </div>
    </div>
  );
}
