# BaySignal Implementation Handoff

**Current phase:** Phase 2 backend foundation implemented locally; migration rollout is pending operator schema review. Nothing is committed, pushed, merged or deployed.

## Repository and Stitch source

- Repository: `C:\Users\gorav\Desktop\projects\SmartPark-AI`
- Branch: `feature/baysignal-production-implementation`
- Starting HEAD: `d7e2e13199705fcbd36a4bbbd64bc2b6b0438689`
- Remote: `origin` → `https://github.com/goravgumber/SmartPark-AI.git`
- The pre-existing Phase 1 untracked product/design documents were preserved.
- Stitch export: `C:\Users\gorav\Desktop\projects\stitch_baysignal_parking_operations_system_ui`. The export contains independent generated screens, `code.html`/`screen.png` files and `baysignal_control_system/DESIGN.md`; it is not a drop-in React application.
- Existing UI mappings remain in `STITCH_SCREEN_CATALOG.md`; Phase 1 visual work is summarized below.

## Dependency map

```text
User → auth middleware → active organization membership → organization admin OR explicit facility grant
                                                       ↘ explicit public-booking facility for driver browse/book
Facility → Zone → ParkingSlot → Reservation (planning only)
         ↘ Device → BayObservation (device report is evidence, not automatically trusted state)
         ↘ GateEvent → FacilityVisit (verified inbound/outbound; no bay event closes a visit)
BayObservation → evidence reconciliation → Discrepancy → reasoned correction + AuditEvent
Every critical write and its AuditEvent share a Prisma transaction; AuditEvent UPDATE/DELETE is blocked by PostgreSQL triggers.
```

## Schema and migration files

`server/prisma/schema.prisma` now adds:

- `Organization`, active/suspended `OrganizationMembership`, `FacilityAccess`, `PLATFORM_ADMIN`, explicit facility roles and `Facility.allowPublicReservations` (default false).
- `GateEvent` and `FacilityVisit`, with pseudonymous `vehicleReference`, inbound/outbound event relations, event validation and idempotency keys.
- `BayObservation`, `Discrepancy`, `DiscrepancyEvidence` and `AuditEvent`.
- Query indexes, confidence bounds in SQL, one-open-visit-per-vehicle partial uniqueness, exit-event consistency, tenant-consistent grants/resources, facility-consistent bay links, and audit update/delete triggers.

Two PostgreSQL migrations are checked in:

- `20261015100000_baseline`: the old checked-in schema, for a genuinely empty database only. It is explicitly marked unsafe to execute on a populated database.
- `20261015101000_add_tenant_presence_evidence_audit`: a forward migration generated from the old checked-in schema to the new schema. It adds tables, enums, nullable facility ownership and a false-by-default public-booking flag; it contains no drop statements and does not recreate old tables.
- `migration_lock.toml` pins PostgreSQL as provider.

### Operator-reviewed adoption procedure

No database URL was read or used. The live database state remains unverified. Before applying this migration to an existing database:

1. Take and verify a restorable database backup. Run a schema-only inspection with the database owner and compare it to the old checked-in Prisma schema. Do not infer that `db push` created an exact match.
2. If the old tables, columns, constraints and enums match the baseline, choose `existing-schema-compared` and type `BASELINE-MATCHED` in the manual workflow. The workflow runs `prisma migrate resolve --applied 20261015100000_baseline`, which records the baseline without executing its table-creation SQL, then runs `prisma migrate deploy` for the additive migration.
3. For a genuinely empty database, choose `fresh-empty-database` and type `FRESH-EMPTY`; the workflow runs both migrations.
4. If the existing schema differs, stop. Prepare a reviewed repair/adoption migration after documenting the drift; do not resolve the baseline or deploy the additive migration yet.

The workflow also requires `APPLY-MIGRATIONS`. It is manual, and it was not run. No production or local database migration/seed was executed. There is no local PostgreSQL or Docker executable available in this environment, so SQL was not executed against a disposable database. Prisma schema validation and a generated schema-diff comparison passed; those are not substitutes for the pending disposable PostgreSQL migration test and live-schema comparison.

## Phase 2.1 PostgreSQL validation status

