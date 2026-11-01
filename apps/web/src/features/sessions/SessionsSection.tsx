import { formatDuration, type SessionSummary, type Share, type VersionEntry } from "@jam/shared";
import { Check, ChevronRight, Copy, Ellipsis, Eye, Link2, Loader2, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
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
import { PLAY_KEY } from "@/features/editor/defaultCode";
import type { SharesHandle } from "@/features/share/useShares";
import { shareLink } from "@/lib/share-api";
import { cn } from "@/lib/utils";
import { relativeTime, versionTime } from "./draft";
import type { SessionsHandle } from "./useSessions";

interface Props {
  signedIn: boolean;
  sessions: SessionsHandle;
  shares?: SharesHandle;
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
function VersionList({ session, sessions }: { session: SessionSummary; sessions: SessionsHandle }) {
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
    void sessions.restore(session.id, v);
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
        <p className="py-1.5 text-xs text-muted-foreground">No versions yet. Each {PLAY_KEY}+Enter saves one.</p>
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

const playsText = (n: number) => (n === 1 ? "1 play" : `${n.toLocaleString()} plays`);

const linksText = (n: number) => (n === 1 ? "1 link" : `${n.toLocaleString()} links`);

/** One share link of a session: copy it, turn it off (the file stays) and on again, or delete a turned-off one. */
function ShareItem({ share, shares }: { share: Share; shares: SharesHandle }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareLink(share.id));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy the link.");
    }
  };
  const toggle = async () => {
    setBusy(true);
    try {
      await shares.setEnabled(share.id, !share.enabled);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete the link to ${share.title} and its audio? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await shares.remove(share.id);
    } finally {
      setBusy(false);
    }
  };
  const sep = (
    <span className="text-gutter" aria-hidden="true">
      /
    </span>
  );
  return (
    <li className="flex flex-col py-1">
      <div className="flex items-center gap-1.5">
        <Link2
          className={cn("size-3.5 flex-none", share.enabled ? "text-water" : "text-muted-foreground")}
          aria-hidden="true"
        />
        <p
          className={cn("min-w-0 flex-1 truncate text-xs font-medium", !share.enabled && "opacity-60")}
          title={share.title}
        >
          {share.title}
        </p>
        {share.enabled && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={() => void copy()}
            aria-label={`Copy link to ${share.title}`}
            title={copied ? "Copied" : "Copy link"}
          >
            {copied ? <Check className="text-water" /> : <Copy />}
          </Button>
        )}
        <Button
          variant="ghost"
          size="xs"
          disabled={busy}
          className="text-muted-foreground"
          onClick={() => void toggle()}
          aria-label={`${share.enabled ? "Turn off" : "Turn on"} the link to ${share.title}`}
          title={
            share.enabled
              ? "The page stops now, and audio already open stops within 15 minutes. The file is kept."
              : undefined
          }
        >
          {share.enabled ? "Turn off" : "Turn on"}
        </Button>
        {!share.enabled && (
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={busy}
            className="text-muted-foreground hover:text-destructive"
            onClick={() => void remove()}
            aria-label={`Delete the link to ${share.title}`}
            title="Delete the link and its audio"
          >
            <Trash2 />
          </Button>
        )}
      </div>
      <p
        className={cn(
          "flex gap-1.5 truncate pl-5 text-[11px] text-muted-foreground tabular-nums",
          !share.enabled && "opacity-60",
        )}
      >
        <span>{formatDuration(share.seconds)}</span>
        {sep}
        <span>{playsText(share.plays)}</span>
        {sep}
        <span>{relativeTime(share.createdAt)}</span>
        {!share.enabled && (
          <>
            {sep}
            <span>off</span>
          </>
        )}
      </p>
    </li>
  );
}

function ShareList({ label, list, shares }: { label: string; list: Share[]; shares: SharesHandle }) {
  return (
    <ul aria-label={label} className="mb-2 ml-[30px] flex flex-col gap-0.5">
      {list.map((share) => (
        <ShareItem key={share.id} share={share} shares={shares} />
      ))}
    </ul>
  );
}

/** A session's links, as one "3 links" line that opens the list, so many links do not crowd the sessions. */
function SessionLinks({ session, list, shares }: { session: SessionSummary; list: Share[]; shares: SharesHandle }) {
  const [open, setOpen] = useState(false);
  const on = list.filter((s) => s.enabled).length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`${open ? "Hide" : "Show"} links to ${session.name}`}
        className="mb-1.5 ml-[30px] flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} aria-hidden="true" />
        <Link2 className={cn("size-3.5", on ? "text-water" : "")} aria-hidden="true" />
        <span className="tabular-nums">
          {linksText(list.length)}
          {on < list.length && `, ${on.toLocaleString()} on`}
        </span>
      </button>
      {open && <ShareList label={`Links to ${session.name}`} list={list} shares={shares} />}
    </>
  );
}

function SessionRow({
  session,
  current,
  expanded,
  renaming,
  sessions,
  shares,
  onToggle,
  onRenaming,
}: {
  session: SessionSummary;
  current: boolean;
  expanded: boolean;
  renaming: boolean;
  sessions: SessionsHandle;
  shares?: SharesHandle;
  onToggle: () => void;
  onRenaming: (on: boolean) => void;
}) {
  const links = shares?.shares.filter((x) => x.sessionId === session.id) ?? [];
  const remove = async () => {
    const what = session.versionCount ? ` and its ${versionsText(session.versionCount)}` : "";
    const linked = links.length
      ? ` Its ${linksText(links.length)} and ${links.length === 1 ? "its" : "their"} audio are deleted too.`
      : "";
    if (!window.confirm(`Delete ${session.name}${what}?${linked} This cannot be undone.`)) return;
    await sessions.remove(session.id);
    // The server deleted the session's links with it.
    if (links.length) await shares?.refresh();
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
              <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      {shares && links.length > 0 && <SessionLinks session={session} list={links} shares={shares} />}
      {expanded && (
        // A new version remounts the list, so it shows at the top.
        <VersionList key={session.versionCount} session={session} sessions={sessions} />
      )}
    </li>
  );
}

/** Named pieces: open one to continue it on any computer. The open one gets every new version. */
export function SessionsSection({ signedIn, sessions, shares }: Props) {
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

  // Links whose session is gone (deleted on another device, or before links went with their
  // session). They stay listed so they can be turned off or deleted.
  const known = new Set(sessions.sessions.map((s) => s.id));
  const orphans = sessions.sessions.length ? (shares?.shares.filter((x) => !known.has(x.sessionId)) ?? []) : [];

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
              shares={shares}
              onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
              onRenaming={(on) => setRenaming(on ? s.id : null)}
            />
          ))}
        </ul>
      )}
      {shares && orphans.length > 0 && (
        <section aria-label="Links of deleted sessions" className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-muted-foreground">Links of deleted sessions</h3>
          <ShareList label="Links of deleted sessions" list={orphans} shares={shares} />
        </section>
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
