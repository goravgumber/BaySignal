import { Router } from 'express'
import { generateKeyPairSync } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'
import { getIO } from '../socket.js'
import { consumeDeviceRequest, verifyDeviceIngestion } from '../middleware/deviceAuth.js'
import { validateBody, validateQuery } from '../middleware/validate.js'
import { accessibleFacilityIds, hasFacilityAccess } from '../tenantAccess.js'

const router = Router()
const listQuerySchema = z.object({
  facilityId: z.string().uuid().optional()
})
const heartbeatSchema = z.object({
  cpuPercent: z.number().min(0).max(100),
  ramPercent: z.number().min(0).max(100),
  temperature: z.number().min(-20).max(120),
  ipAddress: z.string().trim().max(64).optional().default('')
})
const credentialIssueSchema = z.object({ reason: z.string().trim().min(10).max(500) })
const credentialRevokeSchema = z.object({ reason: z.string().trim().min(10).max(500) })

router.get('/', authMiddleware, validateQuery(listQuerySchema), async (req, res, next) => {
  try {
    const { facilityId } = req.query
    const facilityIds = await accessibleFacilityIds(prisma, req.user, 'devices_read')
    if (facilityId && !facilityIds.includes(String(facilityId))) {
      return res.status(404).json({ success: false, error: 'Facility not found.', code: 404 })
    }

    const devices = await prisma.device.findMany({
      where: {
        facilityId: facilityId ? String(facilityId) : { in: facilityIds }
      },
      orderBy: [{ status: 'asc' }, { deviceCode: 'asc' }]
    })

    res.json({ success: true, data: devices })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/credentials', authMiddleware, validateBody(credentialIssueSchema), async (req, res, next) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const device = await tx.device.findUnique({
        where: { id: req.params.id },
        include: { facility: { select: { organizationId: true } } }
      })
      if (!device?.facility.organizationId || !(await hasFacilityAccess(tx, req.user, device.facilityId, 'devices_write'))) {
        const error = new Error('Device not found.')
        error.statusCode = 404
        throw error
      }
      const { publicKey, privateKey } = generateKeyPairSync('ed25519')
      const privateKeyOnce = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url')
      const credential = await tx.deviceCredential.create({
        data: { deviceId: device.id, publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url') },
        select: { id: true, createdAt: true }
      })
      await tx.auditEvent.create({
        data: {
          organizationId: device.facility.organizationId,
          facilityId: device.facilityId,
          actorUserId: req.user.id,
          action: 'DEVICE_CREDENTIAL_ISSUED',
          resourceType: 'DeviceCredential',
          resourceId: credential.id,
          reason: req.body.reason,
          afterState: { deviceId: device.id, credentialId: credential.id }
        }
      })
      return { credential, privateKey: privateKeyOnce }
    }, { isolationLevel: 'Serializable' })
    res.set('Cache-Control', 'no-store').set('Pragma', 'no-cache')
    res.status(201).json({ success: true, data: result })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/credentials/:credentialId/revoke', authMiddleware, validateBody(credentialRevokeSchema), async (req, res, next) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const credential = await tx.deviceCredential.findFirst({
        where: { id: req.params.credentialId, deviceId: req.params.id },
        include: { device: { include: { facility: { select: { organizationId: true } } } } }
      })
      if (!credential?.device.facility.organizationId || !(await hasFacilityAccess(tx, req.user, credential.device.facilityId, 'devices_write'))) {
        const error = new Error('Device credential not found.')
        error.statusCode = 404
        throw error
      }
      if (credential.revokedAt) return { id: credential.id, revokedAt: credential.revokedAt }
      const revokedAt = new Date()
      const changed = await tx.deviceCredential.updateMany({
        where: { id: credential.id, revokedAt: null },
        data: { revokedAt }
      })
      if (changed.count) {
        await tx.auditEvent.create({
          data: {
            organizationId: credential.device.facility.organizationId,
            facilityId: credential.device.facilityId,
            actorUserId: req.user.id,
            action: 'DEVICE_CREDENTIAL_REVOKED',
            resourceType: 'DeviceCredential',
            resourceId: credential.id,
            reason: req.body.reason,
            beforeState: { revokedAt: null },
            afterState: { deviceId: credential.device.id, credentialId: credential.id, revokedAt }
          }
        })
      }
      return { id: credential.id, revokedAt }
    }, { isolationLevel: 'Serializable' })
    res.json({ success: true, data: result })
  } catch (error) {
    next(error)
  }
})

