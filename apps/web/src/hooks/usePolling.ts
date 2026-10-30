import { useEffect, useLayoutEffect, useRef } from "react";

/** Calls fn now and every intervalMs while the tab is visible. A new restartKey calls it again at once. */
export function usePolling(fn: (() => Promise<void>) | null, intervalMs: number, restartKey?: string | null) {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });

  useEffect(() => {
    if (!fn) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const tick = async () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible") await latest.current?.().catch(console.error);
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };
    const onVisible = () => document.visibilityState === "visible" && void tick();
    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // Restart only when polling turns on or off (or the key changes), not on every new closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!fn, intervalMs, restartKey]);
}
