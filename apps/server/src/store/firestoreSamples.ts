// users/{uid}/samples/{id}   Sample (see SAMPLES_COLLECTION in @jam/shared)

import { SAMPLES_COLLECTION, type Sample } from "@jam/shared";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { SampleNameTaken, type SampleStore } from "./samples.js";

const toSample = (doc: DocumentSnapshot) => ({ ...doc.data(), id: doc.id }) as Sample;

export class FirestoreSampleStore implements SampleStore {
  constructor(private readonly db: Firestore) {}

  private col(uid: string) {
    return this.db.collection(SAMPLES_COLLECTION(uid));
  }

  async list(uid: string) {
    const snap = await this.col(uid).orderBy("createdAt", "desc").get();
    return snap.docs.map(toSample);
  }

  async get(uid: string, id: string) {
    const doc = await this.col(uid).doc(id).get();
    return doc.exists ? toSample(doc) : null;
  }

  async findByName(uid: string, name: string) {
    const snap = await this.col(uid).where("name", "==", name).limit(1).get();
    const doc = snap.docs[0];
    return doc ? toSample(doc) : null;
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
