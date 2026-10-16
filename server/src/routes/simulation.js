import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'
import { verifyDeviceIngestion } from '../middleware/deviceAuth.js'
import { config } from '../config.js'
import { validateBody } from '../middleware/validate.js'
import { getIO } from '../socket.js'
import { isObservationCurrent } from '../parkingObservations.js'
import { hasFacilityAccess } from '../tenantAccess.js'

const router = Router()

function simulationAllowed(req, res, next) {
  if (config.nodeEnv === 'production' && !config.allowSimulation) {
    return res.status(404).json({ success: false, error: 'Simulation is disabled in production.', code: 404 })
  }
  return next()
}

const startSchema = z.object({
  facilityId: z.string().uuid(),
  intervalSeconds: z.number().int().min(1).max(60).default(5)
})

const piPayloadSchema = z.object({
  parking_id: z.string().min(1),
  device_id: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  slots: z.record(z.string().regex(/^(available|occupied)$/i)),
  confidence: z.number().min(0).max(1).optional(),
  device_health: z
    .object({
      cpuPercent: z.number().min(0).max(100).optional(),
      ramPercent: z.number().min(0).max(100).optional(),
      temperature: z.number().min(-20).max(120).optional(),
      ipAddress: z.string().max(64).optional(),
      status: z.enum(['ONLINE', 'OFFLINE', 'MAINTENANCE']).optional()
    })
    .optional()
})

const STATUS_MAP = {
  available: 'AVAILABLE',
  occupied: 'OCCUPIED',
  reserved: 'RESERVED',
  disabled: 'DISABLED'
}

const state = {
  intervalId: null,
  isRunning: false,
  facilityId: null,
  intervalSeconds: 0,
  updatesCount: 0,
  startedAt: null,
  isTicking: false
}

function pickRandom(array, count) {
  const copy = [...array]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, count)
}

async function emitLiveSummary(facilityId, changedCount) {
  const [available, occupied, reserved, disabled] = await Promise.all([
    prisma.parkingSlot.count({ where: { zone: { facilityId }, status: 'AVAILABLE' } }),
    prisma.parkingSlot.count({ where: { zone: { facilityId }, status: 'OCCUPIED' } }),
    prisma.parkingSlot.count({ where: { zone: { facilityId }, status: 'RESERVED' } }),
    prisma.parkingSlot.count({ where: { zone: { facilityId }, status: 'DISABLED' } })
  ])

  const total = available + occupied + reserved + disabled
  const occupancyRate = total ? Number(((occupied / total) * 100).toFixed(2)) : 0

  const io = getIO()
  if (io) {
    io.to(facilityId).emit('occupancy:live', {
      facilityId,
      total,
      available,
      occupied,
      reserved,
      disabled,
      occupancyRate,
      changedCount,
      updatesCount: state.updatesCount,
      timestamp: new Date().toISOString()
    })
  }
}

