import type { SessionPlan, Stage } from "@jam/shared";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  plan: SessionPlan | null;
  signedIn: boolean;
}

type StageState = "done" | "current" | "todo";

function StageItem({ stage, index, state }: { stage: Stage; index: number; state: StageState }) {
  const current = state === "current";
  return (
    <li
      aria-current={current ? "step" : undefined}
      data-state={state}
      className={cn(
        "flex gap-3 rounded-lg border border-transparent p-2",
        current && "border-water/35 bg-water/[0.07]",
        state === "done" && "opacity-45",
      )}
    >
      <span
        className={cn(
          "grid size-6 flex-none place-items-center rounded-full bg-secondary text-xs font-bold text-muted-foreground",
          current && "bg-water text-background",
        )}
      >
        {state === "done" ? <Check className="size-3.5" aria-label="done" /> : index + 1}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className={cn("font-medium", state === "todo" && "text-muted-foreground")}>{stage.title}</p>
        {current && <p className="mt-1 text-sm">{stage.goal}</p>}
        {current && stage.hint && <p className="mt-2 text-sm text-water">Hint: {stage.hint}</p>}
      </div>
    </li>
  );
}

const stateOf = (i: number, current: number): StageState => (i < current ? "done" : i === current ? "current" : "todo");

export function PlanSection({ plan, signedIn }: Props) {
  if (!plan) {
    return (
      <p className="text-sm text-muted-foreground">
        {signedIn
          ? "No painting yet. Ask your coach to start a session."
          : "Sign in, then ask your coach to start a session. The plan shows up here."}
      </p>
    );
  }
  return (
    <div>
      <p className="mb-4 text-base leading-snug font-medium">{plan.destination}</p>
      <ol className="flex flex-col gap-2">
        {plan.stages.map((stage, i) => (
          <StageItem key={i} stage={stage} index={i} state={stateOf(i, plan.currentStage)} />
        ))}
      </ol>
      {plan.note && <p className="mt-4 border-t border-border pt-3 text-sm text-water">{plan.note}</p>}
    </div>
  );
}
