# VYOM AI

VYOM AI is a Vite/React interview practice platform backed by an Express API. The repository is split into two independently deployable Vercel projects:

- `frontend/` - Vite + React single-page application.
- `backend/` - Express API exposed through one Vercel Function, with Neon PostgreSQL, private Blob/S3 resume storage, OpenAI and JDoodle integrations.

The existing root-based `vyom-ai` Vercel project deploys the frontend and API together. The frontend and backend can also be deployed separately using their app-folder configurations.

## Repository layout

```text
api/index.js
frontend/
  index.html
  vite.config.js
  vercel.json
  package.json
  src/
backend/
  api/index.js
  server/
  vercel.json
  package.json
vercel.json
README.md
```

Each app folder has its own `package.json`, lockfile, environment example and deployment configuration. The frontend and backend can be deployed as separate Vercel projects. The existing root-based `vyom-ai` project can also deploy both together: `api/index.js` forwards API requests to the backend function, while the root `vercel.json` sends other routes to the frontend SPA.

## Local development

Requirements: Node.js 22.x and npm.

```powershell
npm run install:all
Copy-Item frontend\.env.example frontend\.env.local
Copy-Item backend\.env.example backend\.env.local
```

Start the API and web app in separate terminals:

```powershell
npm run dev:api
npm run dev:web
```

Open `http://localhost:5173`. Vite proxies `/api` to `http://localhost:4000`, so `VITE_API_BASE_URL` can stay empty locally. `npm run dev:api` always uses SQLite at `backend/server/data/vyom.sqlite` and ignores any deployment `DATABASE_URL` found in env files; run `node server/index.js` directly only when you intentionally want the API to use Postgres. `npm run preview` proxies `/api` to the same backend for production-build checks. Set a random `JWT_SECRET` before using real accounts.

Run checks:

```sh
npm test
npm run build
```

`npm test` runs the frontend and backend test suites. The backend suite uses in-memory SQLite and mocked provider calls; it does not require live external credentials.

## Vercel deployment

### Frontend project

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Framework preset | Vite |
| Node.js version | `22.x` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Install command | `npm install` (default) |

For the existing combined `vyom-ai` Vercel project, use these root settings:

| Setting | Value |
|---|---|
| Root Directory | `.` |
| Framework preset | Vite |
| Node.js version | `22.x` |
| Build command | `npm --prefix frontend run build` |
| Output directory | `frontend/dist` |
| Install command | `npm install` (root `postinstall` installs both app dependencies) |

The root `vercel.json` routes `/api/*` to the Node API function before applying the SPA fallback. In this combined setup, set `VITE_API_BASE_URL` to the same production origin (for example `https://vyom-ai-flame.vercel.app`); keep it secret-free. For separate projects, use the backend project origin instead. The root `.vercelignore` excludes local environment files, SQLite data, uploads and installed dependencies from CLI deployments.

Required frontend environment variable:

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | Same as the frontend origin for the combined project, or the backend project origin when split |

Rules for `VITE_API_BASE_URL`:

- Use the API origin (same as the frontend for the combined project). Do not append `/api`; the frontend adds `/api` itself.
- Do not add a trailing slash.
- It is a public build-time variable. Never put a secret in any `VITE_` variable.
- Redeploy the frontend after changing it because Vite embeds it at build time.

Optional: `VITE_GOOGLE_CLIENT_ID` for the Google sign-in button. It must match the backend `GOOGLE_CLIENT_ID`.

`frontend/vercel.json` rewrites every non-asset path to `index.html` when deployed separately, so direct navigation and refresh work for all manual-router pages, including `/dashboard`, `/interview/...`, `/dashboard/friends`, `/dashboard/study`, `/dashboard/resume`, `/dashboard/coding`, `/interview/:id/coding`, and `/interview/:id/report`. The combined root project applies the same fallback after routing `/api/*` to the API function.

### Backend project

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Framework preset | Other |
| Node.js version | `22.x` |
| Build command | none |
| Output directory | none |
| Install command | `npm install` (default) |

`backend/vercel.json` exposes `api/index.js` as the Vercel Function, routes `/api/*` to it, and maps `/` and `/health` to the health check. `maxDuration` is 60 seconds.

Required backend environment variables:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | At least 32 random characters |
| `DATABASE_URL` | Neon pooled PostgreSQL URL (hostname contains `-pooler`) |
| `CLIENT_ORIGIN` | Exact frontend origin, for example `https://vyom-ai-flame.vercel.app` |
| `APP_ORIGIN` | Same exact frontend origin; used for email links |
| `COOKIE_SAME_SITE` | `none` for separate `*.vercel.app` domains; `lax` for custom subdomains of one registrable domain |
| `PGSSLMODE` | `require` |
| `PG_POOL_MAX` | `5` is a safe starting point for Vercel Functions |

