# Changelog

## Unreleased

- Added Argon2id user authentication with hashed opaque server-side sessions.
- Added backend RBAC, resource ownership enforcement, CSRF protection, login throttling, and security headers.
- Added admin action audit logging with secret-field redaction.
- Replaced frontend role selection with a single login, protected routes, a 403 page, and role-filtered navigation/actions.
- Added additive SQLite migrations and security integration coverage.
- Added one-time CLI commands for initial admin and regular user creation without password reset behavior.
