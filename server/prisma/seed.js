import bcrypt from 'bcryptjs'
import { prisma } from '../src/db.js'
import { validateSeedEnvironment } from '../src/seedPolicy.js'

function shuffle(array) {
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function getVehicleNumber(index) {
  const letters = ['AB', 'CD', 'EF', 'GH', 'IJ', 'KL', 'MN', 'PQ', 'RS', 'TU', 'UV', 'WX', 'YZ', 'ZX', 'LM']
  const serial = (1234 + index * 37).toString().padStart(4, '0').slice(-4)
  return `MH-02-${letters[index % letters.length]}-${serial}`
}

async function main() {
  const seedPassword = validateSeedEnvironment()
  const existingUsers = await prisma.user.count()
  if (existingUsers > 0) {
    console.log('✅ Database already seeded. Skipping seed.')
    return
  }

  console.log('🌱 Seeding database...')

  console.log('✅ Creating users...')
  const hashedPassword = await bcrypt.hash(seedPassword, 10)
  const [adminUser, ownerUser, driverUser] = await Promise.all([
    prisma.user.create({
      data: {
        email: 'admin@smartpark.ai',
        passwordHash: hashedPassword,
        name: 'SmartPark Admin',
        role: 'ADMIN'
      }
    }),
    prisma.user.create({
      data: {
        email: 'owner@smartpark.ai',
        passwordHash: hashedPassword,
        name: 'Facility Owner',
        role: 'OWNER'
      }
    }),
    prisma.user.create({
      data: {
        email: 'driver@smartpark.ai',
        passwordHash: hashedPassword,
        name: 'Demo Driver',
        role: 'DRIVER'
      }
    })
  ])

  console.log('✅ Creating facility...')
  const facility = await prisma.facility.create({
    data: {
      name: 'Phoenix Palladium Mall',
      address: 'Lower Parel, Mumbai',
      city: 'Mumbai',
      totalSlots: 120,
      lat: 18.9926,
      lng: 72.8258
    }
  })

  console.log('✅ Creating zones...')
  const zonesToCreate = [
    { name: 'Zone A', code: 'A', capacity: 30, ratePerHour: 20 },
    { name: 'Zone B', code: 'B', capacity: 30, ratePerHour: 20 },
    { name: 'Zone C', code: 'C', capacity: 30, ratePerHour: 15 },
    { name: 'VIP', code: 'VIP', capacity: 20, ratePerHour: 50 },
    { name: 'Handicap', code: 'H', capacity: 10, ratePerHour: 10 }
  ]

  const createdZones = {}
  for (const zone of zonesToCreate) {
    const created = await prisma.zone.create({
      data: {
        facilityId: facility.id,
        name: zone.name,
        code: zone.code,
        capacity: zone.capacity,
        ratePerHour: zone.ratePerHour
      }
    })
    createdZones[zone.code] = created
  }

  console.log('✅ Creating 120 parking slots with target status distribution...')
  const statuses = [
    ...Array(54).fill('OCCUPIED'),
    ...Array(48).fill('AVAILABLE'),
    ...Array(12).fill('RESERVED'),
    ...Array(6).fill('DISABLED')
  ]
  const shuffledStatuses = shuffle(statuses)

  const slotBlueprints = []
  for (let i = 1; i <= 30; i += 1) {
    slotBlueprints.push({ zoneCode: 'A', slotCode: `A-${String(i).padStart(2, '0')}`, slotType: 'STANDARD' })
  }
  for (let i = 1; i <= 30; i += 1) {
    slotBlueprints.push({ zoneCode: 'B', slotCode: `B-${String(i).padStart(2, '0')}`, slotType: i <= 5 ? 'EV' : 'STANDARD' })
  }
  for (let i = 1; i <= 30; i += 1) {
    slotBlueprints.push({ zoneCode: 'C', slotCode: `C-${String(i).padStart(2, '0')}`, slotType: 'STANDARD' })
  }
  for (let i = 1; i <= 20; i += 1) {
    slotBlueprints.push({ zoneCode: 'VIP', slotCode: `V-${String(i).padStart(2, '0')}`, slotType: 'VIP' })
  }
  for (let i = 1; i <= 10; i += 1) {
    slotBlueprints.push({ zoneCode: 'H', slotCode: `H-${String(i).padStart(2, '0')}`, slotType: 'HANDICAP' })
  }

  await prisma.$transaction(
    slotBlueprints.map((slot, index) =>
      prisma.parkingSlot.create({
        data: {
          zoneId: createdZones[slot.zoneCode].id,
          slotCode: slot.slotCode,
          status: shuffledStatuses[index],
          slotType: slot.slotType
        }
      })
    )
  )

  const allSlots = await prisma.parkingSlot.findMany({
    where: {
      status: {
        in: ['AVAILABLE', 'RESERVED', 'OCCUPIED']
      }
    },
    include: {
      zone: true
    }
  })

  console.log('✅ Creating reservations...')
  const reservationNames = [
    'Rahul Sharma',
    'Priya Patel',
    'Amit Kumar',
    'Sunita Singh',
    'Vikram Joshi',
    'Deepa Nair',
    'Arjun Reddy',
    'Kavita Mehta',
    'Suresh Iyer',
    'Pooja Gupta',
    'Rajesh Khanna',
    'Meera Pillai',
    'Anil Desai',
    'Farida Sheikh',
    'Karan Malhotra'
  ]
  const reservationStatuses = [
    'UPCOMING',
    'ACTIVE',
    'COMPLETED',
    'CANCELLED',
    'UPCOMING',
    'ACTIVE',
    'COMPLETED',
    'UPCOMING',
    'ACTIVE',
    'COMPLETED',
    'CANCELLED',
    'UPCOMING',
    'ACTIVE',
    'COMPLETED',
    'UPCOMING'
  ]

  const reservationUsers = [driverUser.id, ownerUser.id, driverUser.id, adminUser.id]
  const selectedSlots = shuffle(allSlots).slice(0, reservationNames.length)

  for (let i = 0; i < reservationNames.length; i += 1) {
    const slot = selectedSlots[i]
    const status = reservationStatuses[i]
    const now = Date.now()
    const startOffsetHours = status === 'COMPLETED' ? -(i + 5) : status === 'ACTIVE' ? -1 : i + 1
    const durationHours = (i % 4) + 1
    const startTime = new Date(now + startOffsetHours * 60 * 60 * 1000)
    const endTime = new Date(startTime.getTime() + durationHours * 60 * 60 * 1000)
    const baseAmount = slot.zone.ratePerHour * durationHours

    await prisma.reservation.create({
      data: {
        reservationCode: `SPK-${String(i + 1).padStart(4, '0')}`,
        slotId: slot.id,
        userId: reservationUsers[i % reservationUsers.length],
        vehicleNumber: getVehicleNumber(i),
        driverName: reservationNames[i],
        driverPhone: `98${String(20000000 + i * 733).slice(0, 8)}`,
        durationHours,
        baseAmount,
        totalAmount: baseAmount,
        status,
        paymentMethod: i % 2 === 0 ? 'UPI' : 'CARD',
        startTime,
        endTime
      }
    })
  }

  console.log('✅ Creating devices...')
  await prisma.device.createMany({
    data: [
      {
        deviceCode: 'RAPI-01',
        facilityId: facility.id,
        zone: 'Zone A',
        status: 'ONLINE',
        cpuPercent: 34,
        ramPercent: 62,
        temperature: 52,
        ipAddress: '10.0.0.11'
      },
      {
        deviceCode: 'RAPI-02',
        facilityId: facility.id,
        zone: 'Zone B',
        status: 'ONLINE',
        cpuPercent: 78,
        ramPercent: 71,
        temperature: 71,
        ipAddress: '10.0.0.12'
      },
      {
        deviceCode: 'RAPI-03',
        facilityId: facility.id,
        zone: 'Zone C',
        status: 'OFFLINE',
        cpuPercent: 0,
        ramPercent: 0,
        temperature: 0,
        ipAddress: '10.0.0.13'
      },
      {
        deviceCode: 'RAPI-04',
        facilityId: facility.id,
        zone: 'VIP',
        status: 'MAINTENANCE',
        cpuPercent: 22,
        ramPercent: 38,
        temperature: 44,
        ipAddress: '10.0.0.14'
      }
    ]
  })

  console.log('✅ Creating alerts...')
  await prisma.alert.createMany({
    data: [
      {
        facilityId: facility.id,
        severity: 'CRITICAL',
        title: 'Zone B Sensor Overheating',
        description: 'Thermal threshold breached at RAPI-02.',
        isResolved: false
      },
      {
        facilityId: facility.id,
        severity: 'WARNING',
        title: 'Congestion Spike in Zone A',
        description: 'Occupancy crossed 90% for over 15 minutes.',
        isResolved: false
      },
      {
        facilityId: facility.id,
        severity: 'INFO',
        title: 'Night Mode Activated',
        description: 'Lighting and safety mode switched for late hours.',
        isResolved: true
      },
      {
        facilityId: facility.id,
        severity: 'WARNING',
        title: 'VIP Entry Camera Lag',
        description: 'Frame drop detected on VIP lane camera.',
        isResolved: false
      },
      {
        facilityId: facility.id,
        severity: 'CRITICAL',
        title: 'Zone C Gateway Offline',
        description: 'RAPI-03 last ping exceeded outage threshold.',
        isResolved: false
      },
      {
        facilityId: facility.id,
        severity: 'INFO',
        title: 'Daily Backup Completed',
        description: 'Parking telemetry backup completed successfully.',
        isResolved: true
      },
      {
        facilityId: facility.id,
        severity: 'WARNING',
        title: 'Payment Retry Burst',
        description: 'Multiple payment retries observed in past 10 minutes.',
        isResolved: false
      },
      {
        facilityId: facility.id,
        severity: 'INFO',
        title: 'EV Charger Utilization High',
        description: 'EV slots are at 85% average utilization.',
        isResolved: false
      }
    ]
  })

  console.log('✅ Seed complete. SmartPark demo data is ready.')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    if (error?.code === 'P1010') {
      console.error('⚠️ Seed skipped: database access denied during deploy startup (P1010).')
      console.error('   Ensure Render DATABASE_URL is attached to the same Postgres instance and SSL is enabled.')
      await prisma.$disconnect()
      return
    }
    console.error('❌ Seed failed:', error)
    await prisma.$disconnect()
    throw error
  })
