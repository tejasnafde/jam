import {
  COACH_ASK_MAX,
  COACH_CADENCES,
  COACH_CADENCE_LABELS,
  isListening,
  type CoachCadence,
  type CoachEvent,
} from "@jam/shared";
import { ArrowUp } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CopyField } from "@/features/connect/CopyField";
import { relativeTime } from "@/features/sessions/draft";
import { cn } from "@/lib/utils";
import type { CoachHandle } from "./useCoach";

/** What the user types in their assistant to start a live coach. */
export const LIVE_PHRASE = "coach me live";

interface Props {
  signedIn: boolean;
  coach: CoachHandle;
  /** The clock for relative times and the listening state. Tests and previews fix it. */
  now?: number;
}

/** The time now, renewed every 15 s, for relative times and the listening state. */
function useNow(fixed?: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (fixed !== undefined) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [fixed]);
  return fixed ?? now;
}

/** "Coach listening" or "No coach", for the section heading. */
export function CoachStatus({ coach, now: fixedNow }: { coach: CoachHandle; now?: number }) {
  const now = useNow(fixedNow);
  const on = isListening(coach.thread?.listeningAt, now);
  return (
    <span className={cn("inline-flex items-center gap-1.5", on && "text-water")}>
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", on ? "jam-wash bg-water" : "border border-muted-foreground/60")}
      />
      {on ? "Coach listening" : "No coach"}
    </span>
  );
}

function checkinText(event: CoachEvent) {
  return event.reason === "runs" ? "Check-in after 15 runs" : "Check-in after 10 minutes";
}

/** Text with `inline code` shown as code. Nothing else is formatted. */
function WithCode({ text }: { text: string }) {
  const parts = text.split(/(`[^`\n]+`)/);
  return parts.map((part, i) =>
    part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
      <code key={i} className="rounded bg-well px-1 py-px font-mono text-[0.85em] text-foreground/90">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

/** Events shown before "Show earlier". The panel scrolls; the thread does not scroll inside it. */
const RECENT = 4;

function Entry({ event, now }: { event: CoachEvent; now: number }) {
  const when = relativeTime(event.createdAt, now);
  const waiting = event.status === "pending";
  if (event.kind === "checkin") {
    return (
      <li className="flex items-baseline justify-between gap-3 py-1 text-xs text-muted-foreground">
        <span>{checkinText(event)}</span>
        <span className="shrink-0 tabular-nums">{waiting ? "waiting" : when}</span>
      </li>
    );
  }
  const mine = event.kind === "ask";
  return (
    <li className="flex flex-col gap-1 py-1.5">
      <span className="flex items-baseline justify-between gap-3 text-xs">
        <span className={cn("font-medium", mine ? "text-muted-foreground" : "text-water")}>
          {mine ? "You" : "Coach"}
        </span>
        <span className="shrink-0 text-muted-foreground tabular-nums">{waiting ? "waiting for the coach" : when}</span>
      </span>
      <p
        className={cn(
          "text-sm leading-snug break-words whitespace-pre-wrap",
          mine ? "text-foreground/80" : "border-l-2 border-water/50 pl-2.5 text-foreground",
          mine && !event.text && "text-muted-foreground italic",
        )}
      >
        {event.text ? <WithCode text={event.text} /> : "Check my music"}
      </p>
    </li>
  );
}

export function CoachSection({ signedIn, coach, now: fixedNow }: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [all, setAll] = useState(false);
  const events = coach.thread?.events ?? [];
  const now = useNow(fixedNow);
  const listening = isListening(coach.thread?.listeningAt, now);
  const hidden = all ? 0 : Math.max(0, events.length - RECENT);

  if (!signedIn) {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground">
        Sign in, then connect an assistant. Your coach answers here while you play.
      </p>
    );
  }

  const send = async (value: string) => {
    if (sending) return;
    setSending(true);
    try {
      await coach.ask(value.trim());
      setText("");
    } catch (err) {
      console.error(err);
      toast.error("The coach did not get that. Try again.");
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) void send(text);
  };

  const onCadence = (value: string) => {
    coach.setCadence(value as CoachCadence).catch((err: unknown) => {
      console.error(err);
      toast.error("Could not save how often the coach checks in.");
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {events.length > 0 ? (
        <div className="flex flex-col gap-1">
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setAll(true)}
              className="self-start rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Show {hidden} earlier
            </button>
          )}
          <ol aria-label="Coach thread" className="flex flex-col">
            {events.slice(hidden).map((event) => (
              <Entry key={event.id} event={event} now={now} />
            ))}
          </ol>
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Ask anything about what you are playing. Your coach answers here, not in another window.
        </p>
      )}

      <form className="flex items-center gap-1.5" onSubmit={onSubmit}>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask the coach"
          aria-label="Ask the coach"
          maxLength={COACH_ASK_MAX}
          disabled={sending}
        />
        <Button
          type="submit"
          size="icon"
          variant="secondary"
          aria-label="Send"
          disabled={sending || !text.trim()}
          className="flex-none"
        >
          <ArrowUp />
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void send("")} disabled={sending}>
          Check my music
        </Button>
        <Select value={coach.thread?.cadence ?? "ask"} onValueChange={onCadence} disabled={!coach.thread}>
          <SelectTrigger size="sm" aria-label="Automatic check-ins" className="min-w-0 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            {COACH_CADENCES.map((c) => (
              <SelectItem key={c} value={c}>
                {COACH_CADENCE_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!listening && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs leading-relaxed text-muted-foreground">No coach connected. Start one with:</p>
          <CopyField value={LIVE_PHRASE} label="the phrase" />
        </div>
      )}
    </div>
  );
}