The local environment has no `psql`, Docker, `pg_ctl` or `initdb`, and nothing is listening on `127.0.0.1:5432`. No ambient database URL or credentials were read. PostgreSQL was not installed and no database connection was attempted. PostgreSQL **16** is the zero-cost CI service target; the CI image version has not run or been independently confirmed in this workspace.

Added isolated commands in `server/package.json`:

- `npm run test:unit` runs the database-free suite; it passed **29 tests**, with the optional PostgreSQL test file skipped.
- `npm run test:postgres:migrations` requires `BAYSIGNAL_TEST_DB_CONFIRMATION=EPHEMERAL-POSTGRES`, and provisions four disposable databases on the explicitly supplied loopback PostgreSQL admin URL. It independently checks fresh deployment, old-schema adoption with retained legacy rows, drift detection before baseline resolution, and prepares the integration database. It did not run because no PostgreSQL service exists locally.
- `npm run test:postgres:integration` requires the same confirmation, an explicit opt-in, and a loopback URL whose database is exactly `baysignal_test_integration`. Both wrapper and test suite enforce loopback host, port 5432, exact database name, and reject URL overrides. Its real PostgreSQL tests cover database triggers/constraints, gate-event transitions, evidence reconciliation, tenant-scoped HTTP routes, authorized and denied corrections, audit atomicity and rollback.

`.github/workflows/postgres-integration.yml` provisions a disposable PostgreSQL 16 service with test-only credentials and runs the three steps above; this workflow has not run in this environment. `server/prisma/baseline-schema.prisma` captures the pre-Phase-2 schema for migration-path comparison. The manual production-migration workflow now runs `prisma migrate diff --from-url ... --to-schema-datamodel prisma/baseline-schema.prisma --exit-code` before resolving the baseline for existing-schema adoption, so an observed schema difference stops that workflow before migration history changes.

Static review found the visit SQL trigger did not validate the inbound event or prevent relinking an already exited visit. The forward migration now checks that a visit's inbound event is verified, inbound, and matches facility, vehicle reference and timestamp; it also rejects outbound events before entry and changes to an exited visit's close event/time. These SQL additions are covered by source-level assertions, but remain **unverified against PostgreSQL** until the CI or local disposable integration run passes.

## Tenant authorization

`server/src/tenantAccess.js` is the access policy used by facilities, reservations, devices, alerts, analytics, simulation, voice, Socket.IO and operations routes.

| Role/grant | Scope |
|---|---|
| `PLATFORM_ADMIN` | Platform-wide access; never assignable through public registration. A one-time controlled bootstrap promotes a selected existing account and writes an audit event. |
| `ORG_ADMIN` membership | All facilities assigned to that organization. |
| `FACILITY_MANAGER` | Granted facility operations, reservation management, device/alert reads, analytics, corrections and audit access. |
| `ATTENDANT` | Granted facility operations, reservations/check-in and alert reads; bay correction requires manager authority. |
| `FINANCE` | Granted finance/report scope only. It does not receive reservation PII through the operations reservation API. |
| `DEVICE_TECHNICIAN` | Granted device and alert read scope; device ingestion still requires the device key. |
| `DRIVER` | Own reservation data; may browse/book a facility only when explicitly public or explicitly granted. |
| `VIEWER` | Granted facility read scope. |

Legacy `OWNER` and `ADMIN` account roles do not grant tenant access. Existing facilities keep `organizationId = NULL`; no owner or facility assignment was guessed. They remain inaccessible to tenant users until a platform administrator maps them with a reason. Organization membership requires an existing account; public self-registration still creates only `DRIVER` accounts. Facility transfers are blocked pending a separate audited workflow.

The one-time platform administrator bootstrap is `npm run admin:bootstrap-platform` in `server/`. It requires a selected existing account, a reason and an explicit confirmation variable; it was not run. Public registration cannot assign platform access.

## Presence, evidence and reconciliation

