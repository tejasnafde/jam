import type { PrepOps, PrepStatusResponse } from "@jam/shared";
import { useCallback, useState } from "react";
import { usePolling } from "@/hooks/usePolling";
import type { Api } from "@/lib/api";

const POLL_MS = 4000;

/** The last prep job per sample. "starting" is before the server answers. */
export type PrepState = (PrepStatusResponse | { status: "starting" }) & { jobId?: string };

export interface PrepHandle {
  jobs: Record<string, PrepState>;
  start: (sampleId: string, ops: PrepOps) => Promise<void>;
}

const active = (s: PrepState) => s.status === "starting" || s.status === "queued" || s.status === "running";

export const isPrepActive = active;

/** Starts prep jobs and polls them until they finish. onDone runs when one makes samples. */
export function usePrep(api: Pick<Api, "startPrep" | "prepStatus"> | null, onDone?: () => void): PrepHandle {
  const [jobs, setJobs] = useState<Record<string, PrepState>>({});
  const set = (sampleId: string, state: PrepState) => setJobs((all) => ({ ...all, [sampleId]: state }));

  const start = async (sampleId: string, ops: PrepOps) => {
    if (!api) return;
    set(sampleId, { status: "starting" });
    try {
      const { jobId } = await api.startPrep({ sampleId, ops });
      set(sampleId, { status: "queued", jobId });
    } catch (err) {
      set(sampleId, { status: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  };

  const poll = useCallback(async () => {
    if (!api) return;
    const pending = Object.entries(jobs).flatMap(([sampleId, s]) =>
      s.jobId && active(s) ? [[sampleId, s.jobId] as const] : [],
    );
    const results = await Promise.all(
      pending.map(async ([sampleId, jobId]) => [sampleId, { ...(await api.prepStatus(jobId)), jobId }] as const),
    );
    if (results.length === 0) return;
    setJobs((all) => ({ ...all, ...Object.fromEntries(results) }));
    if (results.some(([, s]) => s.status === "done")) onDone?.();
  }, [api, jobs, onDone]);

  const anyActive = Object.values(jobs).some((s) => s.jobId && active(s));
  usePolling(api && anyActive ? poll : null, POLL_MS);

  return { jobs, start };
}
