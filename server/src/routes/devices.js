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
const deviceRegisterSchema = z.object({
  facilityId: z.string().uuid(),
  deviceCode: z.string().trim().min(2).max(64),
  zone: z.string().trim().min(1).max(64)
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

router.post('/', authMiddleware, validateBody(deviceRegisterSchema), async (req, res, next) => {
  try {
    const { facilityId, deviceCode, zone } = req.body
    const facility = await prisma.facility.findUnique({
      where: { id: facilityId },
      select: { id: true, organizationId: true }
    })
    if (!facility?.organizationId || !(await hasFacilityAccess(prisma, req.user, facilityId, 'devices_write'))) {
      const error = new Error('Facility not found.')
      error.statusCode = 404
      throw error
    }

    const device = await prisma.$transaction(async (tx) => {
      const existing = await tx.device.findUnique({ where: { deviceCode } })
      if (existing) {
        const error = new Error('Device code already registered.')
        error.statusCode = 409
        throw error
      }
      const created = await tx.device.create({
        data: {
          facilityId,
          deviceCode,
          zone,
          status: 'ONLINE',
          ingestionEnabled: true
        }
      })
      await tx.auditEvent.create({
        data: {
          organizationId: facility.organizationId,
          facilityId,
          actorUserId: req.user.id,
          action: 'DEVICE_REGISTERED',
          resourceType: 'Device',
          resourceId: created.id,
          afterState: { deviceCode: created.deviceCode, facilityId, zone }
        }
      })
      return created
    }, { isolationLevel: 'Serializable' })

    res.status(201).json({ success: true, data: device })
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, error: 'Device code already registered.', code: 409 })
    }
    next(error)
  }
})

router.get('/diagnostics', authMiddleware, validateQuery(listQuerySchema), async (req, res, next) => {
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
      include: {
        credentials: {
          select: { id: true, createdAt: true, revokedAt: true }
        }
      },
      orderBy: [{ status: 'asc' }, { deviceCode: 'asc' }]
    })

    const now = Date.now()
    const STALE_THRESHOLD_SECONDS = 300
    const OFFLINE_THRESHOLD_SECONDS = 900

    const diagnostics = devices.map((d) => {
      const lastPingTime = d.lastPingAt ? new Date(d.lastPingAt).getTime() : 0
      const ageSeconds = lastPingTime > 0 ? Math.max(0, Math.floor((now - lastPingTime) / 1000)) : null
      let reportingStatus = 'UNKNOWN'
      if (d.status === 'MAINTENANCE') {
        reportingStatus = 'MAINTENANCE'
      } else if (!d.ingestionEnabled) {
        reportingStatus = 'DISABLED'
      } else if (ageSeconds === null) {
        reportingStatus = 'NEVER_REPORTED'
      } else if (ageSeconds <= STALE_THRESHOLD_SECONDS) {
        reportingStatus = 'ONLINE'
      } else if (ageSeconds <= OFFLINE_THRESHOLD_SECONDS) {
        reportingStatus = 'STALE'
      } else {
        reportingStatus = 'OFFLINE'
      }

      const activeCredentials = d.credentials.filter((c) => !c.revokedAt).length
      const revokedCredentials = d.credentials.filter((c) => c.revokedAt).length

      return {
        id: d.id,
        deviceCode: d.deviceCode,
        facilityId: d.facilityId,
        zone: d.zone,
        status: d.status,
        ingestionEnabled: d.ingestionEnabled,
        lastPingAt: d.lastPingAt,
        ageSeconds,
        reportingStatus,
        activeCredentials,
        revokedCredentials,
        cpuPercent: d.cpuPercent,
        ramPercent: d.ramPercent,
        temperature: d.temperature
      }
    })

    const summary = {
      total: diagnostics.length,
      online: diagnostics.filter((d) => d.reportingStatus === 'ONLINE').length,
      stale: diagnostics.filter((d) => d.reportingStatus === 'STALE').length,
      offline: diagnostics.filter((d) => ['OFFLINE', 'NEVER_REPORTED'].includes(d.reportingStatus)).length,
      maintenance: diagnostics.filter((d) => d.reportingStatus === 'MAINTENANCE').length
    }

    res.json({ success: true, data: { devices: diagnostics, summary } })
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

