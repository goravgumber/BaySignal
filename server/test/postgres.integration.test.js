import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createPrivateKey, randomUUID, sign as signEd25519 } from 'node:crypto'
import { createServer } from 'node:http'

const enabled = process.env.BAYSIGNAL_PG_INTEGRATION === '1'
test('PostgreSQL constraints, audited services, and tenant routes', { skip: !enabled }, async (t) => {
  assert.ok(process.env.BAYSIGNAL_TEST_DB_CONFIRMATION === 'EPHEMERAL-POSTGRES', 'integration suite requires explicit disposable database confirmation')
  assert.ok(process.env.DATABASE_URL, 'integration tests require an explicit disposable DATABASE_URL')
  const databaseTarget = new URL(process.env.DATABASE_URL)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseTarget.hostname), 'integration tests refuse non-loopback database hosts')
  assert.equal(databaseTarget.port, '5432', 'integration tests require PostgreSQL port 5432')
  assert.equal(databaseTarget.pathname, '/baysignal_test_integration', 'integration tests require the named disposable database')
  assert.equal(databaseTarget.search, '', 'integration tests refuse database URL overrides')
  assert.equal(databaseTarget.hash, '', 'integration tests refuse database URL fragments')
  const [{ PrismaClient }, jwt, expressModule, operationsModule, reservationsModule, authModule, devicesModule, simulationModule, errorHandlerModule, { prisma: routePrisma }, { config }, { reconcileSlotEvidence }, { processVerifiedGateEvent }, socketServerModule, socketClientModule, socketAccessModule] = await Promise.all([
    import('@prisma/client'), import('jsonwebtoken'), import('express'), import('../src/routes/operations.js'),
    import('../src/routes/reservations.js'), import('../src/routes/auth.js'), import('../src/routes/devices.js'),
    import('../src/routes/simulation.js'), import('../src/middleware/errorHandler.js'), import('../src/db.js'), import('../src/config.js'),
    import('../src/services/reconcileEvidence.js'), import('../src/services/gateEvents.js'), import('socket.io'),
    import('socket.io-client'), import('../src/socketAccess.js')
  ])
  const express = expressModule.default
  const { Server } = socketServerModule
  const socketClient = socketClientModule.io
  const { installSocketAccess } = socketAccessModule
  const operationsRoutes = operationsModule.default
  const reservationRoutes = reservationsModule.default
  const authRoutes = authModule.default
  const devicesRoutes = devicesModule.default
  const simulationRoutes = simulationModule.default
  const { errorHandler } = errorHandlerModule
  assert.ok(config.jwtSecret.length >= 32, 'integration test JWT_SECRET must be test-only and at least 32 characters')
  const prisma = new PrismaClient()
  const app = express()
  app.use(express.json({ verify: (req, res, buffer) => { req.rawBody = Buffer.from(buffer) } }))
  app.use('/api/auth', authRoutes)
  app.use('/api/reservations', reservationRoutes)
  app.use('/api/operations', operationsRoutes)
  app.use('/api/devices', devicesRoutes)
  app.use('/api/simulation', simulationRoutes)
  app.use(errorHandler)
  const server = createServer(app)
  const socketServer = new Server(server, { serveClient: false })
  installSocketAccess(socketServer, { prisma, jwtSecret: config.jwtSecret })
  await new Promise((resolve) => server.listen(0, resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const unique = randomUUID()
  const vehicleReference = (salt) => createHash('sha256').update(`${unique}:${salt}`).digest('hex')
  const tokenFor = (user) => jwt.default.sign({ id: user.id }, config.jwtSecret)
  const request = (path, token, options = {}) => fetch(`${base}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers }
  })

  try {
    const orgA = await prisma.organization.create({ data: { name: `Org A ${unique}`, slug: `a-${unique}` } })
    const orgB = await prisma.organization.create({ data: { name: `Org B ${unique}`, slug: `b-${unique}` } })
    const makeFacility = async (organizationId, name) => prisma.facility.create({ data: {
      name, address: 'Test Road', city: 'Test City', totalSlots: 2, lat: 0, lng: 0, organizationId,
      zones: { create: { name: 'Zone', code: name, capacity: 2, slots: { create: [{ slotCode: `${name}-1` }, { slotCode: `${name}-2` }] } } }
    }, include: { zones: { include: { slots: true } } } })
    const facilityA = await makeFacility(orgA.id, `facility-a-${unique}`)
    const facilityAUnassignedGrant = await makeFacility(orgA.id, `facility-a-ungranted-${unique}`)
    const facilityB = await makeFacility(orgB.id, `facility-b-${unique}`)
    const makeUser = (role, suffix) => prisma.user.create({ data: { name: suffix, email: `${suffix}-${unique}@example.test`, passwordHash: 'test-only', role } })
    const manager = await makeUser('ADMIN', 'manager')
    const attendant = await makeUser('ADMIN', 'attendant')
    const finance = await makeUser('ADMIN', 'finance')
    const foreignManager = await makeUser('ADMIN', 'foreign')
    const driver = await makeUser('DRIVER', 'driver')
    const membership = async (organizationId, userId, role) => prisma.organizationMembership.create({ data: { organizationId, userId, role, status: 'ACTIVE' } })
    const managerMembership = await membership(orgA.id, manager.id, 'FACILITY_MANAGER')
    const attendantMembership = await membership(orgA.id, attendant.id, 'ATTENDANT')
    const financeMembership = await membership(orgA.id, finance.id, 'FINANCE')
    const foreignMembership = await membership(orgB.id, foreignManager.id, 'FACILITY_MANAGER')
    await prisma.facilityAccess.createMany({ data: [
      { membershipId: managerMembership.id, facilityId: facilityA.id, role: 'FACILITY_MANAGER' },
      { membershipId: attendantMembership.id, facilityId: facilityA.id, role: 'ATTENDANT' },
      { membershipId: financeMembership.id, facilityId: facilityA.id, role: 'FINANCE' },
      { membershipId: foreignMembership.id, facilityId: facilityB.id, role: 'FACILITY_MANAGER' }
    ] })
    const managerToken = tokenFor(manager)
    const attendantToken = tokenFor(attendant)
    const financeToken = tokenFor(finance)
    const foreignToken = tokenFor(foreignManager)
    const driverToken = tokenFor(driver)

    const signDeviceCall = ({ method = 'PUT', path, deviceId, credential, body, requestId = randomUUID(), timestamp = Math.floor(Date.now() / 1000) }) => {
      const rawBody = Buffer.from(body)
      const timestampText = String(timestamp)
      const bodyHash = createHash('sha256').update(rawBody).digest('hex')
      const canonical = `${method}\n${path}\n${timestampText}\n${requestId}\n${bodyHash}`
      const signature = signEd25519(null, Buffer.from(canonical), createPrivateKey({ key: Buffer.from(credential.privateKey, 'base64url'), format: 'der', type: 'pkcs8' })).toString('base64url')
      return request(path, null, { method, body, headers: {
        'x-device-credential-id': credential.credential.id,
        'x-device-id': deviceId,
        'x-device-timestamp': timestampText,
        'x-device-request-id': requestId,
        'x-device-signature': signature
      } })
    }

    await t.test('device credentials are scoped, signed, revocable, replay-safe, and transactional', async () => {
      const deviceA = await prisma.device.create({ data: { deviceCode: `device-a-${unique}`, facilityId: facilityA.id, zone: 'A' } })
      const deviceB = await prisma.device.create({ data: { deviceCode: `device-b-${unique}`, facilityId: facilityB.id, zone: 'B' } })
      const issue = (device, token = managerToken) => request(`/api/devices/${device.id}/credentials`, token, {
        method: 'POST', body: JSON.stringify({ reason: 'Register device for authenticated pilot ingestion' })
      })
      const issuedResponse = await issue(deviceA)
      assert.equal(issuedResponse.status, 201)
      assert.equal(issuedResponse.headers.get('cache-control'), 'no-store')
      const issued = (await issuedResponse.json()).data
      const storedCredential = await prisma.deviceCredential.findUnique({ where: { id: issued.credential.id } })
      assert.equal(storedCredential.deviceId, deviceA.id)
      assert.equal(storedCredential.publicKey.includes(issued.privateKey), false)
      const issuedAudit = await prisma.auditEvent.findFirst({ where: { action: 'DEVICE_CREDENTIAL_ISSUED', resourceId: issued.credential.id } })
      assert.ok(issuedAudit)
      assert.equal(JSON.stringify(issuedAudit).includes(issued.privateKey), false)
      const unauthorizedIssue = await issue(deviceA, foreignToken)
      assert.equal(unauthorizedIssue.status, 404)

      const body = JSON.stringify({ cpuPercent: 10, ramPercent: 20, temperature: 30 })
      const heartbeatPath = `/api/devices/${deviceA.id}/heartbeat`
      const legacyWithoutOptIn = await request(heartbeatPath, null, { method: 'PUT', body, headers: { 'x-device-key': 'legacy-key-does-not-enable-access' } })
      assert.equal(legacyWithoutOptIn.status, 401)
      const invalidCredential = { ...issued, credential: { ...issued.credential, id: randomUUID() } }
      const unknown = await signDeviceCall({ path: heartbeatPath, deviceId: deviceA.id, credential: invalidCredential, body })
      const unknownBody = await unknown.json()
      assert.equal(unknown.status, 401)
      assert.deepEqual(unknownBody, { success: false, error: 'Invalid device authentication.', code: 401 })

      const tampered = JSON.stringify({ cpuPercent: 99, ramPercent: 20, temperature: 30 })
      const tamperRequestId = randomUUID()
      const tamperBase = await signDeviceCall({ path: heartbeatPath, deviceId: deviceA.id, credential: issued, body, requestId: tamperRequestId })
      const tamperHeaders = Object.fromEntries(tamperBase.headers)
      const tamperedResponse = await request(heartbeatPath, null, { method: 'PUT', body: tampered, headers: tamperHeaders })
      assert.equal(tamperedResponse.status, 401)
      const signatureLastChar = tamperHeaders['x-device-signature'].slice(-1)
      const alteredSignatureHeaders = { ...tamperHeaders, 'x-device-signature': `${tamperHeaders['x-device-signature'].slice(0, -1)}${signatureLastChar === 'A' ? 'B' : 'A'}` }
      const alteredSignature = await request(heartbeatPath, null, { method: 'PUT', body, headers: alteredSignatureHeaders })
      assert.equal(alteredSignature.status, 401)

      const wrongDevice = await signDeviceCall({ path: `/api/devices/${deviceB.id}/heartbeat`, deviceId: deviceB.id, credential: issued, body })
      assert.equal(wrongDevice.status, 401)

      const piPath = '/api/simulation/pi-payload'
      const piBody = JSON.stringify({ parking_id: facilityB.id, device_id: deviceA.id, timestamp: new Date().toISOString(), slots: {} })
      const wrongFacility = await signDeviceCall({ path: piPath, deviceId: deviceA.id, credential: issued, body: piBody })
      assert.equal(wrongFacility.status, 401)
      const validPiBody = JSON.stringify({ parking_id: facilityA.id, device_id: deviceA.id, timestamp: new Date().toISOString(), slots: {} })
      const validPi = await signDeviceCall({ method: 'POST', path: piPath, deviceId: deviceA.id, credential: issued, body: validPiBody })
      assert.equal(validPi.status, 200)
      const stale = await signDeviceCall({ path: heartbeatPath, deviceId: deviceA.id, credential: issued, body, timestamp: Math.floor(Date.now() / 1000) - 301 })
      assert.equal(stale.status, 401)
      const future = await signDeviceCall({ path: heartbeatPath, deviceId: deviceA.id, credential: issued, body, timestamp: Math.floor(Date.now() / 1000) + 301 })
      assert.equal(future.status, 401)
      await prisma.device.update({ where: { id: deviceA.id }, data: { status: 'MAINTENANCE' } })
      const maintenanceDenied = await signDeviceCall({ path: heartbeatPath, deviceId: deviceA.id, credential: issued, body })
      assert.equal(maintenanceDenied.status, 401)
      await prisma.device.update({ where: { id: deviceA.id }, data: { status: 'ONLINE', ingestionEnabled: false } })
      const disabledDenied = await signDeviceCall({ path: heartbeatPath, deviceId: deviceA.id, credential: issued, body })
      assert.equal(disabledDenied.status, 401)
      await prisma.device.update({ where: { id: deviceA.id }, data: { ingestionEnabled: true } })

      const replayId = randomUUID()
      const accepted = await signDeviceCall({ path: heartbeatPath, deviceId: deviceA.id, credential: issued, body, requestId: replayId })
      assert.equal(accepted.status, 200)
      const replay = await signDeviceCall({ path: heartbeatPath, deviceId: deviceA.id, credential: issued, body, requestId: replayId })
      assert.equal(replay.status, 409)
      assert.equal(await prisma.deviceRequest.count({ where: { deviceId: deviceA.id, requestId: replayId } }), 1)

      const concurrentId = randomUUID()
      const concurrent = await Promise.all([
        signDeviceCall({ path: heartbeatPath, deviceId: deviceA.id, credential: issued, body, requestId: concurrentId }),
        signDeviceCall({ path: heartbeatPath, deviceId: deviceA.id, credential: issued, body, requestId: concurrentId })
      ])
      assert.deepEqual(concurrent.map((response) => response.status).sort(), [200, 409])
      assert.equal(await prisma.deviceRequest.count({ where: { deviceId: deviceA.id, requestId: concurrentId } }), 1)

      const initialDevice = await prisma.device.findUnique({ where: { id: deviceA.id } })
      await prisma.$executeRawUnsafe(`CREATE FUNCTION "integration_force_device_failure"() RETURNS trigger AS $$ BEGIN IF NEW."cpuPercent" = 99 THEN RAISE EXCEPTION 'forced device failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "integration_force_device_failure" BEFORE UPDATE ON "Device" FOR EACH ROW EXECUTE FUNCTION "integration_force_device_failure"()`)
      const rollbackRequestId = randomUUID()
      let errorLog = ''
      const originalConsoleError = console.error
      try {
        console.error = (...parts) => { errorLog += parts.join(' ') }
        const failed = await signDeviceCall({ path: heartbeatPath, deviceId: deviceA.id, credential: issued, body: tampered, requestId: rollbackRequestId })
        assert.equal(failed.status, 500)
        assert.equal((await failed.json()).error, 'Internal Server Error')
        assert.equal(await prisma.deviceRequest.count({ where: { deviceId: deviceA.id, requestId: rollbackRequestId } }), 0)
        assert.equal((await prisma.device.findUnique({ where: { id: deviceA.id } })).cpuPercent, initialDevice.cpuPercent)
      } finally {
        console.error = originalConsoleError
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "integration_force_device_failure" ON "Device"`)
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "integration_force_device_failure"()`)
      }
      assert.equal(errorLog.includes(issued.privateKey), false)
      assert.equal(errorLog.includes(issued.credential.id), false)
      assert.equal(errorLog.includes(tampered), false)
      const retryAfterRollback = await signDeviceCall({ path: heartbeatPath, deviceId: deviceA.id, credential: issued, body: tampered, requestId: rollbackRequestId })
      assert.equal(retryAfterRollback.status, 200)

      const rotatedResponse = await issue(deviceA)
      assert.equal(rotatedResponse.status, 201)
      const rotated = (await rotatedResponse.json()).data
      const revoked = await request(`/api/devices/${deviceA.id}/credentials/${issued.credential.id}/revoke`, managerToken, {
        method: 'POST', body: JSON.stringify({ reason: 'Rotate the device credential during pilot maintenance' })
      })
      assert.equal(revoked.status, 200)
      const unauthorizedRevoke = await request(`/api/devices/${deviceA.id}/credentials/${rotated.credential.id}/revoke`, foreignToken, {
        method: 'POST', body: JSON.stringify({ reason: 'Unauthorized foreign tenant credential revocation' })
      })
      assert.equal(unauthorizedRevoke.status, 404)
      const deniedRevoked = await signDeviceCall({ path: heartbeatPath, deviceId: deviceA.id, credential: issued, body })
      assert.equal(deniedRevoked.status, 401)
      assert.equal((await deniedRevoked.json()).error, unknownBody.error)
      const acceptedRotated = await signDeviceCall({ path: heartbeatPath, deviceId: deviceA.id, credential: rotated, body })
      assert.equal(acceptedRotated.status, 200)
      const revokedAudit = await prisma.auditEvent.findFirst({ where: { action: 'DEVICE_CREDENTIAL_REVOKED', resourceId: issued.credential.id } })
      assert.ok(revokedAudit)
      assert.equal(JSON.stringify(revokedAudit).includes(issued.privateKey), false)
    })

    await t.test('tenant route authorization and public registration', async () => {
      const registration = await request('/api/auth/register', null, { method: 'POST', body: JSON.stringify({ name: 'Public Driver', email: `public-${unique}@example.test`, password: 'test-password-123' }) })
      assert.equal(registration.status, 201)
      assert.equal((await registration.json()).data.user.role, 'DRIVER')

      await processVerifiedGateEvent(prisma, {
        organizationId: orgB.id, facilityId: facilityB.id, direction: 'INBOUND', validation: 'VERIFIED',
        vehicleReference: vehicleReference('foreign-visit'), eventAt: new Date(),
        sourceEventId: vehicleReference('foreign-visit-source'), deduplicationKey: vehicleReference('foreign-visit-dedup')
      })
      await processVerifiedGateEvent(prisma, {
        organizationId: orgA.id, facilityId: facilityAUnassignedGrant.id, direction: 'INBOUND', validation: 'VERIFIED',
        vehicleReference: vehicleReference('ungranted-visit'), eventAt: new Date(),
        sourceEventId: vehicleReference('ungranted-visit-source'), deduplicationKey: vehicleReference('ungranted-visit-dedup')
      })
      const visitsA = await request('/api/operations/visits', managerToken)
      assert.equal(visitsA.status, 200)
      const managerVisits = (await visitsA.json()).data
      assert.equal(managerVisits.some((visit) => visit.facilityId === facilityB.id), false)
      assert.equal(managerVisits.some((visit) => visit.facilityId === facilityAUnassignedGrant.id), false)
      const visitsB = await request('/api/operations/visits', foreignToken)
      assert.equal((await visitsB.json()).data.some((visit) => visit.facilityId === facilityB.id), true)
      const guessedForeignResource = await request(`/api/reservations/${randomUUID()}`, managerToken)
      assert.ok([403, 404].includes(guessedForeignResource.status))

      const reservation = await prisma.reservation.create({ data: {
        reservationCode: `R-${unique}`, slotId: facilityB.zones[0].slots[0].id, userId: driver.id,
        vehicleNumber: 'TEST-PLATE-1', driverName: 'Driver Personal', driverPhone: '1234567890',
        durationHours: 1, baseAmount: 20, totalAmount: 25, startTime: new Date(Date.now() + 3600000), endTime: new Date(Date.now() + 7200000)
      } })
      const foreignReservation = await request(`/api/reservations/${reservation.id}`, managerToken)
      assert.ok([403, 404].includes(foreignReservation.status))
      const financeList = await request('/api/reservations', financeToken)
      assert.equal(financeList.status, 200)
      const financeData = (await financeList.json()).data.data
      assert.equal(financeData.some((row) => row.id === reservation.id || row.vehicleNumber === reservation.vehicleNumber || row.driverPhone === reservation.driverPhone), false)
      const driverOwn = await request(`/api/reservations/${reservation.id}`, driverToken)
      assert.equal(driverOwn.status, 200)
      const foreignDriver = await request(`/api/reservations/${reservation.id}`, tokenFor(await makeUser('DRIVER', 'other-driver')))
      assert.equal(foreignDriver.status, 403)
      const privateBooking = await request('/api/reservations', driverToken, { method: 'POST', body: JSON.stringify({ slotId: facilityA.zones[0].slots[1].id, vehicleNumber: 'TEST-PLATE-2', driverName: 'Public Driver', driverPhone: '1234567890', durationHours: 1, startTime: new Date(Date.now() + 86400000).toISOString() }) })
      assert.equal(privateBooking.status, 404)
      await prisma.facility.update({ where: { id: facilityB.id }, data: { allowPublicReservations: true } })
      const publicBooking = await request('/api/reservations', driverToken, { method: 'POST', body: JSON.stringify({ slotId: facilityB.zones[0].slots[1].id, vehicleNumber: 'TEST-PLATE-3', driverName: 'Public Driver', driverPhone: '1234567890', durationHours: 1, startTime: new Date(Date.now() + 86400000).toISOString() }) })
      assert.equal(publicBooking.status, 201)
      const legacyFacility = await prisma.facility.create({ data: { name: `Legacy ${unique}`, address: 'Old Road', city: 'Old City', totalSlots: 0, lat: 0, lng: 0 } })
      const refreshedVisits = await request('/api/operations/visits', managerToken)
      assert.equal((await refreshedVisits.json()).data.some((visit) => visit.facilityId === legacyFacility.id), false)
    })

    await t.test('socket authentication and facility room joins enforce tenant access', async () => {
      const invalidSocket = socketClient(base, { auth: { token: 'invalid-test-token' }, reconnection: false, timeout: 1000, transports: ['websocket'] })
      const invalidResult = await new Promise((resolve) => {
        invalidSocket.once('connect', () => resolve('connected'))
        invalidSocket.once('connect_error', () => resolve('rejected'))
      })
      invalidSocket.close()
      assert.equal(invalidResult, 'rejected')

      const managerSocket = socketClient(base, { auth: { token: managerToken }, reconnection: false, timeout: 1000, transports: ['websocket'] })
      await new Promise((resolve, reject) => {
        managerSocket.once('connect', resolve)
        managerSocket.once('connect_error', reject)
      })
      managerSocket.emit('join:facility', facilityA.id)
      await waitFor(() => socketServer.sockets.sockets.get(managerSocket.id)?.rooms.has(facilityA.id))
      assert.equal(socketServer.sockets.sockets.get(managerSocket.id)?.rooms.has(facilityA.id), true)

      const foreignSocket = socketClient(base, { auth: { token: foreignToken }, reconnection: false, timeout: 1000, transports: ['websocket'] })
      await new Promise((resolve, reject) => {
        foreignSocket.once('connect', resolve)
        foreignSocket.once('connect_error', reject)
      })
      foreignSocket.emit('join:facility', facilityA.id)
      await new Promise((resolve) => setTimeout(resolve, 50))
      assert.equal(socketServer.sockets.sockets.get(foreignSocket.id)?.rooms.has(facilityA.id), false)
      managerSocket.close()
      foreignSocket.close()
    })

    let discrepancy
    await t.test('conflicting evidence persists discrepancy without choosing a state', async () => {
      const slot = facilityA.zones[0].slots[0]
      const observedAt = new Date()
      await prisma.bayObservation.createMany({ data: [
        { organizationId: orgA.id, facilityId: facilityA.id, slotId: slot.id, source: 'BAY_SENSOR', deduplicationKey: `sensor-${unique}`, result: 'OCCUPIED', observedAt },
        { organizationId: orgA.id, facilityId: facilityA.id, slotId: slot.id, source: 'OVERHEAD_CAMERA', deduplicationKey: `camera-${unique}`, result: 'VACANT', observedAt }
      ] })
      const decision = await prisma.$transaction((tx) => reconcileSlotEvidence(tx, { slotId: slot.id, now: observedAt }))
      assert.equal(decision.state, 'CONFLICTING')
      assert.equal((await prisma.parkingSlot.findUnique({ where: { id: slot.id } })).status, 'AVAILABLE')
      discrepancy = await prisma.discrepancy.findUnique({ where: { id: decision.discrepancyId } })
      assert.equal(discrepancy.status, 'OPEN')

      const denied = await request(`/api/operations/discrepancies/${discrepancy.id}/resolve`, attendantToken, { method: 'POST', body: JSON.stringify({ status: 'OCCUPIED', reason: 'Attendant cannot correct' }) })
      assert.ok([404, 403].includes(denied.status))
      assert.equal((await prisma.parkingSlot.findUnique({ where: { id: slot.id } })).status, 'AVAILABLE')

      const rejectedAuditId = await prisma.auditEvent.create({ data: { organizationId: orgA.id, facilityId: facilityA.id, actorSystem: 'integration-test', action: 'IMMUTABLE_TEST', resourceType: 'Test', resourceId: unique } })
      await assert.rejects(prisma.auditEvent.update({ where: { id: rejectedAuditId.id }, data: { reason: 'mutation attempt' } }))
      await assert.rejects(prisma.auditEvent.delete({ where: { id: rejectedAuditId.id } }))
      await assert.rejects(prisma.$executeRaw`UPDATE "BayObservation" SET confidence = 1.1 WHERE "deduplicationKey" = ${`sensor-${unique}`}`)
      await assert.rejects(prisma.$executeRaw`INSERT INTO "FacilityAccess" (id, "membershipId", "facilityId", role) VALUES (${randomUUID()}, ${foreignMembership.id}, ${facilityA.id}, 'FACILITY_MANAGER')`)
      await assert.rejects(prisma.$executeRaw`INSERT INTO "BayObservation" (id, "organizationId", "facilityId", "slotId", source, "deduplicationKey", result, "observedAt") VALUES (${randomUUID()}, ${orgA.id}, ${facilityA.id}, ${facilityB.zones[0].slots[0].id}, 'BAY_SENSOR', ${`cross-bay-${unique}`}, 'VACANT', now())`)
    })

    await t.test('manager correction and its audit commit atomically; rollback removes both', async () => {
      const slot = facilityA.zones[0].slots[0]
      const response = await request(`/api/operations/discrepancies/${discrepancy.id}/resolve`, managerToken, { method: 'POST', body: JSON.stringify({ status: 'OCCUPIED', reason: 'Operator verified vehicle in bay' }) })
      assert.equal(response.status, 200)
      assert.equal((await prisma.parkingSlot.findUnique({ where: { id: slot.id } })).status, 'OCCUPIED')
      const audit = await prisma.auditEvent.findFirst({ where: { action: 'BAY_STATE_CORRECTED', resourceId: slot.id, actorUserId: manager.id }, orderBy: { occurredAt: 'desc' } })
      assert.ok(audit)
      assert.equal(audit.reason, 'Operator verified vehicle in bay')
      assert.equal(audit.beforeState.status, 'AVAILABLE')
      assert.equal(audit.afterState.status, 'OCCUPIED')

      const rollbackSlot = facilityA.zones[0].slots[1]
      const rollbackDiscrepancy = await prisma.discrepancy.create({ data: { organizationId: orgA.id, facilityId: facilityA.id, slotId: rollbackSlot.id, kind: 'TEST_CORRECTION_ROLLBACK', summary: 'Integration rollback fixture' } })
      const observationsBeforeFailure = await prisma.bayObservation.count({ where: { slotId: rollbackSlot.id } })
      await prisma.$executeRawUnsafe(`CREATE FUNCTION "integration_force_audit_failure"() RETURNS trigger AS $$ BEGIN IF NEW."action" = 'BAY_STATE_CORRECTED' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`)
      await prisma.$executeRawUnsafe(`CREATE TRIGGER "integration_force_audit_failure" BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "integration_force_audit_failure"()`)
      try {
        const failedCorrection = await request(`/api/operations/discrepancies/${rollbackDiscrepancy.id}/resolve`, managerToken, { method: 'POST', body: JSON.stringify({ status: 'OCCUPIED', reason: 'Force transactional rollback' }) })
        assert.equal(failedCorrection.status, 500)
        assert.equal((await prisma.parkingSlot.findUnique({ where: { id: rollbackSlot.id } })).status, 'AVAILABLE')
        assert.equal((await prisma.discrepancy.findUnique({ where: { id: rollbackDiscrepancy.id } })).status, 'OPEN')
        assert.equal(await prisma.bayObservation.count({ where: { slotId: rollbackSlot.id } }), observationsBeforeFailure)
        assert.equal(await prisma.auditEvent.count({ where: { action: 'BAY_STATE_CORRECTED', resourceId: rollbackSlot.id } }), 0)
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "integration_force_audit_failure" ON "AuditEvent"`)
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "integration_force_audit_failure"()`)
      }

      const beforeAuditCount = await prisma.auditEvent.count({ where: { resourceId: rollbackSlot.id, action: 'FORCED_ROLLBACK_TEST' } })
      await assert.rejects(prisma.$transaction(async (tx) => {
        await tx.parkingSlot.update({ where: { id: rollbackSlot.id }, data: { status: 'OCCUPIED' } })
        await tx.auditEvent.create({ data: { organizationId: orgA.id, facilityId: facilityA.id, actorUserId: manager.id, action: 'FORCED_ROLLBACK_TEST', resourceType: 'ParkingSlot', resourceId: rollbackSlot.id } })
        throw new Error('forced integration rollback')
      }))
      assert.equal((await prisma.parkingSlot.findUnique({ where: { id: rollbackSlot.id } })).status, 'AVAILABLE')
      assert.equal(await prisma.auditEvent.count({ where: { resourceId: rollbackSlot.id, action: 'FORCED_ROLLBACK_TEST' } }), beforeAuditCount)
    })

    await t.test('verified gate event transactions are idempotent and vacancy does not close presence', async () => {
      const eventReference = vehicleReference('visit')
      const inboundAt = new Date(Date.now() - 5000)
      const inbound = { organizationId: orgA.id, facilityId: facilityA.id, direction: 'INBOUND', validation: 'VERIFIED', vehicleReference: eventReference, eventAt: inboundAt, sourceEventId: vehicleReference('in-source'), deduplicationKey: vehicleReference('in-dedup') }
      const opened = await processVerifiedGateEvent(prisma, inbound)
      assert.equal(opened.action, 'OPEN_VISIT')
      const duplicate = await processVerifiedGateEvent(prisma, inbound)
      assert.equal(duplicate.action, 'DUPLICATE_EVENT')
      assert.equal(await prisma.facilityVisit.count({ where: { id: opened.visitId } }), 1)

      await prisma.bayObservation.create({ data: { organizationId: orgA.id, facilityId: facilityA.id, visitId: opened.visitId, slotId: facilityA.zones[0].slots[1].id, source: 'ATTENDANT', deduplicationKey: vehicleReference('vacancy'), result: 'VACANT', observedAt: new Date() } })
      const vacancyDecision = await prisma.$transaction((tx) => reconcileSlotEvidence(tx, { slotId: facilityA.zones[0].slots[1].id }))
      assert.equal(vacancyDecision.state, 'VACANT')
      assert.equal((await prisma.facilityVisit.findUnique({ where: { id: opened.visitId } })).status, 'ACTIVE')

      const earlyExit = { organizationId: orgA.id, facilityId: facilityA.id, direction: 'OUTBOUND', validation: 'VERIFIED', vehicleReference: eventReference, eventAt: new Date(inboundAt.getTime() - 1000), sourceEventId: vehicleReference('early-source'), deduplicationKey: vehicleReference('early-dedup') }
      const review = await processVerifiedGateEvent(prisma, earlyExit)
      assert.equal(review.action, 'REVIEW')
      assert.equal((await prisma.facilityVisit.findUnique({ where: { id: opened.visitId } })).status, 'ACTIVE')

      const outboundAt = new Date(inboundAt.getTime() + 60000)
      const outbound = { organizationId: orgA.id, facilityId: facilityA.id, direction: 'OUTBOUND', validation: 'VERIFIED', vehicleReference: eventReference, eventAt: outboundAt, sourceEventId: vehicleReference('out-source'), deduplicationKey: vehicleReference('out-dedup') }
      const closed = await processVerifiedGateEvent(prisma, outbound)
      assert.equal(closed.action, 'CLOSE_VISIT')
      assert.equal((await prisma.facilityVisit.findUnique({ where: { id: opened.visitId } })).status, 'EXITED')
      assert.equal((await processVerifiedGateEvent(prisma, outbound)).action, 'DUPLICATE_EVENT')
      const secondOutbound = await prisma.gateEvent.create({ data: { organizationId: orgA.id, facilityId: facilityA.id, sourceEventId: vehicleReference('second-out-source'), deduplicationKey: vehicleReference('second-out-dedup'), direction: 'OUTBOUND', validation: 'VERIFIED', vehicleReference: eventReference, eventAt: new Date(outboundAt.getTime() + 1000), provenance: 'integration-test' } })
      await assert.rejects(prisma.facilityVisit.update({ where: { id: opened.visitId }, data: { exitedAt: secondOutbound.eventAt, outboundEventId: secondOutbound.id } }))
    })

    await t.test('database rejects duplicate keys, active visits, invalid exits and cross-facility visit links', async () => {
      const eventRef = vehicleReference('constraint')
      const inboundEvent = await prisma.gateEvent.create({ data: { organizationId: orgA.id, facilityId: facilityA.id, sourceEventId: vehicleReference('con-in-source'), deduplicationKey: vehicleReference('con-in-dedup'), direction: 'INBOUND', validation: 'VERIFIED', vehicleReference: eventRef, eventAt: new Date(), provenance: 'integration-test' } })
      const visit = await prisma.facilityVisit.create({ data: { organizationId: orgA.id, facilityId: facilityA.id, vehicleReference: eventRef, inboundEventId: inboundEvent.id, inboundAt: inboundEvent.eventAt, status: 'ACTIVE', provenance: 'integration-test' } })
      await assert.rejects(prisma.gateEvent.create({ data: { organizationId: orgA.id, facilityId: facilityA.id, sourceEventId: vehicleReference('duplicate-source'), deduplicationKey: vehicleReference('con-in-dedup'), direction: 'INBOUND', eventAt: new Date(), provenance: 'integration-test' } }))
      const secondInbound = await prisma.gateEvent.create({ data: { organizationId: orgA.id, facilityId: facilityA.id, sourceEventId: vehicleReference('second-in-source'), deduplicationKey: vehicleReference('second-in-dedup'), direction: 'INBOUND', validation: 'VERIFIED', vehicleReference: eventRef, eventAt: new Date(inboundEvent.eventAt.getTime() + 1000), provenance: 'integration-test' } })
      await assert.rejects(prisma.facilityVisit.create({ data: { organizationId: orgA.id, facilityId: facilityA.id, vehicleReference: eventRef, inboundEventId: secondInbound.id, inboundAt: secondInbound.eventAt, status: 'ACTIVE', provenance: 'integration-test' } }))

      const invalidExit = await prisma.gateEvent.create({ data: { organizationId: orgA.id, facilityId: facilityA.id, sourceEventId: vehicleReference('bad-out-source'), deduplicationKey: vehicleReference('bad-out-dedup'), direction: 'OUTBOUND', validation: 'VERIFIED', vehicleReference: eventRef, eventAt: new Date(inboundEvent.eventAt.getTime() - 1000), provenance: 'integration-test' } })
      await assert.rejects(prisma.facilityVisit.update({ where: { id: visit.id }, data: { status: 'EXITED', exitedAt: invalidExit.eventAt, outboundEventId: invalidExit.id } }))
      await assert.rejects(prisma.facilityVisit.update({ where: { id: visit.id }, data: { currentBayId: facilityB.zones[0].slots[0].id } }))
      await assert.rejects(prisma.gateEvent.create({ data: { organizationId: orgB.id, facilityId: facilityA.id, sourceEventId: vehicleReference('cross-tenant-source'), deduplicationKey: vehicleReference('cross-tenant-dedup'), direction: 'INBOUND', eventAt: new Date(), provenance: 'integration-test' } }))
    })
  } finally {
    await new Promise((resolve) => socketServer.close(resolve))
    await Promise.all([prisma.$disconnect(), routePrisma.$disconnect()])
  }
})

async function waitFor(predicate, timeoutMs = 1000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start >= timeoutMs) throw new Error('Timed out waiting for socket room authorization decision.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
