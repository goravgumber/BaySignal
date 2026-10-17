import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, ChevronDown, Menu, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { api } from '../../services/api'

const routeCatalog = [
  { title: 'Parking operations', path: '/dashboard/map', keywords: 'parking map bay zone', permission: 'operations_read' },
  { title: 'Reservations', path: '/dashboard/reservations', keywords: 'reservation booking', permission: 'reservations_read', allowDriver: true },
  { title: 'Analytics', path: '/dashboard/analytics', keywords: 'analytics utilization', permission: 'analytics_read' },
  { title: 'Revenue', path: '/dashboard/revenue', keywords: 'revenue finance', permission: 'finance_read' },
  { title: 'Alerts', path: '/dashboard/alerts', keywords: 'alerts incident', permission: 'alerts_read' },
  { title: 'Device records', path: '/dashboard/admin', keywords: 'admin devices settings', permission: 'devices_read' }
]

function canOpenRoute(item, user) {
  return user?.permissions?.includes(item.permission) || (item.allowDriver && user?.role === 'DRIVER')
}

export default function Header({ title, breadcrumb, onMenuToggle }) {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchFailed, setSearchFailed] = useState(false)
  const [alerts, setAlerts] = useState([])
  const [alertsFailed, setAlertsFailed] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const searchRef = useRef(null)
  const canViewAlerts = user?.permissions?.includes('alerts_read')
  const initials = useMemo(() => (user?.name || 'User').split(' ').slice(0, 2).map((part) => part[0]?.toUpperCase()).join(''), [user?.name])

  useEffect(() => {
    if (!canViewAlerts) return undefined
    let cancelled = false
    api.get('/alerts?resolved=false').then((response) => {
      if (!cancelled) setAlerts(response.data.data || [])
    }).catch(() => {
      if (!cancelled) setAlertsFailed(true)
    })
    return () => { cancelled = true }
  }, [canViewAlerts])

  useEffect(() => {
    const query = searchQuery.trim().toLowerCase()
    if (query.length < 2) {
      setSearchResults([])
      setSearchFailed(false)
      return undefined
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setSearchLoading(true)
      setSearchFailed(false)
      try {
        const [facilityResponse, reservationResponse] = await Promise.all([
          api.get('/parking/facilities'),
          api.get('/reservations?page=1&limit=100')
        ])
        const facilities = facilityResponse.data.data || []
        const facility = facilities[0]
        const results = routeCatalog
          .filter((item) => canOpenRoute(item, user) && `${item.title} ${item.keywords}`.toLowerCase().includes(query))
          .map((item) => ({ id: `route-${item.path}`, title: item.title, subtitle: 'Open page', path: item.path }))
        for (const item of facilities) {
          if (`${item.name} ${item.address || ''}`.toLowerCase().includes(query)) results.push({ id: `facility-${item.id}`, title: item.name, subtitle: item.address || 'Facility', path: '/dashboard/map' })
        }
        if (facility?.id) {
          const slotResponse = await api.get(`/parking/facilities/${facility.id}/slots`)
          for (const slot of slotResponse.data.data || []) {
            if (`${slot.slotCode} ${slot.zone?.name || ''} ${slot.status}`.toLowerCase().includes(query)) {
              results.push({ id: `slot-${slot.id}`, title: `Bay ${slot.slotCode}`, subtitle: `${slot.zone?.name || 'Zone'} · ${slot.status}`, path: '/dashboard/map' })
            }
          }
        }
        for (const reservation of reservationResponse.data.data?.data || []) {
          if (`${reservation.reservationCode} ${reservation.vehicleNumber} ${reservation.driverName}`.toLowerCase().includes(query)) {
            results.push({ id: `reservation-${reservation.id}`, title: reservation.reservationCode, subtitle: `${reservation.vehicleNumber} · ${reservation.status}`, path: '/dashboard/reservations' })
          }
        }
        if (!cancelled) setSearchResults(results.slice(0, 10))
      } catch {
        if (!cancelled) {
          setSearchFailed(true)
          setSearchResults(routeCatalog.filter((item) => canOpenRoute(item, user) && `${item.title} ${item.keywords}`.toLowerCase().includes(query)).map((item) => ({ id: `route-${item.path}`, title: item.title, subtitle: 'Open page', path: item.path })))
        }
      } finally {
        if (!cancelled) setSearchLoading(false)
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [searchQuery, user?.role, user?.permissions?.join(',')])

  function selectResult(item) {
    navigate(item.path)
    setSearchOpen(false)
    setSearchQuery('')
  }

  function signOut() {
    logout()
    navigate('/login')
  }

  return (
    <header className="fixed left-0 right-0 top-0 z-40 h-16 border-b border-slate-200 bg-white md:left-64">
      <div className="flex h-full items-center justify-between gap-3 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" aria-label="Open navigation" onClick={onMenuToggle} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-700 md:hidden"><Menu size={18} /></button>
          <div className="min-w-0"><p className="truncate text-base font-semibold text-slate-900">{title}</p><p className="truncate text-xs text-slate-500">{breadcrumb}</p></div>
        </div>

        <div ref={searchRef} className="relative hidden w-full max-w-xl md:block">
          <form onSubmit={(event) => { event.preventDefault(); if (searchResults[0]) selectResult(searchResults[0]) }} className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
            <Search size={16} className="text-slate-500" aria-hidden="true" />
            <input value={searchQuery} onFocus={() => setSearchOpen(true)} onChange={(event) => { setSearchQuery(event.target.value); setSearchOpen(true) }} placeholder="Search bays and reservations" aria-label="Search bays and reservations" className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-500" />
          </form>
          {searchOpen && searchQuery.trim().length >= 2 ? <div className="absolute left-0 right-0 top-12 z-50 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
            {searchLoading ? <p className="px-3 py-2 text-sm text-slate-500">Searching…</p> : null}
            {searchFailed ? <p className="px-3 py-2 text-xs text-amber-800">Some results could not be loaded. Page shortcuts may still be available.</p> : null}
            {!searchLoading && searchResults.length === 0 ? <p className="px-3 py-2 text-sm text-slate-600">No matching results.</p> : null}
            {searchResults.map((item) => <button key={item.id} type="button" onClick={() => selectResult(item)} className="block min-h-12 w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50"><span className="block text-sm font-medium text-slate-900">{item.title}</span><span className="block text-xs text-slate-500">{item.subtitle}</span></button>)}
          </div> : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {canViewAlerts ? <div className="relative">
            <button type="button" aria-label={`Open unresolved alerts${alerts.length ? `, ${alerts.length}` : ''}`} onClick={() => { setAlertsOpen((value) => !value); setUserOpen(false) }} className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">
              <Bell size={18} />{alerts.length ? <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold text-white">{alerts.length}</span> : null}
            </button>
            {alertsOpen ? <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
              <p className="mb-2 text-sm font-semibold text-slate-900">Unresolved alerts</p>
              {alertsFailed ? <p className="text-sm text-slate-600">Alerts could not be loaded.</p> : null}
              {!alertsFailed && alerts.length === 0 ? <p className="text-sm text-slate-600">No unresolved alerts returned.</p> : null}
              <div className="space-y-2">{alerts.slice(0, 4).map((alert) => <div key={alert.id} className="rounded-lg border border-slate-200 px-3 py-2"><p className="text-sm font-medium text-slate-900">{alert.title}</p><p className="mt-1 text-xs text-slate-500">{alert.severity} · {new Date(alert.createdAt).toLocaleString()}</p></div>)}</div>
              <button type="button" onClick={() => { navigate('/dashboard/alerts'); setAlertsOpen(false) }} className="mt-3 min-h-10 w-full rounded-lg bg-blue-50 px-3 text-sm font-medium text-blue-800">Open alerts</button>
            </div> : null}
          </div> : null}

          <div className="relative">
            <button type="button" aria-label="Account menu" onClick={() => { setUserOpen((value) => !value); setAlertsOpen(false) }} className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">{initials || 'U'}</span><ChevronDown size={14} className="text-slate-500" />
            </button>
            {userOpen ? <div className="absolute right-0 mt-2 w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"><button type="button" onClick={signOut} className="min-h-10 w-full rounded-lg px-3 text-left text-sm text-slate-700 hover:bg-slate-50">Sign out</button></div> : null}
          </div>
        </div>
      </div>
    </header>
  )
}
