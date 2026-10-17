import jwt from 'jsonwebtoken'
import { hasFacilityAccess } from './tenantAccess.js'

export function installSocketAccess(io, { prisma, jwtSecret }) {
  io.use((socket, next) => {
    try {
      const authToken = socket.handshake?.auth?.token
      const headerToken = socket.handshake?.headers?.authorization?.replace(/^Bearer\s+/i, '')
      const token = authToken || headerToken
      if (!token) return next(new Error('Unauthorized socket connection.'))
      socket.data.user = jwt.verify(token, jwtSecret)
      return next()
    } catch {
      return next(new Error('Unauthorized socket connection.'))
    }
  })

  io.on('connection', (socket) => {
    socket.on('join:facility', async (facilityId) => {
      try {
        const userId = socket.data?.user?.id
        if (!userId || typeof facilityId !== 'string' || !facilityId) return

        const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } })
        if (!user || !(await hasFacilityAccess(prisma, user, facilityId, 'operations_read'))) return
        socket.join(facilityId)
      } catch {
        // Keep connection errors generic and avoid logging request or token data.
      }
    })
  })
}
