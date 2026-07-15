# iRent AI Dashboard

iRent AI Dashboard is a demo operations dashboard for AI-assisted rental-car inspection workflows. It includes a renter photo submission flow, blur/quality checks, AI-style incident creation, operator dispatch views, Settings, Slack webhook configuration, and SQLite persistence.

## Architecture

- Frontend: React + Vite + TypeScript
- Backend: Express + TypeScript
- Database: SQLite through `better-sqlite3`
- Demo database: `outputs/irent_ops.db`
- Upload storage: `outputs/uploads/` locally, `/var/data/uploads` on Render

The current app is served as two processes during development:

- Vite frontend on `http://localhost:5173`
- Express backend on `http://localhost:5188`

In production, Express serves the built frontend from `frontend/dist` and keeps API routes under `/api`.

## Local Development

Install dependencies from the repository root:

```bash
pnpm install
```

Run frontend and backend together:

```bash
pnpm dev
```

Build both apps:

```bash
pnpm build
```

Start the production server after building:

```bash
pnpm start
```

Smoke-test the backend:

```bash
curl http://localhost:5188/healthz
curl http://localhost:5188/api/state
```

PowerShell equivalent:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5188/healthz
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5188/api/state
```

## Environment Variables

- `PORT`: Express port. Defaults to `5188`.
- `DATABASE_PATH`: SQLite database path. Defaults to `outputs/irent_ops.db`.
- `UPLOAD_DIR`: uploaded photo directory. Defaults to `outputs/uploads`.
- `FRONTEND_DIST`: optional override for built frontend assets.
- `CORS_ORIGIN`: optional comma-separated CORS allowlist.
- `SLACK_WEBHOOK_URL`: optional Slack webhook value used by deployment/runtime.

## Render Deployment

`render.yaml` is configured for a Node.js web service:

- Build: `corepack enable && pnpm install --frozen-lockfile && pnpm build`
- Start: `pnpm start`
- Persistent disk: `/var/data`
- Production database: `/var/data/irent_ops.db`
- Production uploads: `/var/data/uploads`

The Python `outputs/shared_ops_server.py` implementation is legacy and is no longer used by Render.

## Demo Data

`outputs/irent_ops.db` is intentionally kept as a demo SQLite database for local review and demos. It is not a production database. Runtime uploads and generated cache files should not be committed.

## API Surface

- `GET /healthz`
- `GET /api/state`
- `GET /api/submissions`
- `GET /api/submissions/:submissionId`
- `POST /api/incidents`
- `POST /api/action`
- `POST /api/photos/quality-check`
- `POST /api/photo-submissions`
- `POST /api/settings/slack`

## Repository Hygiene

The repository ignores:

- `node_modules/`
- `dist/` and build outputs
- `.env*`
- logs
- SQLite journal/WAL files
- `outputs/uploads/`
- `outputs/__pycache__/`
