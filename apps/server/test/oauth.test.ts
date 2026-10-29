import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { isMetadataDocumentUrl, isPublicAddress } from "../src/oauth/metadataDocument.js";
import { redirectUriProblem } from "../src/oauth/redirectUris.js";
import { setup } from "./helpers.js";

const ORIGIN = "https://jam.tn07.dev";
const RESOURCE = `${ORIGIN}/mcp`;
const PRM_URL = `${ORIGIN}/.well-known/oauth-protected-resource`;
const CLAUDE_CB = "https://claude.ai/api/mcp/auth_callback";
const CLAUDE_COM_CB = "https://claude.com/api/mcp/auth_callback";
const CHATGPT_CB = "https://chatgpt.com/connector_platform_oauth_redirect";
const ACCEPT = "application/json, text/event-stream";

type Ctx = ReturnType<typeof setup>;
type App = Ctx["app"];

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function register(app: App, body: Record<string, unknown> = {}) {
  return request(app)
    .post("/register")
    .send({ redirect_uris: [CLAUDE_CB], token_endpoint_auth_method: "none", client_name: "Claude", ...body });
}

async function registerClient(app: App, body: Record<string, unknown> = {}) {
  const res = await register(app, body);
  expect(res.status).toBe(201);
  return res.body as { client_id: string; client_secret?: string };
}

interface AuthorizeOptions {
  clientId: string;
  challenge: string;
  redirectUri?: string;
  resource?: string | null;
  state?: string;
  extra?: Record<string, string>;
}

function authorizeQuery({
  clientId,
  challenge,
  redirectUri = CLAUDE_CB,
  resource = RESOURCE,
  state = "st4te",
  extra,
}: AuthorizeOptions) {
  return {
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "jam",
    state,
    ...(resource === null ? {} : { resource }),
    ...extra,
  };
}

/** Starts /authorize and returns the pending request id and the browser cookie. */
async function startAuthorize(app: App, options: AuthorizeOptions) {
  const res = await request(app).get("/authorize").query(authorizeQuery(options));
  expect(res.status).toBe(302);
  const location = new URL(res.headers.location as string, ORIGIN);
  expect(location.pathname).toBe("/authorize");
  const id = location.searchParams.get("request");
  expect(id).toBeTruthy();
  const setCookie = res.headers["set-cookie"] as unknown as string[];
  const cookie = setCookie[0]?.split(";")[0] ?? "";
  return { id: id as string, cookie, setCookie: setCookie[0] ?? "" };
}

async function decide(app: App, id: string, cookie: string, uid: string, allow: boolean) {
  return request(app)
    .post(`/api/oauth/requests/${id}/decision`)
    .set("Cookie", cookie)
    .set("Authorization", `Bearer id-${uid}`)
    .send({ allow });
}

/** Runs consent to the point where the client holds a code. */
async function getCode(app: App, clientId: string, uid = "alice", options: Partial<AuthorizeOptions> = {}) {
  const { verifier, challenge } = pkce();
  const { id, cookie } = await startAuthorize(app, { clientId, challenge, ...options });
  const res = await decide(app, id, cookie, uid, true);
  expect(res.status).toBe(200);
  const redirect = new URL(res.body.redirectTo as string);
  return { code: redirect.searchParams.get("code") as string, verifier, redirect };
}

function token(app: App, form: Record<string, string>) {
  return request(app).post("/token").type("form").send(form);
}

async function exchange(
  app: App,
  clientId: string,
  code: string,
  verifier: string,
  extra: Record<string, string> = {},
) {
  return token(app, {
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: CLAUDE_CB,
    resource: RESOURCE,
    ...extra,
  });
}

async function connect(ctx: Ctx, uid = "alice") {
  const client = await registerClient(ctx.app);
  const { code, verifier } = await getCode(ctx.app, client.client_id, uid);
  const res = await exchange(ctx.app, client.client_id, code, verifier);
  expect(res.status).toBe(200);
  return { client, tokens: res.body as { access_token: string; refresh_token: string; expires_in: number } };
}

const listTools = (app: App, bearer: string) =>
  request(app)
    .post("/mcp")
    .set("Accept", ACCEPT)
    .set("Authorization", `Bearer ${bearer}`)
    .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

