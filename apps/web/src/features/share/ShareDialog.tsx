import {
  firstName,
  formatDuration,
  SHARE_LIMITS,
  type CreateShareResponse,
  type Share,
  type VersionEntry,
} from "@jam/shared";
import { Check, Copy, Link2, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { Scheduler } from "@/features/editor/strudelTypes";
import { ApiError, type Api } from "@/lib/api";
import { sharesApi } from "@/lib/share-api";
import { cn } from "@/lib/utils";
import { asOfText } from "./asOf";
import { CaptureCancelled, capturePass } from "./capture";
import { barsToSeconds, clampBars, guessPlay, maxBarsAt } from "./length";
import type { ShareDraft } from "./offlineShare";
import { computePeaks } from "./peaks";
import { shareWav } from "./wavFile";

export type SharePhase =
  | { kind: "loading" }
  | { kind: "noVersion" }
  | { kind: "form" }
  | { kind: "recording"; elapsed: number; tail: boolean }
  | { kind: "uploading" }
  | { kind: "done"; url: string };

/** The link without the scheme, as the dialog shows it. */
const bareLink = (url: string) => url.replace(/^https?:\/\//, "");

export interface ShareDialogViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionName: string;
  phase: SharePhase;
  error: string | null;
  title: string;
  onTitle: (title: string) => void;
  ownerName: string;
  onOwnerName: (name: string) => void;
  asOf: string | null;
  versionId: string | null;
  label: string;
  bars: number;
  /** True when the bars are a default or were cut to fit, not read from the code. */
  barsGuessed: boolean;
  maxBars: number;
  onBars: (bars: number) => void;
  seconds: number;
  showCode: boolean;
  onShowCode: (on: boolean) => void;
  onCreate: () => void;
  onCancelRecording: () => void;
  /** "offline": the link is made in the background. "realtime": one pass is recorded from bar 1. */
  mode?: "offline" | "realtime";
}

function Row({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3 py-2.5", className)}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">{children}</dd>
    </div>
  );
}

const Dot = () => (
  <span className="text-gutter" aria-hidden="true">
    /
  </span>
);

/** The share dialog's layout, without the work. The dev preview renders it with fixed data. */
export function ShareDialogView(p: ShareDialogViewProps) {
  const [editingBars, setEditingBars] = useState(false);
  const [copied, setCopied] = useState(false);
  const busy = p.phase.kind === "recording" || p.phase.kind === "uploading";
  const locked = busy || p.phase.kind === "done";
  const total = p.seconds;

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy. Select the link and copy it.");
    }
  };

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="gap-3 sm:max-w-lg" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="truncate pr-6">Share &ldquo;{p.title.trim() || p.sessionName}&rdquo;</DialogTitle>
          <DialogDescription>
            A friend gets a link to listen. They do not sign in, and they cannot change your music.
          </DialogDescription>
        </DialogHeader>

        {p.phase.kind === "loading" && (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Reading the latest version
          </p>
        )}
        {p.phase.kind === "noVersion" && (
          <p className="py-6 text-sm text-muted-foreground">
            This session has no version yet. Play the code once, then share it.
          </p>
        )}

        {p.phase.kind !== "loading" && p.phase.kind !== "noVersion" && (
          <dl className="flex flex-col divide-y divide-hairline border-y border-hairline">
            <Row label="Title">
              <Input
                value={p.title}
                maxLength={SHARE_LIMITS.titleMax}
                disabled={locked}
                aria-label="Title"
                onChange={(e) => p.onTitle(e.target.value)}
                className="h-8"
              />
            </Row>
            <Row label="By">
              <Input
                value={p.ownerName}
                maxLength={SHARE_LIMITS.ownerNameMax}
                disabled={locked}
                aria-label="Your name on the page"
                onChange={(e) => p.onOwnerName(e.target.value)}
                className="h-8"
              />
            </Row>
            <Row label="As of">
              <span className="tabular-nums">{p.asOf ? asOfText(p.asOf) : ""}</span>
              {p.versionId && (
                <span className="font-mono text-xs text-muted-foreground" title={`Version ${p.versionId}`}>
                  version {p.versionId.slice(0, 6)}
                </span>
              )}
            </Row>
            <Row label="Plays">
              <span className="max-w-full truncate font-mono text-xs" title={p.label}>
                {p.label}
              </span>
              <Dot />
              {editingBars ? (
                <span className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    autoFocus
                    min={SHARE_LIMITS.barsMin}
                    max={p.maxBars}
                    value={p.bars}
                    aria-label="Bars"
                    onChange={(e) => p.onBars(Math.min(p.maxBars, clampBars(Number(e.target.value))))}
                    onBlur={() => setEditingBars(false)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && setEditingBars(false)}
                    className="h-7 w-16 px-2 tabular-nums"
                  />
                  <span>bars</span>
                </span>
              ) : (
                <span className="tabular-nums">
                  {p.bars === 1 ? "1 bar" : `${p.bars} bars`}
                  {p.barsGuessed && <span className="text-muted-foreground"> (guessed)</span>}
                </span>
              )}
              <Dot />
              <span className="tabular-nums">{formatDuration(total)}</span>
              {!editingBars && !locked && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                  onClick={() => setEditingBars(true)}
                >
                  Edit bars
                </Button>
              )}
            </Row>
            <Row label="Code">
              <span className={cn("min-w-14", !p.showCode && "text-muted-foreground")}>
                {p.showCode ? "shown" : "hidden"}
              </span>
              <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                Show the code
                <Switch checked={p.showCode} disabled={locked} onCheckedChange={p.onShowCode} />
              </label>
            </Row>
            <Row label="Link">
              {p.phase.kind === "done" ? (
                <>
                  <a
                    href={p.phase.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate font-mono text-xs text-water hover:underline"
                  >
                    {bareLink(p.phase.url)}
                  </a>
                  <Button size="sm" onClick={() => p.phase.kind === "done" && void copy(p.phase.url)}>
                    {copied ? <Check /> : <Copy />}
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                </>
              ) : (
                <span className="text-muted-foreground">
                  {p.mode === "offline"
                    ? "Made in the background. Your music keeps playing, and the top bar says when the link is ready."
                    : "Ready after one recorded pass. It plays from bar 1 while it records, so keep this tab open."}
                </span>
              )}
            </Row>
          </dl>
        )}

        {p.error && (
          <p role="alert" className="text-sm text-destructive">
            {p.error}
          </p>
        )}

        {p.phase.kind === "recording" && (
          <div className="flex flex-col gap-2" aria-live="polite">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-well"
              role="progressbar"
              aria-label="Recording"
              aria-valuemin={0}
              aria-valuemax={Math.round(total)}
              aria-valuenow={Math.round(p.phase.elapsed)}
            >
              <div
                className="h-full rounded-full bg-oil transition-[width] duration-100 ease-linear"
                style={{ width: `${Math.min(100, (p.phase.elapsed / Math.max(total, 0.1)) * 100)}%` }}
              />
            </div>
            <p className="flex items-center gap-2 text-sm">
              <span className="size-2 animate-pulse rounded-full bg-oil" aria-hidden="true" />
              <span className="tabular-nums">
                {p.phase.tail
                  ? "Letting the reverb fade"
                  : `Recording ${formatDuration(p.phase.elapsed)} / ${formatDuration(total)}`}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              The piece plays from bar 1 while it records. Keep this tab open.
            </p>
          </div>
        )}

        <DialogFooter>
          {p.phase.kind === "recording" && (
            <Button variant="outline" onClick={p.onCancelRecording}>
              Cancel
            </Button>
          )}
          {p.phase.kind === "uploading" && (
            <Button disabled>
              <Loader2 className="animate-spin" />
              Making the link
            </Button>
          )}
          {(p.phase.kind === "form" || p.phase.kind === "noVersion") && (
            <>
              <Button variant="ghost" onClick={() => p.onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={p.onCreate} disabled={p.phase.kind !== "form" || !p.title.trim() || !p.ownerName.trim()}>
                <Link2 />
                {p.mode === "realtime" ? "Record in real time" : "Create link"}
              </Button>
            </>
          )}
          {p.phase.kind === "done" && (
            <Button variant="ghost" onClick={() => p.onOpenChange(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: Api;
  sessionId: string;
  sessionName: string;
  displayName: string;
  getScheduler: () => Scheduler | null;
  getCps: () => number | null;
  /** Makes the given code the pattern Strudel plays. False when it does not evaluate. */
  playCode: (code: string) => Promise<boolean>;
  /** Saves a Live version that waits, so the latest version is the code that plays. */
  flushVersions: () => void;
  onCreated: (share: Share) => void;
  /**
   * Makes the link in the background (offline render) and closes the dialog at once. Without it,
   * or with `realtime`, the dialog records one pass in real time.
   */
  startOffline?: (draft: ShareDraft) => void;
  /** Record in real time, with the choices of a background share that could not be used. */
  realtime?: ShareDraft | null;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Share: snapshot the latest version, record one pass from bar 1, upload it, and hand back a link.
 * Mount it for each opening.
 */
export function ShareDialog({
  open,
  onOpenChange,
  api,
  sessionId,
  sessionName,
  displayName,
  getScheduler,
  getCps,
  playCode,
  flushVersions,
  onCreated,
  startOffline,
  realtime = null,
}: Props) {
  const offline = !!startOffline && !realtime;
  const [phase, setPhase] = useState<SharePhase>({ kind: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<VersionEntry | null>(null);
  const [title, setTitle] = useState(realtime?.title ?? sessionName);
  const [ownerName, setOwnerName] = useState(() => realtime?.ownerName ?? firstName(displayName));
  const [bars, setBars] = useState(8);
  const [barsGuessed, setBarsGuessed] = useState(false);
  const [label, setLabel] = useState("");
  const [showCode, setShowCode] = useState(realtime?.showCode ?? false);
  const [cps, setCps] = useState(0.5);
  const abort = useRef<AbortController | null>(null);

  const load = async () => {
    setPhase({ kind: "loading" });
    const page = await api.sessionVersions(sessionId);
    const latest = page.versions[0] ?? null;
    setVersion(latest);
    if (!latest) return setPhase({ kind: "noVersion" });
    const tempo = getCps() ?? 0.5;
    const guess = guessPlay(latest.code);
    setCps(tempo);
    setLabel(guess.label);
    if (realtime) {
      setBars(Math.min(realtime.bars, maxBarsAt(tempo)));
    } else {
      setBars(Math.min(guess.bars, maxBarsAt(tempo)));
      setBarsGuessed(guess.source === "default" || guess.capped || guess.bars > maxBarsAt(tempo));
    }
    setPhase({ kind: "form" });
  };

  // The parent mounts the dialog for each opening, so it starts fresh from the latest version.
  useEffect(() => {
    flushVersions();
    // A Live version that was just flushed needs a moment to be saved.
    const timer = setTimeout(() => {
      load().catch((err: unknown) => {
        setError(`Could not read the latest version. ${message(err)}`);
        setPhase({ kind: "noVersion" });
      });
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, []);

  const seconds = barsToSeconds(bars, cps);

  const create = async () => {
    if (!version) return;
    if (offline) {
      // The hidden frame evaluates the code itself, so the page's playback is not touched.
      startOffline?.({
        sessionId,
        versionId: version.id,
        code: version.code,
        title: title.trim(),
        ownerName: ownerName.trim(),
        bars,
        cps,
        showCode,
      });
      onOpenChange(false);
      return;
    }
    const client = sharesApi(api);
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    let started: CreateShareResponse | null = null;
    try {
      // Strudel may still hold another session's pattern (opening a session does not evaluate it).
      // The recording must be the code this dialog names, so that code is evaluated first.
      if (!(await playCode(version.code))) {
        setError("Play this session once, then share it.");
        return;
      }
      const scheduler = getScheduler();
      if (!scheduler?.pattern) {
        setError("Play this session once, then share it.");
        return;
      }
      // The server checks the version, the limits and the rate first, so no pass is recorded for nothing.
      started = await client.create({
        sessionId,
        versionId: version.id,
        title: title.trim(),
        ownerName: ownerName.trim(),
        bars,
        seconds: Math.round(seconds * 100) / 100,
        showCode,
      });
      setPhase({ kind: "recording", elapsed: 0, tail: false });
      const recording = await capturePass(
        scheduler,
        { cycles: bars, seconds, tailSeconds: SHARE_LIMITS.tailSeconds },
        ({ elapsed, tail }) => setPhase({ kind: "recording", elapsed, tail }),
        controller.signal,
      );
      setPhase({ kind: "uploading" });
      // Peaks first: shareWav may mix the channels down in place.
      const peaks = computePeaks(recording.channels, SHARE_LIMITS.peaks).map((v) => Math.round(v * 1000) / 1000);
      await client.put(started.uploadUrl, shareWav(recording.channels, recording.sampleRate), controller.signal);
      const share = await client.ready(started.id, { peaks });
      onCreated(share);
      setPhase({ kind: "done", url: started.url });
    } catch (err) {
      // An unfinished share is deleted with any file it has, so it never lingers.
      if (started) void client.remove(started.id).catch(console.error);
      if (err instanceof CaptureCancelled || controller.signal.aborted) {
        setPhase({ kind: "form" });
        return;
      }
      console.error(err);
      setError(message(err));
      if (err instanceof ApiError && err.status === 409 && /changed/.test(err.message)) {
        await load().catch(() => undefined);
        return;
      }
      setPhase({ kind: "form" });
    } finally {
      abort.current = null;
    }
  };

  const close = (next: boolean) => {
    if (!next) abort.current?.abort();
    onOpenChange(next);
  };

  return (
    <ShareDialogView
      open={open}
      onOpenChange={close}
      sessionName={sessionName}
      phase={phase}
      error={error}
      title={title}
      onTitle={setTitle}
      ownerName={ownerName}
      onOwnerName={setOwnerName}
      asOf={version?.evaluatedAt ?? null}
      versionId={version?.id ?? null}
      label={label}
      bars={bars}
      barsGuessed={barsGuessed}
      maxBars={maxBarsAt(cps)}
      onBars={(n) => {
        setBars(n);
        setBarsGuessed(false);
      }}
      seconds={seconds}
      showCode={showCode}
      onShowCode={setShowCode}
      onCreate={() => void create()}
      onCancelRecording={() => abort.current?.abort()}
      mode={offline ? "offline" : realtime ? "realtime" : undefined}
    />
  );
}
