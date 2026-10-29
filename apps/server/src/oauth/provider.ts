import {
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { LIMITS } from "@jam/shared";
import type { Response } from "express";
import type { Logger } from "../logger.js";
import type { AuthCodeRecord, GrantRecord, OAuthStore, OAuthTokenRecord } from "../store/types.js";
import { browserBinding } from "./browserBinding.js";
import { displayName, type JamClientsStore } from "./clients.js";
import { ACCESS_PREFIX, CODE_PREFIX, hashSecret, mintId, mintSecret, REFRESH_PREFIX } from "./secrets.js";
import { isOurResource, type OAuthSettings } from "./settings.js";

const invalidCode = () => new InvalidGrantError("The authorization code is invalid, expired or already used");
const invalidRefresh = () => new InvalidGrantError("The refresh token is invalid, expired or already used");

/** The grant made from a code. Derived from the code hash, so a replayed code finds the grant to revoke. */
const grantIdFor = (codeHash: string) => hashSecret(`grant:${codeHash}`).slice(0, 32);

/**
 * jam's OAuth 2.1 authorization server, behind the MCP SDK's handlers. The SDK
 * validates request shapes, PKCE and redirect URIs; this class owns state:
 * pending consent requests, single-use codes, grants and hashed tokens.
 */
export class JamOAuthProvider implements OAuthServerProvider {
  constructor(
    private readonly store: OAuthStore,
    private readonly clients: JamClientsStore,
    private readonly settings: OAuthSettings,
    private readonly log: Logger,
  ) {}

  get clientsStore() {
    return this.clients;
  }

  /** Grants only the jam scope. Other requested scopes are dropped, not refused, so a generic client still connects. */
  private grantedScopes(_requested: string[] | undefined) {
    return [this.settings.scope];
  }

  private checkResource(resource: URL | undefined) {
    if (resource && !isOurResource(this.settings, resource)) {
      throw new InvalidTargetError(`resource must be ${this.settings.resource}`);
    }
  }

  /**
   * Stores the request server-side and sends the browser to the consent page.
   * Only an opaque request id goes in the URL. The request is bound to this
   * browser by a cookie, and to the signed-in user when they decide.
   */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    this.checkResource(params.resource);
    const binding = browserBinding(res.req, res, this.settings);
    const id = mintId();
    await this.store.saveAuthRequest({
      id,
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state ?? null,
      scopes: this.grantedScopes(params.scopes),
      resource: this.settings.resource,
      browserHash: binding,
      expiresAt: this.settings.now() + this.settings.requestTtlMs,
    });
    res.redirect(302, `/authorize?request=${encodeURIComponent(id)}`);
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string) {
    const code = await this.store.getAuthCode(hashSecret(authorizationCode));
    if (!code || code.clientId !== client.client_id) throw invalidCode();
    if (code.usedAt !== null) {
      await this.replayed("code", code);
      throw invalidCode();
    }
    if (code.expiresAt <= this.settings.now()) throw invalidCode();
    return code.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const hash = hashSecret(authorizationCode);
    // Marking the code used comes first, so two racing exchanges cannot both win.
    const code = await this.store.useAuthCode(hash, this.settings.now());
    if (!code || code.clientId !== client.client_id) throw invalidCode();
    if (code.usedAt !== null) {
      await this.replayed("code", code);
      throw invalidCode();
    }
    if (code.expiresAt <= this.settings.now()) throw invalidCode();
    if (redirectUri !== undefined && redirectUri !== code.redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match the authorization request");
    }
    this.checkResource(resource);

    const record = await this.clients.getRecord(client.client_id);
    const nowIso = new Date(this.settings.now()).toISOString();
    const grant: GrantRecord = {
      id: grantIdFor(hash),
      uid: code.uid,
      clientId: code.clientId,
      clientName: record ? displayName(record) : client.client_id,
      scopes: code.scopes,
      resource: code.resource,
      createdAt: nowIso,
      lastUsedAt: nowIso,
    };
    await this.enforceGrantLimit(code.uid);
    await this.store.saveGrant(grant);
    this.log.info("oauth grant created", { uid: grant.uid, clientId: grant.clientId, grantId: grant.id });
    return this.issueTokens(grant);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const hash = hashSecret(refreshToken);
    const found = await this.store.getOAuthToken(hash);
    if (!found || found.kind !== "refresh" || found.clientId !== client.client_id) throw invalidRefresh();
    const token = await this.store.rotateRefreshToken(hash, this.settings.now());
    if (!token) throw invalidRefresh();
    if (token.rotatedAt !== null) {
      await this.replayed("refresh token", token);
      throw invalidRefresh();
    }
    if (token.expiresAt <= this.settings.now()) throw invalidRefresh();
    this.checkResource(resource);
    if (scopes?.some((s) => !token.scopes.includes(s))) {
      throw new InvalidScopeError("A refresh cannot add scopes");
    }
    const grant = await this.store.getGrant(token.grantId);
    if (!grant) throw invalidRefresh();
    await this.store.touchGrant(grant.id);
    return this.issueTokens(grant);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = token.startsWith(ACCESS_PREFIX) ? await this.store.getOAuthToken(hashSecret(token)) : null;
    if (!record || record.kind !== "access") throw new InvalidTokenError("Unknown access token");
    if (record.expiresAt <= this.settings.now()) throw new InvalidTokenError("The access token has expired");
    return {
      token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: Math.floor(record.expiresAt / 1000),
      resource: new URL(record.resource),
      extra: { uid: record.uid, grantId: record.grantId },
    };
  }

  /** RFC 7009: an unknown token, or one that belongs to another client, is a silent no-op. */
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
    const hash = hashSecret(request.token);
    const record = await this.store.getOAuthToken(hash);
    if (!record || record.clientId !== client.client_id) return;
    if (record.kind === "refresh") {
      // Revoking a refresh token ends the whole grant, with its access tokens.
      await this.store.deleteGrant(record.grantId);
      this.log.info("oauth grant revoked by client", { uid: record.uid, clientId: record.clientId });
    } else {
      await this.store.deleteOAuthToken(hash);
    }
  }

  /** Called by the consent page after the user allows. Returns the plaintext code for the redirect. */
  async issueCode(fields: Omit<AuthCodeRecord, "hash" | "expiresAt" | "usedAt">): Promise<string> {
    const code = mintSecret(CODE_PREFIX);
    await this.store.saveAuthCode({
      ...fields,
      hash: hashSecret(code),
      expiresAt: this.settings.now() + this.settings.codeTtlMs,
      usedAt: null,
    });
    return code;
  }

  private async issueTokens(grant: GrantRecord): Promise<OAuthTokens> {
    const now = this.settings.now();
    const access = mintSecret(ACCESS_PREFIX);
    const refresh = mintSecret(REFRESH_PREFIX);
    const base = {
      grantId: grant.id,
      uid: grant.uid,
      clientId: grant.clientId,
      scopes: grant.scopes,
      resource: grant.resource,
      rotatedAt: null,
    };
    await Promise.all([
      this.store.saveOAuthToken({
        ...base,
        hash: hashSecret(access),
        kind: "access",
        expiresAt: now + this.settings.accessTtlMs,
      }),
      this.store.saveOAuthToken({
        ...base,
        hash: hashSecret(refresh),
        kind: "refresh",
        expiresAt: now + this.settings.refreshTtlMs,
      }),
    ]);
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: Math.floor(this.settings.accessTtlMs / 1000),
      refresh_token: refresh,
      scope: grant.scopes.join(" "),
    };
  }

  /** A used code or a rotated refresh token came back: someone may have stolen it. End the grant. */
  private async replayed(what: string, record: AuthCodeRecord | OAuthTokenRecord) {
    const grantId = "grantId" in record ? record.grantId : grantIdFor(record.hash);
    await this.store.deleteGrant(grantId);
    this.log.warn(`oauth ${what} replayed, grant revoked`, { uid: record.uid, clientId: record.clientId });
  }

  /** Keeps a user's connected apps under the cap by dropping the oldest. */
  private async enforceGrantLimit(uid: string) {
    const grants = await this.store.listGrants(uid);
    for (const old of grants.slice(LIMITS.oauthGrantsPerUser - 1)) await this.store.deleteGrant(old.id);
  }
}
