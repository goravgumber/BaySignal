# BaySignal Security Review

**Latest Review Date:** 2026-10-17 (Phase 4 Controlled Pilot Preparation)
**Initial Review Date:** 2026-10-16
**Scope:** Static review of application source, feature branch history, route/socket authentication paths, PostgreSQL migration and integration tests, deployment manifests, npm production dependency audits, and Python device signing. No production database, hosting environment, or physical hardware was accessed or modified.

---

## 1. Resolved in Repository Baseline (Phases 1–3)

- **Removed insecure defaults:** Eliminated development JWT fallback key and require explicitly configured signing keys of at least 32 characters (`server/src/config.js`). Production configuration requires a valid HTTPS frontend origin.
- **Removed prefilled demo credentials:** Demo seeding (`server/prisma/seed.js`) is opt-in, explicitly rejects `NODE_ENV=production`, and requires locally supplied credentials.
- **Tenant boundary enforcement:** Tenant-scoped authorization guards (`server/src/tenantAccess.js`) protect all facility, device, reservation, observation, and Socket.IO room endpoints. Legacy unmapped facilities remain inaccessible by design.
- **Redacted error handling:** Server errors return correlation request IDs. Exception message strings and stack traces are suppressed in HTTP responses and process-level logs (`server/src/safeLogging.js`).
- **Cryptographic device authentication:** Replaced shared static API key with per-device Ed25519 signatures. Server stores only public keys (SPKI DER base64url). One-time PKCS#8 DER private keys are exported directly to the authorized caller.
- **Replay resistance:** Requests require an exact canonical digest binding method, URL path/query, timestamp, request UUID, and raw request body SHA-256. Database-backed `(deviceId, requestId)` uniqueness rejects concurrent and serial replays.
- **Production dependency hygiene:** `npm audit --omit=dev` reports 0 vulnerabilities for both `client/` and `server/`.

---

## 2. Phase 4 Hardening: Diagnostic Safety & Controlled Pilot Foundations

- **Diagnostic log redaction:** Added `logDiagnostic` in `server/src/safeLogging.js` with automated regex scrubbing (`/secret|token|password|auth|key|signature|body|rawBody|hash|digest|private/i`). Diagnostic warnings for device rejection, timestamp drift, and replay attempts log correlation IDs while redacting credentials and payloads.
- **Dedicated observation ingestion endpoint:** Implemented `POST /api/devices/:id/observations` with full Ed25519 signature verification, replay protection, and `DEVICE_REPORT` provenance. Real pilot devices no longer depend on the development `/api/simulation/pi-payload` route.
- **Device diagnostics endpoint:** Added `GET /api/devices/diagnostics` calculating device reporting freshness (`ONLINE` < 300s, `STALE` 300–900s, `OFFLINE` > 900s) and active/revoked credential counts without exposing private or sensitive metadata.
- **Readiness check:** Added `GET /health/ready` verifying database connectivity via `SELECT 1` without revealing database credentials or connection parameters upon failure.
- **Graceful shutdown:** Implemented `SIGTERM` and `SIGINT` signal handlers in `server/src/index.js` to stop accepting requests, drain sockets, and disconnect Prisma cleanly before process termination.
- **Safe onboarding dry-run:** Added `server/scripts/onboarding-dry-run.js` allowing platform operators to simulate tenant and facility mappings and detect tenant crossovers without executing database writes.
- **Secure Raspberry Pi key loading:** Updated `raspberry_pi/smartpark_agent.py` to support `BAYSIGNAL_DEVICE_PRIVATE_KEY_PATH` with POSIX file permission checks (`chmod 600`), preventing key exposure in process environment listings.

---

## 3. Owner-Only Credential Remediation

The old default-branch source and commit history historically contained a fixed demo-account password and a weak development JWT signing fallback. The affected historical paths are `server/src/routes/auth.js` and `server/src/config.js`.

> [!IMPORTANT]
> No production database, hosting environment, secret store, or live account was accessed. Whether demo accounts or the weak JWT fallback were ever used in a live environment cannot be determined from repository inspection alone. Remediation cannot be marked complete until the repository owner verifies the live environment.

### Remediation Checklist & Status Template for Repository Owner

| Remediation Item | Target Environment | Owner Verification Step | Current Status |
|---|---|---|---|
| **R-1: Live Demo Account Audit** | Staging & Production DB | Inspect `User` table for `admin@smartpark.ai`, `driver@smartpark.ai`, `owner@smartpark.ai`. Establish if rows ever existed. | `pending owner verification` |
| **R-2: Demo Account Deactivation** | Live DB | Disable or delete unneeded demo accounts. For any retained account, generate a cryptographically strong random password. | `pending owner action` |
| **R-3: Historical JWT Fallback Audit** | Hosting dashboard | Inspect environment variable configurations on Render / hosting provider for active or historical `JWT_SECRET`. | `pending owner verification` |
| **R-4: JWT Secret Rotation** | Live Hosting Secret Store | Generate a cryptographically random secret (32+ chars: `openssl rand -base64 32`) and inject into hosting environment. | `pending owner action` |
| **R-5: Orderly Session Invalidation** | Client & API | Deploy rotated `JWT_SECRET`. Verify all existing user JWTs return 401 and require fresh authentication. | `pending owner action` |
| **R-6: Repository History Remediation** | GitHub Repository | Decide whether repository history rewrite (`git filter-repo`) is required or if secret rotation satisfies threat model. | `pending owner policy decision` |
| **R-7: Hosting Dashboard Branch Audit** | Render Dashboard | Check deployed branch and commit in Render. Ensure auto-deploy is disabled or pinned to approved release tags. | `pending owner verification` |

### Step-by-Step JWT Rotation & Session Invalidation Runbook

