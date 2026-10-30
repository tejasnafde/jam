import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { errorLine } from "./errorLine";

interface Props {
  message: string | null;
  /** Moves the cursor to a line and highlights it. Leave out to hide "Go to line". */
  onGoToLine?: (line: number) => void;
}

/**
 * Shows an evaluation error the Bob Ross way: as a happy accident. A slim bar docked under the
 * editor, so it never covers the code. Dismissed per message; a new error shows again, and so does
 * the same error after a good evaluation cleared it.
 */
export function EvalNote({ message, onGoToLine }: Props) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!message && dismissed !== null) setDismissed(null);
  if (!message || dismissed === message) return null;
  const line = errorLine(message);
  return (
    <div
      role="status"
      className="flex flex-none items-start gap-2 border-t border-l-[3px] border-hairline border-l-oil bg-card py-1.5 pr-1.5 pl-3"
    >
      <p className="max-h-24 min-w-0 flex-1 overflow-auto py-1 font-mono text-[13px] leading-snug break-words whitespace-pre-wrap">
        <span className="mr-2 font-sans font-medium text-oil">Happy accident:</span>
        {message}
      </p>
      {line !== null && onGoToLine && (
        <Button variant="ghost" size="sm" className="flex-none text-oil" onClick={() => onGoToLine(line)}>
          Go to line {line}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        className="flex-none text-muted-foreground"
        onClick={() => setDismissed(message)}
        aria-label="Dismiss"
      >
        <X />
      </Button>
    </div>
  );
}