- `processVerifiedGateEvent` is an internal service for a future trusted gate adapter. A verified inbound event opens a visit; matching verified outbound events close it only when event time is not before entry. Duplicate source/deduplication IDs do not create another event/session. Unverified, unmatched, conflicting or out-of-order events remain for review.
- No gate/ANPR endpoint calls that service today. There is no verified ANPR or camera integration, so no visit/session history was fabricated. The visits read endpoint exposes existing ledger rows only.
- A bay vacancy does not close a facility visit. Visit bay association is a separate optional field. Reservations remain planning records; check-in/out change and audit reservation status only and do not synthesize a facility visit or sensor observation.
- The Raspberry Pi payload path now stores `DEVICE_REPORT` observations and device health but does not treat those reports as verified physical bay evidence or mutate bay occupancy. Confidence is stored only when supplied. The simulator is marked as simulation and records its bay observation and audit event in the same transaction.
- Evidence reconciliation trusts only `BAY_SENSOR`, `OVERHEAD_CAMERA` and `ATTENDANT` evidence for physical bay state. Reservations, ANPR, generic device reports and simulation are excluded by default. Stale evidence yields `UNKNOWN`; current contradictory sources open a discrepancy without selecting a winner. The reconciler endpoint is facility-manager scoped.
- Manual bay correction requires an open bay discrepancy, an authenticated facility manager, a target state and a reason. The correction, attendant evidence, discrepancy resolution and audit row are written in one transaction. The legacy direct slot-status endpoint remains disabled.
- Vehicle references are intended to be keyed non-reversible references; raw plate strings and images are not stored in the new visit ledger. Existing `Reservation.vehicleNumber` remains in the legacy schema and was not migrated or copied into session rows.

## Audit history

The `AuditEvent` row stores actor user or system, action, scoped resource, reason and before/after JSON. Audited transactional paths include platform bootstrap, organization/facility assignment, membership/facility grants, public-booking settings, reservation lifecycle, bay corrections, discrepancy opening, simulator changes, device threshold alerts, and verified visit open/close.

PostgreSQL triggers reject ordinary `UPDATE` and `DELETE` statements on audit rows. This is append-only protection at the database trigger layer, not cryptographic immutability: a database owner can change the schema, drop the trigger or otherwise tamper with the database. No hash chain is implemented.

## Phase 1 UI retained

- `shift_login_redesigned` → `/login`, with no prefills or public admin registration.
- `live_parking_operations_final` → `/dashboard/map`, API data, bay symbols, reservation holds, unknown/conflict states and explicit simulation controls.
- Device records and alerts remain API-backed. Analytics/revenue/environment/forecast screens show unavailable states while their report sources remain synthetic or unvalidated.
- Auth responses now include facility permission summaries; routes, navigation, search, simulation actions and socket joins use these permissions.

## Verification performed

- `npm run test:unit` in `server/`: **29 passed, 0 failed, 1 optional PostgreSQL test skipped**. Tests cover config/seed policy, tenant boundary filtering, public/platform roles, delayed and conflicting evidence, raw-plate rejection, facility-visit transitions, duplicate transition decisions and migration safety properties.
- `node --check` on changed server modules and the bootstrap script: passed.
- `npx prisma validate` with a temporary placeholder `DATABASE_URL`: passed. No database connection was made.
- `npx prisma migrate diff --from-schema-datamodel prisma/baseline-schema.prisma --to-schema-datamodel prisma/schema.prisma --script`: passed, confirming both checked-in datamodels parse and produce a forward diff without connecting to a database.
- `npx prisma generate`: passed locally.
- Prisma `migrate diff` from the old schema to the new schema matched the generated/managed section of the forward migration; custom PostgreSQL trigger/constraint SQL is reviewed statically only.
- `npm run build` in `client/`: passed.
- `git diff --check`: no whitespace errors in code/migration changes; Git reports line-ending notices on edited files and the existing extra blank line at `README.md:204`.
- `node --check scripts/test-postgres-migrations.js`, `node --check scripts/run-postgres-integration.js` and `node --check test/postgres.integration.test.js`: passed.
- PostgreSQL migration and service/route integration suites: **not run**; the guarded commands refused to start without explicit test database targets, and no local server is available. The CI workflow is prepared but has not run.
- No lint script exists. No browser/device visual test ran.

## Latest continuation audit (2026-10-16)

