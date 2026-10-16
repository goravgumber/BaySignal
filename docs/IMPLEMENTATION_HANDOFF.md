# BaySignal Implementation Handoff

Entries below are chronological. Later dated continuation entries supersede earlier status snapshots.

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

The workflow also requires `APPLY-MIGRATIONS`. It is manual and was not run against production. No production or local database migration/seed was executed. The disposable PostgreSQL CI migration tests described below did run; they do not replace the pending live-schema comparison.

## Phase 2.1 PostgreSQL validation status

The local environment has PostgreSQL 18.6 listening on loopback, but its admin credentials and fixed-name test database contents are unknown; it was not connected to. No ambient database URL or credentials were read. PostgreSQL **16** is the verified zero-cost CI service target.

Added isolated commands in `server/package.json`:

- `npm run test:unit` runs the database-free suite; CI reports **31 tests passed**, with the optional PostgreSQL test file skipped.
- `npm run test:postgres:migrations` requires `BAYSIGNAL_TEST_DB_CONFIRMATION=EPHEMERAL-POSTGRES`, and provisions four disposable databases on the explicitly supplied loopback PostgreSQL admin URL. It checks fresh deployment, old-schema adoption with retained legacy rows, drift detection before baseline resolution, and prepares the integration database. All three migration paths passed against the isolated PostgreSQL 16 CI service.
- `npm run test:postgres:integration` requires the same confirmation, an explicit opt-in, and a loopback URL whose database is exactly `baysignal_test_integration`. Both wrapper and test suite enforce loopback host, port 5432, exact database name, and reject URL overrides. Its real PostgreSQL tests cover database triggers/constraints, gate-event transitions, evidence reconciliation, tenant-scoped HTTP routes, authorized and denied corrections, audit atomicity and rollback.

`.github/workflows/postgres-integration.yml` provisions a disposable PostgreSQL 16 service with test-only credentials and runs the three steps above; the workflow passed on GitHub Actions. `server/prisma/baseline-schema.prisma` captures the pre-Phase-2 schema for migration-path comparison. The manual production-migration workflow now runs `prisma migrate diff --from-url ... --to-schema-datamodel prisma/baseline-schema.prisma --exit-code` before resolving the baseline for existing-schema adoption, so an observed schema difference stops that workflow before migration history changes.

Static review found the visit SQL trigger did not validate the inbound event or prevent relinking an already exited visit. The forward migration now checks that a visit's inbound event is verified, inbound, and matches facility, vehicle reference and timestamp; it also rejects outbound events before entry and changes to an exited visit's close event/time. These SQL changes passed the PostgreSQL 16 migration and integration workflow.

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

- GitHub CLI is installed and authenticated as `goravgumber`; the GitHub API confirms `goravgumber/SmartPark-AI` is private. The feature branch was committed and pushed at `09f63de3c143effc1bfe8c61e381df4c814c67c7`; it contains the implementation and this handoff before the final workflow-dispatch result was recorded.
- PostgreSQL service `postgresql-x64-18` is running. Its native client reports PostgreSQL 18.6, and `pg_isready` reports `127.0.0.1:5432` accepting connections. The harness has no major-version restriction, but requires admin access and drops/recreates the fixed databases `baysignal_test_fresh`, `baysignal_test_adoption`, `baysignal_test_drift`, and `baysignal_test_integration`. Credentials are unknown and the contents/ownership of those names have not been established as disposable, so no database connection or local PostgreSQL test was attempted. No PostgreSQL version support claim is made from static inspection alone.
- The CI workflow uses an ephemeral `postgres:16` service, fixed test-only credentials, and the guarded harness. Its workflow file is not present on the default branch yet, so GitHub does not list it until the feature branch is published; it can then be manually dispatched against that branch. Workflow logs do not explicitly print environment variables or connection strings; scripts use generic target-guard messages and the test credentials are confined to the disposable service.
- Current verification: `npm.cmd run test:unit` **29 passed, 0 failed, 1 skipped** (30 total); `npm.cmd run build` passed; all JavaScript files under `server/src`, `server/scripts` and `server/test` passed `node --check`; Prisma 5.22 validation, client generation and baseline-to-current schema diff passed using a placeholder URL without connecting; `git diff --check` passed with Windows line-ending notices only. PowerShell blocked the `npm.ps1` shim, so checks were run through `npm.cmd`/`npx.cmd`.
- A manual dispatch was attempted with `gh workflow run postgres-integration.yml --ref feature/baysignal-production-implementation`; GitHub returned HTTP 404 because the workflow is not registered on the default branch. The workflow currently triggers on `workflow_dispatch`, `pull_request`, and pushes to `main`; there is no feature-branch push trigger. GitHub's documented `workflow_dispatch` behavior requires the workflow file to exist on the default branch, so no run was created. No PostgreSQL job result or run URL exists.
- PostgreSQL migration and service/route integration results remain **unverified**. No database connection, migration, seed, bootstrap, deployment, merge, or push to `main`/`develop` occurred. The workflow-trigger blocker must be resolved before another commit/push: make the workflow available on the default branch through the repository's approved process, or explicitly authorize adding a feature-branch push trigger and publishing that trigger change.