async function simulationTick() {
  if (!state.isRunning || state.isTicking || !state.facilityId) return
  state.isTicking = true

  try {
    const now = new Date()
    const candidates = await prisma.parkingSlot.findMany({
      where: {
        zone: { facilityId: state.facilityId },
        status: { in: ['AVAILABLE', 'OCCUPIED'] },
        reservations: {
          none: {
            status: { in: ['UPCOMING', 'ACTIVE'] },
            startTime: { lte: now },
            endTime: { gt: now }
          }
        }
      },
      select: {
        id: true,
        slotCode: true,
        status: true,
        zone: {
          select: {
            name: true,
            facilityId: true,
            facility: { select: { organizationId: true } }
          }
        }
      }
    })

    if (candidates.length === 0) return

    const count = Math.min(candidates.length, Math.floor(Math.random() * 3) + 3)
    const selected = pickRandom(candidates, count)

    const io = getIO()
    const changedSlots = await prisma.$transaction(async (tx) => {
      const changed = []
      for (const slot of selected) {
        const newStatus = slot.status === 'AVAILABLE' ? 'OCCUPIED' : 'AVAILABLE'
        const updated = await tx.parkingSlot.updateMany({
          where: { id: slot.id, status: slot.status },
          data: { status: newStatus }
        })
        if (updated.count !== 1) continue
        const observation = await tx.bayObservation.create({
          data: {
            organizationId: slot.zone.facility.organizationId,
            facilityId: slot.zone.facilityId,
            slotId: slot.id,
            source: 'SIMULATION',
            sourceReference: 'application-simulator',
            deduplicationKey: `simulation:${randomUUID()}`,
            result: newStatus === 'OCCUPIED' ? 'OCCUPIED' : 'VACANT',
            observedAt: now,
            details: { simulation: true }
          }
        })
        await tx.auditEvent.create({
          data: {
            organizationId: slot.zone.facility.organizationId,
            facilityId: slot.zone.facilityId,
            actorSystem: 'application-simulator',
            action: 'SIMULATED_BAY_STATE_CHANGE',
            resourceType: 'ParkingSlot',
            resourceId: slot.id,
            beforeState: { status: slot.status },
            afterState: { status: newStatus, observationId: observation.id }
          }
        })
        changed.push({ ...slot, newStatus })
      }
      return changed
    })

    if (io) {
      changedSlots.forEach((slot) => {
        io.to(state.facilityId).emit('slot:updated', {
          slotId: slot.id,
          status: slot.newStatus,
          slotCode: slot.slotCode,
          zone: slot.zone.name,
          facilityId: slot.zone.facilityId
        })
      })
    }

    state.updatesCount += 1
    await emitLiveSummary(state.facilityId, changedSlots.length)
  } catch (error) {
    console.error('[simulationTick]', error)
  } finally {
    state.isTicking = false
  }
}

function stopSimulationInterval() {
  if (state.intervalId) {
    clearInterval(state.intervalId)
  }
  state.intervalId = null
  state.isRunning = false
  state.facilityId = null
  state.intervalSeconds = 0
  state.startedAt = null
  state.isTicking = false
}

router.post('/start', simulationAllowed, authMiddleware, validateBody(startSchema), async (req, res, next) => {
  try {
    const { facilityId, intervalSeconds } = req.body

    if (!(await hasFacilityAccess(prisma, req.user, facilityId, 'simulation_write'))) {
      const error = new Error('Facility not found.')
      error.statusCode = 404
      throw error
    }

    const facility = await prisma.facility.findUnique({ where: { id: facilityId }, select: { id: true } })
    if (!facility) {
      const error = new Error('Facility not found.')
      error.statusCode = 404
      throw error
    }

    if (state.isRunning) {
      const error = new Error('Simulation is already running. Stop it before starting again.')
      error.statusCode = 409
      throw error
    }

    state.isRunning = true
    state.facilityId = facilityId
    state.intervalSeconds = intervalSeconds
    state.startedAt = Date.now()
    state.updatesCount = 0
    state.intervalId = setInterval(simulationTick, intervalSeconds * 1000)

    res.json({
      success: true,
      data: {
        message: 'Simulation started',
        facilityId,
        intervalSeconds
      }
    })
  } catch (error) {
    next(error)
  }
})

router.post('/stop', simulationAllowed, authMiddleware, async (req, res, next) => {
  try {
    if (state.isRunning) {
      if (!(await hasFacilityAccess(prisma, req.user, state.facilityId, 'simulation_write'))) {
        const error = new Error('Simulation not found.')
        error.statusCode = 404
        throw error
      }
      stopSimulationInterval()
    }

    res.json({
      success: true,
      data: {
        message: 'Simulation stopped'
      }
    })
  } catch (error) {
    next(error)
  }
})

