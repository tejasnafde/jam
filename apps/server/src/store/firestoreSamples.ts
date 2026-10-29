// users/{uid}/samples/{id}   Sample (see SAMPLES_COLLECTION in @jam/shared)

import { SAMPLES_COLLECTION, Sample } from "@jam/shared";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import type { Logger } from "../logger.js";
import { SampleNameTaken, type SampleStore } from "./samples.js";

/** Other writers (the prep job) share this collection, so validate every doc. Null for a bad one. */
export function toSample(doc: Pick<DocumentSnapshot, "id" | "data">, log: Logger): Sample | null {
  const parsed = Sample.safeParse({ ...doc.data(), id: doc.id });
  if (parsed.success) return parsed.data;
  log.warn("skipping invalid sample doc", { id: doc.id, issues: parsed.error.issues.map((i) => i.path.join(".")) });
  return null;
}

export class FirestoreSampleStore implements SampleStore {
  constructor(
    private readonly db: Firestore,
    private readonly log: Logger,
  ) {}

  private toSample(doc: Pick<DocumentSnapshot, "id" | "data">) {
    return toSample(doc, this.log);
  }

  private col(uid: string) {
    return this.db.collection(SAMPLES_COLLECTION(uid));
  }

  async list(uid: string) {
    const snap = await this.col(uid).orderBy("createdAt", "desc").get();
    return snap.docs.map((d) => this.toSample(d)).filter((s) => s !== null);
  }

  async get(uid: string, id: string) {
    const doc = await this.col(uid).doc(id).get();
    return doc.exists ? this.toSample(doc) : null;
  }

  async findByName(uid: string, name: string) {
    const snap = await this.col(uid).where("name", "==", name).limit(1).get();
    const doc = snap.docs[0];
    return doc ? this.toSample(doc) : null;
  }

  async create(sample: Sample) {
    const col = this.col(sample.userId);
    // The transaction re-reads the name query, so two racing creates cannot both win.
    await this.db.runTransaction(async (tx) => {
      const taken = await tx.get(col.where("name", "==", sample.name).limit(1));
      if (!taken.empty) throw new SampleNameTaken(sample.name);
      tx.create(col.doc(sample.id), sample);
    });
    return sample;
  }

  async delete(uid: string, id: string) {
    const ref = this.col(uid).doc(id);
    if (!(await ref.get()).exists) return false;
    await ref.delete();
    return true;
  }
}
