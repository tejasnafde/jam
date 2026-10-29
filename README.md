# jam

Live-code music in the browser with [Strudel](https://strudel.cc), and let an AI coach listen along.

The coach connects over MCP. It can **read** your code, your history and a summary of the sound, and it can
write a session plan. It can **never** change your music: there is no tool that writes code.

Live at <https://jam.tn07.dev>.

## How a session works

1. Sign in with Google and play. Every Ctrl+Enter saves a version. A few seconds later the page also saves an audio
   snapshot: RMS loudness and the share of energy in the low (<250 Hz), mid and high (>4 kHz) bands.
2. In the side panel, create a key under "Connect an assistant" and add jam to your assistant.
3. Ask the coach to start a session (the `start_session` prompt). In the style of Bob Ross, it describes "what we are
   about to paint today": a destination and 4 to 6 stages. Each stage is a goal with at most one hint, never code.
   The plan shows in the side panel and moves along as you reach each goal.

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
| `get_current_code`   | read       | The last evaluated code, with when it ran and how often                             |
| `get_history`        | read       | Recent versions, newest first, as unified diffs or full code                        |
| `get_audio_snapshot` | read       | Loudness and low/mid/high energy measured after each evaluation                     |
| `lookup_sound`       | read       | Search Strudel's default sounds: synths, `gm_*` soundfonts, sample banks, drum kits |
| `get_session_plan`   | read       | The current plan and stage                                                          |
| `list_samples`       | read       | The user's sample library: kind, duration, BPM, key, stats, stems and ops           |
| `get_sample`         | read       | One sample by name, with its stems and prepared versions                            |
| `set_session_plan`   | plan write | Start a new plan (destination plus 4 to 6 stages)                                   |
| `set_stage`          | plan write | Move to a stage, with an optional short note                                        |

Prompt: `start_session` (optional `mood`, `minutes`). The coaching rules are also in the server instructions, so a
client that does not use prompts still gets them.

## Structure

```
apps/
  server/          Node + Express + TypeScript
    src/auth/      Firebase ID tokens for the page, personal bearer tokens for MCP
    src/mcp/       MCP server, coaching text, one file per tool in tools/
    src/routes/    REST routes for the page, /mcp, static files
    src/store/     Store interface, Firestore implementation, in-memory fake for tests
    src/sounds/    Index of Strudel's default sound names
    src/config.ts  Environment, validated with zod
  web/             React + Vite + Tailwind + shadcn/ui
    src/components/ui/   shadcn components
    src/components/      App shell: top bar, side panel, level meter
    src/features/        auth, editor (wraps <strudel-editor>), plan, connect, library
    src/lib/             Firebase client, typed API client, audio analyser tap
packages/
  shared/          zod schemas and types used by both apps
edge/              Cloudflare Worker that maps jam.tn07.dev to Cloud Run
```

Storage is Firestore (named database `jam-db` in `teejayproject`). Sample audio lives in the private bucket
`jam-samples-teejayproject` under `users/{uid}/`; the page uploads and plays it through short-lived signed URLs, and
registers each sample with Strudel so `s("name")` plays it. No state lives in server memory, so Cloud Run can
run several instances.

MCP auth is a list of authenticators. Phase 1 has the personal token. Phase 2 adds OAuth 2.1 with dynamic client
registration (for claude.ai and ChatGPT) as another entry in that list.

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
path. The edge Worker is deployed by hand with `cd edge && npx wrangler deploy`; it only changes if the Cloud Run URL
does.

## License

jam is free software under the [GNU Affero General Public License v3.0 or later](LICENSE). It embeds Strudel, which is
also AGPL-3.0. If you run a modified version as a network service, you must offer its source to its users.
