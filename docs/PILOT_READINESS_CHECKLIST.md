# BaySignal Pilot Readiness Checklist

This document establishes the explicit operational, security, and technical gates required before launching a controlled pilot of BaySignal with one real device at one pilot facility.

Each checklist item is categorized under one of four statuses:
- **`verified`**: Code, configuration, or test path is implemented, verified in automated suites/CI, and statically confirmed.
- **`pending owner action`**: Software is prepared; requires human owner decision, secret rotation, dashboard verification, or policy approval.
- **`blocked`**: Hard prerequisite missing or prohibited until earlier gates pass.
- **`not applicable`**: Explicitly excluded from pilot scope with documented rationale.

---

## Gate 1: PR Review & Approved Merge Process

| Item | Status | Verification Evidence / Action Required |
|---|---|---|
| **1.1 Feature Branch Ancestry** | `verified` | Branch `feature/controlled-pilot-preparation` branched cleanly from `main` (`8c96d87`), which incorporates merged PR #1, PR #2, and PR #3. |
| **1.2 Clean Working Tree & Conventional Commits** | `verified` | Repository changes are scoped, atomic, and follow Conventional Commit conventions. No untracked junk or unreviewed cleanup commits. |
| **1.3 Human Review of Pull Request** | `pending owner action` | Code must be reviewed and approved by repository owner via GitHub Pull Request against `main`. No automated merge or direct pushes to `main`. |
| **1.4 GitHub Actions Integration Pass** | `verified` | Ephemeral PostgreSQL 16 CI workflow exercises Prisma schema, migrations, unit tests, client build, and production dependency audits. |
| **1.5 Branch Protection Enforcement** | `blocked` | Private repo plan does not support branch protection rules (HTTP 403). Relies on manual governance and owner discipline not to push directly to `main`. |

---

## Gate 2: Historical Credential Remediation

| Item | Status | Verification Evidence / Action Required |
|---|---|---|
| **2.1 Live Demo Account Audit** | `pending owner action` | Owner must verify whether historical demo accounts (`admin@smartpark.ai`, `driver@smartpark.ai`, `owner@smartpark.ai`) were ever seeded into any live or staging database. |
| **2.2 Demo Account Deactivation/Reset** | `pending owner action` | Owner must disable unused demo accounts or replace passwords with strong, randomly generated credentials in the target database. |
| **2.3 Historical JWT Secret Exposure** | `pending owner action` | Weak fallback secret exists in Git history. Owner must verify no active deployment uses historical values. |
| **2.4 JWT Secret Rotation & Session Invalidation** | `pending owner action` | Owner must generate a fresh 32+ character random `JWT_SECRET`, inject via hosting provider secrets store, and verify existing client sessions are invalidated. |
| **2.5 Git History Remediation Decision** | `pending owner action` | Owner must document whether repository rewrite (`git filter-repo` / BFG) is warranted or if secret rotation alone satisfies organizational security policy. |
| **2.6 Safe Environment Configuration** | `verified` | Runtime validator `validateRuntimeConfig` strictly fails closed if `JWT_SECRET` is missing or < 32 characters, or if `NODE_ENV=production` lacks HTTPS frontend origin. |

---

## Gate 3: Per-Device Credential Provisioning & Revocation

| Item | Status | Verification Evidence / Action Required |
|---|---|---|
| **3.1 Ed25519 Keypair Generation** | `verified` | Server generates cryptographically secure Ed25519 keypairs in `POST /api/devices/:id/credentials`. Private key returned once; only SPKI public key stored in PostgreSQL. |
| **3.2 Private Key Storage on Raspberry Pi** | `verified` | `raspberry_pi/smartpark_agent.py` supports secure file loading (`BAYSIGNAL_DEVICE_PRIVATE_KEY_PATH`) and checks POSIX file permissions (enforces `chmod 600`). |
| **3.3 Replay & Tamper Resistance** | `verified` | Canonical request bytes bind HTTP method, exact path/query, timestamp, UUID, and SHA-256 body hash. Unique `(deviceId, requestId)` database constraint rejects replays. |
| **3.4 Timestamp Skew Window** | `verified` | Timestamps validated within `±300 seconds` window. Verified in unit and integration test suites. |
| **3.5 Single-Device Revocation & Re-enrollment** | `verified` | Revoking a credential affects only that device. Replacement credential can be issued and tested before revoking the previous key. Fully audited in `AuditEvent`. |
| **3.6 Physical Hardware Key Installation** | `pending owner action` | Requires physical Raspberry Pi hardware to receive and protect key file at `/etc/baysignal/device_key.der`. |
| **3.7 Legacy Auth Sunset Plan** | `verified` | `ALLOW_LEGACY_DEVICE_API_KEY=false` by default. Requires explicit expiration timestamp < 30 days away. Production cutover strictly rejects unauthenticated legacy calls. |

