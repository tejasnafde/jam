import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  /** A coach section: the heading carries the water accent. */
  coach?: boolean;
  /** A short fact beside the heading: "Stage 2 of 5", "3 samples". */
  meta?: ReactNode;
  children: ReactNode;
  /** When set, the section can collapse. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function Heading({ title, coach, meta }: Pick<Props, "title" | "coach" | "meta">) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
      <h2 className={cn("truncate text-[15px] leading-tight font-semibold tracking-tight", coach && "text-water")}>
        {title}
      </h2>
      {meta && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{meta}</span>}
    </span>
  );
}

/**
 * One section of the side panel. No box: a heading with room around it, and the
 * content below. Sections are separated by a hairline in the panel.
 */
export function PanelCard({ title, coach, meta, children, open, onOpenChange }: Props) {
  if (open === undefined) {
    return (
      <section className="flex flex-col gap-3.5 py-5 first:pt-1" aria-label={title}>
        <Heading title={title} coach={coach} meta={meta} />
        {children}
      </section>
    );
  }
  return (
    <section className="py-5" aria-label={title}>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-1 text-left outline-none hover:bg-secondary/60 focus-visible:ring-3 focus-visible:ring-ring/50">
          <Heading title={title} coach={coach} meta={meta} />
          <ChevronDown
            className={cn("size-4 flex-none text-muted-foreground transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3.5">{children}</CollapsibleContent>
      </Collapsible>
    </section>
  );
}
