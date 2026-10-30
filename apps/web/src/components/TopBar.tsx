import { PanelRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LevelMeter } from "./LevelMeter";
import { LiveToggle } from "./LiveToggle";
import { Logo } from "./Logo";
import { PLAY_KEY } from "@/features/editor/defaultCode";
import { PlayButton } from "./PlayButton";

interface Props {
  playing: boolean;
  onTogglePlay: () => void;
  live: boolean;
  onLiveChange: (on: boolean) => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  status: ReactNode;
  /** The open session's name. */
  session?: ReactNode;
  tools?: ReactNode;
  account: ReactNode;
}

export function TopBar({
  playing,
  onTogglePlay,
  live,
  onLiveChange,
  panelOpen,
  onTogglePanel,
  status,
  session,
  tools,
  account,
}: Props) {
  return (
    <header className="sticky top-0 z-10 flex h-14 flex-none items-center gap-3 border-b border-hairline bg-background px-3 md:gap-4 md:px-4">
      <a
        href="/"
        className="flex items-center gap-2 rounded-md text-[22px] font-bold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label="jam home"
      >
        <Logo className="size-7" />
        <span>jam</span>
      </a>
      <div className="flex items-center gap-2">
        <PlayButton playing={playing} onToggle={onTogglePlay} />
        <LiveToggle on={live} onChange={onLiveChange} />
        <span className="max-sm:hidden">
          <LevelMeter playing={playing} />
        </span>
      </div>
      {/* A phone has no room here; the page shows the name in a strip below instead. */}
      {session && <div className="flex min-w-0 items-center max-md:hidden">{session}</div>}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground max-xl:hidden" aria-label="Shortcuts">
        <kbd className="jam-kbd">{PLAY_KEY}</kbd>
        <kbd className="jam-kbd">Enter</kbd>
        <span>plays</span>
        <span className="mx-1 text-gutter" aria-hidden="true">
          /
        </span>
        <kbd className="jam-kbd">{PLAY_KEY}</kbd>
        <kbd className="jam-kbd">.</kbd>
        <span>stops</span>
      </p>
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
