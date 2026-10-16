const rolesByPermission = {
  operations_read: ['FACILITY_MANAGER', 'ATTENDANT', 'DRIVER', 'VIEWER'],
  simulation_write: ['FACILITY_MANAGER'],
  reservations_read: ['FACILITY_MANAGER', 'ATTENDANT', 'DRIVER', 'VIEWER'],
  reservations_write: ['FACILITY_MANAGER', 'ATTENDANT', 'DRIVER'],
  reservation_checkin: ['FACILITY_MANAGER', 'ATTENDANT'],
  devices_read: ['FACILITY_MANAGER', 'DEVICE_TECHNICIAN'],
  devices_write: ['DEVICE_TECHNICIAN'],
  alerts_read: ['FACILITY_MANAGER', 'ATTENDANT', 'DEVICE_TECHNICIAN', 'VIEWER'],
  alerts_write: ['FACILITY_MANAGER'],
  analytics_read: ['FACILITY_MANAGER', 'FINANCE', 'VIEWER'],
  finance_read: ['FINANCE'],
  audit_read: ['FACILITY_MANAGER'],
  facility_settings: [],
  correction_write: ['FACILITY_MANAGER']
}

const accessPermissions = Object.keys(rolesByPermission)

export function canAccessFacility({ user, facility, memberships = [], grants = [], permission }) {
  if (!user?.id || !facility?.id || !facility.organizationId) return false
  if (user.role === 'PLATFORM_ADMIN') return true
  if (user.role === 'DRIVER' && facility.allowPublicReservations && ['operations_read', 'reservations_write'].includes(permission)) return true

  const activeMemberships = memberships.filter((membership) =>
    membership.userId === user.id &&
    membership.organizationId === facility.organizationId &&
    membership.status === 'ACTIVE'
  )
  if (!activeMemberships.length) return false
  if (activeMemberships.some((membership) => membership.role === 'ORG_ADMIN')) return true

  const allowedRoles = rolesByPermission[permission] || []
  return grants.some((grant) =>
    grant.facilityId === facility.id &&
    activeMemberships.some((membership) =>
      membership.id === grant.membershipId &&
      membership.organizationId === facility.organizationId
    ) &&
    allowedRoles.includes(grant.role)
  )
}

export async function accessibleFacilityIds(prisma, user, permission) {
  if (!user?.id) return []
  if (user.role === 'PLATFORM_ADMIN') {
    const facilities = await prisma.facility.findMany({ select: { id: true } })
    return facilities.map(({ id }) => id)
  }

  const memberships = await prisma.organizationMembership.findMany({
    where: { userId: user.id, status: 'ACTIVE' },
    select: { id: true, organizationId: true, role: true }
  })
  if (memberships.length === 0) {
    if (user.role === 'DRIVER' && ['operations_read', 'reservations_write'].includes(permission)) {
      const publicFacilities = await prisma.facility.findMany({
        where: { organizationId: { not: null }, allowPublicReservations: true },
        select: { id: true }
      })
      return publicFacilities.map(({ id }) => id)
    }
    return []
  }

  const organizationAdminIds = memberships
    .filter(({ role }) => role === 'ORG_ADMIN')
    .map(({ organizationId }) => organizationId)
  const facilityRoleAllowList = rolesByPermission[permission] || []
  const facilities = await prisma.facility.findMany({
    where: {
      organizationId: { not: null },
      OR: [
        ...(organizationAdminIds.length ? [{ organizationId: { in: organizationAdminIds } }] : []),
        {
          facilityAccess: {
            some: {
              role: { in: facilityRoleAllowList },
              membership: { userId: user.id, status: 'ACTIVE' }
            }
          }
        }
      ]
    },
    select: {
      id: true,
      organizationId: true,
      facilityAccess: {
        where: {
          role: { in: facilityRoleAllowList },
          membership: { userId: user.id, status: 'ACTIVE' }
        },
        select: { membership: { select: { organizationId: true } } }
      }
    }
  })

  const membershipOrganizationIds = new Set(memberships.map(({ organizationId }) => organizationId))
  const authorizedIds = facilities
    .filter((facility) => {
      if (organizationAdminIds.includes(facility.organizationId)) return true
      if (!membershipOrganizationIds.has(facility.organizationId)) return false
      return facility.facilityAccess.some((grant) => grant.membership.organizationId === facility.organizationId)
    })
    .map(({ id }) => id)
  if (user.role === 'DRIVER' && ['operations_read', 'reservations_write'].includes(permission)) {
    const publicFacilities = await prisma.facility.findMany({
      where: { organizationId: { not: null }, allowPublicReservations: true },
      select: { id: true }
    })
    return [...new Set([...authorizedIds, ...publicFacilities.map(({ id }) => id)])]
  }
  return authorizedIds
}

export async function hasFacilityAccess(prisma, user, facilityId, permission) {
  const ids = await accessibleFacilityIds(prisma, user, permission)
  return ids.includes(facilityId)
}

export async function userAccessSummary(prisma, user) {
  const facilitiesByPermission = {}
  for (const permission of accessPermissions) {
    facilitiesByPermission[permission] = await accessibleFacilityIds(prisma, user, permission)
  }
  return {
    permissions: accessPermissions.filter((permission) => facilitiesByPermission[permission].length > 0),
    facilitiesByPermission
  }
}
