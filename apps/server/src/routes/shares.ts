import {
  createShareRequestSchema,
  readyShareRequestSchema,
  SHARE_ID,
  SHARE_LIMITS,
  SHARE_UPLOAD_HEADERS,
  shareDescription,
  sharePath,
  updateShareRequestSchema,
  type CreateShareResponse,
  type PublicShare,
  type ShareListResponse,
} from "@jam/shared";
import { Router, type Request, type RequestHandler, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { pageUser } from "../auth/userAuth.js";
import type { Logger } from "../logger.js";
import { clientKey } from "../oauth/router.js";
import type { SampleBlobs } from "../store/blobs.js";
import { ownerView, type ShareRecord, type ShareStore } from "../store/shares.js";
import type { Store } from "../store/types.js";
import { asyncHandler, parseBody } from "./validate.js";

export interface ShareRateLimits {
  /** Shares one user may start per createWindowMs. */
  createMax: number;
  createWindowMs: number;
  /** Requests per minute from one client to the public page, its JSON and its audio. */
  publicPerMinute: number;
}

export const DEFAULT_SHARE_RATE_LIMITS: ShareRateLimits = {
  createMax: 10,
  createWindowMs: 10 * 60_000,
  publicPerMinute: 60,
};

export interface ShareDeps {
  store: Store;
  shares: ShareStore;
  blobs: SampleBlobs;
  log: Logger;
  now: () => number;
  /** The public origin, e.g. https://jam.tn07.dev, for links and link previews. */
  publicUrl: string;
  edgeSecret: string | null;
  limits: ShareRateLimits | false;
  staticDir?: string;
}

/** How long the signed read URL of a shared file lives. Each audio request gets a new one. */
const AUDIO_URL_TTL_MS = 15 * 60_000;

const shareUrl = (publicUrl: string, id: string) => `${publicUrl}/s/${id}`;
const audioPath = (id: string) => `/s/${id}/audio.wav`;

const isActive = (s: ShareRecord) => s.ready && s.enabled;

/** Removes a share's file, then its record, so no record ever points at a file that is gone. */
export async function removeShare(shares: ShareStore, blobs: SampleBlobs, share: ShareRecord) {
  await blobs.remove(share.storagePath);
  await shares.delete(share.id);
}

/** Removes every share of a session, with its files: run when the session is deleted. */
export async function removeSessionShares(shares: ShareStore, blobs: SampleBlobs, uid: string, sessionId: string) {
  const list = (await shares.listByOwner(uid)).filter((s) => s.sessionId === sessionId);
  for (const share of list) await removeShare(shares, blobs, share);
  return list.length;
}

/** A file name for the download: the title in lowercase letters, digits and dashes. */
export const downloadName = (title: string) =>
  `${
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "jam"
  }.wav`;

const limiter = (limits: ShareRateLimits | false, make: (l: ShareRateLimits) => Parameters<typeof rateLimit>[0]) =>
  (limits ? rateLimit(make(limits)) : (_req, _res, next) => next()) as RequestHandler;

const tooMany = (message: string) => ({ error: "rate_limited", message });

/** The owner's shares: start one, mark its upload done, list, turn off and on, rename, delete. */
export function sharesRouter({ store, shares, blobs, log, now, publicUrl, limits }: ShareDeps) {
  const router = Router();

  const createLimit = limiter(limits, (l) => ({
    windowMs: l.createWindowMs,
    limit: l.createMax,
    keyGenerator: (req) => pageUser(req).uid,
    validate: false,
    message: tooMany("You made many links just now. Wait a few minutes, then try again."),
  }));

  const activeCount = async (uid: string) => (await shares.listByOwner(uid)).filter(isActive).length;

  /**
   * Deletes the user's shares that never got ready within pendingTtlMs (a cancel, a closed tab, a
   * failed upload), with any file. Returns how many unfinished shares are left.
   */
  const sweepPending = async (uid: string) => {
    const cutoff = now() - SHARE_LIMITS.pendingTtlMs;
    let left = 0;
    for (const share of await shares.listByOwner(uid)) {
      if (share.ready) continue;
      if (Date.parse(share.createdAt) < cutoff) await removeShare(shares, blobs, share);
      else left++;
    }
    return left;
  };
  const overLimit = (res: Response) =>
    res.status(409).json({
      error: "share_limit",
      message: `You have ${SHARE_LIMITS.activePerUser} links on. Turn one off in Sessions first.`,
    });

  /** The caller's share, or a 404 for a bad id, another user's share, or one never made. */
  const mine = async (req: Request, res: Response): Promise<ShareRecord | null> => {
    const id = String(req.params.id);
    const share = SHARE_ID.test(id) ? await shares.get(id) : null;
    if (share && share.uid === pageUser(req).uid) return share;
    res.status(404).json({ error: "not_found" });
    return null;
  };

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const list = await shares.listByOwner(pageUser(req).uid);
      const response: ShareListResponse = { shares: list.filter((s) => s.ready).map(ownerView) };
      res.json(response);
    }),
  );

  // Step 1: a share with no audio yet, and a signed URL to upload it to.
  router.post(
    "/",
    createLimit,
    asyncHandler(async (req, res) => {
      const body = parseBody(createShareRequestSchema, req, res);
      if (!body) return;
      const { uid } = pageUser(req);
      if (!(await store.getSession(uid, body.sessionId))) return res.status(404).json({ error: "not_found" });
      const version = await store.latestVersion(uid, body.sessionId);
      if (!version) {
        return res.status(409).json({ error: "no_version", message: "Play the code once before you share it." });
      }
      if (version.id !== body.versionId) {
        return res
          .status(409)
          .json({ error: "stale_version", message: "The code changed. Open Share again to share the new version." });
      }
      if ((await activeCount(uid)) >= SHARE_LIMITS.activePerUser) return overLimit(res);
      if ((await sweepPending(uid)) >= SHARE_LIMITS.pendingPerUser) {
        return res.status(409).json({
          error: "pending_limit",
          message: "You are making other links now. Finish them, or wait an hour, then try again.",
        });
      }
      const id = randomBytes(8).toString("base64url").slice(0, 10);
      const record: ShareRecord = {
        id,
        uid,
        sessionId: body.sessionId,
        versionId: version.id,
        title: body.title,
        ownerName: body.ownerName,
        asOf: version.evaluatedAt,
        bars: body.bars,
        seconds: body.seconds,
        showCode: body.showCode,
        code: body.showCode ? version.code : null,
        storagePath: sharePath(id),
        enabled: false,
        ready: false,
        peaks: null,
        createdAt: new Date(now()).toISOString(),
        plays: 0,
      };
      await shares.create(record);
      const response: CreateShareResponse = {
        id,
        uploadUrl: await blobs.uploadUrl(record.storagePath, "audio/wav", SHARE_UPLOAD_HEADERS),
        url: shareUrl(publicUrl, id),
      };
      res.status(201).json(response);
    }),
  );

  // Step 2: the audio is in the bucket. Check it, then turn the link on.
  router.post(
    "/:id/ready",
    asyncHandler(async (req, res) => {
      const share = await mine(req, res);
      const body = share && parseBody(readyShareRequestSchema, req, res);
      if (!share || !body) return;
      if (share.ready) return res.json(ownerView(share));
      const size = await blobs.size(share.storagePath);
      if (size === null) {
        return res.status(400).json({ error: "not_uploaded", message: "Upload the audio before you finish the link." });
      }
      if (size > SHARE_LIMITS.maxBytes) {
        await blobs.remove(share.storagePath);
        return res.status(413).json({ error: "too_large", message: "The audio is too large to share." });
      }
      if ((await activeCount(share.uid)) >= SHARE_LIMITS.activePerUser) return overLimit(res);
      await shares.update(share.id, { ready: true, enabled: true, peaks: body.peaks ?? null });
      log.info("share created", { uid: share.uid, id: share.id, bars: share.bars, bytes: size });
      res.json(ownerView({ ...share, ready: true, enabled: true }));
    }),
  );

  // Turn off keeps the file; the page stops at once and issued signed URLs within AUDIO_URL_TTL_MS.
  // Turn on counts toward the limit.
  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const share = await mine(req, res);
      const body = share && parseBody(updateShareRequestSchema, req, res);
      if (!share || !body) return;
      if (!share.ready) return res.status(404).json({ error: "not_found" });
      if (body.enabled && !share.enabled && (await activeCount(share.uid)) >= SHARE_LIMITS.activePerUser) {
        return overLimit(res);
      }
      await shares.update(share.id, body);
      res.json(ownerView({ ...share, ...body }));
    }),
  );

  // Delete removes the file and the record: for a cancelled recording, or a link the owner is done with.
  router.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      const share = await mine(req, res);
      if (!share) return;
      await removeShare(shares, blobs, share);
      res.status(204).end();
    }),
  );

  return router;
}

