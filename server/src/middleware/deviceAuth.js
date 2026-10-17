import { createHash, createPublicKey, timingSafeEqual, verify as verifySignature } from 'node:crypto'
import { config } from '../config.js'
import { prisma } from '../db.js'
import { logDiagnostic } from '../safeLogging.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/

export function deviceCanonicalRequest({ method, path, timestamp, requestId, rawBody }) {
  const bodyHash = createHash('sha256').update(rawBody).digest('hex')
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${requestId}\n${bodyHash}`
}

function invalidDeviceAuth(res, reason = 'unspecified', details = {}) {
  logDiagnostic('device_auth_rejected', { reason, ...details })
  return res.status(401).json({ success: false, error: 'Invalid device authentication.', code: 401 })
}

function safeEqual(left, right) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function verifyDeviceIngestion(req, res, next) {
  try {
    const credentialId = req.header('x-device-credential-id')
    const deviceId = req.header('x-device-id')

    // Time-limited compatibility for already-deployed legacy clients. It is off by default.
    if (req.header('x-device-key') && config.allowLegacyDeviceApiKey && Date.now() < Date.parse(config.legacyDeviceApiKeyExpiresAt)) {
      const suppliedKey = req.header('x-device-key')
      if (!safeEqual(suppliedKey, config.legacyDeviceApiKey)) return invalidDeviceAuth(res, 'legacy_key_mismatch')
      const legacyDevice = await resolveRequestedDevice(req, deviceId)
      if (!legacyDevice || legacyDevice.status === 'MAINTENANCE' || !legacyDevice.ingestionEnabled || !requestMatchesDevice(req, legacyDevice, true)) {
        return invalidDeviceAuth(res, 'legacy_device_invalid_or_disabled', { deviceId })
      }
      req.deviceAuth = { device: legacyDevice, legacy: true }
      return next()
    }

    const timestamp = req.header('x-device-timestamp')
    const requestId = req.header('x-device-request-id')
    const signature = req.header('x-device-signature')
    if (!credentialId || !UUID.test(credentialId) || !deviceId || !UUID.test(deviceId) ||
      !timestamp || !/^\d{10}$/.test(timestamp) || !requestId || !UUID.test(requestId) || !signature || !SIGNATURE.test(signature) ||
      !Buffer.isBuffer(req.rawBody)) return invalidDeviceAuth(res, 'missing_or_malformed_headers', { deviceId })

    const credential = await prisma.deviceCredential.findFirst({
      where: { id: credentialId, deviceId, revokedAt: null },
      select: {
        publicKey: true,
        device: { select: { id: true, facilityId: true, status: true, ingestionEnabled: true } }
      }
    })
    if (!credential) return invalidDeviceAuth(res, 'credential_not_found_or_revoked', { deviceId, credentialId })
    if (credential.device.status === 'MAINTENANCE' || !credential.device.ingestionEnabled) {
      return invalidDeviceAuth(res, 'device_maintenance_or_disabled', { deviceId })
    }
    if (!requestMatchesDevice(req, credential.device)) {
      return invalidDeviceAuth(res, 'device_mismatch', { deviceId })
    }

    const nowSeconds = Math.floor(Date.now() / 1000)
    const requestSeconds = Number(timestamp)
    if (Math.abs(nowSeconds - requestSeconds) > config.deviceRequestWindowSeconds) {
      return invalidDeviceAuth(res, 'timestamp_out_of_window', { deviceId, deltaSeconds: nowSeconds - requestSeconds })
    }

    let validSignature = false
    try {
      const signatureBytes = Buffer.from(signature, 'base64url')
      validSignature = signatureBytes.length === 64 && signatureBytes.toString('base64url') === signature && verifySignature(
        null,
        Buffer.from(deviceCanonicalRequest({ method: req.method, path: req.originalUrl, timestamp, requestId, rawBody: req.rawBody }), 'utf8'),
        createPublicKey({ key: Buffer.from(credential.publicKey, 'base64url'), format: 'der', type: 'spki' }),
        signatureBytes
      )
    } catch {
      validSignature = false
    }
    if (!validSignature) return invalidDeviceAuth(res, 'invalid_signature', { deviceId, credentialId })

    req.deviceAuth = {
      device: credential.device,
      credentialId,
      requestId,
      timestamp: requestSeconds,
      legacy: false
    }
    return next()
  } catch (error) {
    return next(error)
  }
}

async function resolveRequestedDevice(req, headerDeviceId) {
  const bodyDeviceId = req.body?.device_id
  const requestedId = req.params.id || bodyDeviceId || headerDeviceId
  if (!requestedId) return null
  return prisma.device.findFirst({
    where: { OR: [{ id: requestedId }, { deviceCode: requestedId }] },
    select: { id: true, deviceCode: true, facilityId: true, status: true, ingestionEnabled: true }
  })
}

function requestMatchesDevice(req, device, allowDeviceCode = false) {
  const bodyDeviceId = req.body?.device_id
  const bodyFacilityId = req.body?.parking_id
  if (req.params.id && req.params.id !== device.id) return false
  if (bodyDeviceId && bodyDeviceId !== device.id && !(allowDeviceCode && bodyDeviceId === device.deviceCode)) return false
  if (req.header('x-device-id') && req.header('x-device-id') !== device.id) return false
  if (bodyFacilityId && bodyFacilityId !== device.facilityId) return false
  return true
}

export async function consumeDeviceRequest(tx, deviceAuth) {
  if (deviceAuth.legacy) return
  const credential = await tx.deviceCredential.findFirst({
    where: { id: deviceAuth.credentialId, deviceId: deviceAuth.device.id, revokedAt: null },
    select: { id: true }
  })
  const device = await tx.device.findUnique({ where: { id: deviceAuth.device.id }, select: { ingestionEnabled: true, status: true } })
  if (!credential || !device?.ingestionEnabled || device.status === 'MAINTENANCE') {
    logDiagnostic('device_request_rejected', { reason: 'credential_invalid_in_transaction', deviceId: deviceAuth.device?.id })
    const error = new Error('Invalid device authentication.')
    error.statusCode = 401
    throw error
  }
  const now = new Date()
  await tx.deviceRequest.deleteMany({ where: { deviceId: deviceAuth.device.id, expiresAt: { lt: now } } })
  await tx.deviceRequest.create({
    data: {
      deviceId: deviceAuth.device.id,
      requestId: deviceAuth.requestId,
      expiresAt: new Date(now.getTime() + (config.deviceRequestWindowSeconds * 2 * 1000))
    }
  })
}
