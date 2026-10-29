import type { SaveStatus as Status } from "@/features/editor/useEvaluationRecorder";

const LABELS: Record<Status, string> = {
  idle: "",
  saving: "Saving",
  saved: "Saved",
  failed: "Not saved",
  "signed-out": "Sign in to save versions",
};

/** A short-lived status line. A new stamp remounts it, which restarts the fade. */
export function SaveStatus({ status, stamp }: { status: Status; stamp: number }) {
  if (status === "idle") return null;
  return (
    <span
      key={stamp}
      aria-live="polite"
      className="animate-[jam-fade-out_2.8s_ease-in_forwards] text-xs whitespace-nowrap text-muted-foreground max-md:hidden"
    >
      {LABELS[status]}
    </span>
  );
}
