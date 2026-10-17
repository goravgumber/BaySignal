# BaySignal Deployment and Operations Readiness

BaySignal is a prototype with tenant-scoped APIs and PostgreSQL migrations. This document describes the guarded path and current limits; it does not authorize a deployment or database change.

## Current operating model

- Supported integration target: PostgreSQL 16. The GitHub Actions tests use an ephemeral PostgreSQL 16 service with test-only credentials.
- Runtime settings are supplied through environment/secret stores: `DATABASE_URL`, `JWT_SECRET` (32+ characters, randomly generated), `FRONTEND_URL` (HTTPS origin), `NODE_ENV=production`, and `TRUST_PROXY=true` only behind the known one-hop trusted proxy. Per-device public keys and replay IDs are stored in PostgreSQL. The legacy global device key is disabled by default. Client settings are `VITE_API_URL` and `VITE_WS_URL`.
- Do not put secrets in `.env.example`, Git, workflow YAML, shell history, or build output. The checked-in Render blueprint requests a generated JWT key; device credentials are issued per device. Verify deployed secret settings through the provider's secret UI without printing values.
- `GET /health` is a liveness response only; it does not check PostgreSQL readiness. The process connects to PostgreSQL at startup and exits if that connection fails. A separate authenticated/low-information readiness check is still needed before production use.
- JWT and database configuration are validated during startup; a missing JWT secret fails closed. Do not treat `.env.example` placeholders as deployable secrets. Device credentials are issued through an authenticated API and are not environment-wide secrets.
- Render's checked-in blueprint sets `autoDeploy: true`. The service's configured deployment branch and current live commit were not inspected. Verify those settings before publishing further changes; do not merge or deploy this feature branch automatically.

## Database provisioning and migration gate

1. Provision a PostgreSQL database with TLS/network restrictions, an application role with only required schema privileges, and a separate backup/restore role. Keep administrative credentials outside the app runtime.
2. Create a restorable backup and verify a restore into an isolated database before a production schema change.
3. For an existing database, obtain a schema-only comparison against `server/prisma/baseline-schema.prisma` and the old checked-in schema. Do not infer compatibility from app version or table names. Stop on any difference.
4. For an empty database, verify it is genuinely empty. Use the manual migration workflow's `fresh-empty-database` path only after owner review. For an exact old-schema match, use `existing-schema-compared` only after the comparison and backup are reviewed.
5. The manual workflow requires explicit confirmation and either applies the baseline to an empty database or records the already-existing baseline before applying the additive migration. It does not seed data or bootstrap a platform administrator.
6. Inspect migration history and application health after the change. If a migration fails, stop writes as appropriate, preserve safe logs, and have the database owner direct recovery. The repository has no down-migration workflow; assume migrations are forward-only. Restore a verified backup or apply a reviewed forward repair under the recovery plan. Do not roll back application code against an incompatible schema or rerun blindly.

Assign named people before any production change: the service owner approves the window and customer communication; the database owner approves schema/migration mode and recovery; the backup operator verifies and restores the isolated backup; the application operator monitors rollout and health. Record the actual names and escalation route in the deployment runbook before a pilot.

Never use `prisma db push`, the seed command, the platform-admin bootstrap, or the PostgreSQL test harness against a production or unidentified database. The test harness drops and recreates four fixed `baysignal_test_*` names; use only its ephemeral CI service or independently confirmed disposable databases.

## Backups and restore

Backups must be encrypted, access-controlled, retained outside the database host, and periodically restored into an isolated environment. Record backup time, schema/migration version, retention, restore owner, and measured recovery time. Do not treat a successful `pg_dump` exit as restore verification.

No application-level retention or deletion schedule is implemented for reservations, device observations, replay records, or audit events. Replay entries expire after 600 seconds and are physically removed on that device's next accepted signed request; this is not a general data-retention job. Before a pilot, the service owner and privacy/data owner must define purposes, retention periods, deletion/subject-request handling, and the treatment of reservation PII, device IP addresses, and audit history. Audit history is append-only through ordinary application SQL, so deletion exceptions need a reviewed database-owner procedure.

