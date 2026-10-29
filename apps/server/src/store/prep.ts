// Firestore (database jam-db):
//   users/{uid}/prep_jobs/{id}   PrepJob. The page creates it; the Cloud Run job updates it.
//   users/{uid}/samples/{id}     Sample (read here only to check that the source exists)

import { PREP_JOBS_COLLECTION, SAMPLES_COLLECTION, type PrepJob, type PrepOps } from "@jam/shared";
import type { Firestore } from "firebase-admin/firestore";

export type PrepJobPatch = Partial<Pick<PrepJob, "status" | "sampleIds" | "error">>;

/** Prep job state, scoped to one user. Every call takes the owner's uid. */
export interface PrepStore {
  sampleExists(uid: string, sampleId: string): Promise<boolean>;
  createJob(uid: string, sampleId: string, ops: PrepOps): Promise<PrepJob>;
  getJob(uid: string, jobId: string): Promise<PrepJob | null>;
  /** Newest first. */
  listJobs(uid: string, limit: number): Promise<PrepJob[]>;
  updateJob(uid: string, jobId: string, patch: PrepJobPatch): Promise<void>;
}

const now = () => new Date().toISOString();

export class FirestorePrepStore implements PrepStore {
  constructor(private readonly db: Firestore) {}

  private jobs(uid: string) {
    return this.db.collection(PREP_JOBS_COLLECTION(uid));
  }

  async sampleExists(uid: string, sampleId: string) {
    return (await this.db.collection(SAMPLES_COLLECTION(uid)).doc(sampleId).get()).exists;
  }

  async createJob(uid: string, sampleId: string, ops: PrepOps): Promise<PrepJob> {
    const ref = this.jobs(uid).doc();
    const ts = now();
    const doc = { sampleId, ops, status: "queued" as const, createdAt: ts, updatedAt: ts };
    await ref.set(doc);
    return { id: ref.id, ...doc };
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
      .update({ ...patch, updatedAt: now() });
  }
}

/** An in-memory PrepStore for tests and local runs. */
export class MemoryPrepStore implements PrepStore {
  /** Sample ids per uid that count as existing. */
  readonly samples = new Map<string, Set<string>>();
  readonly jobs = new Map<string, PrepJob[]>();
  private seq = 0;

  async sampleExists(uid: string, sampleId: string) {
    return this.samples.get(uid)?.has(sampleId) ?? false;
  }

  async createJob(uid: string, sampleId: string, ops: PrepOps) {
    const ts = now();
    const job: PrepJob = { id: `job${++this.seq}`, sampleId, ops, status: "queued", createdAt: ts, updatedAt: ts };
    this.jobs.set(uid, [job, ...(this.jobs.get(uid) ?? [])]);
    return structuredClone(job);
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
    Object.assign(job, patch);
  }
}
