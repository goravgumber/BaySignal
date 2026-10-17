# BaySignal Security Review

**Review date:** 2026-10-16
**Scope:** Static review of the feature branch, Git history, route/socket access paths, PostgreSQL tests, deployment manifest, and npm production dependency audits. No production database, deployment service, or external application endpoint was accessed.

## Resolved in the feature branch

- Removed the development JWT fallback and require an explicitly configured signing key of at least 32 characters. Production configuration also requires an HTTPS frontend origin; device ingestion now uses individually issued public-key credentials.
- Removed the prefilled demo login and fixed seed password. Demo seeding is opt-in, rejects production, and requires a locally supplied password.
- Added tenant-scoped facility and reservation route integration tests, including inaccessible legacy facilities, foreign tenant data, finance data minimization, and disabled-by-default public booking.
- Changed server error logging to emit correlation and error-class metadata without serializing the exception object. Unknown-route responses no longer reflect a request URL or query string.
- Updated React Router to 7.18.4 and constrained the server's transitive `qs` dependency to 6.16.1. Both production dependency trees pass `npm audit --omit=dev`.

## Human action required: historical credentials

The old default-branch source and commit history contain a fixed demo-account password and a weak development JWT signing fallback. The affected historical source paths are `server/src/routes/auth.js` and `server/src/config.js`; the insecure defaults are absent from the current feature-branch runtime. The values remain recoverable from prior Git commits. The repository is private now; a checked-in discovery document states it was public, but historical visibility could not be independently verified. Treat the demo password as exposed. It is not possible from repository inspection to determine whether those demo accounts were ever created in a live database or whether any environment used the old JWT fallback. This is a committed credential with unknown deployment/use, not a credential confirmed used live.

Before any real pilot, the owner should:

1. Identify whether the demo account addresses exist in any live database. Disable unused demo accounts and reset credentials for any account that remains.
2. Rotate `JWT_SECRET` in each deployed environment, verify the new value is generated randomly and stored only in the platform secret store, and require users to authenticate again. Rotation invalidates tokens signed with the old value.
3. Confirm that no active deployment relies on the old source default. `render.yaml` now requests a generated `JWT_SECRET`, but the current dashboard value and deployed commit were not inspected.
4. Review repository visibility/audit history and any copies or forks. No history rewrite was performed; rotation is the required remediation for retained Git objects.

The JWT secret is not set to a fallback in development either: provide a locally generated value in an ignored `.env` file. The checked-in example contains placeholders only. Test-only passwords and keys exist in test fixtures and the isolated CI workflow; they are not production credentials. No production secret or live account was inspected.

No password, signing key, token, or production environment was accessed or rotated during this review.

## Release blockers and limitations

- **Device credential transition:** New device heartbeat and Raspberry Pi ingestion use per-device Ed25519 signatures. Authorized `FACILITY_MANAGER` and `DEVICE_TECHNICIAN` users can issue and revoke a device credential; issuance/revocation are audited. The private key is returned once and only its public key is stored. Requests are bound to method, exact URL path/query, timestamp, request ID, and the SHA-256 digest of the exact raw JSON bytes. Timestamps may differ from server time by at most 300 seconds. A unique `(deviceId, requestId)` database key prevents concurrent replay; request IDs expire after 600 seconds, and expired rows are removed on a later request from that device. Replay row creation and ingestion writes share a transaction.
- **Legacy device compatibility:** The old global key is not used unless `ALLOW_LEGACY_DEVICE_API_KEY=true` and a separate `LEGACY_DEVICE_API_KEY` plus explicit `LEGACY_DEVICE_API_KEY_EXPIRES_AT` are configured. Legacy requests do not have timestamp/signature/replay protection and retain the historical cross-device blast radius. Production validation rejects a missing/expired cutoff or a cutoff over 30 days away. Keep this disabled by default; enable only for an inventoried migration, then disable it once all clients have moved to signed requests. There is no built-in legacy-client usage metric, so confirm cutover from device/operator inventory before enabling and verify externally before disabling.
- **Device key rotation:** Issue a replacement credential, securely install its one-time private key on that device, verify a signed heartbeat, then revoke the previous credential. Revocation is per credential and does not invalidate other devices. Lost private keys cannot be recovered from the server; issue a replacement and revoke the lost credential.
- **Historical exposure status:** present-day repository privacy is verified, but past public visibility and actual use of the old seed/fallback cannot be established from the checked-out repository. Complete the rotation review above before pilot access.
- **Rate-limit topology:** Express's rate limiter is in-memory and disabled outside production. It is suitable only for a single instance; multi-instance deployment needs a shared store and an explicit proxy/IP policy.
- **PostgreSQL validation:** the PostgreSQL 16 GitHub Actions run passed. Local PostgreSQL 18 was not used because credentials and the contents of the harness's fixed destructive target names are unknown.
- **Unpatched development dependencies:** full audits report a high-severity `braces` advisory through `nodemon` on the server and Tailwind's development tree on the client, plus moderate development-tool advisories involving esbuild/Vite and PostCSS selector parsing. The current production-only audits are clean. These packages are build/watch tooling, not shipped runtime dependencies; the `braces` advisory has no patched release. Keep development servers off untrusted networks and reassess the toolchain when compatible fixed releases are available.
- **Platform protections:** GitHub reports that branch-protection settings require a higher plan for this private repository (HTTP 403). The repository's current settings expose no required-review or required-status-check configuration through the available plan. Do not treat CI passing as a substitute for human review.

## Reviewed controls

- HTTP routes use JWT authentication and facility/organization access checks; tenant route tests cover foreign facilities, visits, reservations, public booking, and finance-field exclusion.
- Socket connections require JWTs and facility-room joins check current database access. The PostgreSQL 16 integration suite now tests invalid-token rejection, an authorized manager joining a facility room, and a foreign-tenant manager being denied.
- Device signatures use Node's Ed25519 verification; authentication failures return one generic response and do not log request headers, signatures, or body contents. The database stores only public key material. Device maintenance/disabled state is rejected at authentication time.
- Express JSON request bodies are capped at 50 KB. Reservation pagination is capped at 100 rows; operations lists are capped at 100.
- CORS uses the configured frontend origin; production configuration requires a valid HTTPS origin. The Socket.IO wildcard fallback is reachable only if frontend configuration is empty, which production validation rejects.
- Audit rows have database triggers against ordinary update/delete operations. Database owners can still alter the schema or remove triggers; this is not cryptographic immutability.
