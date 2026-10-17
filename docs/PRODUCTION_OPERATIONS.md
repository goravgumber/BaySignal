# BaySignal Deployment and Operations Readiness

BaySignal is a prototype with tenant-scoped APIs and PostgreSQL migrations. This document describes the guarded path and current limits; it does not authorize a deployment or database change.

## Current operating model

- Supported integration target: PostgreSQL 16. The GitHub Actions tests use an ephemeral PostgreSQL 16 service with test-only credentials.
- Runtime settings are supplied through environment/secret stores: `DATABASE_URL`, `JWT_SECRET` (32+ characters, randomly generated), `FRONTEND_URL` (HTTPS origin), `DEVICE_API_KEY` (32+ characters), `NODE_ENV=production`, and `TRUST_PROXY=true` only behind the known one-hop trusted proxy. Client settings are `VITE_API_URL` and `VITE_WS_URL`.
- Do not put secrets in `.env.example`, Git, workflow YAML, shell history, or build output. The checked-in Render blueprint requests generated JWT/device keys; verify the deployed values through the provider's secret UI without printing them.
- `GET /health` is a liveness response only; it does not check PostgreSQL readiness. The process connects to PostgreSQL at startup and exits if that connection fails. A separate authenticated/low-information readiness check is still needed before production use.
- Render's checked-in blueprint sets `autoDeploy: true`. The service's configured deployment branch and current live commit were not inspected. Verify those settings before publishing further changes; do not merge or deploy this feature branch automatically.

## Database provisioning and migration gate

1. Provision a PostgreSQL database with TLS/network restrictions, an application role with only required schema privileges, and a separate backup/restore role. Keep administrative credentials outside the app runtime.
2. Create a restorable backup and verify a restore into an isolated database before a production schema change.
3. For an existing database, obtain a schema-only comparison against `server/prisma/baseline-schema.prisma` and the old checked-in schema. Do not infer compatibility from app version or table names. Stop on any difference.
4. For an empty database, verify it is genuinely empty. Use the manual migration workflow's `fresh-empty-database` path only after owner review. For an exact old-schema match, use `existing-schema-compared` only after the comparison and backup are reviewed.
5. The manual workflow requires explicit confirmation and either applies the baseline to an empty database or records the already-existing baseline before applying the additive migration. It does not seed data or bootstrap a platform administrator.
6. Inspect migration history and application health after the change. If a migration fails, stop writes as appropriate, preserve logs, restore or repair under the database owner's incident plan, and do not rerun blindly.

Never use `prisma db push`, the seed command, the platform-admin bootstrap, or the PostgreSQL test harness against a production or unidentified database. The test harness drops and recreates four fixed `baysignal_test_*` names; use only its ephemeral CI service or independently confirmed disposable databases.

## Backups and restore

Backups must be encrypted, access-controlled, retained outside the database host, and periodically restored into an isolated environment. Record backup time, schema/migration version, retention, restore owner, and measured recovery time. Do not treat a successful `pg_dump` exit as restore verification.

The Render blueprint currently declares a free PostgreSQL database. Render documents that free Postgres databases expire after 30 days and do not include managed backups; free web services can spin down when idle. Render explicitly says free instances are not for production. Therefore the current `$0` configuration is suitable only for disposable demos/tests, not for a production pilot with data durability or recovery expectations. A pilot needs a funded database/backup plan or an independently operated and verified backup design. See [Render free instance limitations](https://render.com/docs/free) and [Render Postgres backups](https://render.com/docs/postgresql-backups).

## TLS, keys, access, and incidents

- Terminate HTTPS at the hosting provider, require TLS for database connections, restrict database ingress to the app/administrator paths, and avoid public database endpoints where private networking is available.
- Rotate JWT signing and device keys through the secret manager. Rotation of `JWT_SECRET` invalidates existing signed sessions. Revoke account memberships for access removal; confirm revocation on API and socket paths.
- The present device key is shared across devices. Do not connect real hardware until per-device credentials, revocation, and replay handling exist.
- On suspected credential exposure, restrict affected access, rotate the relevant key, invalidate sessions, preserve audit/provider logs, identify affected accounts and devices, and review database access. Do not post tokens, plates, or raw credentials in issue reports.
- Application errors are returned with a request ID; logs emit safe metadata only. A managed structured-log sink, retention policy, alerting, and incident owner are not configured in this repository.

## Runtime, health, and capacity

- Graceful shutdown and readiness checks are not implemented. Add signal handling to stop accepting requests, drain sockets, and close Prisma cleanly before multi-instance production use.
- Rate limits use per-process memory and are disabled outside production. Use a shared store for multiple instances and confirm client IP derivation behind the actual proxy.
- Database connection limits, pool sizing, statement timeouts, alert thresholds, and capacity targets have not been validated for a production workload.
- Analytics, revenue, environmental reports, trusted gate/ANPR processing, and real bay-sensor integrations remain unavailable or unimplemented. Do not present simulator output as production evidence.

## Release checklist

- [ ] Owner completed the historical demo-credential/JWT rotation review in `SECURITY_REVIEW.md`.
- [ ] A production-capable PostgreSQL and verified backup/restore arrangement is funded and tested.
- [ ] Existing schema is reviewed against the baseline; migration mode is approved by the database owner.
- [ ] Deployment branch, auto-deploy settings, secret injection, TLS, and network boundaries are verified in the hosting dashboard.
- [ ] PostgreSQL migration and integration CI passes on PostgreSQL 16; tenant/socket authorization and rollback coverage is complete.
- [ ] Per-device authentication/replay protection, readiness, graceful shutdown, shared rate limiting (if scaling), logging/alerts, and incident ownership are ready.
- [ ] Human review approves the PR. No automatic merge or deployment is part of this workflow.
