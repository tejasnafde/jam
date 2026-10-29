import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PlayButton({ playing, onToggle }: { playing: boolean; onToggle: () => void }) {
  return (
    <Button
      onClick={onToggle}
      size="lg"
      aria-label={playing ? "Stop" : "Play"}
      className={cn(
        "h-9 rounded-full pr-4 pl-3 font-bold",
        playing && "bg-transparent text-oil ring-[1.5px] ring-oil ring-inset hover:bg-oil/10",
      )}
    >
      {playing ? <Square className="fill-current" /> : <Play className="fill-current" />}
      {playing ? "Stop" : "Play"}
    </Button>
  );
}
