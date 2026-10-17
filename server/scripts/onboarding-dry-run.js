import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../src/db.js'

async function main() {
  const planFilePath = process.env.ONBOARDING_PLAN_FILE

  if (!planFilePath) {
    console.info('=== BaySignal Tenant Onboarding Inventory Report ===\n')
    console.info('No ONBOARDING_PLAN_FILE provided. Generating inventory of unassigned resources...\n')

    const [unassignedFacilities, organizations, legacyUsers] = await Promise.all([
      prisma.facility.findMany({
        where: { organizationId: null },
        select: { id: true, name: true, address: true, city: true, totalSlots: true, createdAt: true }
      }),
      prisma.organization.findMany({
        select: { id: true, name: true, slug: true, createdAt: true, _count: { select: { facilities: true, memberships: true } } }
      }),
      prisma.user.findMany({
        where: { memberships: { none: {} } },
        select: { id: true, email: true, name: true, role: true, createdAt: true }
      })
    ])

    console.info(`Unassigned Facilities (${unassignedFacilities.length}):`)
    if (unassignedFacilities.length === 0) {
      console.info('  (None - all facilities are mapped to organizations)')
    } else {
      for (const fac of unassignedFacilities) {
        console.info(`  - Facility ID: ${fac.id} | Name: "${fac.name}" | City: ${fac.city} | Slots: ${fac.totalSlots}`)
      }
    }

    console.info(`\nExisting Organizations (${organizations.length}):`)
    if (organizations.length === 0) {
      console.info('  (None created yet - platform administrator must create target organization)')
    } else {
      for (const org of organizations) {
        console.info(`  - Org ID: ${org.id} | Slug: ${org.slug} | Name: "${org.name}" | Facilities: ${org._count.facilities} | Members: ${org._count.memberships}`)
      }
    }

    console.info(`\nUnmapped Users (${legacyUsers.length}):`)
    if (legacyUsers.length === 0) {
      console.info('  (None - all users have organization memberships)')
    } else {
      for (const u of legacyUsers) {
        console.info(`  - User ID: ${u.id} | Email: ${u.email} | Legacy Role: ${u.role}`)
      }
    }

    console.info('\nTo execute a dry-run against a proposed onboarding plan:')
    console.info('  1. Create a JSON plan file (e.g., onboarding-plan.json).')
    console.info('  2. Set ONBOARDING_PLAN_FILE=path/to/plan.json')
    console.info('  3. Run: npm run tenant:dry-run\n')
    return
  }

  const resolvedPath = path.resolve(process.cwd(), planFilePath)
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Onboarding plan file not found: ${resolvedPath}`)
  }

  const plan = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'))
  console.info(`=== BaySignal Tenant Onboarding Dry-Run Report ===`)
  console.info(`Plan file: ${resolvedPath}`)
  console.info(`Generated at: ${new Date().toISOString()}\n`)

  const errors = []
  const warnings = []

  // 1. Validate Organization
  let targetOrg = null
  if (plan.organization?.id) {
    targetOrg = await prisma.organization.findUnique({ where: { id: plan.organization.id } })
    if (!targetOrg) {
      errors.push(`Target organization ID ${plan.organization.id} not found in database.`)
    }
  } else if (plan.organization?.slug) {
    targetOrg = await prisma.organization.findUnique({ where: { slug: plan.organization.slug } })
    if (!targetOrg) {
      warnings.push(`Target organization slug "${plan.organization.slug}" does not exist yet; will need to be created by platform administrator.`)
    }
  } else {
    errors.push('Plan must specify target organization.id or organization.slug.')
  }

  // 2. Validate Facility Assignments
  const facilityAssignments = plan.facilityAssignments || []
  const verifiedFacilities = []

  for (const fa of facilityAssignments) {
    if (!fa.facilityId) {
      errors.push('Facility assignment missing facilityId.')
      continue
    }
    if (!fa.reason || fa.reason.trim().length < 20) {
      errors.push(`Facility ${fa.facilityId} assignment reason must be at least 20 characters.`)
    }
    const facility = await prisma.facility.findUnique({
      where: { id: fa.facilityId },
      select: { id: true, name: true, organizationId: true }
    })
    if (!facility) {
      errors.push(`Facility ID ${fa.facilityId} not found in database.`)
    } else if (facility.organizationId) {
      errors.push(`Facility ID ${fa.facilityId} ("${facility.name}") is ALREADY assigned to organization ${facility.organizationId}. Cross-tenant transfer forbidden.`)
    } else {
      verifiedFacilities.push({ id: facility.id, name: facility.name, reason: fa.reason })
    }
  }

  // 3. Validate User Memberships and Grants
  const memberships = plan.memberships || []
  const verifiedMemberships = []
  const validRoles = ['ORG_ADMIN', 'FACILITY_MANAGER', 'ATTENDANT', 'FINANCE', 'DEVICE_TECHNICIAN', 'DRIVER', 'VIEWER']

  for (const m of memberships) {
    if (!m.userId) {
      errors.push('Membership entry missing userId.')
      continue
    }
    if (!validRoles.includes(m.role)) {
      errors.push(`Invalid role "${m.role}" for user ${m.userId}. Must be one of: ${validRoles.join(', ')}`)
    }
    if (m.role === 'ORG_ADMIN' && m.facilityId) {
      errors.push(`User ${m.userId}: ORG_ADMIN receives organization-wide scope and cannot be granted a facility-specific role.`)
    }
    if (m.role !== 'ORG_ADMIN' && !m.facilityId) {
      errors.push(`User ${m.userId}: Role "${m.role}" requires an explicit facilityId.`)
    }
    if (!m.reason || m.reason.trim().length < 10) {
      errors.push(`User ${m.userId} membership reason must be at least 10 characters.`)
    }

    const user = await prisma.user.findUnique({
      where: { id: m.userId },
      select: { id: true, email: true, name: true, role: true }
    })
    if (!user) {
      errors.push(`User ID ${m.userId} not found in database.`)
    } else {
      if (m.facilityId) {
        const facInPlan = verifiedFacilities.find((f) => f.id === m.facilityId)
        if (!facInPlan && targetOrg) {
          const facInOrg = await prisma.facility.findFirst({
            where: { id: m.facilityId, organizationId: targetOrg.id }
          })
          if (!facInOrg) {
            errors.push(`Facility ID ${m.facilityId} for user ${m.userId} is not assigned to target organization and not in this onboarding plan.`)
          }
        }
      }
      verifiedMemberships.push({
        userId: user.id,
        email: user.email,
        name: user.name,
        legacyRole: user.role,
        targetRole: m.role,
        facilityId: m.facilityId || null,
        reason: m.reason
      })
    }
  }

  console.info('--- Dry-Run Verification Results ---')
  if (errors.length > 0) {
    console.error(`Status: REJECTED with ${errors.length} error(s):`)
    for (const err of errors) console.error(`  [ERROR] ${err}`)
  } else {
    console.info('Status: VALID (Plan meets all validation constraints)')
  }

  if (warnings.length > 0) {
    console.info(`\nWarnings (${warnings.length}):`)
    for (const w of warnings) console.info(`  [WARN] ${w}`)
  }

  console.info(`\nPlanned Facility Assignments (${verifiedFacilities.length}):`)
  for (const vf of verifiedFacilities) {
    console.info(`  - Facility: ${vf.name} (${vf.id}) -> Target Org`)
    console.info(`    Reason: "${vf.reason}"`)
  }

  console.info(`\nPlanned Memberships & Grants (${verifiedMemberships.length}):`)
  for (const vm of verifiedMemberships) {
    console.info(`  - User: ${vm.name} <${vm.email}> (Legacy: ${vm.legacyRole})`)
    console.info(`    Grant: ${vm.targetRole}${vm.facilityId ? ` on facility ${vm.facilityId}` : ' (Organization-wide)'}`)
    console.info(`    Reason: "${vm.reason}"`)
  }

  console.info('\n============================================================')
  console.info('DRY-RUN ONLY: NO DATABASE WRITES OR PRIVILEGED CHANGES MADE.')
  console.info('============================================================\n')

  if (errors.length > 0) {
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error('Dry-run script failed:', error.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