The Render blueprint currently declares a free PostgreSQL database. Render documents that free Postgres databases expire after 30 days and do not include managed backups; free web services can spin down when idle. Render explicitly says free instances are not for production. Therefore the current `$0` configuration is suitable only for disposable demos/tests, not for a production pilot with data durability or recovery expectations. A pilot needs a funded database/backup plan or an independently operated and verified backup design. See [Render free instance limitations](https://render.com/docs/free) and [Render Postgres backups](https://render.com/docs/postgresql-backups).

## TLS, keys, access, and incidents

- Terminate HTTPS at the hosting provider, require TLS for database connections, restrict database ingress to the app/administrator paths, and avoid public database endpoints where private networking is available.
- Rotate JWT signing keys through the secret manager. Rotation of `JWT_SECRET` invalidates existing signed sessions. Revoke account memberships for access removal; confirm revocation on API and socket paths.
- Device authentication uses Ed25519. The credential issuance endpoint returns a PKCS#8 DER private key as base64url exactly once; the server stores the corresponding SPKI DER public key. The device must keep its private key in protected storage and use HTTPS. No database backup or API response should be treated as a private-key recovery mechanism.
- Canonical signing bytes are UTF-8 for `METHOD\nPATH_AND_QUERY\nUNIX_TIMESTAMP_SECONDS\nREQUEST_UUID\nLOWERCASE_HEX_SHA256_OF_RAW_BODY`. `METHOD` is uppercase; `PATH_AND_QUERY` is the exact request URL path/query received by Express; the digest is over exact HTTP JSON body bytes before parsing. The signature is Ed25519 and is sent as unpadded base64url. Headers carry the credential ID, device ID, timestamp, request UUID, and signature. Requests outside ±300 seconds are rejected. A unique device/request UUID row makes concurrent replays fail; rows expire after 600 seconds and cleanup occurs on that device's later accepted request.
- Credential issuance and revocation require facility-scoped `FACILITY_MANAGER` or `DEVICE_TECHNICIAN` access and create audit events. For rotation, issue a replacement, install it on the device, verify a signed request, then revoke the old credential. Lost private keys must be replaced and revoked, not recovered.
- Legacy global-key compatibility is disabled by default. Its explicit flag requires a strong legacy key and a cutoff no more than 30 days away. Legacy requests have no timestamp/signature/replay protection and the key spans devices. Use only for an inventoried client transition; confirm all devices have moved to signed requests and turn the compatibility flag off. The application does not provide a legacy-usage dashboard, so use hardware inventory/operator confirmation as cutoff evidence.
- On suspected credential exposure, restrict affected access, rotate the relevant key, invalidate sessions, preserve audit/provider logs, identify affected accounts and devices, and review database access. Do not post tokens, plates, or raw credentials in issue reports.
- Application errors are returned with a request ID; logs emit safe metadata only. A managed structured-log sink, retention policy, alerting, and incident owner are not configured in this repository.

## Runtime, health, and capacity

- Graceful shutdown and readiness checks are not implemented. Add signal handling to stop accepting requests, drain sockets, and close Prisma cleanly before multi-instance production use.
- Rate limits use per-process memory and are disabled outside production. Use a shared store for multiple instances and confirm client IP derivation behind the actual proxy.
- Database connection limits, pool sizing, statement timeouts, alert thresholds, and capacity targets have not been validated for a production workload.
- The server uses Prisma's configured PostgreSQL connection pool; there is no separate pool-management worker or graceful shutdown handler. Measure connection use under the intended instance count and set provider/database limits before scaling.
- Analytics, revenue, environmental reports, trusted gate/ANPR processing, and real bay-sensor integrations remain unavailable or unimplemented. Do not present simulator output as production evidence.

## Release checklist

- [ ] Owner completed the historical demo-credential/JWT rotation review in `SECURITY_REVIEW.md`.
- [ ] A production-capable PostgreSQL and verified backup/restore arrangement is funded and tested.
- [ ] Existing schema is reviewed against the baseline; migration mode is approved by the database owner.
- [ ] Deployment branch, auto-deploy settings, secret injection, TLS, and network boundaries are verified in the hosting dashboard.
- [ ] PostgreSQL migration and integration CI passes on PostgreSQL 16; tenant/socket authorization and rollback coverage is complete.
- [ ] Per-device private keys are securely installed, tested and individually revocable; legacy compatibility is disabled after the documented device inventory confirms cutover.
- [ ] Readiness, graceful shutdown, shared rate limiting (if scaling), managed logging/alerts, and incident ownership are ready.
- [ ] Human review approves the PR. No automatic merge or deployment is part of this workflow.
- [ ] Named service, database, backup/restore, privacy, and application operators and their escalation path are recorded; retention and deletion rules are approved.
- [ ] The approved deployment commit/branch is confirmed in the hosting dashboard; build/start, health observation, migration gate, rollback/recovery decision, and post-deploy checks are scheduled and assigned.