---

## Gate 4: One Authorized Organization and Facility

| Item | Status | Verification Evidence / Action Required |
|---|---|---|
| **4.1 Safe Platform Administrator Bootstrap** | `pending owner action` | One-time controlled script `npm run admin:bootstrap-platform` must be run by owner with `PLATFORM_ADMIN_BOOTSTRAP_CONFIRM=GRANT-PLATFORM-ADMIN` for a specific email. |
| **4.2 Single Pilot Organization Creation** | `pending owner action` | Platform administrator creates exactly one pilot organization via audited `POST /api/tenants/organizations`. |
| **4.3 Explicit Facility Assignment** | `pending owner action` | Pilot facility assigned to pilot organization via `POST /api/tenants/facilities/:id/organization` with documented operational reason. |
| **4.4 Role-Scoped Operator Grants** | `pending owner action` | Facility manager and device technician granted access via `POST /api/tenants/organizations/:id/memberships`. |
| **4.5 Tenant Cross-Contamination Prevention** | `verified` | Tenant boundary middleware strictly isolates facilities, devices, reservations, observations, and socket rooms. Verified in PostgreSQL integration suite. |
| **4.6 Onboarding Dry-Run Verification** | `verified` | Safe utility `npm run tenant:dry-run` (`server/scripts/onboarding-dry-run.js`) validates proposed mappings and detects tenant crossovers without touching database. |

---

## Gate 5: Verified Backup and Restore

| Item | Status | Verification Evidence / Action Required |
|---|---|---|
| **5.1 Production Database Hosting Tier** | `blocked` | Render free-tier PostgreSQL expires in 30 days, has no managed backups, and is unsuitable. Requires funded database plan or external managed PostgreSQL. |
| **5.2 Logical Backup (`pg_dump`) Procedure** | `verified` | Documented in `PRODUCTION_OPERATIONS.md` using `pg_dump -Fc` with custom format and checksum generation. |
| **5.3 Isolated Restore Verification** | `pending owner action` | Backup restore must be exercised into an isolated, disposable database instance before live traffic. (Unverified until target DB is funded). |
| **5.4 Schema Drift Baseline Comparison** | `verified` | Automated migration preflight `prisma migrate diff --from-url ... --to-schema-datamodel prisma/baseline-schema.prisma` halts if unreviewed schema drift is found. |
| **5.5 Append-Only Audit Integrity** | `verified` | PostgreSQL triggers block `UPDATE` and `DELETE` on `AuditEvent`. Verified in integration tests. |

---

## Gate 6: Operator Onboarding & Recovery Training

| Item | Status | Verification Evidence / Action Required |
|---|---|---|
| **6.1 Named Roles and Responsibilities** | `pending owner action` | Owner must appoint named individuals: Service Owner, Database Owner, Backup Operator, and Facility Operator. |
| **6.2 Discrepancy Resolution Training** | `pending owner action` | Operator trained on manual discrepancy resolution flow: review conflict evidence, submit reason, verify transactional audit record. |
| **6.3 Device Key Rotation Runbook** | `verified` | Documented step-by-step in `PRODUCTION_OPERATIONS.md`. |
| **6.4 Emergency Stop & Revocation Training** | `pending owner action` | Operator trained to disable device ingestion or revoke credential via API immediately upon suspected tampering. |

---

## Gate 7: Hardware Integration & Evidence Verification

| Item | Status | Verification Evidence / Action Required |
|---|---|---|
| **7.1 Dedicated Device Observation Route** | `verified` | Implemented `POST /api/devices/:id/observations` with Ed25519 signing, replay protection, and `DEVICE_REPORT` provenance. |
| **7.2 Evidence Provenance Distinction** | `verified` | `DEVICE_REPORT` observations stored separately and excluded from physical occupancy truth by default. Only `BAY_SENSOR`, `OVERHEAD_CAMERA`, and `ATTENDANT` are trusted. |
| **7.3 Separation of Reservations & Physical Presence** | `verified` | Reservation holds do not modify bay physical state. Entry gate events do not establish individual bay occupancy. Verified in unit and integration suites. |
| **7.4 Physical Device Bench Test** | `pending owner action` | Requires physical bench testing of Raspberry Pi with camera/sensor on local network against staging server. |
| **7.5 Gate / ANPR Integration** | `not applicable` | Gate adapters and ANPR cameras are future integrations and explicitly excluded from Phase 4 pilot scope. |

