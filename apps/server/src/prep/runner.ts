import type { PrepOps } from "@jam/shared";

export interface PrepRun {
  uid: string;
  jobId: string;
  sampleId: string;
  ops: PrepOps;
}

/** Starts the prep worker for one job. Injected so tests do not need Cloud Run. */
export type PrepRunner = (run: PrepRun) => Promise<void>;

export interface CloudRunJobConfig {
  project: string;
  region: string;
  job: string;
  getAccessToken: () => Promise<string>;
  fetch?: typeof fetch;
}

/** The env the worker reads (services/prep/main.py). */
export const prepEnv = ({ uid, jobId, sampleId, ops }: PrepRun) => [
  { name: "JAM_UID", value: uid },
  { name: "JAM_JOB_ID", value: jobId },
  { name: "JAM_SAMPLE_ID", value: sampleId },
  { name: "JAM_OPS", value: JSON.stringify(ops) },
];

/**
 * Starts one execution of the Cloud Run job with per-run env overrides
 * (Cloud Run Admin API v2, jobs.run). It does not wait: the worker writes
 * its status to the job doc.
 */
export function cloudRunJobRunner({
  project,
  region,
  job,
  getAccessToken,
  fetch: doFetch = fetch,
}: CloudRunJobConfig): PrepRunner {
  const url = `https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run`;
  return async (run) => {
    const res = await doFetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ overrides: { containerOverrides: [{ env: prepEnv(run) }] } }),
    });
    if (!res.ok) throw new Error(`Cloud Run jobs.run: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  };
}
