import { PanelRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LevelMeter } from "./LevelMeter";
import { Logo } from "./Logo";
import { PlayButton } from "./PlayButton";

interface Props {
  playing: boolean;
  onTogglePlay: () => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  status: ReactNode;
  tools?: ReactNode;
  account: ReactNode;
}

export function TopBar({ playing, onTogglePlay, panelOpen, onTogglePanel, status, tools, account }: Props) {
  return (
    <header className="sticky top-0 z-10 flex h-14 flex-none items-center gap-3 border-b border-border bg-background px-3 md:gap-4 md:px-4">
      <a href="/" className="flex items-center gap-2 text-[22px] font-bold tracking-tight" aria-label="jam home">
        <Logo className="size-7" />
        <span>jam</span>
      </a>
      <PlayButton playing={playing} onToggle={onTogglePlay} />
      <LevelMeter playing={playing} />
      <span className="text-xs whitespace-nowrap text-muted-foreground max-xl:hidden">
        Ctrl+Enter to play, Ctrl+. to stop
      </span>
      <div className="flex-1" />
      {status}
      {tools}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-lg"
            onClick={onTogglePanel}
            aria-label="Toggle side panel"
            aria-expanded={panelOpen}
            className="max-md:hidden"
          >
            <PanelRight className={panelOpen ? "text-foreground" : "text-muted-foreground"} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{panelOpen ? "Hide panel" : "Show panel"}</TooltipContent>
      </Tooltip>
      {account}
    </header>
  );
}
