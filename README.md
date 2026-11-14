# VYOM AI

VYOM AI is a Vite/React interview practice application with an Express API. It retains SQLite for local development and uses Neon PostgreSQL, private Vercel Blob storage (or private S3-compatible storage), and Vercel Functions for deployment.

## Local development

Requirements: Node.js 20+ and npm.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to the Express API on port 4000. Without `DATABASE_URL`, the API uses `server/data/vyom.sqlite`. Set a random `JWT_SECRET` before using real accounts. Provider credentials are optional locally; unavailable integrations return explicit errors.

Run local checks:

```sh
npm test
npm run build
```

## Production architecture

- One GitHub repository and one Vercel project build the Vite frontend to `dist` and expose the Express API as the Vercel Function at `api/index.js`.
- The frontend calls relative `/api/...` URLs by default, keeping the app and API on the same Vercel domain.
- `vercel.json` routes `/api/*` to the function and all other paths to the SPA entry point.
- When `DATABASE_URL` is set, the API uses a pooled Neon PostgreSQL connection. When it is absent, development uses SQLite and applies SQLite migrations on startup. PostgreSQL migrations use the direct `DATABASE_URL_UNPOOLED` connection through `npm run migrate:neon` before deploying the function.
- Neon CLI configuration lives in `neon.ts` and `.neon`; it pulls connection variables into ignored `.env.local`. The app loads `.env.local` and `.env` without replacing variables already present in the process environment.
- Resume documents are stored privately in Vercel Blob when `BLOB_READ_WRITE_TOKEN` is present. Private S3-compatible storage is supported as an alternative. Vercel production uploads fail closed if neither is configured; the function filesystem is never used as persistent storage.
- LLM and JDoodle credentials are read by the server only. Browser voice receives a short-lived OpenAI Realtime client secret; WebRTC media is sent from the browser directly to OpenAI, while the authenticated Vercel API creates credentials and saves transcript events.

## Create the production resources

1. Push this repository to GitHub and import it into **one Vercel project**. Use the repository root as the project root, `npm run build` as the build command, and `dist` as the output directory. Do not configure a separate backend service.
2. Create a Neon PostgreSQL database. Set `DATABASE_URL` to the pooled connection string (the hostname includes `-pooler`). Keep the direct connection string for `DATABASE_URL_UNPOOLED` and the migration command only.
3. Create and connect a **private** Vercel Blob store to this Vercel project. Vercel supplies `BLOB_READ_WRITE_TOKEN`. Alternatively, set all required private S3 variables.
4. Add Vercel environment variables from `.env.example`: set a unique `JWT_SECRET` (at least 32 characters), `NODE_ENV=production`, `APP_ORIGIN` and `CLIENT_ORIGIN` to the production domain, and `COOKIE_SAME_SITE=lax`. Add provider keys only for features you intend to enable.
5. Set `VITE_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_ID` to the same Google OAuth client ID if Google sign-in is enabled. Add the production domain to that OAuth client's authorized JavaScript origins.
6. Deploy from Vercel when you are ready. This repository does not deploy automatically from this coding task.

### Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon pooled PostgreSQL runtime URL; absent locally to select SQLite |
| `DATABASE_URL_UNPOOLED` | Direct Neon URL for migration tooling |
| `JWT_SECRET` | Required in production; at least 32 random characters |
| `APP_ORIGIN`, `CLIENT_ORIGIN` | Exact deployed HTTPS origin; used for mail links and CORS |
| `VITE_API_BASE_URL` | Leave empty for same-domain `/api` calls; never put secrets here |
| `BLOB_READ_WRITE_TOKEN` | Automatically injected by the linked private Vercel Blob store |
| `S3_*` | Optional S3-compatible private resume storage configuration |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | Server-side OpenAI-compatible chat and evidence-based evaluation |
| `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE`, `OPENAI_REALTIME_URL` | Realtime WebRTC session model, voice and endpoint |
| `JDOODLE_CLIENT_ID`, `JDOODLE_CLIENT_SECRET` | Server-side JDoodle code execution credentials |
| `JDOODLE_*_VERSION_INDEX` | Pin the JDoodle language version index available to your account |
| `MAIL_API_URL`, `MAIL_API_KEY`, `MAIL_FROM` | Resend-compatible verification and password reset email |
| `GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID` | Server verification and frontend Google button client ID |
| `PDFTOPPM_CMD`, `TESSERACT_CMD`, `TESSERACT_LANG` | Optional local OCR support for scanned PDF resumes |

