import { Outlet, useLocation } from 'react-router-dom'
import { useMemo, useState } from 'react'
import Sidebar from './Sidebar'
import Header from './Header'
import VoiceAssistant from '../voice/VoiceAssistant'

const titleMap = {
  '/dashboard/map': 'Parking operations',
  '/dashboard/analytics': 'Analytics',
  '/dashboard/environment': 'Environment',
  '/dashboard/reservations': 'Reservations',
  '/dashboard/revenue': 'Revenue',
  '/dashboard/alerts': 'Alerts',
  '/dashboard/admin': 'Admin Panel'
}

export default function AppShell() {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  const title = titleMap[location.pathname] || 'Mission Control'
  const breadcrumb = useMemo(() => {
    const parts = location.pathname.split('/').filter(Boolean)
    return ['Dashboard', ...parts.slice(1).map((part) => part[0].toUpperCase() + part.slice(1))].join(' / ')
  }, [location.pathname])

  return (
    <div className="min-h-screen">
      <div className="flex h-screen">
        <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

        <div className="flex min-h-screen flex-1 flex-col">
          <Header
            title={title}
            breadcrumb={breadcrumb}
            onMenuToggle={() => setMobileOpen((value) => !value)}
          />

          <main className="flex-1 overflow-y-auto pt-16 md:pl-64">
            <div className="min-h-[calc(100vh-64px)] p-4 md:p-6">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      <VoiceAssistant />
    </div>
  )
}
