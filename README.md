# jam

Live-code music in the browser with [Strudel](https://strudel.cc), and let an AI coach listen along.

The coach connects over MCP. It can **read** your code, your history and a summary of the sound, and it can
write a session plan. It can **never** change your music: there is no tool that writes code.

Live at <https://jam.tn07.dev>.

## How a session works

1. Sign in with Google and play. Every Ctrl+Enter saves a version. A few seconds later the page also saves an audio
   snapshot: RMS loudness and the share of energy in the low (<250 Hz), mid and high (>4 kHz) bands.
2. Add jam to your assistant: as a connector in claude.ai or ChatGPT (OAuth, no key to copy), or in Claude Code with
   a personal key from the side panel. Both are under "Connect an assistant".
3. Ask the coach to start a session (the `start_session` prompt). In the style of Bob Ross, it describes "what we are
   about to paint today": a destination and 4 to 6 stages. Each stage is a goal with at most one hint, never code.
   The plan shows in the side panel and moves along as you reach each goal.

### Sessions

A session is a named piece. The side panel lists them under "Sessions" with their version count and last edit; the
top bar shows the open one (select the name to rename it). Every version and plan belongs to one session, so opening
a session brings back its code and its "Today we paint" plan, on any computer. Opening never plays anything. The
editor text of the session you leave is saved first, and the open session also saves its text a few seconds after you
stop typing. Expand a session to page through its versions: Preview shows the code read-only, Restore puts it in
the editor as a new edit (it does not play it). Versions from before sessions belong to a session named "Untitled",
made on first load.

## Connect claude.ai or ChatGPT

Both use OAuth: you paste one URL, and jam asks you to sign in and allow the connection.

Connector URL: `https://jam.tn07.dev/mcp`

- **claude.ai:** Settings, Connectors, Add custom connector. Paste the URL and select Connect.
- **ChatGPT:** Settings, Apps and Connectors, Advanced settings, turn on Developer mode. Then Create, paste the URL and
  choose OAuth.

A jam page opens. It names the app and the site it returns to, and lists what the app can do. Sign in with Google and
select Allow. The side panel lists each connected app under "Connect an assistant", with Revoke.

## Connect Claude Code

```sh
claude mcp add --transport http jam https://jam.tn07.dev/mcp --header "Authorization: Bearer <token>"
```

The page shows this command, with your token filled in, once, when you create a key. Only a SHA-256 hash of the key is
stored. Revoke a key from the same panel. The token goes in the `Authorization` header only; the server ignores a token
in the URL.

## MCP tools

| Tool                 | Kind       | What it does                                                                        |
| -------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `get_current_code`   | read       | The last evaluated code in the open session, with its name, when it ran, how often  |
| `get_history`        | read       | Recent versions of a session (open one, or by name), as unified diffs or full code  |
| `list_sessions`      | read       | The user's sessions: name, version count, last edited, which one is open            |
| `get_audio_snapshot` | read       | Loudness and low/mid/high energy measured after each evaluation                     |
| `lookup_sound`       | read       | Search Strudel's default sounds: synths, `gm_*` soundfonts, sample banks, drum kits |
| `get_session_plan`   | read       | The current plan and stage                                                          |
| `list_samples`       | read       | The user's sample library: kind, duration, BPM, key, stats, stems and ops           |
| `get_sample`         | read       | One sample by name, with its stems and prepared versions                            |
| `set_session_plan`   | plan write | Start a new plan for the open session (destination plus 4 to 6 stages)              |
| `set_stage`          | plan write | Move to a stage, with an optional short note                                        |
| `get_prep_status`    | read       | The user's prep jobs (stem split, tempo match, key shift) and the samples they made |

Prompt: `start_session` (optional `mood`, `minutes`). The coaching rules are also in the server instructions, so a
client that does not use prompts still gets them.

## Structure

```
apps/
  server/          Node + Express + TypeScript
    src/auth/      Firebase ID tokens for the page, personal bearer tokens for MCP
    src/oauth/     OAuth 2.1 authorization server for claude.ai and ChatGPT connectors
    src/mcp/       MCP server, coaching text, one file per tool in tools/
    src/routes/    REST routes for the page, /mcp, static files
    src/store/     Store interface, Firestore implementation, in-memory fake for tests
    src/sounds/    Index of Strudel's default sound names
    src/config.ts  Environment, validated with zod
  web/             React + Vite + Tailwind + shadcn/ui
    src/components/ui/   shadcn components
    src/components/      App shell: top bar, side panel, level meter
    src/features/        auth, editor (wraps <strudel-editor>), plan, connect, consent (OAuth page), library
    src/lib/             Firebase client, typed API client, audio analyser tap
packages/
  shared/          zod schemas and types used by both apps
services/
  prep/            Python Cloud Run job: Demucs stem split, BPM and key detection, Rubber Band
                   tempo and pitch. One execution per prep job; the server starts it, it writes
                   its status to Firestore users/{uid}/prep_jobs/{id}
edge/              Cloudflare Worker that maps jam.tn07.dev to Cloud Run
```

Storage is Firestore (named database `jam-db` in `teejayproject`). Sample audio lives in the private bucket
`jam-samples-teejayproject` under `users/{uid}/`; the page uploads and plays it through short-lived signed URLs, and
registers each sample with Strudel so `s("name")` plays it. No state lives in server memory, so Cloud Run can
run several instances.

MCP auth is a list of authenticators: the personal key (`jam_...`), then the OAuth access token (`jama_...`). `/mcp`
does not care which one matched.

## OAuth design

jam is both the MCP resource server and its own OAuth 2.1 authorization server. Firebase Google sign-in only proves who
the user is on the consent page; it issues no tokens to the client. No new Google OAuth client is involved.

The endpoints follow the MCP authorization spec. They use the MCP SDK's handlers (`authorizationHandler`,
`tokenHandler`, `clientRegistrationHandler`, `revocationHandler`, `metadataHandler`) with a Firestore-backed
`OAuthServerProvider` in `apps/server/src/oauth`.

