import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The one oil button. While playing it breathes, so the eye finds what is live. */
export function PlayButton({ playing, onToggle }: { playing: boolean; onToggle: () => void }) {
  return (
    <Button
      onClick={onToggle}
      size="lg"
      aria-label={playing ? "Stop" : "Play"}
      className={cn(
        "h-9 min-w-[88px] rounded-full pr-4 pl-3 font-bold transition-colors",
        playing && "jam-breathe bg-oil/15 text-oil ring-[1.5px] ring-oil ring-inset hover:bg-oil/25",
      )}
    >
      {playing ? <Square className="fill-current" /> : <Play className="fill-current" />}
      {playing ? "Stop" : "Play"}
    </Button>
  );
}