## Production-readiness continuation (2026-10-16)

- Starting state: branch `feature/baysignal-production-implementation`, commit `09f63de3c143effc1bfe8c61e381df4c814c67c7`, with the prior handoff correction as the only uncommitted user change. Remote branch was at the same commit. `main` is the default and `develop` does not exist; four other feature branches exist. No PR was open. GitHub CLI was authenticated as `goravgumber`, and the repository API reported `private: true`.
- Added the feature-branch push trigger, limited pull-request runs to `main`, and set workflow token permissions to `contents: read` (`8dce40c`). Added a separate quality job for client build, Prisma validation/generation, production dependency audits, and unit tests (`3cdc5ae`). The workflow successfully ran on feature push; GitHub's manual dispatch limitation is no longer a blocker.
- PostgreSQL 16 workflow run [38847453106](https://github.com/goravgumber/SmartPark-AI/actions/runs/38847453106) completed successfully at commit `e5c188a14ff1520c77201b003b0077d3b2215920`. Both `quality` and `postgres` jobs passed. The quality job installed both lockfiles, built the client, validated/generated Prisma, passed both `npm audit --omit=dev` checks, and reported **29 unit tests passed, 0 failed, 1 optional PostgreSQL suite skipped** (30 total). The PostgreSQL job passed the fresh-empty migration path, adoption of the exact legacy schema while retaining data, schema-drift refusal before baseline resolution, and **6 integration tests passed, 0 failed, 0 skipped**. This was an ephemeral PostgreSQL 16 Actions service, not a local or production database.
- An earlier run at `3cdc5ae` had a failed quality job because its checked-in client lockfile still resolved an audited React Router version; its PostgreSQL job passed. Updated React Router to 7.18.4 and pinned transitive `qs` to 6.16.1 in `e5c188a`; the subsequent quality and PostgreSQL jobs both passed. The current production dependency audits report zero vulnerabilities. Full audits still report development-only advisories in `braces` (server and Tailwind/client), and client build tooling (`esbuild`/Vite and PostCSS selector parsing); `braces` has no patched release in the reviewed advisory. See `SECURITY_REVIEW.md`.
- Local PostgreSQL 18.6 is running and accepting loopback connections, but the database harness has four destructive fixed-name targets whose ownership/contents are unknown and credentials are not known. It was not connected to. PostgreSQL 18 compatibility therefore remains unverified; PostgreSQL 16 CI passed.
- Additional local checks after the passing run: `npm.cmd run test:unit` **31 passed, 0 failed, 1 skipped** (32 total, including two error-response/logging tests); client build passed; all JavaScript under `server/src`, `server/scripts`, and `server/test` passed `node --check`; Prisma validation, generation and schema diff passed with a placeholder URL; production dependency audits passed; `git diff --check` passed. The later successful push/PR runs on commit `74f858d` also cover the error-log changes and security/operations documents.
- Security review found the old fixed demo-account password and weak JWT fallback in Git history and still present on the unmerged `main` base. The repository is private now, but historical visibility is unverified and a checked-in discovery report says it was public. Treat the demo password as exposed. No production DB or secrets were inspected; whether those accounts/key were ever used in a live environment is unknown. The owner must reset/disable demo accounts and rotate deployed JWT signing keys before a pilot. The device credential is global rather than per-device and has no request replay protection. Socket room authorization passed the PostgreSQL suite on commit `74f858d4`.
- Added `SECURITY_REVIEW.md` and `PRODUCTION_OPERATIONS.md` with the review findings, credential-rotation plan, migration/backup procedure, and operational limitations. Render's blueprint sets `autoDeploy: true`; the service's configured branch/current deployed commit were not checked. No deployment was initiated. Render's free PostgreSQL plan cannot meet production retention/backup needs; see the linked current provider documentation in the operations guide.
- GitHub branch-protection API returned HTTP 403 because the private repository plan does not expose that feature. Workflow token permissions are read-only, but mandatory PR reviews/status checks are not verified as configured. The main-plus-feature-PR model is used; no `develop` branch was created.
- The earlier status above was superseded by the verification updates below. The feature branch and its draft PR are published; no migration, seed, administrator bootstrap, production service call, deployment, merge, or `main`/`develop` push occurred.

## Latest verification update (2026-10-16)

- Latest implementation source commit: `74f858d4a82ccb58fa194f702e05db6251c5f23d`; subsequent commits through `46c1100435b0f7619f5375d10db59103e824ce6d` are documentation-only. The feature remote matches. The PR is [#1, draft, against `main`](https://github.com/goravgumber/SmartPark-AI/pull/1); it is open and not merged.
- The latest push run [38848152921](https://github.com/goravgumber/SmartPark-AI/actions/runs/38848152921) and PR run [38848156728](https://github.com/goravgumber/SmartPark-AI/actions/runs/38848156728) completed successfully on commit `46c1100435b0f7619f5375d10db59103e824ce6d`. Both `quality` and `postgres` jobs passed in each run.
- PostgreSQL 16 CI covered fresh-empty migration, legacy-schema adoption with data retained, schema-drift refusal before baseline history changes, audit/relational constraints, idempotent gate transitions, conflict reconciliation, correction authorization/rollback, HTTP tenant access, and Socket.IO authentication/room authorization. The integration command reported **7 passed, 0 failed, 0 skipped** (the suite wrapper plus six substantive subtests). The Socket.IO subtest rejected an invalid token, allowed the assigned manager room join, and denied the foreign-tenant join.
- Quality job reported **31 unit tests passed, 0 failed, 1 optional PostgreSQL test skipped** (32 total), client production build passed, Prisma validation/client generation passed, and production dependency audits found zero vulnerabilities. PostgreSQL integration ran separately and passed; the skipped unit-test item is not counted as a database test.
- Added a real in-process Socket.IO integration path by moving socket authentication/facility-room access checks into `server/src/socketAccess.js`; this enables testing the actual handshake and database-backed room authorization. The test uses only the ephemeral CI database/service.
- Production and security documents now record that the old demo credential/JWT fallback remain in history, the owner must review/reset/rotate any affected live demo accounts and JWT key, device auth remains one shared global key without replay resistance, and current free Render PostgreSQL is unsuitable for production backup/retention. No credentials were read or changed.
- Security review found one high-severity unpatched development-only `braces` advisory in each package tree plus moderate client build-tool advisories. `npm audit --omit=dev` is clean for both client and server; dev-only warnings remain documented in `SECURITY_REVIEW.md`.
- Local PostgreSQL 18 remains untested because admin credentials and contents of fixed destructive target databases are unknown. PostgreSQL 16 GitHub Actions is the verified database target. No production database connection, migration, seed, bootstrap, deployment, merge, or push to `main`/`develop` occurred.
- GitHub does not expose branch protection for this private repository plan (HTTP 403); draft PR review is still pending. Render's blueprint has `autoDeploy: true`; its configured branch/current deployed commit were not checked. No PR merge/deploy was attempted.

## Remaining risks and next slice

- Existing production schema has not been inspected. Baseline adoption is blocked until an operator compares a backup/schema-only dump against the baseline. Migration SQL was exercised only against disposable PostgreSQL 16 in CI, never against production or the local PostgreSQL 18 service.
- All existing facilities/users need explicit organization and membership mapping. Until that is completed, former owner/admin users will have no facility data access by design. Bootstrap a platform administrator through the controlled one-time script first.
- Gate/ANPR adapters, bay sensors/camera calibration, raw-source verification, evidence freshness policy, gate lane configuration, and hardware credentials remain external work. No model accuracy, payment, SMS or camera capability is claimed.
- A local PostgreSQL 18 run is still unverified; use CI PostgreSQL 16 results as the current database integration evidence. Unit/state tests do not replace the database suite.
- The next slice is: obtain human review on the feature-to-main PR, complete the historical credential rotation check, and design per-device revocable/replay-resistant ingestion before a real pilot. Existing-database adoption remains blocked on owner-reviewed backup and exact baseline comparison.

No local/production database connection, production migration, seed, administrator bootstrap, deployment, merge, push to `main`/`develop`, or credential rotation was performed during this continuation. GitHub API/Actions operations and feature-branch pushes are recorded above.
