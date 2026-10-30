import { useEffect, useMemo, useState } from "react";
import { buildCatalog, fromIndex, fromSoundMap, type IndexEntry, type RawSound } from "./catalog";
import { strudelSoundMap } from "./strudelSounds";

/** Where the list came from: Strudel's own map (what plays), or the server index (fallback). */
export type CatalogSource = "loading" | "strudel" | "server" | "none";

// Strudel registers thousands of keys one by one while it loads; rebuild once the burst settles.
const SETTLE_MS = 300;
const POLL_MS = 500;
// The REPL normally loads in a few seconds. After this, the server index stands in.
const FALLBACK_AFTER_MS = 20_000;

/** The sound catalog, from Strudel's registered sounds, plus the user's own samples as "Yours". */
export function useSoundCatalog(yours: readonly string[]) {
  const [raw, setRaw] = useState<RawSound[]>([]);
  const [source, setSource] = useState<CatalogSource>("loading");

  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | null = null;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    const attach = () => {
      const map = strudelSoundMap();
      if (!map) return false;
      const read = () => live && setRaw(fromSoundMap(map.get()));
      read();
      setSource("strudel");
      unlisten = map.listen(() => {
        clearTimeout(settle);
        settle = setTimeout(read, SETTLE_MS);
      });
      return true;
    };

    const fallback = () =>
      fetch("/api/sounds")
        .then((r) => (r.ok ? (r.json() as Promise<{ sounds: IndexEntry[] }>) : Promise.reject(new Error(r.statusText))))
        .then((body) => {
          if (!live || strudelSoundMap()) return;
          setRaw(fromIndex(body.sounds));
          setSource("server");
        })
        .catch(() => live && setSource("none"));

    if (attach()) return () => void unlisten?.();
    let fellBack = false;
    const timer = setInterval(() => {
      if (attach()) return clearInterval(timer);
      if (!fellBack && Date.now() - started > FALLBACK_AFTER_MS) {
        fellBack = true;
        // Keep polling: if Strudel loads late, its map replaces the fallback.
        void fallback();
      }
    }, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
      clearTimeout(settle);
      unlisten?.();
    };
  }, []);

  const catalog = useMemo(() => buildCatalog(raw, yours), [raw, yours]);
  return { catalog, source };
}
