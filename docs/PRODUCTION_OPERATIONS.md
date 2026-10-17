# BaySignal Deployment and Operations Readiness

BaySignal is a multi-tenant parking operations and auditable evidence platform. This document defines the operational procedures, evidence workflows, tenant onboarding, monitoring diagnostics, backup/recovery, and privacy inventory required to operate a controlled pilot with one real device at one pilot facility.

> [!WARNING]
> This runbook does NOT authorize a production deployment or live schema migration without explicit repository owner approval and environment verification.

---

## 1. Operating Model & Runtime Architecture

- **Database Engine:** PostgreSQL 16 is the verified automated integration target.
- **Runtime Configuration:**
  - `DATABASE_URL`: Connection string with TLS (`sslmode=require` in production). Must use a restricted application user role (no schema-dropping or superuser privileges).
  - `JWT_SECRET`: Random string of 32+ characters, stored strictly in provider secret manager.
  - `FRONTEND_URL`: Fully qualified HTTPS origin of the frontend web application.
  - `NODE_ENV`: `production` for deployed instances; enforces HTTPS, rate limiting, and disables simulation shortcuts.
  - `TRUST_PROXY`: `true` only when running behind a single-hop trusted reverse proxy (e.g., Render, Nginx, Cloudflare).
  - `PORT`: Server listening port (default: 4000).
  - `ALLOW_LEGACY_DEVICE_API_KEY`: `false` by default. If enabled for migration, requires `LEGACY_DEVICE_API_KEY` and `LEGACY_DEVICE_API_KEY_EXPIRES_AT` (< 30 days away).
- **Client Configuration:** `VITE_API_URL` (HTTPS) and `VITE_WS_URL` (WSS).
- **Secret Hygiene:** Never commit secrets to `.env.example`, Git history, Dockerfiles, or log sinks.

---

## 2. Tenant and Facility Administrative Onboarding Plan

Legacy facilities in BaySignal intentionally have `organizationId = NULL` upon migration adoption and remain inaccessible to ordinary tenant users until a platform administrator explicitly maps them.

### Administrative Onboarding Procedure:
1. **Bootstrap Platform Administrator (One-Time Only):**
   - The repository owner selects an existing user account.
   - Runs `npm run admin:bootstrap-platform` with explicit confirmations:
     ```bash
     PLATFORM_ADMIN_EMAIL="owner@example.com" \
     PLATFORM_ADMIN_BOOTSTRAP_REASON="Authorized platform bootstrap for pilot rollout" \
     PLATFORM_ADMIN_BOOTSTRAP_CONFIRM="GRANT-PLATFORM-ADMIN" \
     npm run admin:bootstrap-platform
     ```
   - Transaction promotes the account and creates an append-only `AuditEvent`.
2. **Create Organization:**
   - Platform admin calls `POST /api/tenants/organizations` with `{ "name": "Pilot Parking Operator", "slug": "pilot-operator" }`.
   - Creates `Organization` and logs `ORGANIZATION_CREATED` audit event.
3. **Map Existing Facility to Organization:**
   - Platform admin calls `POST /api/tenants/facilities/:facilityId/organization` with:
     ```json
     {
       "organizationId": "<org-uuid>",
       "reason": "Assigning Downtown Lot 1 to Pilot Parking Operator for Phase 4 pilot"
     }
     ```
   - Validates facility is currently unassigned; prevents accidental transfers; logs `FACILITY_ASSIGNED_TO_ORGANIZATION`.
4. **Appoint Organization & Facility Members:**
   - Platform admin creates Organization Admin: `POST /api/tenants/organizations/:id/memberships` with role `ORG_ADMIN`.
   - Org Admin or Platform Admin grants Facility Manager or Attendant role:
     ```json
     {
       "userId": "<user-uuid>",
       "role": "FACILITY_MANAGER",
       "facilityId": "<facility-uuid>",
       "reason": "Assigning facility manager for pilot facility operations"
     }
     ```
   - Records `MEMBERSHIP_CREATED` and `FACILITY_ACCESS_GRANTED` audit events.

