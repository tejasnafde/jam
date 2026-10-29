import { OAUTH_SCOPE } from "@jam/shared";

/** Per-IP rate limits for the public OAuth endpoints: requests per window. */
export interface OAuthRateLimits {
  windowMs: number;
  register: number;
  authorize: number;
  token: number;
  revoke: number;
}

export interface OAuthSettings {
  /** The public origin, e.g. https://jam.tn07.dev. It is the issuer, and the MCP resource is `<origin>/mcp`. */
  publicUrl: string;
  issuer: string;
  resource: string;
  resourceMetadataUrl: string;
  scope: string;
  requestTtlMs: number;
  codeTtlMs: number;
  accessTtlMs: number;
  refreshTtlMs: number;
  rateLimits: OAuthRateLimits | false;
  /** The clock, injectable for tests. Milliseconds since the epoch. */
  now: () => number;
}

export type OAuthOptions = Partial<Omit<OAuthSettings, "issuer" | "resource" | "resourceMetadataUrl" | "scope">>;

export const DEFAULT_PUBLIC_URL = "https://jam.tn07.dev";

export function oauthSettings(options: OAuthOptions = {}): OAuthSettings {
  const publicUrl = (options.publicUrl ?? DEFAULT_PUBLIC_URL).replace(/\/+$/, "");
  return {
    publicUrl,
    issuer: publicUrl,
    resource: `${publicUrl}/mcp`,
    resourceMetadataUrl: `${publicUrl}/.well-known/oauth-protected-resource`,
    scope: OAUTH_SCOPE,
    requestTtlMs: options.requestTtlMs ?? 10 * 60_000,
    codeTtlMs: options.codeTtlMs ?? 90_000,
    accessTtlMs: options.accessTtlMs ?? 60 * 60_000,
    refreshTtlMs: options.refreshTtlMs ?? 30 * 24 * 60 * 60_000,
    rateLimits: options.rateLimits ?? {
      windowMs: 15 * 60_000,
      register: 20,
      authorize: 100,
      token: 200,
      revoke: 50,
    },
    now: options.now ?? Date.now,
  };
}

/** True when a `resource` value names this MCP server (RFC 8707). A trailing slash is ignored. */
export function isOurResource(settings: OAuthSettings, resource: string | URL): boolean {
  let url: URL;
  try {
    url = new URL(String(resource));
  } catch {
    return false;
  }
  if (url.hash || url.search) return false;
  return url.href.replace(/\/$/, "") === settings.resource;
}
