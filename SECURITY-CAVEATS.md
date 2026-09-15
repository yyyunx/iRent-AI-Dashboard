# Security Caveats

## Current deployment constraints

- Login throttling is in-memory and is appropriate only for the stated single-backend-instance deployment. Move it to a shared store before horizontal scaling.
- SQLite and uploaded files rely on the Render persistent disk configured at `/var/data`. Backups, restore drills, encryption-at-rest policy, and retention are operational responsibilities not implemented by this code change.
- Runtime alert routing for authentication spikes, repeated 403/429 responses, disk usage, and audit-log review is not configured in this repository.
- Automated browser E2E coverage for route redirects and the rendered 403 page is not yet present. TypeScript/build checks cover the frontend implementation; backend denial is covered by integration tests.
- SQLite remains a single-writer datastore despite WAL; migrate before horizontally scaling or supporting sustained write-heavy upload traffic. LINE retry processing remains in-process, and AI requests remain synchronous with a bounded 30-second upstream timeout.

These are Medium/Low operational limitations. The current security decision is **CONDITIONAL** until monitoring and backup controls are configured and evidenced.
