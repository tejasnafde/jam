import { useEffect, useRef } from "react";

const OIL = "#FF8A3D";
const WATER = "#3CCFC0";
const BORDER = "#4D465E";

/** Sizes the canvas to its box at device resolution and returns the 2D context. */
function fit(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const g = canvas.getContext("2d");
  g?.clearRect(0, 0, w, h);
  return g ? { g, w, h } : null;
}

/**
 * The live mic waveform with an input level bar, or the static waveform of a
 * take (min/max per pixel column). Live wins when an analyser is given.
 */
export function Scope({
  analyser,
  take,
  hot,
}: {
  analyser: AnalyserNode | null;
  take: Float32Array | null;
  hot: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const level = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    if (!analyser) {
      if (level.current) level.current.style.transform = "scaleX(0)";
      const c = fit(el);
      if (!c) return;
      const { g, w, h } = c;
      g.fillStyle = take ? WATER : BORDER;
      if (!take) {
        g.fillRect(0, h / 2, w, 1);
        return;
      }
      const per = Math.max(1, Math.floor(take.length / w));
      let peak = 0.05;
      for (const s of take) peak = Math.max(peak, Math.abs(s));
      for (let x = 0; x < w; x++) {
        let lo = 0;
        let hi = 0;
        for (let i = x * per; i < (x + 1) * per && i < take.length; i++) {
          const s = (take[i] ?? 0) / peak;
          lo = Math.min(lo, s);
          hi = Math.max(hi, s);
        }
        g.fillRect(x, (h / 2) * (1 - hi), 1, Math.max(1, (h / 2) * (hi - lo)));
      }
      return;
    }
    const buf = new Float32Array(analyser.fftSize);
    let frame = 0;
    const draw = () => {
      analyser.getFloatTimeDomainData(buf);
      const c = fit(el);
      if (c) {
        const { g, w, h } = c;
        g.strokeStyle = hot ? OIL : WATER;
        g.lineWidth = Math.max(1, window.devicePixelRatio);
        g.beginPath();
        buf.forEach((s, i) => {
          const x = (i / (buf.length - 1)) * w;
          const y = (h / 2) * (1 - s);
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        });
        g.stroke();
      }
      let peak = 0;
      for (const s of buf) peak = Math.max(peak, Math.abs(s));
      if (level.current) {
        level.current.style.transform = `scaleX(${Math.min(1, peak).toFixed(3)})`;
        level.current.style.backgroundColor = peak > 0.95 ? "#FF6B6B" : hot ? OIL : WATER;
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [analyser, take, hot]);

  return (
    <div className="space-y-2">
      <canvas ref={canvas} className="block h-24 w-full rounded-md bg-well" aria-hidden="true" />
      <div className="h-1 overflow-hidden rounded-full bg-secondary" title="Input level" aria-hidden="true">
        <div ref={level} className="h-full origin-left scale-x-0 rounded-full" />
      </div>
    </div>
  );
}
