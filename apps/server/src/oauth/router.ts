import { authorizationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/authorize.js";
import { metadataHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/metadata.js";
import { clientRegistrationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/register.js";
import { revocationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/revoke.js";
import { tokenHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/token.js";
import type { OAuthMetadata, OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { TooManyRequestsError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { ipKeyGenerator, rateLimit as expressRateLimit, type Options as RateLimitOptions } from "express-rate-limit";
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { clientAuthentication } from "./clientAuthentication.js";
import type { JamClientsStore } from "./clients.js";
import type { JamOAuthProvider } from "./provider.js";
import type { OAuthSettings } from "./settings.js";

const AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"];

export function authorizationServerMetadata(settings: OAuthSettings): OAuthMetadata {
  const at = (p: string) => `${settings.issuer}${p}`;
  return {
    issuer: settings.issuer,
    authorization_endpoint: at("/authorize"),
    token_endpoint: at("/token"),
    registration_endpoint: at("/register"),
    revocation_endpoint: at("/revoke"),
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: AUTH_METHODS,
    revocation_endpoint_auth_methods_supported: AUTH_METHODS,
    scopes_supported: [settings.scope],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: "https://github.com/tejasnafde/jam#connect-claudeai-or-chatgpt",
  };
}

export function protectedResourceMetadata(settings: OAuthSettings): OAuthProtectedResourceMetadata {
  return {
    resource: settings.resource,
    authorization_servers: [settings.issuer],
    scopes_supported: [settings.scope],
    bearer_methods_supported: ["header"],
    resource_name: "jam",
    resource_documentation: "https://github.com/tejasnafde/jam",
  };
}

/**
 * The client address for rate limits. Behind the Cloudflare Worker, every
 * request reaches Cloud Run from a Cloudflare address, so the Worker's
 * CF-Connecting-IP is the real client. But anyone can reach the *.run.app URL
 * directly and send any CF-Connecting-IP, so it counts only when the request
 * also carries the Worker's secret in X-Jam-Edge. Otherwise the key is the
 * socket address, never req.ip: with `trust proxy` on, req.ip is the leftmost
 * X-Forwarded-For, which the caller chooses.
 */
export function clientKey(req: Request, edgeSecret: string | null): string {
  const cf = req.headers["cf-connecting-ip"];
  if (edgeSecret && typeof cf === "string" && cf && edgeHeaderMatches(req.headers["x-jam-edge"], edgeSecret)) {
    return ipKeyGenerator(cf);
  }
  return ipKeyGenerator(req.socket.remoteAddress ?? "unknown");
}

/** Constant-time check of X-Jam-Edge. Hashing first makes the lengths equal. */
function edgeHeaderMatches(header: string | string[] | undefined, secret: string): boolean {
  if (typeof header !== "string") return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header), digest(secret));
}

/** Escapes text for an HTML page. */
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Redirect hosts that may receive an /authorize error redirect. For any other
 * client, jam shows an error page instead: open registration would otherwise
 * make jam.tn07.dev a redirector to any host that someone registers.
 */
const ERROR_REDIRECT_HOSTS = new Set(["claude.ai", "claude.com", "chatgpt.com"]);

/**
 * Wraps res.redirect for the SDK /authorize handler. An error redirect to an
 * unknown host becomes a 400 page. Redirects inside jam (to the consent page)
 * and error redirects to known connectors pass unchanged.
 */
function guardErrorRedirects(_req: Request, res: Response, next: NextFunction) {
  const original = res.redirect.bind(res) as (...args: unknown[]) => void;
  const redirect = (status: number, url: string) => original(status, url);
  const guarded = (status: number | string, url?: string | number) => {
    if (typeof status !== "number" || typeof url !== "string") return original(status, url);
    const target = URL.canParse(url) ? new URL(url) : null;
    const error = target?.searchParams.get("error");
    if (!target || !error || ERROR_REDIRECT_HOSTS.has(target.hostname)) return redirect(status, url);
    const description = target.searchParams.get("error_description") ?? "";
    res
      .status(400)
      .set({ "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'" })
      .type("html")
      .send(
        `<!doctype html><meta charset="utf-8"><title>jam: request refused</title>` +
          `<h1>jam cannot continue</h1><p>The app that sent you here made an invalid request ` +
          `(${escapeHtml(error)}).</p><p>${escapeHtml(description.slice(0, 300))}</p>` +
          `<p>You can close this page.</p>`,
      );
  };
  res.redirect = guarded as Response["redirect"];
  next();
}

interface OAuthRouterDeps {
  provider: JamOAuthProvider;
  clients: JamClientsStore;
  settings: OAuthSettings;
  staticDir?: string;
}

/** The authorization server endpoints, the metadata, and the consent page route. Mount at the app root. */
export function oauthRouter({ provider, clients, settings, staticDir }: OAuthRouterDeps) {
  const router = Router();
  const limits = settings.rateLimits;
  const rateLimit = (max: number): Partial<RateLimitOptions> | false =>
    limits && {
      windowMs: limits.windowMs,
      max,
      keyGenerator: (req) => clientKey(req, settings.edgeSecret),
      validate: { trustProxy: false, xForwardedForHeader: false },
    };
  /**
   * A limiter jam mounts itself. /token and /revoke need one in front of
   * clientAuthentication, which can fetch a client metadata document, so the
   * SDK's own limiter (behind it) comes too late.
   */
  const limiter = (options: Partial<RateLimitOptions> | false, message: string): RequestHandler[] =>
    options
      ? [
          expressRateLimit({
            standardHeaders: true,
            legacyHeaders: false,
            // CORS preflights do not count. The SDK handler behind answers them.
            skip: (req) => req.method === "OPTIONS",
            handler: (_req, res, _next, opts) => {
              res
                .status(opts.statusCode)
                .set("Access-Control-Allow-Origin", "*")
                .json(new TooManyRequestsError(message).toResponseObject());
            },
            ...options,
          }),
        ]
      : [];

  // The consent page: /authorize?request=<id>, where provider.authorize sends
  // the browser. The SDK handler owns /authorize?client_id=... .
  router.get("/authorize", (req, res, next) => {
    if (typeof req.query.request !== "string" || req.query.client_id !== undefined) return next();
    res.set({
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
    });
    if (!staticDir || !existsSync(path.join(staticDir, "index.html"))) {
      res.status(404).type("text").send("The consent page is not built.");
      return;
    }
    // `root` keeps send's dotfile check to "index.html", not to every directory above it.
    res.sendFile("index.html", { root: staticDir });
  });

  router.use(
    "/authorize",
    guardErrorRedirects,
    authorizationHandler({ provider, rateLimit: limits && rateLimit(limits.authorize) }),
  );
  router.use(
    "/token",
    ...limiter(limits && rateLimit(limits.token), "You have exceeded the rate limit for token requests"),
    clientAuthentication(clients),
    tokenHandler({ provider, rateLimit: false }),
  );
  router.use(
    "/revoke",
    ...limiter(limits && rateLimit(limits.revoke), "You have exceeded the rate limit for token revocation requests"),
    clientAuthentication(clients),
    revocationHandler({ provider, rateLimit: false }),
  );
  router.use(
    "/register",
    // A global cap on top of the per-client one: many addresses together still
    // cannot write an unbounded number of client documents.
    ...limiter(
      limits && {
        windowMs: 60 * 60_000,
        max: limits.registerPerHour,
        keyGenerator: () => "all",
        validate: { trustProxy: false, xForwardedForHeader: false },
      },
      "Too many client registrations, try again later",
    ),
    clientRegistrationHandler({
      clientsStore: clients,
      // 0: a registered secret never expires (RFC 7591), so a connector does not break after 30 days.
      clientSecretExpirySeconds: 0,
      rateLimit: limits && rateLimit(limits.register),
    }),
  );

  // RFC 9728 at the root and at the path of the resource (/mcp), and RFC 8414.
  const resourceMetadata = metadataHandler(protectedResourceMetadata(settings));
  router.use("/.well-known/oauth-protected-resource/mcp", resourceMetadata);
  router.use("/.well-known/oauth-protected-resource", resourceMetadata);
  router.use("/.well-known/oauth-authorization-server", metadataHandler(authorizationServerMetadata(settings)));

  return router;
}
