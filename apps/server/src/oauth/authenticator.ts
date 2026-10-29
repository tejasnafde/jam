import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { McpAuthenticator } from "../auth/mcpAuth.js";
import type { JamOAuthProvider } from "./provider.js";
import { ACCESS_PREFIX } from "./secrets.js";
import { isOurResource, type OAuthSettings } from "./settings.js";

/** Accepts an OAuth access token issued for this MCP server with the jam scope. */
export function oauthAuthenticator(provider: JamOAuthProvider, settings: OAuthSettings): McpAuthenticator {
  return async (bearer) => {
    if (!bearer.startsWith(ACCESS_PREFIX)) return null;
    let info;
    try {
      info = await provider.verifyAccessToken(bearer);
    } catch (err) {
      if (err instanceof InvalidTokenError) return null;
      throw err;
    }
    if (!info.resource || !isOurResource(settings, info.resource)) return null;
    if (!info.scopes.includes(settings.scope)) return null;
    const uid = info.extra?.uid;
    if (typeof uid !== "string") return null;
    return { uid, via: "oauth", clientId: info.clientId };
  };
}
