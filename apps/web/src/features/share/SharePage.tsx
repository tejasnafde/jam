import { formatDuration, SHARE_LIMITS, shareAudioPath, type PublicShare } from "@jam/shared";
import { ArrowRight, Download, Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { countPlay, fetchPublicShare } from "@/lib/share-api";
import { cn } from "@/lib/utils";
import { asOfText } from "./asOf";

/** Peaks stored with the share; the waveform pools them down to what fits its width. */
const PEAKS = SHARE_LIMITS.peaks;

/** Max-pools peaks down to `count` bars. */
const pool = (peaks: number[], count: number) =>
  Array.from({ length: count }, (_, i) =>
    Math.max(0, ...peaks.slice(Math.floor((i * peaks.length) / count), Math.floor(((i + 1) * peaks.length) / count))),
  );

type Load =
  { kind: "loading" } | { kind: "off" } | { kind: "failed"; message: string } | { kind: "ready"; share: PublicShare };

/** A flat waveform, for a share stored without peaks. */
const FLAT = new Array<number>(PEAKS).fill(0.15);

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 flex-none items-center px-4 md:px-6">
        <a
          href="/"
          className="flex items-center gap-2 rounded-md text-[22px] font-bold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label="jam home"
        >
          <Logo className="size-7" />
          <span>jam</span>
        </a>
      </header>
      <main className="flex flex-1 flex-col items-center px-4 pt-6 pb-10 md:justify-center md:pt-0 md:pb-24">
        <div className="w-full max-w-xl">{children}</div>
      </main>
      <footer className="flex flex-none flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-hairline px-4 py-5 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          Made with <Logo className="size-4" /> <span className="font-semibold text-foreground">jam</span>
        </span>
        <a href="/" className="flex items-center gap-1 font-medium text-oil hover:underline">
          Make your own
          <ArrowRight className="size-3.5" />
        </a>
      </footer>
    </div>
  );
}

function Waveform({
  peaks,
  progress,
  onSeek,
}: {
  peaks: number[];
  progress: number;
  onSeek: (fraction: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  // One bar per 5 px (3 px bar, 2 px gap), so a phone gets fewer, wider bars.
  const [count, setCount] = useState(96);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setCount(Math.max(24, Math.min(PEAKS, Math.floor(el.clientWidth / 5))));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const bars = pool(peaks, count);
  const seek = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)));
  };
  return (
    <div
      ref={box}
      className="flex h-20 w-full cursor-pointer items-center gap-[2px] md:h-24"
      onPointerDown={seek}
      aria-hidden="true"
      data-testid="waveform"
    >
      {bars.map((p, i) => (
        <span
          key={i}
          className={cn(
            "min-w-0 flex-1 rounded-full transition-colors",
            (i + 0.5) / bars.length <= progress ? "bg-oil" : "bg-gutter/70",
          )}
          style={{ height: `${Math.max(4, p * 100)}%` }}
        />
      ))}
    </div>
  );
}

/** The listener page at /s/:id: one pass of a piece, read only. No sign-in. */
export function SharePage({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [time, setTime] = useState(0);
  // From the file's metadata once the player has it; the share's length until then.
  const [fileDuration, setFileDuration] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const counted = useRef(false);

  // Only the metadata loads here. The player streams the audio when Play is pressed, so a page view
  // that never plays costs no download.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const share = await fetchPublicShare(id);
        document.title = `${share.title} - jam`;
        if (!cancelled) setLoad({ kind: "ready", share });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setLoad({ kind: "off" });
        else setLoad({ kind: "failed", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // The clock follows the audio smoothly while it plays.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const step = () => {
      setTime(audio.current?.currentTime ?? 0);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  if (load.kind === "loading") {
    return (
      <Shell>
        <p className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading the music
        </p>
      </Shell>
    );
  }

  if (load.kind === "off" || load.kind === "failed") {
    return (
      <Shell>
        <section className="flex flex-col items-center gap-4 py-16 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-card ring-1 ring-border">
            <Logo className="size-8 opacity-60" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">
            {load.kind === "off" ? "This link is turned off" : "The music did not load"}
          </h1>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            {load.kind === "off"
              ? "The person who shared it turned it off, or the link is not complete. Ask them for a new one."
              : `${load.message} Reload the page to try again.`}
          </p>
          <Button asChild size="lg" className="mt-2 rounded-full">
            <a href="/">Make your own music</a>
          </Button>
        </section>
      </Shell>
    );
  }

  const { share } = load;
  const peaks = share.peaks?.length ? share.peaks : FLAT;
  const src = shareAudioPath(share.id);
  const duration = fileDuration || share.seconds + SHARE_LIMITS.tailSeconds;
  const progress = duration ? Math.min(1, time / duration) : 0;

  const toggle = async () => {
    const el = audio.current;
    if (!el) return;
    if (playing) return el.pause();
    if (ended) {
      el.currentTime = 0;
      setEnded(false);
    }
    try {
      await el.play();
    } catch (err) {
      // A load failure also fires the element's error event, which shows the message.
      console.error(err);
      return;
    }
    if (!counted.current) {
      counted.current = true;
      void countPlay(share.id);
    }
  };

  const seek = (fraction: number) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = fraction * duration;
    setTime(el.currentTime);
    setEnded(false);
  };

  return (
    <Shell>
      <article className="flex flex-col gap-6">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-bold tracking-tight break-words md:text-4xl">{share.title}</h1>
          <p className="text-sm text-muted-foreground">
            by <span className="text-foreground">{share.ownerName}</span>, as of{" "}
            <time dateTime={share.asOf} className="tabular-nums">
              {asOfText(share.asOf)}
            </time>
          </p>
        </header>

        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 md:p-5">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => void toggle()}
              aria-label={playing ? "Pause" : ended ? "Play again" : "Play"}
              className={cn(
                "flex size-16 flex-none items-center justify-center rounded-full bg-oil text-primary-foreground shadow-[0_0_0_6px_rgb(255_138_61/0.12)] transition-transform outline-none hover:scale-[1.03] focus-visible:ring-4 focus-visible:ring-ring/50 active:scale-95",
                playing && "jam-breathe",
              )}
            >
              {playing ? (
                <Pause className="size-7 fill-current" />
              ) : ended ? (
                <RotateCcw className="size-7" />
              ) : (
                <Play className="ml-1 size-7 fill-current" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <Waveform peaks={peaks} progress={progress} onSeek={seek} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-sm tabular-nums" aria-label="Elapsed and total time">
              <span className={cn(playing && "text-oil")}>{formatDuration(time)}</span>
              <span className="text-muted-foreground"> / {formatDuration(duration)}</span>
            </span>
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground">
              <a href={`${src}?download`} download>
                <Download />
                Download
              </a>
            </Button>
          </div>
          <audio
            ref={audio}
            src={src}
            preload="metadata"
            onLoadedMetadata={(e) =>
              Number.isFinite(e.currentTarget.duration) && setFileDuration(e.currentTarget.duration)
            }
            onError={() => setLoad({ kind: "failed", message: "The audio did not load." })}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false);
              setEnded(true);
              setTime(duration);
            }}
          />
        </div>

        {share.code !== null && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">The code</h2>
            <pre
              className="max-h-[60vh] overflow-auto rounded-xl border border-border bg-well p-4 font-mono text-xs leading-relaxed"
              aria-label="The code"
            >
              {share.code}
            </pre>
          </section>
        )}
      </article>
    </Shell>
  );
}