### Dry-Run Verification Tool (`onboarding-dry-run.js`)
Operators can simulate an onboarding plan before executing privileged writes:
```bash
# 1. Inspect unassigned facilities and unmapped users:
npm run tenant:dry-run

# 2. Dry-run a proposed onboarding mapping file:
ONBOARDING_PLAN_FILE=./onboarding-plan.json npm run tenant:dry-run
```
The dry-run script verifies that facilities exist and are unassigned, organizations and users exist, grants are valid, and no tenant cross-contamination occurs. No database writes are executed.

---

## 3. One-Device, One-Facility Evidence Workflow

The application explicitly distinguishes raw device telemetry from verified physical occupancy truth. Gate/ANPR and camera integrations are not live and must not be simulated as verified hardware.

### Event Path: One Sensor/Device to Physical Occupancy
```text
[ Physical Sensor / Raspberry Pi ]
               │
               │ 1. Signs payload with local Ed25519 private key (chmod 600)
               ▼
[ Authenticated Ingestion: POST /api/devices/:id/observations ]
               │
               │ 2. Verifies signature, timestamp (±300s), deviceId, and UUID replay guard
               ▼
[ Validated BayObservation Record ]
               │
               │ 3. Stored with source: 'DEVICE_REPORT', confidence, and deduplicationKey
               │    (NOTE: DEVICE_REPORT alone is NOT trusted physical evidence!)
               ▼
[ Evidence Reconciler: POST /api/operations/slots/:id/reconcile ]
               │
               │ 4. Evaluates usable evidence from trusted sources:
               │    ['BAY_SENSOR', 'OVERHEAD_CAMERA', 'ATTENDANT']
               │    (DEVICE_REPORT is contextual telemetry; stays excluded unless policy elevates)
               ▼
  ┌────────────────────────────┬────────────────────────────┐
  ▼                            ▼                            ▼
[ Consistent Truth ]   [ Stale / No Data ]       [ Contradictory Evidence ]
Updates ParkingSlot    Preserves 'UNKNOWN'       Creates Discrepancy:
status: AVAILABLE/     status; flags for         BAY_EVIDENCE_CONFLICT
OCCUPIED + AuditEvent  attendant check           with linked observations
                                                            │
                                                            │ 5. Attendant Review
                                                            ▼
                                                 [ POST /api/operations/discrepancies/:id/resolve ]
                                                 Attendant submits reasoned correction + AuditEvent
```

### Distinct Gate Entry/Exit Workflow (Future Trusted Adapter)
Gate events follow a strictly isolated lifecycle through internal service `processVerifiedGateEvent`:
- Entry: `GateEvent` (INBOUND, VERIFIED) opens a `FacilityVisit`. It records vehicle presence at the facility.
- **Rule:** A gate entry event **never** establishes an individual bay's occupancy.
- Exit: Matching `GateEvent` (OUTBOUND, VERIFIED) closes the `FacilityVisit`.
- **Rule:** Bay vacancy **never** closes a facility visit.
- Duplicate gate events with the same `deduplicationKey` are idempotent and do not create duplicate visits.

---

## 4. Monitoring, Diagnostics, and Incident Response

### Health & Diagnostic Endpoints

| Endpoint | Access | Purpose |
|---|---|---|
| `GET /health` | Public | **Liveness:** Process uptime, current server timestamp, status. |
| `GET /health/ready` | Public / Monitoring | **Readiness:** Verifies database connectivity (`SELECT 1`). Returns 200 `{ status: 'ready' }` or 503 `{ status: 'not_ready' }`. |
| `GET /api/devices/diagnostics` | `FACILITY_MANAGER`, `DEVICE_TECHNICIAN` | **Device Telemetry:** Ping age (s), reporting status (`ONLINE` < 300s, `STALE` 300–900s, `OFFLINE` > 900s), active/revoked key count. |
| `GET /api/operations/audit` | `PLATFORM_ADMIN`, `ORG_ADMIN`, `FACILITY_MANAGER` | **Audit Trail:** Append-only ledger of all privileged changes, device registrations, corrections, and alerts. |

