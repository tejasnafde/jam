import { AlertCircle, Check, Copy, Loader2, OctagonX, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ShareJob } from "./useShareJob";

interface Props {
  job: ShareJob;
  onCopy: (url: string) => void;
  onRetry: () => void;
  onRealtime: () => void;
  onDismiss: () => void;
}

/** The top bar chip of a share made in the background. Nothing shows while no share is made. */
export function ShareStatus({ job, onCopy, onRetry, onRealtime, onDismiss }: Props) {
  if (job.kind === "idle") return null;
  const chip = "flex h-8 items-center gap-1.5 rounded-full border pr-1 pl-2.5 text-xs whitespace-nowrap";
  if (job.kind === "preparing") {
    const percent = Math.round(job.fraction * 100);
    return (
      <div role="status" aria-live="polite" className={cn(chip, "border-hairline text-muted-foreground")}>
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        <span>Preparing link…</span>
        <span className="tabular-nums">{percent}%</span>
        <Button variant="ghost" size="icon-xs" onClick={onDismiss} aria-label="Cancel the link" title="Cancel">
          <X />
        </Button>
      </div>
    );
  }
  if (job.kind === "ready") {
    return (
      <div role="status" aria-live="polite" className={cn(chip, "border-water/40 text-foreground")}>
        <Check className="size-3.5 text-water" aria-hidden="true" />
        <span>Link ready</span>
        <Button size="xs" onClick={() => onCopy(job.url)} aria-label="Copy link">
          <Copy />
          Copy link
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
          <X />
        </Button>
      </div>
    );
  }
  return (
    <div role="alert" className={cn(chip, "border-destructive/40 text-destructive")} title={job.message}>
      <AlertCircle className="size-3.5" aria-hidden="true" />
      <span>Link failed</span>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onRetry}
        aria-label="Retry"
        title="Retry"
        className="text-foreground"
      >
        <RotateCcw />
      </Button>
      {job.offerRealtime && (
        <Button
          variant="ghost"
          size="xs"
          onClick={onRealtime}
          title="Record in real time instead"
          className="text-foreground"
        >
          Real time
        </Button>
      )}
      <Button variant="ghost" size="icon-xs" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
        <X />
      </Button>
    </div>
  );
}

interface ErrorToastProps {
  message: string;
  offerRealtime: boolean;
  onRetry: () => void;
  onRealtime: () => void;
  onClose: () => void;
}

/** The toast of a share that failed: the reason, then Retry and the real-time fallback on their own row. */
export function ShareErrorToast({ message, offerRealtime, onRetry, onRealtime, onClose }: ErrorToastProps) {
  return (
    <div
      role="alert"
      className="flex w-[356px] max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-(--radius) border border-border bg-popover p-4 text-sm text-popover-foreground shadow-lg"
    >
      <div className="flex items-start gap-2">
        <OctagonX className="mt-0.5 size-4 flex-none text-destructive" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Could not make the link</p>
          <p className="mt-0.5 text-muted-foreground [overflow-wrap:anywhere]">{message}</p>
        </div>
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close" className="-mt-1 -mr-1">
          <X />
        </Button>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {offerRealtime && (
          <Button variant="outline" size="sm" onClick={onRealtime}>
            Record in real time instead
          </Button>
        )}
        <Button size="sm" onClick={onRetry}>
          <RotateCcw />
          Retry
        </Button>
      </div>
    </div>
  );
}