/** Reads a share for the public: null when it is missing, not ready or turned off. */
async function publicShare(shares: ShareStore, id: string): Promise<ShareRecord | null> {
  if (!SHARE_ID.test(id)) return null;
  const share = await shares.get(id);
  return share && isActive(share) ? share : null;
}

const off = (res: Response) =>
  res.status(404).set("Cache-Control", "no-store").json({ error: "off", message: "This link is turned off." });

/** Sends a redirect to a fresh signed URL of the share's audio; `?download` makes it an attachment. */
const audioRedirect = (shares: ShareStore, blobs: SampleBlobs) =>
  asyncHandler(async (req, res) => {
    const share = await publicShare(shares, String(req.params.id));
    if (!share) return res.status(404).set("Cache-Control", "no-store").type("text").send("This link is turned off.");
    const download = req.query.download !== undefined;
    const url = await blobs.readUrl(share.storagePath, {
      ttlMs: AUDIO_URL_TTL_MS,
      ...(download && { downloadName: downloadName(share.title) }),
    });
    res.set("Cache-Control", "no-store").redirect(302, url);
  });

/**
 * Anyone with the link: the share's metadata, its audio (a redirect to a fresh signed URL, so the
 * player streams it and a late Download still works) and a play counter. No sign-in.
 */