### Operator Diagnostic Matrix

| Failure Symptom | Diagnostic Tool / Log Event | Root Cause & Resolution |
|---|---|---|
| **Device stopped reporting** | `GET /api/devices/diagnostics` reports `STALE` or `OFFLINE` | Check device network, power, local logs at `/var/log/baysignal.log`. Verify device process is running. |
| **Signature rejected / 401** | `logDiagnostic('device_auth_rejected', { reason: 'invalid_signature' })` | Key mismatch or tampering. Verify public key in database matches private key on Pi. Re-issue credential if necessary. |
| **Timestamp out of window** | `logDiagnostic('device_auth_rejected', { reason: 'timestamp_out_of_window', deltaSeconds })` | Raspberry Pi system clock drift. Ensure NTP/systemd-timesyncd is synchronized on device (`timedatectl`). |
| **Replayed request / 409** | `logDiagnostic('device_request_replay_rejected', { deviceId })` | Network retry or duplicate UUID. Ensure agent generates unique UUID per transmission attempt. |
| **Credential revoked** | `logDiagnostic('device_auth_rejected', { reason: 'credential_not_found_or_revoked' })` | Credential was revoked via API. Follow key rotation runbook to re-enroll device with a new keypair. |
| **Database connectivity failure** | `GET /health/ready` returns 503; `logDiagnostic('readiness_check_failed')` | PostgreSQL unreachable. Check hosting database status, connection limits, and network ingress. |
| **Cross-tenant access denial** | Express 403 response; `logDiagnostic('tenant_access_denied')` | User lacks active membership or facility grant. Operator must review tenant access assignments. |

### Redacted Diagnostic Logging
Server logs use structured JSON formatting via `logDiagnostic` (`server/src/safeLogging.js`). All keys matching `/secret|token|password|auth|key|signature|body|rawBody|hash|digest|private/i` are automatically masked with `[REDACTED]`. Never attach raw payloads or tokens to diagnostic tickets.

### Graceful Shutdown
Upon receiving `SIGTERM` or `SIGINT`, the server:
1. Stops accepting new HTTP connections (`httpServer.close()`).
2. Drains active Socket.IO connections.
3. Disconnects Prisma database pool (`prisma.$disconnect()`).
4. Exits with status code 0.

---

## 5. Backup, Integrity, and Recovery Runbook

> [!CAUTION]
> Render's free PostgreSQL tier does not support automated backups or point-in-time recovery and expires after 30 days. A funded database plan is mandatory for pilot data retention.

### Database Backup Procedure
Logical backup using native PostgreSQL tools:
```bash
# 1. Execute custom-format compressed backup:
pg_dump -h <HOST> -p 5432 -U <BACKUP_USER> -d <DB_NAME> -F c -b -v -f baysignal_backup_$(date +%Y%m%d_%H%M%S).dump

# 2. Generate SHA-256 integrity checksum:
sha256sum baysignal_backup_*.dump > baysignal_backup_$(date +%Y%m%d_%H%M%S).sha256

# 3. Store in access-controlled, encrypted offsite object storage.
```

### Isolated Restore Verification Procedure (Disposable Target Only)
```bash
# 1. Verify file checksum:
sha256sum -c baysignal_backup_*.sha256

# 2. Restore into a disposable, isolated test database (NEVER into live DB):
createdb -h localhost -p 5432 -U postgres baysignal_restore_test
pg_restore -h localhost -p 5432 -U postgres -d baysignal_restore_test -v baysignal_backup_*.dump

# 3. Verify schema compatibility against checked-in baseline:
npx prisma migrate diff \
  --from-url postgresql://postgres:password@localhost:5432/baysignal_restore_test \
  --to-schema-datamodel server/prisma/schema.prisma \
  --exit-code
```
*(Status note: Restore testing in live hosting environment remains unverified pending funded database provisioning).*