router.put('/:id/heartbeat', verifyDeviceIngestion, validateBody(heartbeatSchema), async (req, res, next) => {
  try {
    const { cpuPercent, ramPercent, temperature, ipAddress } = req.body

    const registeredDevice = await prisma.device.findUnique({
      where: { id: req.params.id },
      include: { facility: { select: { organizationId: true } } }
    })
    if (!registeredDevice?.facility.organizationId) {
      return res.status(404).json({ success: false, error: 'Registered device not found.', code: 404 })
    }

    const { device, generatedAlert } = await prisma.$transaction(async (tx) => {
      await consumeDeviceRequest(tx, req.deviceAuth)
      const updatedDevice = await tx.device.update({
        where: { id: registeredDevice.id },
        data: {
          cpuPercent: Number(cpuPercent ?? 0),
          ramPercent: Number(ramPercent ?? 0),
          temperature: Number(temperature ?? 0),
          ipAddress: ipAddress || '',
          lastPingAt: new Date(),
          status: 'ONLINE'
        }
      })
      let alert = null
      if (updatedDevice.cpuPercent > 85 || updatedDevice.temperature > 78) {
        alert = await tx.alert.create({
          data: {
            facilityId: updatedDevice.facilityId,
            severity: 'WARNING',
            title: `Device threshold alert: ${updatedDevice.deviceCode}`,
            description: `CPU ${updatedDevice.cpuPercent}% / Temp ${updatedDevice.temperature}C crossed threshold.`
          }
        })
        await tx.auditEvent.create({
          data: {
            organizationId: registeredDevice.facility.organizationId,
            facilityId: updatedDevice.facilityId,
            actorSystem: 'device-ingestion',
            action: 'DEVICE_THRESHOLD_ALERT_CREATED',
            resourceType: 'Alert',
            resourceId: alert.id,
            afterState: { severity: alert.severity, title: alert.title }
          }
        })
      }
      return { device: updatedDevice, generatedAlert: alert }
    })

    if (generatedAlert) {
      const io = getIO()
      if (io) {
        io.to(device.facilityId).emit('alert:new', generatedAlert)
      }
    }

    res.json({
      success: true,
      data: {
        ...device,
        generatedAlert
      }
    })
  } catch (error) {
    if (error.code === 'P2002' || error.code === 'P2034') {
      return res.status(409).json({ success: false, error: 'Duplicate device request.', code: 409 })
    }
    if (error.code === 'P2025') {
      error.statusCode = 404
      error.message = 'Device not found.'
    }
    next(error)
  }
})

router.get('/stats', authMiddleware, async (req, res, next) => {
  try {
    const facilityIds = await accessibleFacilityIds(prisma, req.user, 'devices_read')
    const [total, online, offline, maintenance] = await Promise.all([
      prisma.device.count({ where: { facilityId: { in: facilityIds } } }),
      prisma.device.count({ where: { facilityId: { in: facilityIds }, status: 'ONLINE' } }),
      prisma.device.count({ where: { facilityId: { in: facilityIds }, status: 'OFFLINE' } }),
      prisma.device.count({ where: { facilityId: { in: facilityIds }, status: 'MAINTENANCE' } })
    ])

    res.json({
      success: true,
      data: {
        total,
        online,
        offline,
        maintenance
      }
    })
  } catch (error) {
    next(error)
  }
})

export default router