| Endpoint                                                                                  | Spec                                  |
| ----------------------------------------------------------------------------------------- | ------------------------------------- |
| `/.well-known/oauth-protected-resource`, also `/.well-known/oauth-protected-resource/mcp` | RFC 9728                              |
| `/.well-known/oauth-authorization-server`                                                 | RFC 8414                              |
| `/register`                                                                               | RFC 7591 dynamic registration         |
| `/authorize`                                                                              | Authorization code with PKCE          |
| `/token`                                                                                  | `authorization_code`, `refresh_token` |
| `/revoke`                                                                                 | RFC 7009                              |

- A 401 from `/mcp` carries `WWW-Authenticate: Bearer resource_metadata="https://jam.tn07.dev/.well-known/oauth-protected-resource"`,
  which is how a client finds the rest.
- **Clients.** Dynamic registration, rate limited per IP and capped at 200 registrations per hour per instance. A
  registered client that no grant claims within 24 hours expires (the `oauthClients` TTL below). A client can also use
  the https URL of a Client ID Metadata Document as its `client_id`; jam fetches it over https only, to a public address
  only, with a 5 s total deadline, a 32 KB cap, one fetch per URL at a time and at most 10 fetches at once. Redirect URIs must be https, or http on `localhost`, `127.0.0.1` or `[::1]` (any port, RFC 8252). Matching is
  exact otherwise. Client authentication: `none`, `client_secret_post` or `client_secret_basic`. Secrets are stored
  hashed and do not expire.
- **Rate limits and the Worker.** The limits key on the client address. The Worker sends the secret `X-Jam-Edge`
  header (Worker secret and Secret Manager `JAM_EDGE_SECRET`, the same value), and only then does the server trust
  `CF-Connecting-IP`. A direct `*.run.app` request is keyed on its socket address. `/token` and `/revoke` are limited
  before the client lookup. An `/authorize` error goes back to the client only for claude.ai, claude.com and
  chatgpt.com redirect URIs; for any other client jam shows an error page, so it is not an open redirector.