const deviceObservationSchema = z.object({
  parking_id: z.string().uuid(),
  timestamp: z.string().datetime({ offset: true }),
  slots: z.record(z.string().regex(/^(available|occupied)$/i)),
  confidence: z.number().min(0).max(1).optional(),
  device_health: z.object({
    cpuPercent: z.number().min(0).max(100).optional(),
    ramPercent: z.number().min(0).max(100).optional(),
    temperature: z.number().min(-20).max(120).optional(),
    ipAddress: z.string().max(64).optional()
  }).optional()
})

router.post('/:id/observations', verifyDeviceIngestion, validateBody(deviceObservationSchema), async (req, res, next) => {
  try {
    const { parking_id: facilityId, slots, confidence, device_health: deviceHealth } = req.body
    const observedAt = new Date(req.body.timestamp)

    const result = await prisma.$transaction(async (tx) => {
      await consumeDeviceRequest(tx, req.deviceAuth)
      const sourceDevice = await tx.device.findUnique({
        where: { id: req.deviceAuth.device.id },
        include: { facility: { select: { organizationId: true } } }
      })
      if (!sourceDevice?.facility.organizationId || sourceDevice.facilityId !== facilityId || sourceDevice.id !== req.params.id) {
        const error = new Error('Invalid device authentication.')
        error.statusCode = 401
        throw error
      }

      let observationsStored = 0
      let duplicatesSkipped = 0

      for (const [slotCode, value] of Object.entries(slots)) {
        const mappedStatus = String(value).toUpperCase()
        if (!['AVAILABLE', 'OCCUPIED'].includes(mappedStatus)) continue
        const targetSlot = await tx.parkingSlot.findFirst({
          where: { slotCode, zone: { facilityId } }
        })
        if (!targetSlot) continue

        try {
          await tx.bayObservation.create({
            data: {
              organizationId: sourceDevice.facility.organizationId,
              facilityId,
              slotId: targetSlot.id,
              deviceId: sourceDevice.id,
              source: 'DEVICE_REPORT',
              sourceReference: sourceDevice.id,
              deduplicationKey: `device-report:${sourceDevice.id}:${targetSlot.id}:${observedAt.toISOString()}`,
              result: mappedStatus === 'OCCUPIED' ? 'OCCUPIED' : 'VACANT',
              confidence,
              observedAt,
              freshnessSeconds: Math.max(0, Math.round((Date.now() - observedAt.getTime()) / 1000))
            }
          })
          observationsStored += 1
        } catch (err) {
          if (err.code !== 'P2002') throw err
          duplicatesSkipped += 1
        }
      }

      let alert = null
      if (deviceHealth) {
        const updated = await tx.device.update({
          where: { id: sourceDevice.id },
          data: {
            cpuPercent: deviceHealth.cpuPercent !== undefined ? Number(deviceHealth.cpuPercent) : undefined,
            ramPercent: deviceHealth.ramPercent !== undefined ? Number(deviceHealth.ramPercent) : undefined,
            temperature: deviceHealth.temperature !== undefined ? Number(deviceHealth.temperature) : undefined,
            ipAddress: deviceHealth.ipAddress || undefined,
            lastPingAt: observedAt,
            status: 'ONLINE'
          }
        })

        if (updated.cpuPercent > 85 || updated.temperature > 78) {
          alert = await tx.alert.create({
            data: {
              facilityId,
              severity: 'WARNING',
              title: `Device threshold alert: ${sourceDevice.deviceCode}`,
              description: `CPU ${updated.cpuPercent}% / Temp ${updated.temperature}C crossed threshold.`
            }
          })
          await tx.auditEvent.create({
            data: {
              organizationId: sourceDevice.facility.organizationId,
              facilityId,
              actorSystem: 'device-ingestion',
              action: 'DEVICE_THRESHOLD_ALERT_CREATED',
              resourceType: 'Alert',
              resourceId: alert.id,
              afterState: { severity: alert.severity, title: alert.title }
            }
          })
        }
      }

      return {
        processed: true,
        slotsObserved: observationsStored,
        duplicatesSkipped,
        generatedAlert: alert
      }
    })

    if (result.generatedAlert) {
      const io = getIO()
      if (io) io.to(facilityId).emit('alert:new', result.generatedAlert)
    }

    res.json({ success: true, data: result })
  } catch (error) {
    if (error.code === 'P2002' || error.code === 'P2034') {
      return res.status(409).json({ success: false, error: 'Duplicate device request.', code: 409 })
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