- Actual branch is `feature/baysignal-production-implementation`, at `d7e2e13199705fcbd36a4bbbd64bc2b6b0438689`; the local branch currently points to the same commit as `origin/main`. No changes are staged; Phase 1/2 implementation files and product documents remain uncommitted in the worktree.
- GitHub CLI is not installed. The connected GitHub repository metadata request returned 404, so repository visibility and the authenticated GitHub username could not be verified. No commit, push, or workflow dispatch was attempted.
- Tightened both PostgreSQL test entry points to require `BAYSIGNAL_TEST_DB_CONFIRMATION=EPHEMERAL-POSTGRES`, loopback host, port 5432, exact test database names, and no URL query/fragment overrides. The integration test file repeats the target checks as a backstop. Local guard checks rejected external database hosts before connecting.
- Updated the README's feature and demo descriptions to reflect unavailable reports, explicit simulation evidence, and the absence of a production gate/ANPR adapter.
- Re-ran `npm run test:unit` in `server/`: **29 passed, 0 failed, 1 optional PostgreSQL suite skipped**. `npm run build` in `client/`, `node --check` for JavaScript under server `src/`, `scripts/` and `test/`, `npx prisma validate`, `npx prisma generate`, and Prisma schema-diff generation all passed. `git diff --check` passed with only Git line-ending notices.
- PostgreSQL 16 integration and migration suites remain unrun. The existing CI workflow is configured for `workflow_dispatch` and `pull_request`; a feature-branch manual dispatch requires authenticated GitHub access that is currently unavailable.

## Continuation verification (2026-10-16)

- GitHub CLI is installed and authenticated as `goravgumber`; the GitHub API confirms `goravgumber/SmartPark-AI` is private. The feature branch still starts at `d7e2e13199705fcbd36a4bbbd64bc2b6b0438689`. No commit or push has been made yet.
- PostgreSQL service `postgresql-x64-18` is running. Its native client reports PostgreSQL 18.6, and `pg_isready` reports `127.0.0.1:5432` accepting connections. The harness has no major-version restriction, but requires admin access and drops/recreates the fixed databases `baysignal_test_fresh`, `baysignal_test_adoption`, `baysignal_test_drift`, and `baysignal_test_integration`. Credentials are unknown and the contents/ownership of those names have not been established as disposable, so no database connection or local PostgreSQL test was attempted. No PostgreSQL version support claim is made from static inspection alone.
- The CI workflow uses an ephemeral `postgres:16` service, fixed test-only credentials, and the guarded harness. Its workflow file is not present on the default branch yet, so GitHub does not list it until the feature branch is published; it can then be manually dispatched against that branch. Workflow logs do not explicitly print environment variables or connection strings; scripts use generic target-guard messages and the test credentials are confined to the disposable service.
- Current verification: `npm.cmd run test:unit` **29 passed, 0 failed, 1 skipped** (30 total); `npm.cmd run build` passed; all JavaScript files under `server/src`, `server/scripts` and `server/test` passed `node --check`; Prisma 5.22 validation, client generation and baseline-to-current schema diff passed using a placeholder URL without connecting; `git diff --check` passed with Windows line-ending notices only. PowerShell blocked the `npm.ps1` shim, so checks were run through `npm.cmd`/`npx.cmd`.
- PostgreSQL migration and service/route integration results remain **unverified**. No commit, push, workflow dispatch, migration, seed, bootstrap, deployment or merge has occurred at the time of this note.

## Remaining risks and next slice

- Existing production schema has not been inspected. Baseline adoption is blocked until an operator compares a backup/schema-only dump against the baseline. Migration SQL has not run on PostgreSQL here.
- All existing facilities/users need explicit organization and membership mapping. Until that is completed, former owner/admin users will have no facility data access by design. Bootstrap a platform administrator through the controlled one-time script first.
- Gate/ANPR adapters, bay sensors/camera calibration, raw-source verification, evidence freshness policy, gate lane configuration, and hardware credentials remain external work. No model accuracy, payment, SMS or camera capability is claimed.
- The migration-path harness and PostgreSQL HTTP/service suite need a successful CI run against PostgreSQL 16 before their checks can be called verified. Unit/state tests do not prove transaction behavior.
- The next slice is: run `.github/workflows/postgres-integration.yml` and resolve any PostgreSQL failures; then have the database owner review a backup/schema-only dump of the existing database before choosing the guarded migration workflow mode.

No migration, seed, external service call, deployment, commit, push, merge or credential rotation was performed.