Never expose secrets with a `VITE_` prefix.

## SQLite to Neon migration

To create/update the PostgreSQL schema and copy existing local SQLite data into Neon, back up the SQLite file first, set `DATABASE_URL_UNPOOLED` to the Neon direct URL and `SOURCE_SQLITE_PATH` (or `DATABASE_PATH`) to the source file, then run:

```powershell
$env:DATABASE_URL_UNPOOLED="postgresql://..."
$env:SOURCE_SQLITE_PATH=".\server\data\vyom.sqlite"
npm run migrate:neon
```

The importer preserves IDs and skips records already present in Neon. Review the row counts and verify representative accounts, interviews, messages and reports before switching production traffic. Do not run a migration against the wrong Neon branch.

Check the configured Neon connection and migrated tables without printing credentials:

```sh
npm run verify:neon
```

This confirms a PostgreSQL query, required schema tables, resume analysis storage, migration version 5, and a rolled-back transactional write/read check.

To apply schema changes without copying any local SQLite records, set `DATABASE_URL_UNPOOLED` to the intended Neon branch and run `npm run migrate:neon:schema`. This performs additive, idempotent schema setup only. `npm run migrate:neon` is the separate SQLite data importer.

## Implemented API and integrations

- Authentication: registration, login/logout, email verification/resend, forgot/reset/change password, Google ID-token verification, HTTP-only JWT cookies, profile and settings.
- Interviews: owned interview creation and history, persisted conversation turns, AI opening/follow-up questions, interview evaluation, report download and analytics.
- Voice: OpenAI Realtime client secrets are issued by the API; WebRTC uses the browser's microphone with speaking/listening indicators, and ordered transcript events are saved via the authenticated transcript endpoint. Requires `OPENAI_API_KEY` and browser microphone access.
- Resumes: PDF validation, text extraction, evidence-based OpenAI analysis saved in Neon/SQLite, analysis-aware interview context, optional Poppler/Tesseract OCR, private object storage, ownership-checked retrieval and deletion. Requires a private Blob/S3 store for production files and `OPENAI_API_KEY` for AI findings.
- Coding: JDoodle execution for C++, Java, Python and JavaScript. Test cases compare actual output and execution outcomes are persisted for later AI evaluation. A missing JDoodle configuration returns HTTP 503; execution is never simulated.
- Dashboard: statistics are computed from the signed-in user's database rows; history filters and report records are user-scoped.
- Community: email-based friend requests, accepted-friend leaderboard rankings from completed reports, private invite-code study rooms, member-only persisted chat and presence refreshes. Individual timer intervals persist per member; group time sums the union of overlapping study intervals (no double-counting). Heartbeats close abandoned sessions at their last confirmed activity. Study-room updates poll every five seconds to stay compatible with Vercel Functions; they do not use a persistent WebSocket server.

Migrations v3–v5 only add friendship, study-room, study-timer tables, indexes, and an AI analysis column on resumes. They do not remove or rewrite existing tables or user records. Run `npm run migrate:neon:schema` with `DATABASE_URL_UNPOOLED` pointed at the intended Neon branch before deploying code that uses these features. The SQLite equivalent is applied automatically during local API startup.

## Deployment checks and known limits

Before launch, configure real Neon, Blob, OpenAI, JDoodle, email and OAuth credentials in Vercel, then test with those credentials on a preview deployment. Live provider behavior, OAuth/email delivery, and production database migrations cannot be verified without the corresponding accounts and secrets. Scanned-PDF OCR requires Poppler/Tesseract binaries and is intended for local setups unless those executables are included in a compatible deployment bundle. JDoodle language/version indexes depend on the JDoodle API plan; pin the values supported by your account.

Production build and automated test commands are `npm run build` and `npm test`. The API requires a live `DATABASE_URL` in Vercel. A static frontend build alone does not verify Vercel function routing or external providers; use `vercel dev` and a Vercel preview after configuring credentials.