- **Consent.** `/authorize` validates the request, stores it server-side for 10 minutes, sets an HttpOnly
  `__Host-jam_oauth` cookie and redirects to `/authorize?request=<id>`, the consent page. The id is not a credential:
  reading or deciding the request needs the same cookie, and deciding also needs the Firebase ID token in a header. A
  request is decided once. The page cannot be framed.
- **Codes and tokens.** PKCE S256 is required. Codes live 90 s and are single-use; a replayed code revokes what it
  produced. Access tokens are opaque, live 1 hour and are bound to the resource `https://jam.tn07.dev/mcp` (RFC 8707)
  and the scope `jam`. Refresh tokens live 30 days and rotate on every use; a reused refresh token revokes the grant, except within 30 s of the rotation (a likely retry), which is only refused.
  Only SHA-256 hashes of codes and tokens are stored. Nothing secret goes in a URL except the standard `code` and
  `state` on the redirect back to the client (Cloud Run logs every URL).
- **Grants.** Each Allow creates a grant: one connected app. Revoking it (side panel, or `/revoke` with a refresh token)
  deletes it and its tokens. A user keeps at most 20; the oldest goes first.

Sessions live at `users/{uid}/sessions/{id}`; versions and plans carry a `sessionId`, and `users/{uid}` holds
`currentSessionId`. Listing a session's versions needs one composite index, kept as code in `firestore.indexes.json`.
Create it once (CI does not deploy indexes):

```sh
gcloud firestore indexes composite create --database=jam-db --project=teejayproject \
  --collection-group=versions --query-scope=COLLECTION \
  --field-config=field-path=sessionId,order=ascending --field-config=field-path=createdAt,order=descending
```

Firestore collections: `oauthClients`, `oauthRequests`, `oauthCodes`, `oauthGrants`, `oauthTokens`. All queries are
single-field, so there is no composite index. Requests, codes and tokens carry an `expireAt` Timestamp for an optional
TTL policy, which deletes expired rows (they are already rejected by time). A registered client carries `expireAt` (24 h
after registration) until its first grant removes it:

```sh
for c in oauthRequests oauthCodes oauthTokens oauthClients; do
  gcloud firestore fields ttls update expireAt --collection-group=$c --enable-ttl \
    --database=jam-db --project=teejayproject --async
done
```

## Run locally

Needs Node 22 (see `.nvmrc`).

```sh
npm install
npm run dev:server   # API and /mcp on :8080 (needs Firestore credentials, see below)
npm run dev          # web app on :5173, proxies /api and /mcp to :8080
```

The server uses Application Default Credentials for Firestore. Point `GOOGLE_APPLICATION_CREDENTIALS` at a service
account key that can use the `jam-db` database. `http://localhost:5173/?preview` shows the side panel with fixture data
and needs no backend.

Sample uploads and playback go straight to the bucket, and its CORS allows only `localhost:5173` (dev) and
`localhost:4173` (preview). GCS CORS has no port wildcard, so on another port add the origin to the bucket CORS.

Checks, the same as CI:

```sh
npm run lint
npm run format:check
npm run typecheck
npm test             # vitest, --maxWorkers=2
npm run build
```

## Deploy

A push to `main` runs the checks, then deploys to Cloud Run (`.github/workflows/ci.yml`). There is no other deploy
path. When `services/prep` changes, CI also builds the prep image with Cloud Build and updates the `jam-prep` Cloud
Run job (it never runs it). The edge Worker is deployed by hand with `cd edge && npx wrangler deploy`; it only changes if the Cloud Run URL
does.

## License

jam is free software under the [GNU Affero General Public License v3.0 or later](LICENSE). It embeds Strudel, which is
also AGPL-3.0. If you run a modified version as a network service, you must offer its source to its users.