Resume storage (choose one):

| Variable | Purpose |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | Injected automatically when a private Vercel Blob store is connected |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Optional private S3-compatible storage instead of Blob |

Feature credentials (optional; endpoints fail closed with an explicit error when missing):

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | Server-side chat, report generation and resume analysis |
| `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE`, `OPENAI_REALTIME_URL` | OpenAI Realtime WebRTC voice session |
| `JDOODLE_CLIENT_ID`, `JDOODLE_CLIENT_SECRET`, `JDOODLE_API_URL`, `JDOODLE_*_VERSION_INDEX` | JDoodle code execution |
| `MAIL_API_URL`, `MAIL_API_KEY`, `MAIL_FROM` | Resend-compatible verification and password-reset email |
| `GOOGLE_CLIENT_ID` | Server-side Google ID-token verification |
| `PDFTOPPM_CMD`, `TESSERACT_CMD`, `TESSERACT_LANG` | Optional OCR; normally local only |

Do not set `PORT` or `DATABASE_PATH` in Vercel. Do not add backend secrets with a `VITE_` prefix.

### Cross-origin authentication

The frontend and backend are different origins. The backend already:

- Allows credentialed CORS only for the exact origins in `CLIENT_ORIGIN`, `APP_ORIGIN`, the original production origin, and the backend's own `VERCEL_URL`. Local development additionally accepts any `http://localhost:<port>` or `http://127.0.0.1:<port>` origin.
- Rejects unsafe API requests whose `Origin` is not allowlisted.
- Uses HTTP-only JWT cookies and `Trust proxy` for rate limiting behind Vercel.

For two separate `*.vercel.app` projects, set:

```text
CLIENT_ORIGIN=https://your-frontend.vercel.app
APP_ORIGIN=https://your-frontend.vercel.app
COOKIE_SAME_SITE=none
NODE_ENV=production
```

`vercel.app` is a public suffix, so the two projects are cross-site. `SameSite=None; Secure` is required. Some browsers with strict third-party-cookie blocking may still reject the cookie. For the most reliable production auth, attach custom domains under one registrable domain, for example `app.example.com` and `api.example.com`, and use `COOKIE_SAME_SITE=lax`. Keep both on HTTPS.

Add the Google OAuth authorized JavaScript origin for the frontend domain if Google sign-in is enabled.

## Database and migrations

The live Neon branch is read with the pooled `DATABASE_URL` at runtime. Schema and data migration tooling uses the direct `DATABASE_URL_UNPOOLED` URL.

Existing live Neon data from the earlier audit was at schema versions 1-2 and did not include the friendships, study-room, study-timer, `resumes.analysis`, interview setup, or coding-workspace schema. Those changes are implemented as additive, idempotent migrations and have **not** been run by this preparation task. Schema version 6 adds `interviews.experience_level`, `interviews.interview_language`, `submissions.problem_key`, and `submissions.mode`; the coding workspace reuses the existing `interviews` and `submissions` tables. Version mapping: v3 adds friendships and study rooms, members and messages; v4 adds study-room timer sessions; v5 adds `resumes.analysis`; v6 adds the interview setup and coding submission columns plus the user-submission index.

To apply schema only, after explicit approval and after confirming the branch is correct:

```powershell
$env:DATABASE_URL_UNPOOLED = "<direct Neon URL for the intended branch>"
npm run migrate:neon:schema
npm run verify:neon
```

`npm run migrate:neon:schema` creates or adds schema. It does not copy SQLite rows. To copy local SQLite data instead, use `npm run migrate:neon` with `SOURCE_SQLITE_PATH` set; that command preserves IDs and skips existing rows.

Before running either command:

- Back up the target Neon branch or use a Neon branch/restore point.
- Confirm `DATABASE_URL_UNPOOLED` points at the intended branch, not production by accident.
- Never run destructive SQL to "clean up" migration state.
- The migration adds tables, indexes, `users.email_verified`, `users.google_sub`, `users.profile_image`, `resumes.analysis`, interview setup columns, and coding submission columns; it does not drop or rewrite existing tables or rows.

## Implemented functionality

