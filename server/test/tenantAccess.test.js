import test from 'node:test'
import assert from 'node:assert/strict'
import { accessibleFacilityIds, canAccessFacility, hasFacilityAccess } from '../src/tenantAccess.js'

const facility = { id: 'facility-a', organizationId: 'org-a' }
const memberships = [
  { id: 'member-a', userId: 'user-a', organizationId: 'org-a', role: 'ATTENDANT', status: 'ACTIVE' },
  { id: 'member-b', userId: 'user-a', organizationId: 'org-b', role: 'ORG_ADMIN', status: 'ACTIVE' }
]
const grants = [
  { membershipId: 'member-a', facilityId: 'facility-a', role: 'ATTENDANT' },
  { membershipId: 'member-b', facilityId: 'facility-a', role: 'FACILITY_MANAGER' }
]

test('facility grants permit an explicitly assigned attendant for allowed work', () => {
  assert.equal(canAccessFacility({ user: { id: 'user-a' }, facility, memberships, grants, permission: 'operations_read' }), true)
  assert.equal(canAccessFacility({ user: { id: 'user-a' }, facility, memberships, grants, permission: 'correction_write' }), false)
})

test('a membership or grant from another organization cannot cross a tenant boundary', () => {
  const onlyForeignMembership = memberships.filter(({ id }) => id === 'member-b')
  assert.equal(canAccessFacility({ user: { id: 'user-a' }, facility, memberships: onlyForeignMembership, grants, permission: 'operations_read' }), false)
})

test('legacy unassigned facilities remain inaccessible even to former owner roles', () => {
  assert.equal(canAccessFacility({ user: { id: 'legacy', role: 'OWNER' }, facility: { id: 'legacy-facility', organizationId: null }, permission: 'operations_read' }), false)
})

test('only a platform administrator role grants platform-wide access', () => {
  assert.equal(canAccessFacility({ user: { id: 'platform', role: 'PLATFORM_ADMIN' }, facility, permission: 'operations_read' }), true)
  assert.equal(canAccessFacility({ user: { id: 'legacy', role: 'ADMIN' }, facility, permission: 'operations_read' }), false)
})

test('facility queries exclude grants whose membership belongs to a different organization', async () => {
  const fakePrisma = {
    organizationMembership: {
      findMany: async () => [{ id: 'member-a', organizationId: 'org-a', role: 'ATTENDANT' }]
    },
    facility: {
      findMany: async () => [
        { id: 'facility-a', organizationId: 'org-a', facilityAccess: [{ membership: { organizationId: 'org-a' } }] },
        { id: 'facility-b', organizationId: 'org-b', facilityAccess: [{ membership: { organizationId: 'org-b' } }] }
      ]
    }
  }
  const ids = await accessibleFacilityIds(fakePrisma, { id: 'user-a' }, 'operations_read')
  assert.deepEqual(ids, ['facility-a'])
  assert.equal(await hasFacilityAccess(fakePrisma, { id: 'user-a' }, 'facility-b', 'operations_read'), false)
})