export function publicSharesRouter({ shares, blobs, limits, edgeSecret }: ShareDeps) {
  const router = Router();
  router.use(
    limiter(limits, (l) => ({
      windowMs: 60_000,
      limit: l.publicPerMinute,
      keyGenerator: (req) => clientKey(req, edgeSecret),
      validate: false,
      message: tooMany("Too many requests. Wait a minute, then try again."),
    })),
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const share = await publicShare(shares, String(req.params.id));
      if (!share) return off(res);
      const body: PublicShare = {
        id: share.id,
        title: share.title,
        ownerName: share.ownerName,
        asOf: share.asOf,
        bars: share.bars,
        seconds: share.seconds,
        code: share.showCode ? share.code : null,
        peaks: share.peaks ?? null,
        createdAt: share.createdAt,
      };
      res.set("Cache-Control", "no-store").json(body);
    }),
  );

  router.get("/:id/audio", audioRedirect(shares, blobs));

  router.post(
    "/:id/plays",
    asyncHandler(async (req, res) => {
      const share = await publicShare(shares, String(req.params.id));
      if (!share) return off(res);
      await shares.addPlay(share.id);
      res.status(204).end();
    }),
  );

  return router;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

interface PageMeta {
  title: string;
  description: string;
  url: string;
  imageUrl: string;
  audioUrl?: string;
}

/** Puts the share's title and Open Graph tags into the app's index.html, for WhatsApp and iMessage previews. */
export function sharePageHtml(indexHtml: string, meta: PageMeta): string {
  const tag = (property: string, content: string) => `<meta property="${property}" content="${escapeHtml(content)}" />`;
  const tags = [
    `<meta name="robots" content="noindex" />`,
    tag("og:site_name", "jam"),
    tag("og:type", "music.song"),
    tag("og:title", meta.title),
    tag("og:description", meta.description),
    tag("og:url", meta.url),
    tag("og:image", meta.imageUrl),
    tag("og:image:width", "1200"),
    tag("og:image:height", "630"),
    ...(meta.audioUrl ? [tag("og:audio", meta.audioUrl), tag("og:audio:type", "audio/wav")] : []),
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].join("\n    ");
  // Function replacers: a string replacement would read `$&` or `$'` in a title as a pattern.
  return indexHtml
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(meta.title)} - jam</title>`)
    .replace(
      /<meta\s+name="description"[\s\S]*?\/?>/,
      () => `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    )
    .replace("</head>", () => `    ${tags}\n  </head>`);
}

/** /s/:id (the listener page, with link preview tags) and /s/:id/audio.wav (a redirect to a fresh signed URL). */
export function sharePageRouter(deps: ShareDeps) {
  const { shares, blobs, publicUrl, staticDir, limits, edgeSecret, log } = deps;
  const router = Router();
  let index: string | null = null;
  const indexHtml = async () => {
    if (index === null && staticDir) {
      index = await readFile(path.join(staticDir, "index.html"), "utf8").catch(() => null);
    }
    return (
      index ?? `<!doctype html><html lang="en"><head><title>jam</title></head><body><div id="root"></div></body></html>`
    );
  };
  const limit = limiter(limits, (l) => ({
    windowMs: 60_000,
    limit: l.publicPerMinute,
    keyGenerator: (req) => clientKey(req, edgeSecret),
    validate: false,
  }));

  router.get("/s/:id/audio.wav", limit, audioRedirect(shares, blobs));

  router.get(
    "/s/:id",
    limit,
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const share = await publicShare(shares, id).catch((err: unknown) => {
        log.warn("share page lookup failed", { id, error: String(err) });
        return null;
      });
      const imageUrl = `${publicUrl}/og.png`;
      const meta: PageMeta = share
        ? {
            title: share.title,
            description: shareDescription(share.seconds, share.ownerName),
            url: shareUrl(publicUrl, share.id),
            imageUrl,
            audioUrl: `${publicUrl}${audioPath(share.id)}`,
          }
        : {
            title: "This link is turned off",
            description: "Make your own music in the browser with jam.",
            url: publicUrl,
            imageUrl,
          };
      res
        .status(share ? 200 : 404)
        .set("Cache-Control", "no-cache")
        .type("html")
        .send(sharePageHtml(await indexHtml(), meta));
    }),
  );

  return router;
}
