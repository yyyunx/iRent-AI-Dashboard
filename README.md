下面整份直接複製貼到 GitHub `README.md` 就好。

````md
# iRent AI Dashboard

iRent AI Dashboard is a demo web app for AI-assisted rental-car inspection workflows.

It includes:

- Renter photo submission flow
- Blur / quality check
- AI-style incident creation mock
- Operator dashboard
- Photo submissions review
- Tasks / dispatch views
- Settings page
- Slack webhook configuration
- SQLite demo persistence

---

## Architecture

- Frontend: React + Vite + TypeScript
- Backend: Express + TypeScript
- Database: SQLite through `better-sqlite3`
- Local demo database: `outputs/irent_ops.db`
- Local upload folder: `outputs/uploads/`

The app runs as two processes during local development:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:5188`

In production, Express serves the built React frontend from `frontend/dist`, while API routes stay under `/api`.

---

## Project Structure

```txt
iRent-AI-Dashboard/
├─ frontend/              # React + Vite frontend
├─ backend/               # Express + TypeScript backend
├─ outputs/
│  ├─ irent_ops.db        # Demo SQLite database
│  └─ uploads/            # Local uploaded images
├─ package.json           # Root scripts
├─ render.yaml            # Render deployment reference
└─ README.md
````

---

## Local Development

Install dependencies from the repository root:

```bash
pnpm install
pnpm --dir frontend install
pnpm --dir backend install
```

Run frontend and backend together:

```bash
pnpm dev
```

Open the frontend:

```txt
http://localhost:5173
```

Backend health check:

```txt
http://localhost:5188/healthz
```

---

## Build

Build both frontend and backend:

```bash
pnpm build
```

Start the production server after building:

```bash
pnpm start
```

In production mode, Express serves the React build and the API from the same backend service.

---

## Environment Variables

| Key                 | Description                           | Default                |
| ------------------- | ------------------------------------- | ---------------------- |
| `PORT`              | Express backend port                  | `5188`                 |
| `NODE_ENV`          | Runtime mode                          | `development`          |
| `DATABASE_PATH`     | SQLite database path                  | `outputs/irent_ops.db` |
| `UPLOAD_DIR`        | Upload folder path                    | `outputs/uploads`      |
| `FRONTEND_DIST`     | Optional frontend build path override | auto-detected          |
| `CORS_ORIGIN`       | Optional CORS allowlist               | not required locally   |
| `SLACK_WEBHOOK_URL` | Optional Slack webhook                | empty                  |

---

## Render Deployment

This project is deployed as a Node.js web service.

### Build Command

```bash
pnpm install --frozen-lockfile && pnpm --dir frontend install --frozen-lockfile && pnpm --dir backend install --frozen-lockfile && pnpm build
```

### Start Command

```bash
pnpm start
```

### Render Environment Variables

For short-term demo deployment on Render Free:

```txt
NODE_ENV=production
DATABASE_PATH=outputs/irent_ops.db
UPLOAD_DIR=outputs/uploads
SLACK_WEBHOOK_URL=optional
```

Health check path:

```txt
/healthz
```

---

## Render Free Demo Limitation

This project currently uses local SQLite and local upload storage for demo purposes.

On Render Free, the filesystem is not persistent. This means data written at runtime may be lost after:

* Redeploy
* Restart
* Service spin down
* Free instance wake-up

For short-term demos, this is acceptable.

For production, replace local SQLite and local uploads with external persistent services such as:

* Supabase Postgres
* Neon Postgres
* Supabase Storage
* Cloudinary

---

## API Surface

### Health

```txt
GET /healthz
```

### Dashboard / State

```txt
GET /api/state
```

### Photo Submissions

```txt
GET /api/submissions
GET /api/submissions/:submissionId
POST /api/photos/quality-check
POST /api/photo-submissions
```

### Incidents / Actions

```txt
POST /api/incidents
POST /api/action
```

### Settings

```txt
POST /api/settings/slack
```

---

## Demo Database

`outputs/irent_ops.db` is kept as a demo SQLite database for local review and demo usage.

It is not intended to be used as a production database.

---

## Repository Hygiene

The repository should not commit:

* `node_modules/`
* `dist/`
* `.env*`
* logs
* runtime uploads
* SQLite journal / WAL files
* Python cache files

Ignored examples:

```txt
node_modules/
dist/
.env*
*.log
outputs/uploads/
outputs/__pycache__/
*.db-journal
*.db-wal
*.db-shm
```

---

## Legacy Python Server

The old Python server:

```txt
outputs/shared_ops_server.py
```

is legacy and is no longer used for Render deployment.

The current deployment target is:

```txt
React frontend + Express backend + SQLite demo database
```
