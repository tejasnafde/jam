import {
  CreateUploadUrl,
  RegisterSample,
  SAMPLE_ID,
  SAMPLE_MAX_BYTES,
  samplePath,
  type Sample,
  type SampleWithUrl,
  type UploadUrlResponse,
} from "@jam/shared";
import { Router } from "express";
import { randomBytes } from "node:crypto";
import type { z } from "zod";
import { pageUser } from "../auth/userAuth.js";
import type { Logger } from "../logger.js";
import type { SampleBlobs } from "../store/blobs.js";
import { SampleNameTaken, type SampleStore } from "../store/samples.js";
import { asyncHandler, parseBody } from "./validate.js";

// Ours are 20 hex chars; the prep job may use Firestore ids. SAMPLE_ID never allows a path separator.
const RegisterBody = RegisterSample.extend({ id: RegisterSample.shape.id.regex(SAMPLE_ID) });

const nameTaken = (name: string) => ({ error: "name_taken", message: `You already have a sample named ${name}.` });

/**
 * The page may only register its own takes and uploads. Derived fields (stem, stats, ops) are kept only
 * when parentId names one of the user's samples; anything else is the prep job's to write.
 */
async function trusted(samples: SampleStore, uid: string, body: z.output<typeof RegisterBody>) {
  if (body.parentId && (await samples.get(uid, body.parentId))) return body;
  const { id, name, storagePath, contentType, durationSec, bpm, key } = body;
  const kind = body.kind === "take" ? ("take" as const) : ("upload" as const);
  return { id, name, kind, storagePath, contentType, durationSec, bpm, key, ops: [] };
}

/** The user's sample library. Every object lives under users/{uid}/, and every call checks the owner. */
export function samplesRouter(samples: SampleStore, blobs: SampleBlobs, log: Logger) {
  const router = Router();

  router.post(
    "/upload-url",
    asyncHandler(async (req, res) => {
      const body = parseBody(CreateUploadUrl, req, res);
      if (!body) return;
      const { uid } = pageUser(req);
      if (await samples.findByName(uid, body.name)) {
        res.status(409).json(nameTaken(body.name));
        return;
      }
      const id = randomBytes(10).toString("hex");
      const storagePath = samplePath(uid, id, body.contentType);
      const response: UploadUrlResponse = {
        id,
        storagePath,
        uploadUrl: await blobs.uploadUrl(storagePath, body.contentType),
      };
      res.json(response);
    }),
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const body = parseBody(RegisterBody, req, res);
      if (!body) return;
      const { uid } = pageUser(req);
      if (body.storagePath !== samplePath(uid, body.id, body.contentType)) {
        res.status(400).json({ error: "invalid_request", message: "storagePath does not match this user and id." });
        return;
      }
      const size = await blobs.size(body.storagePath);
      if (size === null) {
        res.status(400).json({ error: "not_uploaded", message: "Upload the file before you register it." });
        return;
      }
      if (size > SAMPLE_MAX_BYTES) {
        await blobs.remove(body.storagePath);
        res.status(413).json({ error: "too_large", message: "A sample can be 50 MB at most." });
        return;
      }
      if (await samples.get(uid, body.id)) {
        res.status(409).json({ error: "id_taken", message: "This sample is already registered." });
        return;
      }
      const sample: Sample = {
        ...(await trusted(samples, uid, body)),
        userId: uid,
        createdAt: new Date().toISOString(),
      };
      try {
        await samples.create(sample);
      } catch (err) {
        if (!(err instanceof SampleNameTaken)) throw err;
        // ponytail: an upload that is never registered (tab closed after the PUT) still stays in the bucket;
        // add a sweep of objects with no doc if storage cost shows up.
        await blobs.remove(body.storagePath);
        res.status(409).json(nameTaken(body.name));
        return;
      }
      log.info("sample registered", { uid, id: sample.id, kind: sample.kind, bytes: size });
      res.status(201).json(sample);
    }),
  );

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const list = await samples.list(pageUser(req).uid);
      const withUrls: SampleWithUrl[] = await Promise.all(
        list.map(async (s) => ({ ...s, url: await blobs.readUrl(s.storagePath) })),
      );
      res.json({ samples: withUrls });
    }),
  );

  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const { uid } = pageUser(req);
      const id = String(req.params.id);
      const sample = SAMPLE_ID.test(id) ? await samples.get(uid, id) : null;
      if (!sample) {
        res.status(404).end();
        return;
      }
      // Doc first: a leftover blob is invisible, a leftover doc is a broken row.
      await samples.delete(uid, sample.id);
      await blobs.remove(sample.storagePath);
      log.info("sample deleted", { uid, id: sample.id });
      res.status(204).end();
    }),
  );

  return router;
}
