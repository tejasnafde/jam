import { AlertCircle, Check, Copy, Loader2, RotateCcw, X } from "lucide-react";
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
        <span className="max-sm:sr-only">Preparing link…</span>
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
        <span className="max-sm:sr-only">Link ready</span>
        <Button size="xs" onClick={() => onCopy(job.url)} aria-label="Copy link">
          <Copy />
          <span className="max-sm:hidden">Copy link</span>
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
      <span className="max-sm:sr-only">Link failed</span>
      <Button variant="ghost" size="xs" onClick={onRetry} aria-label="Retry" className="text-foreground">
        <RotateCcw />
        <span className="max-sm:hidden">Retry</span>
      </Button>
      {job.offerRealtime && (
        <Button variant="ghost" size="xs" onClick={onRealtime} className="text-foreground max-sm:hidden">
          Record in real time
        </Button>
      )}
      <Button variant="ghost" size="icon-xs" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
        <X />
      </Button>
    </div>
  );
}
