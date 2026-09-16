# Security Review: User/Admin Authentication and Authorization

## Scope and trust boundaries

- Entry points: React login/forms, REST API, protected uploaded files, signed LINE webhook, and one-time create-admin CLI.
- Identities: anonymous client, authenticated user, authenticated admin, and signed LINE webhook sender.
- Sensitive data: password hashes, session/CSRF tokens, LINE/OpenAI secrets, user submissions, photos, incidents, settings, and audit events.
- Trust transitions: browser to Express, Express to SQLite/filesystem, Express to LINE/OpenAI, and operator shell to create-admin CLI.
- Side effects: account/session creation, incident/submission writes, dispatch/status changes, file writes, configuration changes, and notifications.

## Controls and evidence

- Authentication: normalized case-insensitive usernames with DB uniqueness/format enforcement; Argon2id password hashes; 32-byte `crypto.randomBytes` opaque tokens; SHA-256 session-token storage; expiration, rotation, revocation, disable checks, and generic login errors.
- Authorization: reusable `loginRequired`/`roleRequired`; current role and active state loaded from SQLite on every request; admin checks precede sensitive controllers.
- Ownership: `user_id`, `owner_user_id`, and `source_submission_id` scope submission, photo, file, incident, and state reads. Cross-user lookups return 404.
- Browser/API: HttpOnly session cookie, production Secure flag, configurable SameSite/CORS credentials, double-submit plus session-bound CSRF, CSP and defensive headers.
- SQL: values are parameterized; the one dynamic Incident update field list is allowlisted.
- Files: image data URLs are allowlisted to JPEG/PNG/WebP, capped at 10 MB, server-renamed, and served only after authentication/ownership checks.
- Files (hardening update): data URL MIME is cross-checked against magic bytes; Sharp fully decodes JPEG/PNG/WebP and rejects malformed, oversized, or excessive-dimension images before disk write.
- Operations (hardening update): JSON compression is enabled while `/uploads` is excluded; stale LINE `sending` rows recover to queued on startup; opaque resource IDs remove count-based collision risk.
- Secrets/audit: no credentials are returned by auth APIs; audit metadata recursively redacts password/token/secret/cookie/API-key field names.
- Webhook: existing LINE HMAC signature verification remains outside cookie auth; target changes now produce an audit event.
- Change safety: migrations use `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ADD COLUMN`; the username migration preserves legacy User rows, IDs, password hashes, roles, and the legacy email column while removing email from login/API behavior.

## Findings

## SEC-001: Missing application authentication
- Severity: Critical
- Status: Mitigated
- Evidence: `backend/src/auth/`, auth routes, and security integration suite.
- Impact: Previously any network client could invoke operational APIs.
- Reproduction: Anonymous `GET /api/state` previously succeeded.
- Required fix: Server-side authentication and session invalidation.
- Validation: Anonymous access now returns 401; logout/rotation/revocation reuse tests pass.
- Owner: iRent Ops team
- Target version: next release

## SEC-002: Missing RBAC and ownership checks
- Severity: Critical
- Status: Mitigated
- Evidence: `backend/src/routes/apiRoutes.ts`, `DashboardController.ts`, repository ownership queries.
- Impact: Users could access admin operations or another user's records.
- Reproduction: Change route IDs or send a forged role in the request body.
- Required fix: Backend RBAC and per-resource ownership.
- Validation: user-to-admin requests return 403; cross-user submission/photo/incident visibility tests return 404 or exclude the record.
- Owner: iRent Ops team
- Target version: next release

## SEC-003: Cookie-authenticated writes lacked CSRF protection
- Severity: High
- Status: Mitigated
- Evidence: `backend/src/auth/middleware.ts` and `frontend/src/context/AuthContext.tsx`.
- Impact: A malicious site could attempt authenticated state changes.
- Reproduction: Submit a write request without a matching CSRF cookie/header.
- Required fix: Validate Origin when present and require matching, session-bound CSRF tokens.
- Validation: forged CSRF integration request returns 403.
- Owner: iRent Ops team
- Target version: next release

## SEC-004: File upload type confusion
- Severity: High
- Status: Mitigated
- Evidence: `DashboardService.savePhotoFile`.
- Impact: Authenticated clients could previously choose arbitrary file extensions/content.
- Reproduction: Upload a `data:text/html` payload with an HTML filename.
- Required fix: Image MIME allowlist, size bound, server-chosen extension/name, protected serving.
- Validation: non-image payload integration request returns 400.
- Owner: iRent Ops team
- Target version: next release

## SEC-005: Single-instance operational controls
- Severity: Medium
- Status: Accepted for current scope
- Evidence: `SECURITY-CAVEATS.md`, Render single web service and persistent disk.
- Impact: In-memory rate limits do not coordinate across replicas; monitoring/backups need operational setup.
- Reproduction: Add multiple backend replicas or inspect missing alert configuration.
- Required fix: Shared limiter plus documented alerts/backups before scaling.
- Validation: Not applicable to the explicitly accepted single-instance phase.
- Owner: iRent Ops operations
- Target version: before horizontal scaling

## Validation and traceability

- Baseline/rollback target: Git commit `ae91d7c821e9034381ec66ef324430a332e2a7e5`.
- Review state: uncommitted working-tree diff on `codex/auth-rbac`, intentionally not pushed at user request.
- Migration-copy evidence: Incident 11→11, PhotoSubmission 1→1, UploadedPhoto 10→10, Settings 6→6; User/AuthSession/AuditLog added.
- Runtime security suite: 26/26 Node test results passed, covering fresh/legacy User schemas, additive legacy-user migration, username normalization/uniqueness and generic failures, authentication, RBAC, ownership, CSRF, session hashing/rotation/revocation, disabled/downgraded users, rate limiting, audit redaction, upload allowlisting, and production cookie flags.
- Compiled service smoke: `/healthz` returned 200 and anonymous `/api/state` returned 401 against a temporary SQLite database.
- Bootstrap safety: first `create-admin` succeeded, the second invocation refused, and the stored password hash remained unchanged.
- Frontend: TypeScript, ESLint, and Vite production build passed; backend TypeScript compile passed.
- Dependency audit: backend and frontend production dependency audits reported no known vulnerabilities after patch upgrades.
- Rollback: restore application code to the baseline commit. Additive nullable columns/tables can remain safely unused; do not drop them during emergency rollback. Restore SQLite/files from the persistent-volume backup if data rollback is required.

## Decision

**CONDITIONAL** — application-level Critical/High findings in this scope are mitigated. Monitoring, backup evidence, and browser E2E remain documented operational gaps.
