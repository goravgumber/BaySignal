import 'dotenv/config'
import { prisma } from '../src/db.js'

const email = String(process.env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase()
const reason = String(process.env.PLATFORM_ADMIN_BOOTSTRAP_REASON || '').trim()

async function main() {
  if (process.env.PLATFORM_ADMIN_BOOTSTRAP_CONFIRM !== 'GRANT-PLATFORM-ADMIN') {
    throw new Error('Set PLATFORM_ADMIN_BOOTSTRAP_CONFIRM=GRANT-PLATFORM-ADMIN to authorize this one-time action.')
  }
  if (!email || reason.length < 20) {
    throw new Error('Set PLATFORM_ADMIN_EMAIL for an existing account and a PLATFORM_ADMIN_BOOTSTRAP_REASON of at least 20 characters.')
  }

  await prisma.$transaction(async (tx) => {
    const activePlatformAdmin = await tx.user.findFirst({ where: { role: 'PLATFORM_ADMIN' }, select: { id: true } })
    if (activePlatformAdmin) throw new Error('A platform administrator already exists; bootstrap is one-time only.')

    const user = await tx.user.findUnique({ where: { email }, select: { id: true, role: true } })
    if (!user) throw new Error('The selected existing account was not found.')

    const updated = await tx.user.update({ where: { id: user.id }, data: { role: 'PLATFORM_ADMIN' } })
    await tx.auditEvent.create({
      data: {
        actorSystem: 'controlled-platform-admin-bootstrap',
        action: 'PLATFORM_ADMIN_BOOTSTRAPPED',
        resourceType: 'User',
        resourceId: user.id,
        reason,
        beforeState: { role: user.role },
        afterState: { role: updated.role }
      }
    })
  }, { isolationLevel: 'Serializable' })

  console.info('Platform administrator bootstrap completed for the selected existing account.')
}

main()
  .catch((error) => {
    console.error('Platform administrator bootstrap failed:', error.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
