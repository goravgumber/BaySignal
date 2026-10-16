import { NavLink, useNavigate } from 'react-router-dom'
import { Map, Calendar, Bell, Settings, LogOut } from 'lucide-react'
import { useAuth } from '../../store/auth'

const navItems = [
  { to: '/dashboard/map', label: 'Parking operations', icon: Map, permission: 'operations_read' },
  { to: '/dashboard/reservations', label: 'Reservations', icon: Calendar, permission: 'reservations_read', allowDriver: true },
  { to: '/dashboard/alerts', label: 'Alerts', icon: Bell, permission: 'alerts_read' },
  { to: '/dashboard/admin', label: 'Device records', icon: Settings, permission: 'devices_read' }
]

export default function Sidebar({ mobileOpen, onClose }) {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const visibleItems = navItems.filter((item) => user?.permissions?.includes(item.permission) || (item.allowDriver && user?.role === 'DRIVER'))
  const initials = (user?.name || 'User').split(' ').slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <>
      {mobileOpen ? <button type="button" aria-label="Close navigation" className="fixed inset-0 z-40 bg-slate-950/30 md:hidden" onClick={onClose} /> : null}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white p-4 transition-transform md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="mb-6 flex items-center gap-3 px-2 py-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 font-semibold text-white">B</span>
          <div>
            <p className="font-semibold tracking-tight text-slate-900">BaySignal</p>
            <p className="text-xs text-slate-500">Working name</p>
          </div>
        </div>

        <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Workspace</p>
        <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto">
          {visibleItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink key={item.to} to={item.to} onClick={onClose} className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition ${isActive ? 'bg-blue-50 font-semibold text-blue-800' : 'text-slate-700 hover:bg-slate-50'}`}>
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        <div className="mt-4 border-t border-slate-200 pt-4">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">{initials || 'U'}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{user?.name || 'Account'}</p>
              <p className="text-xs capitalize text-slate-500">{(user?.role || 'user').toLowerCase()}</p>
            </div>
          </div>
          <button type="button" onClick={handleLogout} className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 transition hover:bg-slate-50">
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </div>
      </aside>
    </>
  )
}
