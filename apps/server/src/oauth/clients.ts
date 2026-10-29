import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { CustomOAuthError, InvalidClientMetadataError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { errorFields, type Logger } from "../logger.js";
import type { OAuthClientRecord, OAuthStore } from "../store/types.js";
import { isMetadataDocumentUrl, type DocumentFetcher } from "./metadataDocument.js";
import { redirectUriProblem } from "./redirectUris.js";
import { hashSecret } from "./secrets.js";

const AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"] as const;
const GRANT_TYPES = new Set(["authorization_code", "refresh_token"]);
const MAX_REDIRECT_URIS = 10;
const DOCUMENT_CACHE_MS = 60 * 60_000;
const DOCUMENT_FAILURE_CACHE_MS = 60_000;
/** Cached documents. The least recently used goes first when it is full. */
const DOCUMENT_CACHE_SIZE = 500;
/** Metadata documents fetched at the same time, across all URLs. */
const MAX_CONCURRENT_FETCHES = 10;

/** Client fields jam reads, from a registration request or a metadata document. */
const clientFieldsSchema = z.object({
  redirect_uris: z.array(z.string()).min(1).max(MAX_REDIRECT_URIS),
  client_name: z.string().optional(),
  client_uri: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  scope: z.string().optional(),
});
type ClientFields = z.infer<typeof clientFieldsSchema>;

const invalidRedirect = (message: string) => new CustomOAuthError("invalid_redirect_uri", message);

/** Removes control characters and caps the length, so a client name is safe to show. */
function cleanName(name: string | undefined): string | null {
  // eslint-disable-next-line no-control-regex
  const cleaned = name?.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned ? cleaned.slice(0, 80) : null;
}

/** Validates client fields against jam's policy. Throws an OAuth error the SDK turns into a 400. */
function checkFields(
  fields: ClientFields,
): Omit<OAuthClientRecord, "clientId" | "clientSecretHash" | "clientIdIssuedAt"> {
  for (const uri of fields.redirect_uris) {
    const problem = redirectUriProblem(uri);
    if (problem) throw invalidRedirect(`redirect_uri ${problem}`);
  }
  const grantTypes = fields.grant_types ?? ["authorization_code", "refresh_token"];
  if (!grantTypes.includes("authorization_code") || grantTypes.some((g) => !GRANT_TYPES.has(g))) {
    throw new InvalidClientMetadataError("grant_types must be authorization_code, optionally with refresh_token");
  }
  const responseTypes = fields.response_types ?? ["code"];
  if (responseTypes.some((r) => r !== "code")) throw new InvalidClientMetadataError("response_types must be code");
  // RFC 7591 makes client_secret_basic the default method.
  const method = fields.token_endpoint_auth_method ?? "client_secret_basic";
  if (!(AUTH_METHODS as readonly string[]).includes(method)) {
    throw new InvalidClientMetadataError(`token_endpoint_auth_method must be one of ${AUTH_METHODS.join(", ")}`);
  }
  let clientUri: string | null = null;
  if (fields.client_uri && URL.canParse(fields.client_uri) && new URL(fields.client_uri).protocol === "https:") {
    clientUri = fields.client_uri;
  }
  return {
    clientName: cleanName(fields.client_name),
    clientUri,
    redirectUris: fields.redirect_uris,
    grantTypes,
    responseTypes,
    tokenEndpointAuthMethod: method,
    scope: fields.scope ?? null,
  };
}

/** The shape the SDK handlers read. The secret is left out: `clientAuthentication` checks it against the hash. */
function toClientInformation(record: OAuthClientRecord): OAuthClientInformationFull {
  return {
    client_id: record.clientId,
    client_id_issued_at: record.clientIdIssuedAt,
    redirect_uris: record.redirectUris,
    grant_types: record.grantTypes,
    response_types: record.responseTypes,
    token_endpoint_auth_method: record.tokenEndpointAuthMethod,
    ...(record.clientName ? { client_name: record.clientName } : {}),
    ...(record.clientUri ? { client_uri: record.clientUri } : {}),
    ...(record.scope ? { scope: record.scope } : {}),
  };
}

/** The name the consent page and the side panel show. Falls back to the redirect host. */
export function displayName(record: OAuthClientRecord): string {
  if (record.clientName) return record.clientName;
  const first = record.redirectUris[0];
  return first ? new URL(first).host : "An app";
}

/**
 * OAuth clients for the SDK handlers. A client is either registered here
 * (RFC 7591, stored in Firestore) or identified by the https URL of its
 * metadata document (fetched and cached in memory).
 */
export class JamClientsStore implements OAuthRegisteredClientsStore {
  /** In insertion order, oldest use first: a hit moves the entry to the end. */
  private readonly documents = new Map<string, { record: OAuthClientRecord | null; until: number }>();
  /** One fetch per URL at a time; concurrent lookups share it. */
  private readonly inFlight = new Map<string, Promise<OAuthClientRecord | null>>();

  constructor(
    private readonly store: OAuthStore,
    private readonly fetchDocument: DocumentFetcher,
    private readonly log: Logger,
    private readonly now: () => number,
  ) {}

  async getRecord(clientId: string): Promise<OAuthClientRecord | null> {
    if (isMetadataDocumentUrl(clientId)) return this.fromDocument(clientId);
    if (clientId.length === 0 || clientId.length > 100) return null;
    return this.store.getOAuthClient(clientId);
  }

  async getClient(clientId: string) {
    const record = await this.getRecord(clientId);
    return record ? toClientInformation(record) : undefined;
  }

  async registerClient(client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">) {
    const fields = clientFieldsSchema.safeParse(client);
    if (!fields.success) throw new InvalidClientMetadataError("redirect_uris must list 1 to 10 URIs");
    const checked = checkFields(fields.data);
    const full = client as Partial<OAuthClientInformationFull>;
    const clientId = full.client_id ?? randomUUID();
    const issuedAt = full.client_id_issued_at ?? Math.floor(this.now() / 1000);
    const isPublic = checked.tokenEndpointAuthMethod === "none";
    const record: OAuthClientRecord = {
      ...checked,
      clientId,
      clientSecretHash: !isPublic && client.client_secret ? hashSecret(client.client_secret) : null,
      clientIdIssuedAt: issuedAt,
    };
    await this.store.saveOAuthClient(record);
    this.log.info("oauth client registered", { clientId, name: record.clientName, public: isPublic });
    // The response is the only time the plaintext secret leaves the server.
    return {
      ...toClientInformation(record),
      ...(isPublic ? {} : { client_secret: client.client_secret, client_secret_expires_at: 0 }),
    };
  }

  private async fromDocument(url: string): Promise<OAuthClientRecord | null> {
    const cached = this.documents.get(url);
    if (cached && cached.until > this.now()) {
      this.documents.delete(url);
      this.documents.set(url, cached);
      return cached.record;
    }
    const pending = this.inFlight.get(url);
    if (pending) return pending;
    if (this.inFlight.size >= MAX_CONCURRENT_FETCHES) {
      // Not cached: the URL may be fine, the server is only busy.
      this.log.warn("client metadata document fetch refused: too many in flight", { url });
      return null;
    }
    const fetching = this.loadDocument(url).finally(() => this.inFlight.delete(url));
    this.inFlight.set(url, fetching);
    return fetching;
  }

  private async loadDocument(url: string): Promise<OAuthClientRecord | null> {
    let record: OAuthClientRecord | null = null;
    try {
      const doc = await this.fetchDocument(url);
      const fields = clientFieldsSchema.extend({ client_id: z.literal(url) }).parse(doc);
      const checked = checkFields(fields);
      // A metadata document cannot carry a shared secret, so only public clients qualify.
      if (fields.token_endpoint_auth_method !== undefined && fields.token_endpoint_auth_method !== "none") {
        throw new Error("token_endpoint_auth_method must be none");
      }
      record = {
        ...checked,
        tokenEndpointAuthMethod: "none",
        clientId: url,
        clientSecretHash: null,
        clientIdIssuedAt: Math.floor(this.now() / 1000),
      };
    } catch (err) {
      this.log.warn("client metadata document rejected", { url, ...errorFields(err), stack: undefined });
    }
    const ttl = record ? DOCUMENT_CACHE_MS : DOCUMENT_FAILURE_CACHE_MS;
    this.documents.delete(url);
    this.documents.set(url, { record, until: this.now() + ttl });
    for (const oldest of this.documents.keys()) {
      if (this.documents.size <= DOCUMENT_CACHE_SIZE) break;
      this.documents.delete(oldest);
    }
    return record;
  }
}
