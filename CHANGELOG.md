# Changelog

## Unreleased

- Added admin-only deterministic shift briefings, SLA warnings, evidence-backed incident clusters, non-mutating dispatch drafts, and persistent redacted Agent task history.
- Added expiring, server-owned dispatch and LINE message drafts with explicit admin confirmation, CSRF/RBAC enforcement, current-state revalidation, atomic one-time claiming, and audit events.
- Added cited bounded SOP retrieval, allowlisted admin Audit Log natural-language queries, authorization-denial auditing, and strict OpenAI Structured Outputs with response storage disabled.
- Replaced email login identifiers with normalized, case-insensitive unique usernames across the additive SQLite migration, auth/session APIs, CLI bootstrap commands, and frontend identity display.
- Hardened uploads with signature, decode, dimension, and size validation; added JSON compression, restart-safe LINE retry recovery, opaque resource IDs, bounded AI context, and minimal mutation responses.
- Added Argon2id user authentication with hashed opaque server-side sessions.
- Added backend RBAC, resource ownership enforcement, CSRF protection, login throttling, and security headers.
- Added admin action audit logging with secret-field redaction.
- Replaced frontend role selection with a single login, protected routes, a 403 page, and role-filtered navigation/actions.
- Added additive SQLite migrations and security integration coverage.
- Added one-time CLI commands for initial admin and regular user creation without password reset behavior.