---

## Gate 8: Privacy and Retention Ownership

| Item | Status | Verification Evidence / Action Required |
|---|---|---|
| **8.1 Pilot Data Inventory** | `verified` | All 7 data classes documented with purpose, scope, and storage mechanics in `PRODUCTION_OPERATIONS.md`. |
| **8.2 Vehicle Reference Keying Policy** | `verified` | Ledgers enforce 64-character pseudonymous vehicle references (`/^[a-f0-9]{64}$/i`). Raw plate strings and images are rejected from visit records. |
| **8.3 Operational Retention Period Approval** | `pending owner action` | Owner must approve operational retention windows (e.g., 30 days for observations, 90 days for audit records). |
| **8.4 Nonce/Replay Expiration** | `verified` | `DeviceRequest` records expire after 600s and are cleaned up during subsequent accepted device requests. |

---

## Gate 9: Monitoring, Diagnostics & Incident Response

| Item | Status | Verification Evidence / Action Required |
|---|---|---|
| **9.1 Liveness Health Endpoint** | `verified` | `GET /health` returns process uptime and status. |
| **9.2 Database Readiness Endpoint** | `verified` | `GET /health/ready` validates database connectivity (`SELECT 1`) and returns 503 if database is disconnected. |
| **9.3 Device Diagnostics Endpoint** | `verified` | `GET /api/devices/diagnostics` reports device ping age, reporting status (`ONLINE`, `STALE`, `OFFLINE`), and active/revoked credential counts. |
| **9.4 Redacted Diagnostic Logging** | `verified` | `logDiagnostic` in `server/src/safeLogging.js` automatically strips tokens, signatures, passwords, and raw request bodies. |
| **9.5 Graceful Process Shutdown** | `verified` | Signal handlers for `SIGTERM` and `SIGINT` drain HTTP connections, close Socket.IO, disconnect Prisma cleanly, and exit code 0. |
| **9.6 High-Threshold Device Alerts** | `verified` | CPU > 85% or Temperature > 78°C creates transactional `Alert` and `AuditEvent`, and broadcasts to facility socket room. |

---

## Gate 10: Rollback and Stop-Pilot Criteria

| Item | Status | Verification Evidence / Action Required |
|---|---|---|
| **10.1 Immediate Stop Criteria** | `verified` | Documented triggers for aborting pilot: duplicate observation corruption, database connection failure, unresolvable discrepancy storm, credential leak. |
| **10.2 Device Kill Switch** | `verified` | Ingestion can be immediately stopped per-device by setting `ingestionEnabled = false` or `status = 'MAINTENANCE'`, or by revoking credential. |
| **10.3 Facility Rollback Procedure** | `verified` | Unassigning facility from tenant requires explicit platform administrator database action. Forward migrations have no blind down-migrations. |
| **10.4 Post-Incident Postmortem Protocol** | `verified` | Incident triage, log preservation, and customer notification runbook documented in `PRODUCTION_OPERATIONS.md`. |

---

## Summary of Gate Statuses

| Category | Verified | Pending Owner Action | Blocked | Not Applicable | Total |
|---|---|---|---|---|---|
| Gate 1: PR Review & Merge | 3 | 1 | 1 | 0 | 5 |
| Gate 2: Credential Remediation | 1 | 5 | 0 | 0 | 6 |
| Gate 3: Device Authentication | 5 | 1 | 0 | 0 | 6 |
| Gate 4: Tenant Onboarding | 2 | 4 | 0 | 0 | 6 |
| Gate 5: Backup & Recovery | 3 | 1 | 1 | 0 | 5 |
| Gate 6: Operator Training | 1 | 3 | 0 | 0 | 4 |
| Gate 7: Hardware & Evidence | 3 | 1 | 0 | 1 | 5 |
| Gate 8: Privacy & Retention | 3 | 1 | 0 | 0 | 4 |
| Gate 9: Monitoring & Diagnostics | 6 | 0 | 0 | 0 | 6 |
| Gate 10: Rollback & Stop-Pilot | 4 | 0 | 0 | 0 | 4 |
| **TOTAL** | **31** | **17** | **2** | **1** | **51** |

> [!IMPORTANT]
> A physical pilot cannot be launched until all **17 Pending Owner Actions** are resolved and the **2 Blocked items** (funded database tier with automated backups; GitHub branch protection or strict manual merge process) are addressed.
