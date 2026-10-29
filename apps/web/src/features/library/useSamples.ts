import { SAMPLE_MAX_BYTES, type SampleWithUrl } from "@jam/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Api } from "@/lib/api";
import { samplesApi } from "@/lib/samples-api";
import { contentTypeOf, durationOf, toSampleName } from "./sampleFile";

// Read URLs live for an hour, so refresh well before they expire.
const REFRESH_MS = 30 * 60_000;
const NONE: SampleWithUrl[] = [];

type StrudelSamples = (map: Record<string, string>) => Promise<void>;

/** Registers the library with Strudel, so s("name") plays. Waits for the REPL to put samples() on globalThis. */
async function registerWithStrudel(list: SampleWithUrl[]) {
  const scope = globalThis as { samples?: StrudelSamples };
  // ponytail: polls up to a minute for the REPL to load; an event from StrudelEditor if this ever misses
  for (let i = 0; !scope.samples && i < 120; i++) await new Promise((r) => setTimeout(r, 500));
  await scope.samples?.(Object.fromEntries(list.map((s) => [s.name, s.url])));
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

  useEffect(() => {
    if (samples.length > 0) registerWithStrudel(samples).catch(console.error);
  }, [samples]);

  const upload = useCallback(
    async (file: File) => {
      if (!client) return;
      const contentType = contentTypeOf(file.name);
      if (!contentType) return void toast.error("Choose an mp3 or wav file.");
      if (file.size > SAMPLE_MAX_BYTES) return void toast.error("A sample can be 50 MB at most.");
      setUploading(true);
      try {
        const name = toSampleName(file.name, new Set(samples.map((s) => s.name)));
        const durationSec = await durationOf(file);
        const { id, uploadUrl, storagePath } = await client.uploadUrl({ name, contentType });
        await client.put(uploadUrl, file, contentType);
        await client.register({ id, name, kind: "upload", storagePath, contentType, durationSec });
        await refresh();
        toast.success(`Added ${name}`, { description: `Play it with s("${name}")` });
      } catch (err) {
        toast.error("Could not upload", { description: message(err) });
      } finally {
        setUploading(false);
      }
    },
    [client, samples, refresh],
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
