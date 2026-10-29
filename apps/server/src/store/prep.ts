// Firestore (database jam-db):
//   users/{uid}/prep_jobs/{id}   PrepJob. The server creates it; the Cloud Run job updates it.
//   prep_meta/active             {jobs: [{uid, jobId}]}: the jobs that may still run, for the global cap.

import {
  PREP_JOBS_COLLECTION,
  PREP_WORKER_STOPPED,
  isPrepJobActive,
  isPrepJobStale,
  type PrepJob,
  type PrepOps,
} from "@jam/shared";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";

export type PrepJobPatch = Partial<Pick<PrepJob, "status" | "sampleIds" | "error">>;

export interface PrepLimits {
  /** Jobs in flight per user. */
  perUser: number;
  /** Jobs in flight across all users. */
  global: number;
  /** Jobs a user may start in a rolling 24 h. */
  perDay: number;
  nowMs: number;
}

export type PrepRefusal = "user_busy" | "global_busy" | "daily_quota";
export type CreateJobResult = { ok: true; job: PrepJob } | { ok: false; reason: PrepRefusal };

/** Prep job state, scoped to one user. Every call takes the owner's uid. */
export interface PrepStore {
  /** Checks the caps and creates the job in one atomic step, so parallel requests cannot pass a cap together. */
  createJob(uid: string, sampleId: string, ops: PrepOps, limits: PrepLimits): Promise<CreateJobResult>;
  getJob(uid: string, jobId: string): Promise<PrepJob | null>;
  /** Newest first. */
  listJobs(uid: string, limit: number): Promise<PrepJob[]>;
  updateJob(uid: string, jobId: string, patch: PrepJobPatch): Promise<void>;
}

const DAY_MS = 24 * 60 * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** A job whose worker died (OOM, task timeout, bad image) reads as failed, not as running for ever. */
export const withStaleness = (job: PrepJob, nowMs: number): PrepJob =>
  isPrepJobStale(job, nowMs) ? { ...job, status: "failed", error: PREP_WORKER_STOPPED } : job;

/** A job counts against a cap while it is active and its worker can still be alive. */
const counts = (job: PrepJob | null, nowMs: number) => !!job && isPrepJobActive(job) && !isPrepJobStale(job, nowMs);

/** The cap the new job would break, if any. */
export function refusal(
  limits: PrepLimits,
  activeMine: number,
  activeAll: number,
  startedToday: number,
): PrepRefusal | null {
  if (activeMine >= limits.perUser) return "user_busy";
  if (startedToday >= limits.perDay) return "daily_quota";
  if (activeAll >= limits.global) return "global_busy";
  return null;
}

interface ActiveEntry {
  uid: string;
  jobId: string;
}

export class FirestorePrepStore implements PrepStore {
  constructor(private readonly db: Firestore) {}

  private jobs(uid: string) {
    return this.db.collection(PREP_JOBS_COLLECTION(uid));
  }

  private get active() {
    return this.db.doc("prep_meta/active");
  }

  async createJob(uid: string, sampleId: string, ops: PrepOps, limits: PrepLimits): Promise<CreateJobResult> {
    const ref = this.jobs(uid).doc();
    const ts = iso(limits.nowMs);
    const doc = { sampleId, ops, status: "queued" as const, createdAt: ts, updatedAt: ts };
    return this.db.runTransaction(async (tx): Promise<CreateJobResult> => {
      // Every create reads and writes prep_meta/active, so Firestore serialises them.
      const meta = await tx.get(this.active);
      const listed = ((meta.data()?.jobs ?? []) as ActiveEntry[]).slice(0, 50);
      const refs: DocumentReference[] = listed.map((e) => this.jobs(e.uid).doc(e.jobId));
      const snaps = refs.length ? await tx.getAll(...refs) : [];
      const live = listed.filter((_, i) => {
        const snap = snaps[i];
        return snap?.exists && counts(snap.data() as PrepJob, limits.nowMs);
      });
      const today = await tx.get(
        this.jobs(uid)
          .where("createdAt", ">=", iso(limits.nowMs - DAY_MS))
          .limit(limits.perDay),
      );
      const why = refusal(limits, live.filter((e) => e.uid === uid).length, live.length, today.size);
      if (why) return { ok: false, reason: why };
      tx.create(ref, doc);
      tx.set(this.active, { jobs: [...live, { uid, jobId: ref.id }] });
      return { ok: true, job: { id: ref.id, ...doc } };
    });
  }

  async getJob(uid: string, jobId: string) {
    const doc = await this.jobs(uid).doc(jobId).get();
    return doc.exists ? ({ ...doc.data(), id: doc.id } as PrepJob) : null;
  }

  async listJobs(uid: string, limit: number) {
    const snap = await this.jobs(uid).orderBy("createdAt", "desc").limit(limit).get();
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as PrepJob);
  }

  async updateJob(uid: string, jobId: string, patch: PrepJobPatch) {
    await this.jobs(uid)
      .doc(jobId)
      .update({ ...patch, updatedAt: iso(Date.now()) });
  }
}

/** An in-memory PrepStore for tests and local runs. createJob has no await, so it is atomic. */
export class MemoryPrepStore implements PrepStore {
  readonly jobs = new Map<string, PrepJob[]>();
  private seq = 0;

  async createJob(uid: string, sampleId: string, ops: PrepOps, limits: PrepLimits): Promise<CreateJobResult> {
    const all = [...this.jobs.values()].flat().filter((j) => counts(j, limits.nowMs));
    const mine = this.jobs.get(uid) ?? [];
    const today = mine.filter((j) => Date.parse(j.createdAt) >= limits.nowMs - DAY_MS).length;
    const why = refusal(limits, all.filter((j) => mine.includes(j)).length, all.length, today);
    if (why) return { ok: false, reason: why };
    const ts = iso(limits.nowMs);
    const job: PrepJob = { id: `job${++this.seq}`, sampleId, ops, status: "queued", createdAt: ts, updatedAt: ts };
    this.jobs.set(uid, [job, ...mine]);
    return { ok: true, job: structuredClone(job) };
  }

  async getJob(uid: string, jobId: string) {
    const job = this.jobs.get(uid)?.find((j) => j.id === jobId);
    return job ? structuredClone(job) : null;
  }

  async listJobs(uid: string, limit: number) {
    return (this.jobs.get(uid) ?? []).slice(0, limit).map((j) => structuredClone(j));
  }

  async updateJob(uid: string, jobId: string, patch: PrepJobPatch) {
    const job = this.jobs.get(uid)?.find((j) => j.id === jobId);
    if (!job) throw new Error(`prep job ${jobId} not found`);
    Object.assign(job, patch, { updatedAt: iso(Date.now()) });
  }
}
