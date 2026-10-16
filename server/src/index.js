import 'dotenv/config'

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception', err)
})

process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection', err)
})

import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import http from 'http'
import jwt from 'jsonwebtoken'
import { Server } from 'socket.io'
import { config, validateRuntimeConfig } from './config.js'
import authRoutes from './routes/auth.js'
import parkingRoutes from './routes/parking.js'
import reservationRoutes from './routes/reservations.js'
import analyticsRoutes from './routes/analytics.js'
import alertRoutes from './routes/alerts.js'
import deviceRoutes from './routes/devices.js'
import voiceRoutes from './routes/voice.js'
import simulationRoutes from './routes/simulation.js'
import operationsRoutes from './routes/operations.js'
import tenantRoutes from './routes/tenants.js'

import { setIO } from './socket.js'
import { generalRateLimit } from './middleware/rateLimiter.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { prisma } from './db.js'
import { hasFacilityAccess } from './tenantAccess.js'

const app = express()
app.set('trust proxy', config.trustProxy ? 1 : false)

const httpServer = http.createServer(app)

const io = new Server(httpServer, {
  cors: {
    origin: config.frontendUrl || "*"
  },
  maxHttpBufferSize: 1e5
})

setIO(io)

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
)

app.use(
  cors({
    origin: config.frontendUrl,
    credentials: true
  })
)

app.use(generalRateLimit)
app.use(express.json({ limit: '50kb' }))

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
})

console.log("⚙️ Registering routes...")

app.use('/api/auth', authRoutes)
app.use('/api/parking', parkingRoutes)
app.use('/api/reservations', reservationRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/alerts', alertRoutes)
app.use('/api/devices', deviceRoutes)
app.use('/api/voice', voiceRoutes)
app.use('/api/simulation', simulationRoutes)
app.use('/api/operations', operationsRoutes)
app.use('/api/tenants', tenantRoutes)

io.use((socket, next) => {
  try {
    const authToken = socket.handshake?.auth?.token
    const headerToken = socket.handshake?.headers?.authorization?.replace('Bearer ', '')
    const token = authToken || headerToken

    if (!token) {
      return next(new Error('Unauthorized socket connection.'))
    }

    const decoded = jwt.verify(token, config.jwtSecret)
    socket.data.user = decoded
    return next()
  } catch (error) {
    console.error('Socket auth error', error?.message || error)
    return next(new Error('Unauthorized socket connection.'))
  }
})

io.on('connection', (socket) => {
  console.info(`Socket connected: ${socket.id}`)

  socket.on('join:facility', async (facilityId) => {
    try {
      const userId = socket.data?.user?.id
      if (!userId || !facilityId) return

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } })
      if (!user || !(await hasFacilityAccess(prisma, user, String(facilityId), 'operations_read'))) return
      socket.join(String(facilityId))
    } catch (error) {
      console.error('Socket join error', error)
    }
  })
})

app.use(notFoundHandler)
app.use(errorHandler)

const PORT = config.port

async function startServer() {
  validateRuntimeConfig(config)
  await prisma.$connect()
  console.info('Database connection established.')

  httpServer.listen(PORT, () => {
    console.info(`SmartPark server listening on port ${PORT}`)
  })
}

startServer().catch((error) => {
  console.error('Fatal startup error:', error.message)
  process.exit(1)
})

export { io }
