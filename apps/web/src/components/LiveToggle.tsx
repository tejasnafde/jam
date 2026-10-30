import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Live mode: the music follows the code after a pause in typing. Oil when on, like everything that plays. */
export function LiveToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Live"
          onClick={() => onChange(!on)}
          className={cn(
            "flex h-9 items-center gap-1.5 rounded-full px-2.5 text-sm sm:px-3 font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
            on
              ? "bg-oil/15 text-oil ring-[1.5px] ring-oil/70 ring-inset hover:bg-oil/25"
              : "text-muted-foreground ring-1 ring-hairline ring-inset hover:bg-secondary hover:text-foreground",
          )}
        >
          <span
            className={cn("size-2 rounded-full", on ? "bg-oil" : "border border-current bg-transparent")}
            aria-hidden="true"
          />
          Live
        </button>
      </TooltipTrigger>
      <TooltipContent>Updates the music when you pause typing</TooltipContent>
    </Tooltip>
  );
}
