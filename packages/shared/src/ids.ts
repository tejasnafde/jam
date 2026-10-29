// Document id formats shared by the routes. Kept out of samples.ts, which is never edited.
import { z } from "zod";

/** A Firestore doc id the server accepts from a client: no "/", never empty. */
export const SAMPLE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const SampleId = z.string().regex(SAMPLE_ID);
