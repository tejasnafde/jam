import type { SampleWithUrl } from "@jam/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Api } from "@/lib/api";
import { samplesApi } from "@/lib/samples-api";
import { audioFileProblem, contentTypeOf, durationOf, toSampleName } from "./sampleFile";

// Read URLs live for an hour, so refresh well before they expire.
const REFRESH_MS = 30 * 60_000;
const NONE: SampleWithUrl[] = [];

type StrudelSamples = (map: Record<string, string | string[]>) => Promise<void>;

/**
 * Registers the library with Strudel, so s("name") plays. Waits for the REPL to put samples() on globalThis.
 * samples() only adds names, so a deleted name is set to an empty list, which makes it silent.
 */
export async function registerWithStrudel(list: SampleWithUrl[], removed: string[] = []) {
  const scope = globalThis as { samples?: StrudelSamples };
  // ponytail: polls up to a minute for the REPL to load; an event from StrudelEditor if this ever misses
  for (let i = 0; !scope.samples && i < 120; i++) await new Promise((r) => setTimeout(r, 500));
  const map: Record<string, string | string[]> = Object.fromEntries(removed.map((name) => [name, []]));
  for (const s of list) map[s.name] = s.url;
  await scope.samples?.(map);
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The signed-in user's sample library, kept registered with Strudel. */
export function useSamples(api: Api | null) {
  const client = useMemo(() => (api ? samplesApi(api) : null), [api]);
  // Tagged with the client it was loaded for, so a sign-out never shows another account's samples.
  const [loaded, setLoaded] = useState<{ client: object; samples: SampleWithUrl[] } | null>(null);
  const [uploading, setUploading] = useState(false);

  const refresh = useCallback(async () => {
    if (client) setLoaded({ client, samples: await client.list() });
  }, [client]);

  useEffect(() => {
    if (!client) return;
    let live = true;
    const load = () =>
      client
        .list()
        .then((list) => live && setLoaded({ client, samples: list }))
        .catch(console.error);
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [client]);

  const samples = loaded && loaded.client === client ? loaded.samples : NONE;

  // Names registered before, so a delete can clear them from Strudel's map.
  const registered = useRef(new Set<string>());
  useEffect(() => {
    const removed = [...registered.current].filter((name) => !samples.some((s) => s.name === name));
    registered.current = new Set(samples.map((s) => s.name));
    registerWithStrudel(samples, removed).catch(console.error);
  }, [samples]);

  // Uploads run one at a time, so files dropped together get distinct names.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef(samples);
  useEffect(() => {
    latest.current = samples;
  }, [samples]);
  const reserved = useRef(new Set<string>());

  /** Uploads one file. Resolves to the new sample's name, or null when it was refused or failed. */
  const upload = useCallback(
    (file: File): Promise<string | null> => {
      const run = async (): Promise<string | null> => {
        if (!client) return null;
        const contentType = contentTypeOf(file.name);
        const problem = audioFileProblem(file);
        if (!contentType || problem) {
          toast.error(`${file.name} ${problem ?? "is not an mp3 or wav file"}.`);
          return null;
        }
        setUploading(true);
        const taken = new Set([...latest.current.map((s) => s.name), ...reserved.current]);
        const name = toSampleName(file.name, taken);
        reserved.current.add(name);
        try {
          const durationSec = await durationOf(file);
          const { id, uploadUrl, storagePath } = await client.uploadUrl({ name, contentType });
          await client.put(uploadUrl, file, contentType);
          await client.register({ id, name, kind: "upload", storagePath, contentType, durationSec });
          const list = await client.list();
          latest.current = list;
          setLoaded({ client, samples: list });
          // s("name") plays only once Strudel knows the name.
          await registerWithStrudel(list).catch(console.error);
          toast.success(`Added ${name}`, { description: `Play it with s("${name}")` });
          return name;
        } catch (err) {
          toast.error("Could not upload", { description: message(err) });
          return null;
        } finally {
          reserved.current.delete(name);
          setUploading(false);
        }
      };
      const next = queue.current.then(run, run);
      queue.current = next;
      return next;
    },
    [client],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!client) return;
      try {
        await client.remove(id);
        await refresh();
      } catch (err) {
        toast.error("Could not delete", { description: message(err) });
      }
    },
    [client, refresh],
  );

  return { samples, uploading, upload, remove, refresh, client };
}