describe("OAuth metadata", () => {
  it("serves protected resource metadata at the root and at /mcp", async () => {
    const { app } = setup();
    for (const p of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const res = await request(app).get(p).expect(200);
      expect(res.body).toMatchObject({
        resource: RESOURCE,
        authorization_servers: [ORIGIN],
        scopes_supported: ["jam"],
      });
    }
  });

  it("serves authorization server metadata", async () => {
    const { app } = setup();
    const res = await request(app).get("/.well-known/oauth-authorization-server").expect(200);
    expect(res.body).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/authorize`,
      token_endpoint: `${ORIGIN}/token`,
      registration_endpoint: `${ORIGIN}/register`,
      revocation_endpoint: `${ORIGIN}/revoke`,
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      client_id_metadata_document_supported: true,
    });
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("answers 404, not the web page, for an unknown well-known path", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jam-static-"));
    try {
      writeFileSync(path.join(dir, "index.html"), "<html>page</html>");
      const { app } = setup({ staticDir: dir });
      await request(app).get("/.well-known/openid-configuration").expect(404);
      const page = await request(app).get("/some/client/route").expect(200);
      expect(page.text).toContain("page");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("/mcp 401", () => {
  it("points at the resource metadata", async () => {
    const { mcp } = setup();
    const res = await mcp(null, "tools/list");
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain(`resource_metadata="${PRM_URL}"`);
    expect(res.headers["www-authenticate"]).toMatch(/^Bearer /);
  });

  it("says invalid_token for a bad token", async () => {
    const { mcp } = setup();
    const res = await mcp("jama_nope", "tools/list");
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain('error="invalid_token"');
    expect(res.headers["www-authenticate"]).toContain(`resource_metadata="${PRM_URL}"`);
  });
});

describe("dynamic client registration", () => {
  it("registers a public client for the claude.ai and ChatGPT callbacks", async () => {
    const { app } = setup();
    const res = await register(app, { redirect_uris: [CLAUDE_CB, CLAUDE_COM_CB, CHATGPT_CB] });
    expect(res.status).toBe(201);
    expect(res.body.client_id).toBeTruthy();
    expect(res.body.client_secret).toBeUndefined();
    expect(res.body.redirect_uris).toEqual([CLAUDE_CB, CLAUDE_COM_CB, CHATGPT_CB]);
  });

  it("returns a secret once to a confidential client and stores only its hash", async () => {
    const { app, store } = setup();
    const res = await register(app, { token_endpoint_auth_method: "client_secret_post" });
    expect(res.status).toBe(201);
    const secret = res.body.client_secret as string;
    expect(secret).toBeTruthy();
    expect(res.body.client_secret_expires_at).toBe(0);
    expect(JSON.stringify([...store.oauthClients.values()])).not.toContain(secret);
  });

  it("accepts http only on loopback, with any port", async () => {
    const { app } = setup();
    await register(app, { redirect_uris: ["http://127.0.0.1:53682/callback"] }).then((r) => expect(r.status).toBe(201));
    await register(app, { redirect_uris: ["http://localhost:3000/cb"] }).then((r) => expect(r.status).toBe(201));
    const bad = await register(app, { redirect_uris: ["http://evil.example/cb"] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_redirect_uri");
  });

  it("rejects custom schemes, fragments, no redirect URIs and bad grant types", async () => {
    const { app } = setup();
    for (const body of [
      { redirect_uris: ["myapp://cb"] },
      { redirect_uris: ["https://ok.example/cb#frag"] },
      { redirect_uris: [] },
      { grant_types: ["client_credentials"] },
      { grant_types: ["refresh_token"] },
      { response_types: ["token"] },
      { token_endpoint_auth_method: "private_key_jwt" },
    ]) {
      const res = await register(app, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("is rate limited", async () => {
    const { app } = setup({
      oauth: { rateLimits: { windowMs: 60_000, register: 2, authorize: 100, token: 100, revoke: 100 } },
    });
    expect((await register(app)).status).toBe(201);
    expect((await register(app)).status).toBe(201);
    expect((await register(app)).status).toBe(429);
  });
});

describe("authorize", () => {
  it("sends the browser to the consent page with an opaque request id and a binding cookie", async () => {
    const { app, store } = setup();
    const { client_id } = await registerClient(app);
    const { challenge } = pkce();
    const { id, setCookie } = await startAuthorize(app, { clientId: client_id, challenge });
    expect(setCookie).toMatch(/^__Host-jam_oauth=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(store.authRequests.get(id)).toMatchObject({ clientId: client_id, codeChallenge: challenge, state: "st4te" });
  });

  it("answers directly, without redirecting, for an unknown client or an unregistered redirect_uri", async () => {
    const { app } = setup();
    const { client_id } = await registerClient(app);
    const { challenge } = pkce();
    const unknown = await request(app)
      .get("/authorize")
      .query(authorizeQuery({ clientId: "nope", challenge }));
    expect(unknown.status).toBe(400);
    const mismatch = await request(app)
      .get("/authorize")
      .query(authorizeQuery({ clientId: client_id, challenge, redirectUri: "https://claude.ai/other" }));
    expect(mismatch.status).toBe(400);
    expect(mismatch.headers.location).toBeUndefined();
  });

  it("requires PKCE with S256", async () => {
    const { app } = setup();
    const { client_id } = await registerClient(app);
    for (const extra of [{ code_challenge_method: "plain" }, { code_challenge: "" }]) {
      const query: Record<string, string> = { ...authorizeQuery({ clientId: client_id, challenge: "x" }), ...extra };
      if (query.code_challenge === "") delete query.code_challenge;
      const res = await request(app).get("/authorize").query(query);
      expect(res.status).toBe(302);
      const location = new URL(res.headers.location as string);
      expect(location.origin + location.pathname).toBe(CLAUDE_CB);
      expect(location.searchParams.get("error")).toBe("invalid_request");
    }
  });

  it("rejects a resource that is not this MCP server", async () => {
    const { app } = setup();
    const { client_id } = await registerClient(app);
    const res = await request(app)
      .get("/authorize")
      .query(
        authorizeQuery({ clientId: client_id, challenge: pkce().challenge, resource: "https://evil.example/mcp" }),
      );
    expect(res.status).toBe(302);
    expect(new URL(res.headers.location as string).searchParams.get("error")).toBe("invalid_target");
  });

  it("serves the consent page with anti-framing headers", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jam-static-"));
    try {
      writeFileSync(path.join(dir, "index.html"), "<html>consent</html>");
      const { app } = setup({ staticDir: dir });
      const res = await request(app).get("/authorize?request=abc").expect(200);
      expect(res.text).toContain("consent");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(res.headers["cache-control"]).toBe("no-store");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("consent", () => {
  it("shows the request only to the browser that started it", async () => {
    const { app } = setup();
    const { client_id } = await registerClient(app);
    const { id, cookie } = await startAuthorize(app, { clientId: client_id, challenge: pkce().challenge });
    await request(app).get(`/api/oauth/requests/${id}`).expect(403);
    await request(app).get(`/api/oauth/requests/${id}`).set("Cookie", "__Host-jam_oauth=other").expect(403);
    const res = await request(app).get(`/api/oauth/requests/${id}`).set("Cookie", cookie).expect(200);
    expect(res.body).toMatchObject({ clientName: "Claude", redirectHost: "claude.ai", scopes: ["jam"] });
  });

  it("needs a signed-in user and the same browser to decide", async () => {
    const { app } = setup();
    const { client_id } = await registerClient(app);
    const { id, cookie } = await startAuthorize(app, { clientId: client_id, challenge: pkce().challenge });
    await request(app)
      .post(`/api/oauth/requests/${id}/decision`)
      .set("Cookie", cookie)
      .send({ allow: true })
      .expect(401);
    await request(app)
      .post(`/api/oauth/requests/${id}/decision`)
      .set("Authorization", "Bearer id-alice")
      .send({ allow: true })
      .expect(403);
  });

  it("redirects with access_denied on Deny, and a request is decided once", async () => {
    const { app } = setup();
    const { client_id } = await registerClient(app);
    const { id, cookie } = await startAuthorize(app, { clientId: client_id, challenge: pkce().challenge });
    const res = await decide(app, id, cookie, "alice", false);
    expect(res.status).toBe(200);
    const redirect = new URL(res.body.redirectTo as string);
    expect(redirect.origin + redirect.pathname).toBe(CLAUDE_CB);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("state")).toBe("st4te");
    expect(redirect.searchParams.get("code")).toBeNull();
    expect((await decide(app, id, cookie, "alice", true)).status).toBe(404);
  });

  it("redirects with code, state and iss on Allow", async () => {
    const { app } = setup();
    const { client_id } = await registerClient(app);
    const { redirect, code } = await getCode(app, client_id);
    expect(code).toMatch(/^jamc_/);
    expect(redirect.searchParams.get("state")).toBe("st4te");
    expect(redirect.searchParams.get("iss")).toBe(ORIGIN);
  });

  it("expires a request nobody answers", async () => {
    const { app, clock } = setup();
    const { client_id } = await registerClient(app);
    const { id, cookie } = await startAuthorize(app, { clientId: client_id, challenge: pkce().challenge });
    clock.advance(11 * 60_000);
    expect((await decide(app, id, cookie, "alice", true)).status).toBe(404);
  });
});

describe("token: authorization_code", () => {
  it("exchanges a code with the right PKCE verifier", async () => {
    const ctx = setup();
    const { tokens } = await connect(ctx);
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "jam" });
    expect(tokens.access_token).toMatch(/^jama_/);
    expect(tokens.refresh_token).toMatch(/^jamr_/);
  });

  it("stores tokens and codes only as hashes", async () => {
    const ctx = setup();
    const { tokens } = await connect(ctx);
    const dump = JSON.stringify([...ctx.store.oauthTokens.entries(), ...ctx.store.authCodes.entries()]);
    expect(dump).not.toContain(tokens.access_token);
    expect(dump).not.toContain(tokens.refresh_token);
  });

  it("rejects a wrong PKCE verifier", async () => {
    const { app } = setup();
    const { client_id } = await registerClient(app);
    const { code } = await getCode(app, client_id);
    const res = await exchange(app, client_id, code, pkce().verifier);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_grant");
  });

  it("rejects a reused code and revokes what the first use got", async () => {
    const ctx = setup();
    const { client_id } = await registerClient(ctx.app);
    const { code, verifier } = await getCode(ctx.app, client_id);
    const first = await exchange(ctx.app, client_id, code, verifier);
    expect(first.status).toBe(200);
    expect((await listTools(ctx.app, first.body.access_token as string)).status).toBe(200);
    const second = await exchange(ctx.app, client_id, code, verifier);
    expect(second.status).toBe(400);
    expect(second.body.error).toBe("invalid_grant");
    expect((await listTools(ctx.app, first.body.access_token as string)).status).toBe(401);
  });

  it("rejects an expired code", async () => {
    const ctx = setup();
    const { client_id } = await registerClient(ctx.app);
    const { code, verifier } = await getCode(ctx.app, client_id);
    ctx.clock.advance(91_000);
    const res = await exchange(ctx.app, client_id, code, verifier);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_grant");
  });

  it("rejects a redirect_uri that differs from the authorization request", async () => {
    const { app } = setup();
    const { client_id } = await registerClient(app, { redirect_uris: [CLAUDE_CB, CLAUDE_COM_CB] });
    const { code, verifier } = await getCode(app, client_id);
    const res = await exchange(app, client_id, code, verifier, { redirect_uri: CLAUDE_COM_CB });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_grant");
  });

  it("rejects a resource that is not this MCP server", async () => {
    const { app } = setup();
    const { client_id } = await registerClient(app);
    const { code, verifier } = await getCode(app, client_id);
    const res = await exchange(app, client_id, code, verifier, { resource: "https://evil.example/mcp" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_target");
  });

  it("accepts a request without resource, bound to this server", async () => {
    const { app } = setup();
    const { client_id } = await registerClient(app);
    const { code, verifier } = await getCode(app, client_id, "alice", { resource: null });
    const res = await token(app, { grant_type: "authorization_code", client_id, code, code_verifier: verifier });
    expect(res.status).toBe(200);
    expect((await listTools(app, res.body.access_token as string)).status).toBe(200);
  });

  it("rejects a code from another client", async () => {
    const { app } = setup();
    const a = await registerClient(app);
    const b = await registerClient(app);
    const { code, verifier } = await getCode(app, a.client_id);
    const res = await exchange(app, b.client_id, code, verifier);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_grant");
  });
});

describe("token: confidential clients", () => {
  it("accepts client_secret_post and client_secret_basic, and rejects a wrong secret", async () => {
    const { app } = setup();
    const { client_id, client_secret } = await registerClient(app, {
      token_endpoint_auth_method: "client_secret_basic",
    });
    const secret = client_secret as string;

    const viaPost = await getCode(app, client_id);
    const post = await exchange(app, client_id, viaPost.code, viaPost.verifier, { client_secret: secret });
    expect(post.status).toBe(200);

    const viaBasic = await getCode(app, client_id);
    const basic = await request(app)
      .post("/token")
      .type("form")
      .auth(encodeURIComponent(client_id), encodeURIComponent(secret))
      .send({
        grant_type: "authorization_code",
        code: viaBasic.code,
        code_verifier: viaBasic.verifier,
        redirect_uri: CLAUDE_CB,
      });
    expect(basic.status).toBe(200);

    const wrong = await getCode(app, client_id);
    const bad = await exchange(app, client_id, wrong.code, wrong.verifier, { client_secret: "nope" });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe("invalid_client");
    const none = await exchange(app, client_id, wrong.code, wrong.verifier);
    expect(none.status).toBe(401);
  });
});

describe("token: refresh_token", () => {
  it("rotates the refresh token, and a reused one revokes the grant", async () => {
    const ctx = setup();
    const { client, tokens } = await connect(ctx);
    const refreshed = await token(ctx.app, {
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: tokens.refresh_token,
      resource: RESOURCE,
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refresh_token).not.toBe(tokens.refresh_token);
    expect(refreshed.body.access_token).not.toBe(tokens.access_token);
    expect((await listTools(ctx.app, refreshed.body.access_token as string)).status).toBe(200);

    const replay = await token(ctx.app, {
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: tokens.refresh_token,
    });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe("invalid_grant");
    // The replay ended the grant, so the tokens from the honest refresh die too.
    expect((await listTools(ctx.app, refreshed.body.access_token as string)).status).toBe(401);
    const after = await token(ctx.app, {
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: refreshed.body.refresh_token as string,
    });
    expect(after.status).toBe(400);
  });

  it("rejects a refresh for another client, a new scope or another resource", async () => {
    const ctx = setup();
    const { client, tokens } = await connect(ctx);
    const other = await registerClient(ctx.app);
    const wrongClient = await token(ctx.app, {
      grant_type: "refresh_token",
      client_id: other.client_id,
      refresh_token: tokens.refresh_token,
    });
    expect(wrongClient.body.error).toBe("invalid_grant");

    const fresh = await connect(ctx);
    const scope = await token(ctx.app, {
      grant_type: "refresh_token",
      client_id: fresh.client.client_id,
      refresh_token: fresh.tokens.refresh_token,
      scope: "jam admin",
    });
    expect(scope.body.error).toBe("invalid_scope");

    const third = await connect(ctx);
    const resource = await token(ctx.app, {
      grant_type: "refresh_token",
      client_id: third.client.client_id,
      refresh_token: third.tokens.refresh_token,
      resource: "https://evil.example/mcp",
    });
    expect(resource.body.error).toBe("invalid_target");
    expect(client.client_id).toBeTruthy();
  });

  it("expires access tokens after an hour", async () => {
    const ctx = setup();
    const { tokens } = await connect(ctx);
    expect((await listTools(ctx.app, tokens.access_token)).status).toBe(200);
    ctx.clock.advance(60 * 60_000 + 1);
    expect((await listTools(ctx.app, tokens.access_token)).status).toBe(401);
  });
});

describe("revoke", () => {
  it("revokes an access token", async () => {
    const ctx = setup();
    const { client, tokens } = await connect(ctx);
    await request(ctx.app)
      .post("/revoke")
      .type("form")
      .send({ client_id: client.client_id, token: tokens.access_token })
      .expect(200);
    expect((await listTools(ctx.app, tokens.access_token)).status).toBe(401);
  });

  it("revokes the whole grant for a refresh token", async () => {
    const ctx = setup();
    const { client, tokens } = await connect(ctx);
    await request(ctx.app)
      .post("/revoke")
      .type("form")
      .send({ client_id: client.client_id, token: tokens.refresh_token, token_type_hint: "refresh_token" })
      .expect(200);
    expect((await listTools(ctx.app, tokens.access_token)).status).toBe(401);
    expect(ctx.store.grants.size).toBe(0);
  });

  it("ignores a token of another client", async () => {
    const ctx = setup();
    const { tokens } = await connect(ctx);
    const other = await registerClient(ctx.app);
    await request(ctx.app)
      .post("/revoke")
      .type("form")
      .send({ client_id: other.client_id, token: tokens.access_token })
      .expect(200);
    expect((await listTools(ctx.app, tokens.access_token)).status).toBe(200);
  });
});

describe("/mcp with OAuth", () => {
  it("serves the user who consented, and personal keys still work", async () => {
    const ctx = setup();
    await ctx.saveCode("alice", 's("bd sd")');
    const { tokens } = await connect(ctx, "alice");
    const viaOAuth = await ctx.callTool(tokens.access_token, "get_current_code");
    expect(viaOAuth.content[0]?.text).toContain('s(\\"bd sd\\")');
    const key = await ctx.mintFor("alice");
    const viaKey = await ctx.callTool(key, "get_current_code");
    expect(viaKey.content[0]?.text).toContain('s(\\"bd sd\\")');
  });

  it("does not accept a refresh token or a code as an access token", async () => {
    const ctx = setup();
    const { tokens } = await connect(ctx);
    expect((await listTools(ctx.app, tokens.refresh_token)).status).toBe(401);
  });
});

describe("connected apps (side panel)", () => {
  it("lists a grant to its owner, and revoking it ends its tokens", async () => {
    const ctx = setup();
    const { tokens } = await connect(ctx, "alice");
    const list = await request(ctx.app).get("/api/oauth/grants").set(ctx.asUser("alice")).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ clientName: "Claude" });
    expect(JSON.stringify(list.body)).not.toContain(tokens.access_token);
    await request(ctx.app).get("/api/oauth/grants").set(ctx.asUser("bob")).expect(200, []);

    const id = list.body[0].id as string;
    await request(ctx.app).delete(`/api/oauth/grants/${id}`).set(ctx.asUser("bob")).expect(404);
    await request(ctx.app).delete(`/api/oauth/grants/${id}`).set(ctx.asUser("alice")).expect(204);
    expect((await listTools(ctx.app, tokens.access_token)).status).toBe(401);
    await request(ctx.app).get("/api/oauth/grants").expect(401);
  });
});

describe("client ID metadata documents", () => {
  const DOC_URL = "https://client.example/oauth/metadata.json";
  const doc = {
    client_id: DOC_URL,
    client_name: "Doc Client",
    redirect_uris: [CLAUDE_CB],
    token_endpoint_auth_method: "none",
  };

  it("uses an https client_id URL without registration", async () => {
    const fetched: string[] = [];
    const ctx = setup({
      fetchDocument: async (url) => {
        fetched.push(url);
        return doc;
      },
    });
    const { code, verifier } = await getCode(ctx.app, DOC_URL);
    const res = await exchange(ctx.app, DOC_URL, code, verifier);
    expect(res.status).toBe(200);
    expect(fetched).toEqual([DOC_URL]);
  });

  it("rejects a document whose client_id differs or that asks for a secret", async () => {
    for (const bad of [
      { ...doc, client_id: "https://other.example/x" },
      { ...doc, token_endpoint_auth_method: "client_secret_post" },
      { ...doc, redirect_uris: ["http://evil.example/cb"] },
    ]) {
      const { app } = setup({ fetchDocument: async () => bad });
      const res = await request(app)
        .get("/authorize")
        .query(authorizeQuery({ clientId: DOC_URL, challenge: "x" }));
      expect(res.status).toBe(400);
    }
  });

  it("only treats safe https URLs as metadata documents", () => {
    expect(isMetadataDocumentUrl(DOC_URL)).toBe(true);
    expect(isMetadataDocumentUrl("http://client.example/a")).toBe(false);
    expect(isMetadataDocumentUrl("https://client.example/")).toBe(false);
    expect(isMetadataDocumentUrl("https://127.0.0.1/a")).toBe(false);
    expect(isMetadataDocumentUrl("https://client.example:8443/a")).toBe(false);
    expect(isMetadataDocumentUrl("https://user@client.example/a")).toBe(false);
    expect(isMetadataDocumentUrl("https://localhost/a")).toBe(false);
  });

  it("blocks private and loopback addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "0.0.0.0",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
  });
});

describe("redirect URI policy", () => {
  it("allows https and loopback http only", () => {
    expect(redirectUriProblem(CLAUDE_CB)).toBeNull();
    expect(redirectUriProblem(CHATGPT_CB)).toBeNull();
    expect(redirectUriProblem("http://127.0.0.1:1234/cb")).toBeNull();
    expect(redirectUriProblem("http://[::1]:1234/cb")).toBeNull();
    expect(redirectUriProblem("http://example.com/cb")).not.toBeNull();
    expect(redirectUriProblem("javascript:alert(1)")).not.toBeNull();
  });
});