### Migration Preflight and Recovery Steps
1. Before running migrations, perform schema comparison against `server/prisma/baseline-schema.prisma`.
2. Deploy additive migration: `npx prisma migrate deploy`.
3. If migration fails:
   - Do **NOT** run blind down-migrations or raw SQL deletions.
   - Halt application traffic.
   - Database owner reviews migration log and executes forward repair migration or restores the verified pre-migration backup.

---

## 6. Pilot Data Inventory & Retention Policy

| Data Class | Purpose | Access Scope | Retention Owner | Deletion / Retention Rules | Backup Handling |
|---|---|---|---|---|---|
| **1. Account & Membership** | Authentication & RBAC | `PLATFORM_ADMIN`, User (self) | Service Owner | Retained for account lifetime. Deletion upon user request via reviewed admin flow. | Included in logical backups. Passwords hashed with bcrypt. |
| **2. Reservations & Legacy Vehicle No.** | Parking booking | `FACILITY_MANAGER`, Driver (self) | Operations Owner | Retained for 90 days post-completion; subject to owner retention policy decision. | Included in logical backups. Excluded from operations views for non-privileged roles. |
| **3. Device Identities & Public Keys** | Ed25519 authentication | `FACILITY_MANAGER`, `DEVICE_TECHNICIAN` | Hardware Tech Lead | Retained until device decommissioning. Private keys never stored. | Public keys backed up in PostgreSQL. Revoked keys kept for audit trail. |
| **4. Signed Request IDs / Nonces** | Replay attack prevention | System internal (`DeviceRequest`) | Security Lead | Auto-expires after 600 seconds; purged during subsequent accepted device requests. | Excluded from long-term archival. |
| **5. Facility Visits & Vehicle References** | Entry/exit presence ledger | `FACILITY_MANAGER`, Platform Admin | Compliance / Privacy Owner | 64-char pseudonymous hashes only. Raw plates prohibited. Default retention: 30 days (pending owner policy). | Included in encrypted database backups. |
| **6. Bay Observations & Discrepancies** | Occupancy evidence & reconciliation | `FACILITY_MANAGER`, Attendant | Operations Owner | Observations retained for 30 days. Discrepancies and resolution notes retained for 1 year. | Included in database backups. Excluded from raw telemetry dumps. |
| **7. Audit Records & Diagnostic Logs** | Non-repudiation & forensic review | `PLATFORM_ADMIN`, `ORG_ADMIN`, `FACILITY_MANAGER` | Security & Compliance Owner | Append-only via DB triggers. Retained for 365 days. Never deleted through application API. | Included in encrypted backups. Diagnostic logs to stdout stripped of secrets. |

> [!NOTE]
> Retention periods marked above represent recommended pilot defaults. Final operational retention periods must be formally approved by the repository owner before commencing pilot operations.

---

## 7. Pilot Rollback and Emergency Stop Criteria

### Immediate Pilot Abort Triggers:
1. **Cryptographic Key Compromise:** Any evidence that a device private key was exposed or logged.
2. **Data Corruption Storm:** Automated observation ingestion creates conflicting discrepancy loops on > 20% of bays.
3. **Database Unavailability:** Database connection failures or transaction timeouts exceeding 5 minutes.
4. **Tenant Isolation Breach:** Any authorization failure that leaks resources across tenant boundaries.

### Emergency Device Isolation Procedure:
If a device misbehaves or reports corrupted data:
1. Revoke active credential immediately: `POST /api/devices/:id/credentials/:credentialId/revoke`.
2. Disable device ingestion: update `Device` setting `ingestionEnabled = false`.
3. Set device status: `status = 'MAINTENANCE'`.
4. Power off physical Raspberry Pi hardware.