1. **Schedule Maintenance Window:** Notify pilot facility operators of a brief 5-minute authentication reset window.
2. **Generate New Secret:** Run locally:
   ```bash
   openssl rand -base64 36
   ```
3. **Inject Secret:** In the hosting provider dashboard (e.g., Render Environment Settings), update `JWT_SECRET` with the generated value. Never commit this value to Git.
4. **Trigger Rolling Restart:** Restart the web service process. Startup validation will confirm `JWT_SECRET` length >= 32 characters.
5. **Verify Invalidation:** Attempt an API request with an old JWT token; confirm it returns HTTP 401 `{"success": false, "error": "Invalid or expired token.", "code": 401}`.
6. **Re-authenticate:** Have authorized operators log in via `/api/auth/login` to obtain newly signed JWT tokens.

---

## 4. Device Authentication: Physical Installation & Rollout Architecture

### Provisioning Sequence for One Pilot Device

```text
[Operator Dashboard / CLI]
       │
       │ 1. POST /api/devices (Register deviceCode under Facility ID)
       ▼
[PostgreSQL Database] ─── Creates Device (status: ONLINE, ingestionEnabled: true)
       │
       │ 2. POST /api/devices/:id/credentials (Issue Ed25519 Keypair)
       ▼
[Server Engine] ─── Stores SPKI Public Key in DB; exports PKCS#8 Private Key once
       │
       │ 3. Secure Out-of-Band Transfer (SSH / SCP over local network)
       ▼
[Raspberry Pi Hardware] ─── Stored at /etc/baysignal/device_key.der (chmod 600)
       │
       │ 4. Signed Heartbeat: PUT /api/devices/:id/heartbeat
       ▼
[Server Verifier] ─── Validates Ed25519 signature, timestamp window, & replay ID
```

### Key Storage and File Permissions on Raspberry Pi

1. **Storage Location:** Private key is written to `/etc/baysignal/device_key.der` (or an operator-specified secure path).
2. **Permission Hardening:**
   ```bash
   sudo mkdir -p /etc/baysignal
   sudo chown -R baysignal:baysignal /etc/baysignal
   sudo chmod 700 /etc/baysignal
   sudo chmod 600 /etc/baysignal/device_key.der
   ```
3. **Enforcement in Agent:** `raspberry_pi/smartpark_agent.py` checks file mode on POSIX systems: if group/other read permissions exist (`st_mode & 0o077 != 0`), a security warning is logged recommending `chmod 600`.
4. **Environment Isolation:** The key is read from file into memory only for signing; it is never logged, printed, or exported.

### Credential Revocation & Key Rotation Runbook

1. **Issue Replacement Key:** While the device is running, an authorized facility manager issues a new credential via `POST /api/devices/:id/credentials`.
2. **Deploy New Key:** Install the replacement private key file onto the Raspberry Pi and update `BAYSIGNAL_DEVICE_CREDENTIAL_ID`.
3. **Verify Reporting:** Confirm that the device's signed heartbeat or observation succeeds with the new credential ID.
4. **Revoke Old Key:** Revoke the old credential via `POST /api/devices/:id/credentials/:oldCredentialId/revoke` with a mandatory reason (minimum 10 characters).
5. **Confirm Revocation:** Ensure subsequent requests using the old key receive HTTP 401. Revocation is recorded in `AuditEvent`.
6. **Compromise Response:** If a device key is compromised, immediately call revoke on that credential or set `ingestionEnabled: false` on the device.

---

## 5. Legacy Device Authentication Sunset Policy

The legacy shared API key path (`x-device-key`) represents a single-point-of-failure cross-device blast radius.

### Sunset Plan:
1. **Default Off:** `ALLOW_LEGACY_DEVICE_API_KEY` is `false` by default in all environments.
2. **Strict Expiration Guard:** If enabled, `LEGACY_DEVICE_API_KEY_EXPIRES_AT` must be set to a valid ISO date within 30 days. Startup validation fails closed if the expiration is missing or exceeded.
3. **Zero Legacy Production Pilot:** The Phase 4 pilot environment strictly prohibits legacy authentication. All pilot devices must use signed Ed25519 requests.
4. **Complete Cutoff:** Once legacy hardware is inventoried and updated, the compatibility middleware will be deprecated and removed from the codebase.

---

## 6. Diagnostic Logging & Privacy Controls

- **Redaction by Design:** Express error handlers and `logDiagnostic` strip raw bodies, authorization headers, signature strings, and credentials.
- **Safe Authentication Rejections:** Failed device signature checks return generic 401 errors to the client while emitting structured diagnostic logs to stdout with correlation reasons (`invalid_signature`, `timestamp_out_of_window`, `credential_not_found_or_revoked`) without leaking cryptographic material.
- **Vehicle Data Privacy:** Vehicle entries in `FacilityVisit` accept only 64-character pseudonymous digests (`/^[a-f0-9]{64}$/i`). Raw plate numbers and camera frame captures are prohibited from the evidence ledger.
- **Append-Only Auditing:** Database triggers prevent `UPDATE` or `DELETE` on `AuditEvent` rows, preserving non-repudiable audit trails of all administrative actions.

---

## 7. Security Limitations & Production Blockers

1. **Database Tier:** Render free PostgreSQL has a 30-day lifespan and lacks point-in-time recovery and managed backups. A funded PostgreSQL plan is required before a pilot.
2. **Branch Protection:** Private GitHub repository plan returns 403 on branch protection API. Manual review discipline must prevent direct commits to `main`.
3. **In-Memory Rate Limiting:** Single-node rate limiting is memory-bound; multi-instance deployment requires Redis or an equivalent shared cache.
4. **Physical Bench Testing:** Physical hardware testing has not been performed; testing is verified through automated CI suites.
