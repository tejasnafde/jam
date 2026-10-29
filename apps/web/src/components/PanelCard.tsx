import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  coach?: boolean;
  children: ReactNode;
  /** When set, the card can collapse. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function Heading({ title, coach }: { title: string; coach?: boolean }) {
  return (
    <h2 className="flex items-center gap-2 text-[13px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
      {coach && <span className="size-2 rounded-full bg-water" aria-hidden="true" />}
      {title}
    </h2>
  );
}

export function PanelCard({ title, coach, children, open, onOpenChange }: Props) {
  if (open === undefined) {
    return (
      <Card className="gap-0 py-4">
        <CardContent className="flex flex-col gap-3 px-4">
          <Heading title={title} coach={coach} />
          {children}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="gap-0 py-4">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CardContent className="px-4">
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md text-left">
            <Heading title={title} coach={coach} />
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">{children}</CollapsibleContent>
        </CardContent>
      </Collapsible>
    </Card>
  );
}
