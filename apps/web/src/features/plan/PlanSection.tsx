import type { SessionPlan, Stage } from "@jam/shared";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  plan: SessionPlan | null;
  signedIn: boolean;
}

type StageState = "done" | "current" | "todo";

const stateOf = (i: number, current: number): StageState => (i < current ? "done" : i === current ? "current" : "todo");

/**
 * The painting so far: one stroke per stage. Done strokes are dry water, the
 * current stroke is wet (it moves), the rest is bare canvas.
 */
function Strokes({ stages, current }: { stages: Stage[]; current: number }) {
  return (
    <div className="flex h-2 gap-1" aria-hidden="true">
      {stages.map((stage, i) => {
        const state = stateOf(i, current);
        return (
          <span
            key={i}
            title={stage.title}
            className={cn(
              "flex-1 rounded-full",
              state === "done" && "bg-water-deep",
              state === "current" && "jam-wash bg-water",
              state === "todo" && "bg-secondary",
            )}
          />
        );
      })}
    </div>
  );
}

function StageItem({ stage, index, state }: { stage: Stage; index: number; state: StageState }) {
  const current = state === "current";
  return (
    <li
      aria-current={current ? "step" : undefined}
      data-state={state}
      className={cn(
        "grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2",
        current ? "py-2" : "py-1",
        state === "todo" && "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "pt-px font-mono text-xs tabular-nums",
          state === "done" && "text-water-deep",
          current && "text-water",
          state === "todo" && "text-gutter",
        )}
        aria-hidden={state === "done" ? undefined : true}
      >
        {state === "done" ? <Check className="size-3.5" aria-label="done" /> : String(index + 1).padStart(2, "0")}
      </span>
      <div className="min-w-0">
        <p
          className={cn(
            "text-sm leading-snug",
            current && "text-base font-semibold text-foreground",
            state === "done" && "text-muted-foreground",
          )}
        >
          {stage.title}
        </p>
        {current && <p className="mt-1.5 text-sm leading-snug text-foreground/90">{stage.goal}</p>}
        {current && stage.hint && (
          <p className="mt-2 border-l-2 border-water/50 pl-2.5 text-sm leading-snug text-water">Hint: {stage.hint}</p>
        )}
      </div>
    </li>
  );
}

export function PlanSection({ plan, signedIn }: Props) {
  if (!plan) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex h-2 gap-1" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="flex-1 rounded-full bg-secondary" />
          ))}
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {signedIn
            ? "No painting yet. Ask your coach to start a session."
            : "Sign in, then ask your coach to start a session. The plan shows up here."}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <Strokes stages={plan.stages} current={plan.currentStage} />
      <p className="text-[17px] leading-snug font-medium tracking-tight text-foreground">{plan.destination}</p>
      <ol className="flex flex-col">
        {plan.stages.map((stage, i) => (
          <StageItem key={i} stage={stage} index={i} state={stateOf(i, plan.currentStage)} />
        ))}
      </ol>
      {plan.note && (
        <p className="text-sm leading-snug text-water">
          <span className="mr-1.5 font-semibold">Coach:</span>
          {plan.note}
        </p>
      )}
    </div>
  );
}
