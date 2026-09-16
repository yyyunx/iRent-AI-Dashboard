# Security Caveats

## Current deployment constraints

- Login throttling is in-memory and is appropriate only for the stated single-backend-instance deployment. Move it to a shared store before horizontal scaling.
- SQLite and uploaded files rely on the Render persistent disk configured at `/var/data`. Backups, restore drills, encryption-at-rest policy, and retention are operational responsibilities not implemented by this code change.
- Runtime alert routing for authentication spikes, repeated 403/429 responses, disk usage, and audit-log review is not configured in this repository.
- Automated browser E2E coverage for route redirects and the rendered 403 page is not yet present. TypeScript/build checks cover the frontend implementation; backend denial is covered by integration tests.
- Before deploying the username migration over an installation with existing email-based users, operators must communicate each generated lowercase username. The migration derives it from the email local-part, replaces unsupported characters with `-`, and appends the user ID when needed for uniqueness; passwords and user IDs are preserved.
- SQLite remains a single-writer datastore despite WAL; migrate before horizontally scaling or supporting sustained write-heavy upload traffic. LINE retry processing remains in-process, and AI requests remain synchronous with a bounded 30-second upstream timeout.
- SLA warning thresholds and team recommendations are deterministic application rules, not contractual SLA configuration. Operations owners must review thresholds before production rollout; execution requires a separate, short-lived server draft and explicit admin confirmation.
- Confirmed LINE drafts are queued by the same in-process single-instance delivery mechanism as existing notifications. A confirmed draft can therefore be recorded as `not_configured` or later fail delivery; operators must monitor notification status and retry operationally.

These are Medium/Low operational limitations. The current security decision is **CONDITIONAL** until monitoring and backup controls are configured and evidenced.
