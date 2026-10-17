import 'dotenv/config'

import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import http from 'http'
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
import { installSocketAccess } from './socketAccess.js'
import { logDiagnostic, logProcessError } from './safeLogging.js'

process.on('uncaughtException', (err) => logProcessError('uncaught_exception', err))
process.on('unhandledRejection', (err) => logProcessError('unhandled_rejection', err))

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
app.use(express.json({
  limit: '50kb',
  verify: (req, res, buffer) => {
    req.rawBody = Buffer.from(buffer)
  }
}))

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
})

app.get('/health/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({
      status: 'ready',
      database: 'connected',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logDiagnostic('readiness_check_failed', {
      errorName: error?.name || 'Error',
      errorCode: typeof error?.code === 'string' ? error.code : undefined
    })
    res.status(503).json({
      status: 'not_ready',
      database: 'disconnected',
      timestamp: new Date().toISOString()
    })
  }
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

installSocketAccess(io, { prisma, jwtSecret: config.jwtSecret })

app.use(notFoundHandler)
app.use(errorHandler)

const PORT = config.port

function gracefulShutdown(signal) {
  console.info(`Received ${signal}, initiating graceful shutdown...`)
  httpServer.close(async () => {
    try {
      if (io) {
        await io.close()
      }
      await prisma.$disconnect()
      console.info('Graceful shutdown complete.')
      process.exit(0)
    } catch (err) {
      logProcessError('shutdown_error', err)
      process.exit(1)
    }
  })
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

async function startServer() {
  validateRuntimeConfig(config)
  await prisma.$connect()
  console.info('Database connection established.')

  httpServer.listen(PORT, () => {
    console.info(`SmartPark server listening on port ${PORT}`)
  })
}

startServer().catch((error) => {
  logProcessError('fatal_startup_error', error)
  process.exit(1)
})

export { io }
