import type { IdTokenVerifier } from "../auth/userAuth.js";
import type { Logger } from "../logger.js";
import type { OAuthStore } from "../store/types.js";
import { oauthAuthenticator } from "./authenticator.js";
import { JamClientsStore } from "./clients.js";
import { consentRouter } from "./consent.js";
import { fetchMetadataDocument, type DocumentFetcher } from "./metadataDocument.js";
import { JamOAuthProvider } from "./provider.js";
import { oauthRouter } from "./router.js";
import { oauthSettings, type OAuthOptions } from "./settings.js";

export type { OAuthOptions } from "./settings.js";

interface OAuthDeps {
  store: OAuthStore;
  verifyIdToken: IdTokenVerifier;
  log: Logger;
  staticDir?: string;
  options?: OAuthOptions;
  fetchDocument?: DocumentFetcher;
}

/** Builds jam's OAuth authorization server: its routes, the consent API, and the /mcp authenticator. */
export function createOAuth({ store, verifyIdToken, log, staticDir, options, fetchDocument }: OAuthDeps) {
  const settings = oauthSettings(options);
  const clients = new JamClientsStore(store, fetchDocument ?? fetchMetadataDocument, log, settings.now);
  const provider = new JamOAuthProvider(store, clients, settings, log);
  return {
    settings,
    provider,
    routes: oauthRouter({ provider, clients, settings, staticDir }),
    consent: consentRouter({ store, clients, provider, settings, verifyIdToken, log }),
    authenticator: oauthAuthenticator(provider, settings),
  };
}
