import { useEffect, useRef } from "react";
import { read } from "@/lib/audio";
import { cn } from "@/lib/utils";

const BANDS = ["low", "mid", "high"] as const;
const FLOOR = 0.12;

/**
 * Three bars (low, mid, high) in a dark well, driven by the live analyser while
 * playing. Low and mid are oil, high is water: the two halves of the logo.
 */
export function LevelMeter({ playing }: { playing: boolean }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const reading = playing ? read() : null;
      const level = reading ? Math.min(1, reading.rms * 4) : 0;
      BANDS.forEach((band, i) => {
        const share = reading ? reading[band] : 0;
        const height = reading ? Math.max(FLOOR, Math.min(1, level * (0.4 + share * 1.6))) : FLOOR;
        const bar = bars.current[i];
        if (bar) bar.style.transform = `scaleY(${height.toFixed(3)})`;
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  return (
    <div
      className="flex h-9 items-end gap-1 rounded-md bg-well px-2 py-1.5 ring-1 ring-hairline ring-inset"
      aria-hidden="true"
      title="Output level: low, mid, high"
    >
      {BANDS.map((band, i) => (
        <span
          key={band}
          ref={(el) => {
            bars.current[i] = el;
          }}
          className={cn(
            "h-full w-1.5 origin-bottom scale-y-[0.12] rounded-[2px] bg-gutter transition-transform duration-75 ease-linear",
            playing && (band === "high" ? "bg-water" : "bg-oil"),
          )}
        />
      ))}
    </div>
  );
}