router.post('/pi-payload', simulationAllowed, verifyDeviceIngestion, validateBody(piPayloadSchema), async (req, res, next) => {
  try {
    const { parking_id: facilityId, device_id: deviceId, slots, device_health: deviceHealth } = req.body
    const observedAt = new Date(req.body.timestamp)

    const facility = await prisma.facility.findUnique({ where: { id: facilityId }, select: { id: true } })
    if (!facility) {
      const error = new Error('Facility not found.')
      error.statusCode = 404
      throw error
    }

    const assignedFacility = await prisma.facility.findUnique({ where: { id: facilityId }, select: { organizationId: true } })
    if (!assignedFacility?.organizationId) {
      const error = new Error('Facility is not assigned to an organization.')
      error.statusCode = 409
      throw error
    }

    const sourceDevice = await prisma.device.findFirst({
      where: { facilityId, OR: [{ id: deviceId }, { deviceCode: deviceId }] },
      select: { id: true, facility: { select: { organizationId: true } } }
    })
    if (!sourceDevice) {
      const error = new Error('Registered device not found for this facility.')
      error.statusCode = 404
      throw error
    }
    if (sourceDevice.facility.organizationId !== assignedFacility.organizationId) {
      const error = new Error('Device organization does not match the facility.')
      error.statusCode = 403
      throw error
    }

    const io = getIO()
    const slotEntries = Object.entries(slots)
    let slotsUpdated = 0
    let observationsStored = 0
    let staleOrConflicting = 0

    for (const [slotCode, value] of slotEntries) {
      const mappedStatus = STATUS_MAP[String(value).toLowerCase()]
      if (!mappedStatus) continue

      const targetSlot = await prisma.parkingSlot.findFirst({
        where: {
          slotCode,
          zone: { facilityId }
        },
        include: {
          zone: { select: { name: true, facilityId: true } }
        }
      })
      if (!targetSlot) continue

      const latestEvidence = await prisma.bayObservation.findFirst({
        where: { facilityId, slotId: targetSlot.id },
        orderBy: { observedAt: 'desc' },
        select: { observedAt: true }
      })
      const newerThanSlot = isObservationCurrent(targetSlot, observedAt)
      const newerThanEvidence = !latestEvidence || latestEvidence.observedAt < observedAt
      if (!newerThanSlot || !newerThanEvidence) staleOrConflicting += 1

      try {
        await prisma.bayObservation.create({
          data: {
            organizationId: assignedFacility.organizationId,
            facilityId,
            slotId: targetSlot.id,
            deviceId: sourceDevice.id,
            source: 'DEVICE_REPORT',
            sourceReference: deviceId,
            deduplicationKey: `device-report:${sourceDevice.id}:${targetSlot.id}:${observedAt.toISOString()}`,
            result: mappedStatus === 'OCCUPIED' ? 'OCCUPIED' : 'VACANT',
            confidence: req.body.confidence,
            observedAt,
            freshnessSeconds: Math.max(0, Math.round((Date.now() - observedAt.getTime()) / 1000))
          }
        })
        observationsStored += 1
      } catch (error) {
        if (error.code !== 'P2002') throw error
        staleOrConflicting += 1
      }
    }

    if (deviceHealth) {
      const device = await prisma.device.findUnique({ where: { id: sourceDevice.id } })
      await prisma.device.updateMany({
        where: { id: sourceDevice.id, lastPingAt: { lt: observedAt } },
        data: {
          cpuPercent: deviceHealth.cpuPercent ?? device.cpuPercent,
          ramPercent: deviceHealth.ramPercent ?? device.ramPercent,
          temperature: deviceHealth.temperature ?? device.temperature,
          ipAddress: deviceHealth.ipAddress ?? device.ipAddress,
          status: 'ONLINE',
          lastPingAt: observedAt
        }
      })
    }

    await emitLiveSummary(facilityId, slotsUpdated)

    res.json({
      success: true,
      data: {
        processed: true,
        slotsUpdated,
        slotsObserved: observationsStored,
        staleOrConflicting
      }
    })
  } catch (error) {
    next(error)
  }
})

router.get('/status', authMiddleware, async (req, res, next) => {
  try {
    if (state.facilityId && !(await hasFacilityAccess(prisma, req.user, state.facilityId, 'operations_read'))) {
      return res.json({ success: true, data: { isRunning: false, facilityId: null, intervalSeconds: 0, updatesCount: 0, uptimeSeconds: 0 } })
    }
    res.json({
      success: true,
      data: {
        isRunning: state.isRunning,
        facilityId: state.facilityId,
        intervalSeconds: state.intervalSeconds,
        updatesCount: state.updatesCount,
        uptimeSeconds: state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0
      }
    })
  } catch (error) {
    next(error)
  }
})

export default router
