import type { Sample } from "@jam/shared";

export class SampleNameTaken extends Error {
  constructor(name: string) {
    super(`a sample named ${name} exists`);
  }
}

/** Sample metadata, scoped to one user. Every call takes the owner's uid. */
export interface SampleStore {
  /** Newest first. */
  list(uid: string): Promise<Sample[]>;
  get(uid: string, id: string): Promise<Sample | null>;
  findByName(uid: string, name: string): Promise<Sample | null>;
  /** Throws SampleNameTaken when the user already has a sample with this name. */
  create(sample: Sample): Promise<Sample>;
  /** False when the sample does not exist for this user. */
  delete(uid: string, id: string): Promise<boolean>;
}

/** An in-memory SampleStore for tests and local runs. */
export class MemorySampleStore implements SampleStore {
  readonly samples = new Map<string, Sample>();

  private mine(uid: string) {
    return [...this.samples.values()].filter((s) => s.userId === uid);
  }

  async list(uid: string) {
    return this.mine(uid)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => structuredClone(s));
  }

  async get(uid: string, id: string) {
    const sample = this.samples.get(id);
    return sample && sample.userId === uid ? structuredClone(sample) : null;
  }

  async findByName(uid: string, name: string) {
    const sample = this.mine(uid).find((s) => s.name === name);
    return sample ? structuredClone(sample) : null;
  }

  async create(sample: Sample) {
    // Firestore's tx.create fails on an existing doc, so the fake does too.
    if (this.samples.has(sample.id)) throw new Error(`ALREADY_EXISTS: ${sample.id}`);
    if (this.mine(sample.userId).some((s) => s.name === sample.name)) throw new SampleNameTaken(sample.name);
    this.samples.set(sample.id, structuredClone(sample));
    return structuredClone(sample);
  }

  async delete(uid: string, id: string) {
    if (!(await this.get(uid, id))) return false;
    return this.samples.delete(id);
  }
}
