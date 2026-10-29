import { authorizationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/authorize.js";
import { metadataHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/metadata.js";
import { clientRegistrationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/register.js";
import { revocationHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/revoke.js";
import { tokenHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/token.js";
import type { OAuthMetadata, OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { ipKeyGenerator, type Options as RateLimitOptions } from "express-rate-limit";
import { Router, type Request } from "express";
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
 * request reaches Cloud Run from a Cloudflare address and the leftmost
 * X-Forwarded-For is whatever the client sent, so CF-Connecting-IP is the
 * only trustworthy source. A direct *.run.app request falls back to req.ip.
 */
function clientKey(req: Request): string {
  const cf = req.headers["cf-connecting-ip"];
  return ipKeyGenerator((typeof cf === "string" && cf) || req.ip || "unknown");
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
      keyGenerator: clientKey,
      validate: { trustProxy: false, xForwardedForHeader: false },
    };

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

  router.use("/authorize", authorizationHandler({ provider, rateLimit: limits && rateLimit(limits.authorize) }));
  router.use(
    "/token",
    clientAuthentication(clients),
    tokenHandler({ provider, rateLimit: limits && rateLimit(limits.token) }),
  );
  router.use(
    "/revoke",
    clientAuthentication(clients),
    revocationHandler({ provider, rateLimit: limits && rateLimit(limits.revoke) }),
  );
  router.use(
    "/register",
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