- Authentication: registration, login/logout, email verification/resend, forgot/reset/change password, Google ID-token verification, HTTP-only JWT cookies, profile and settings.
- Interviews: owned interview creation and history with role, experience level, difficulty, interview language and type; persisted conversation turns; AI opening/follow-up questions; evidence-based evaluation; saved report with performance categories, strengths, growth areas, recommended practice and next difficulty; report download and analytics.
- Voice: server-issued short-lived OpenAI Realtime client secret, browser WebRTC microphone session, ordered transcript persistence, microphone analyser waveform, live AI/mic/timer status, and mute/pause/resume/stop controls. Missing credentials fail closed with an explicit error instead of a simulated interview.
- Resumes: PDF validation, text extraction, evidence-based AI analysis, analysis-aware interview context, private Blob/S3 storage, owner-only retrieval and deletion, optional local OCR.
- Coding Lab: JDoodle execution for C++, Java, Python and JavaScript, syntax-highlighted editor overlay, language selection, custom input, Run and Submit modes, per-test pass/fail with hidden tests masked on run, problem statements/constraints/examples, Easy/Medium/Hard filters, progress, and persisted submission history. Missing credentials return HTTP 503 rather than simulated output.
- Dashboard: user-scoped statistics, interview history filters and report records.
- Community: email friend requests, accepted-friend and global leaderboards with weekly/all-time filters and top-three podium, invite-code study rooms, member-only persisted chat, per-member and group study timers, and room progress/leaderboard. Points come from completed interviews, report scores, passed coding tests and tracked study time; weekly boards cover the last seven days. Group time is the union of overlapping intervals, avoiding double counting. Presence uses heartbeats and five-second polling, which is compatible with Vercel Functions.

### API surface added or extended

| Area | Endpoints |
|---|---|
| Leaderboards | `GET /api/leaderboard?scope=friends\|global&period=all\|weekly` |
| Study rooms | `GET/POST /api/study-rooms`, `POST /api/study-rooms/join`, `GET/DELETE /api/study-rooms/:id`, `POST /api/study-rooms/:id/messages`, `POST /api/study-rooms/:id/timer/start`, `POST /api/study-rooms/:id/timer/stop`, `POST /api/study-rooms/:id/timer/heartbeat`, `DELETE /api/study-rooms/:id/membership` |
| Coding | `GET /api/coding/problems`, `GET /api/coding/progress`, `GET/POST /api/coding/workspace`, `POST /api/interviews/:id/code` with `mode=run\|submit` |
| Interview setup and report | `POST /api/interviews` accepts `experience_level` and `interview_language`; `GET /api/interviews/:id/report` and `/report/download` return the saved report |

Run and submit both execute through JDoodle. Run uses the custom input; submit validates the server-side test set, masks hidden test details in the response, and records the submission against the user's coding progress.

## Health check and validation

Backend health endpoints:

```text
https://your-backend.vercel.app/api/health
https://your-backend.vercel.app/health
https://your-backend.vercel.app/
```

A healthy response is `{"status":"ok","database":"postgres"}`. The endpoint returns HTTP 503 when the database is unavailable.

Before launch, verify with real credentials on a Vercel preview:

1. `GET /api/health` returns 200 and `database: postgres`.
2. Sign up, sign in, refresh, and sign out from the deployed frontend.
3. Upload a PDF resume and open Preview; confirm the request goes to the backend origin.
4. Create an interview, send a message, open the report, confirm performance, strengths, growth areas and recommended practice, then download it.
5. Start a voice session with microphone permission and confirm AI speech, mic levels, status changes and transcript rows persist.
6. Open Code Lab, run code with custom input, submit a solution, and confirm per-test results and submission history. An unconfigured JDoodle returns a clear 503.
7. Use two accounts to test friend requests, weekly/all-time leaderboards, study-room chat, room leaderboard, and individual/group timers.
8. Refresh each route directly, including `/dashboard/coding`, `/dashboard/friends`, `/dashboard/study`, `/interview/:id/coding`, and `/interview/:id/report`.

## Known limits and remaining manual steps

- Live provider behavior cannot be proven without real OpenAI, JDoodle, Blob/S3, email and Google credentials; those checks remain manual.
- The frontend resume library sends multipart uploads through the backend function. Vercel's request-body limit applies (roughly 4 MB in practice); use a smaller PDF or the existing Blob client-upload endpoint for larger files.
- `npm audit` may report moderate React Router advisories. The suggested fix upgrades to React Router 7 and is a breaking change, so it was not applied automatically.
- Scanned-PDF OCR needs Poppler/Tesseract binaries and is intended for local use unless those executables are bundled.
- Browser speech-to-text (the Speak button and the homepage mic demo) uses the Web Speech API, which is available in Chrome and Edge on desktop. Firefox and Safari are not supported for speech-to-text; typing and realtime voice still work there. Read-aloud uses the Speech Synthesis API, which Chrome, Edge and Safari support.
- Do not push, deploy, run production migrations, or change production environment variables until the migration target and environment values have been reviewed.
