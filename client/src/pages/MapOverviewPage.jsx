import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Bookmark, CarFront, Check, CircleHelp, Clock3, Grid2X2, Loader2, RefreshCw, Search, Table2, Wrench, X } from 'lucide-react'
import { api } from '../services/api'
import useSocket from '../hooks/useSocket'
import ToastContainer from '../components/ui/ToastContainer'
import SimulationPanel from '../components/SimulationPanel'
import { useAuth } from '../store/auth'

const statusMeta = {
  AVAILABLE: { label: 'Available', className: 'border-green-200 bg-green-50 text-green-800', Icon: Check },
  OCCUPIED: { label: 'Occupied', className: 'border-red-200 bg-red-50 text-red-800', Icon: CarFront },
  RESERVED: { label: 'Reserved', className: 'border-amber-200 bg-amber-50 text-amber-900', Icon: Bookmark },
  DISABLED: { label: 'Out of service', className: 'border-slate-300 bg-slate-100 text-slate-700', Icon: Wrench },
  UNKNOWN: { label: 'Unknown / unverified', className: 'border-slate-300 bg-slate-100 text-slate-700', Icon: CircleHelp },
  CONFLICTING: { label: 'Needs review', className: 'border-red-300 bg-red-50 text-red-900', Icon: AlertCircle }
}

function slotMeta(status) {
  return statusMeta[status] || { label: 'Unknown / unverified', className: 'border-slate-300 bg-slate-100 text-slate-700', Icon: CircleHelp }
}

function ReservationDialog({ slot, onClose, onCreated, addToast }) {
  const [driverName, setDriverName] = useState('')
  const [driverPhone, setDriverPhone] = useState('')
  const [vehicleNumber, setVehicleNumber] = useState('')
  const [durationHours, setDurationHours] = useState(2)
  const [submitting, setSubmitting] = useState(false)
  const [reservation, setReservation] = useState(null)

  async function submit(event) {
    event.preventDefault()
    setSubmitting(true)
    try {
      const response = await api.post('/reservations', {
        slotId: slot.id,
        vehicleNumber: vehicleNumber.trim().toUpperCase(),
        driverName: driverName.trim(),
        driverPhone: driverPhone.trim(),
        durationHours,
        startTime: new Date().toISOString()
      })
      setReservation(response.data.data)
      onCreated(slot.id)
      addToast({ type: 'success', title: 'Reservation created', message: response.data.data.reservationCode })
    } catch (error) {
      addToast({ type: 'error', title: 'Reservation was not created', message: error?.response?.data?.error || 'Check your connection and try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  return <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section role="dialog" aria-modal="true" aria-labelledby="reservation-title" className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 shadow-xl sm:rounded-2xl sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div><p className="font-mono text-xs uppercase tracking-wider text-slate-500">{slot.zone?.name} · {slot.slotCode}</p><h2 id="reservation-title" className="mt-1 text-xl font-semibold text-slate-900">{reservation ? 'Reservation created' : 'Reserve this bay'}</h2></div>
        <button type="button" aria-label="Close dialog" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"><X size={19} /></button>
      </div>
      {reservation ? <div className="mt-5 space-y-4">
        <div className="rounded-xl border border-green-200 bg-green-50 p-4"><p className="text-sm font-semibold text-green-900">Booking record saved</p><p className="mt-1 font-mono text-lg text-green-900">{reservation.reservationCode}</p><p className="mt-2 text-sm text-green-900">No payment was processed. This prototype does not issue a validated QR pass.</p></div>
        <p className="text-sm text-slate-600">A reservation is a planned time window. It does not confirm facility arrival or physical bay occupancy.</p>
        <button type="button" onClick={onClose} className="min-h-12 w-full rounded-lg bg-blue-600 px-4 font-semibold text-white hover:bg-blue-700">Done</button>
      </div> : <form onSubmit={submit} className="mt-5 space-y-4">
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">Rate: ₹{slot.zone?.ratePerHour ?? '—'} per hour. Payment is not collected here.</p>
        <label className="block text-sm font-medium text-slate-800">Driver name<input value={driverName} onChange={(event) => setDriverName(event.target.value)} required maxLength={80} autoComplete="name" className="mt-1.5 min-h-12 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /></label>
        <label className="block text-sm font-medium text-slate-800">Phone number<input type="tel" value={driverPhone} onChange={(event) => setDriverPhone(event.target.value)} required minLength={8} maxLength={20} autoComplete="tel" className="mt-1.5 min-h-12 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /></label>
        <label className="block text-sm font-medium text-slate-800">Vehicle registration<input value={vehicleNumber} onChange={(event) => setVehicleNumber(event.target.value.toUpperCase())} required minLength={6} maxLength={20} autoComplete="off" placeholder="KA 01 AB 1234" className="mt-1.5 min-h-12 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm uppercase outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" /></label>
        <label className="block text-sm font-medium text-slate-800">Duration<select value={durationHours} onChange={(event) => setDurationHours(Number(event.target.value))} className="mt-1.5 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100">{[1, 2, 3, 4, 6, 8, 12].map((hours) => <option key={hours} value={hours}>{hours} hour{hours > 1 ? 's' : ''}</option>)}</select></label>
        <button type="submit" disabled={submitting} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 font-semibold text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-70">{submitting ? <><Loader2 size={18} className="animate-spin" /> Creating reservation…</> : 'Create reservation'}</button>
      </form>}
    </section>
  </div>
}

export default function MapOverviewPage() {
  const { user } = useAuth()
  const [facilities, setFacilities] = useState([])
  const [facilityId, setFacilityId] = useState('')
  const [slots, setSlots] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [zoneFilter, setZoneFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [query, setQuery] = useState('')
  const [view, setView] = useState('grid')
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [bookingSlot, setBookingSlot] = useState(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)
  const [simulationRunning, setSimulationRunning] = useState(false)
  const [toasts, setToasts] = useState([])
  const { isConnected, lastEvent } = useSocket(facilityId)
  const canSimulate = user?.permissions?.includes('simulation_write')

  const addToast = useCallback((toast) => setToasts((prev) => [...prev, { ...toast, id: crypto.randomUUID() }]), [])
  const removeToast = useCallback((id) => setToasts((prev) => prev.filter((item) => item.id !== id)), [])

  const refreshFacility = useCallback(async (id) => {
    const [slotsResponse, summaryResponse] = await Promise.all([
      api.get(`/parking/facilities/${id}/slots`),
      api.get(`/parking/summary/${id}`)
    ])
    setSlots(slotsResponse.data.data || [])
    setSummary(summaryResponse.data.data || null)
    setLastUpdatedAt(new Date())
  }, [])

  const loadFacilities = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const response = await api.get('/parking/facilities')
      const list = response.data.data || []
      setFacilities(list)
      const id = list.some((item) => item.id === facilityId) ? facilityId : list[0]?.id || ''
      setFacilityId(id)
      if (id && id === facilityId) await refreshFacility(id)
      else if (id) setLoading(true)
      else { setSlots([]); setSummary(null); setLastUpdatedAt(null) }
    } catch (error) {
      setLoadError(error?.response?.data?.error || 'Parking information could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [facilityId, refreshFacility])

  useEffect(() => { loadFacilities() }, [])

  useEffect(() => {
    if (!facilityId) return
    let cancelled = false
    setLoading(true)
    refreshFacility(facilityId).catch((error) => {
      if (!cancelled) setLoadError(error?.response?.data?.error || 'Parking information could not be loaded.')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [facilityId, refreshFacility])

  useEffect(() => {
    if (!facilityId) return undefined
    const interval = setInterval(() => {
      refreshFacility(facilityId).catch(() => {})
    }, 15000)
    return () => clearInterval(interval)
  }, [facilityId, refreshFacility])

  useEffect(() => {
    if (lastEvent?.type !== 'slot:updated' || !lastEvent.payload) return
    const update = lastEvent.payload
    setSlots((current) => current.map((slot) => {
      if (slot.id !== update.slotId) return slot
      const displayStatus = slot.reservationHold ? (update.status === 'AVAILABLE' ? 'RESERVED' : 'CONFLICTING') : update.status === 'RESERVED' ? 'UNKNOWN' : update.status
      return { ...slot, status: update.status, displayStatus }
    }))
    setLastUpdatedAt(new Date(lastEvent.at))
    if (facilityId) api.get(`/parking/summary/${facilityId}`).then((response) => setSummary(response.data.data || null)).catch(() => {})
  }, [lastEvent, facilityId])

  useEffect(() => {
    if (!canSimulate) return undefined
    let cancelled = false
    api.get('/simulation/status').then((response) => {
      if (!cancelled) setSimulationRunning(Boolean(response.data.data?.isRunning))
    }).catch(() => {})
    const interval = setInterval(() => {
      api.get('/simulation/status').then((response) => {
        if (!cancelled) setSimulationRunning(Boolean(response.data.data?.isRunning))
      }).catch(() => {})
    }, 5000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [canSimulate])

  const zones = useMemo(() => [...new Map(slots.map((slot) => [slot.zone?.code || slot.zone?.name, slot.zone])).entries()].filter(([key]) => key).map(([key, zone]) => ({ key, name: zone?.name || key })), [slots])
  const filtered = useMemo(() => slots.filter((slot) => {
    const zone = slot.zone?.code || slot.zone?.name
    const zoneMatch = zoneFilter === 'ALL' || zone === zoneFilter || slot.zone?.name === zoneFilter
    const statusMatch = statusFilter === 'ALL' || (slot.displayStatus || slot.status) === statusFilter
    const queryMatch = `${slot.slotCode} ${slot.zone?.name || ''}`.toLowerCase().includes(query.trim().toLowerCase())
    return zoneMatch && statusMatch && queryMatch
  }), [slots, zoneFilter, statusFilter, query])

  const count = (status) => slots.filter((slot) => slot.status === status).length
  const activeFacility = facilities.find((facility) => facility.id === facilityId)

  return <div className="space-y-5">
    <ToastContainer toasts={toasts} onRemove={removeToast} />
    <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Parking operations</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Bay status</h1>
        <p className="mt-1 text-sm text-slate-600">Recorded bay states and reservations for this facility.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {facilities.length > 1 ? <label className="sr-only" htmlFor="facility-select">Select facility</label> : null}
        {facilities.length > 1 ? <select id="facility-select" value={facilityId} onChange={(event) => setFacilityId(event.target.value)} className="min-h-11 min-w-52 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800">{facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}</select> : <span className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800">{activeFacility?.name || (loading ? 'Loading facility…' : 'No facility configured')}</span>}
        <span className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm ${isConnected ? 'border-green-200 bg-green-50 text-green-800' : 'border-slate-300 bg-slate-100 text-slate-700'}`}><span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-600' : 'bg-slate-500'}`} />{isConnected ? 'Realtime connected' : 'Realtime disconnected'}</span>
        <button type="button" onClick={loadFacilities} disabled={loading} aria-label="Refresh parking data" className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button>
      </div>
    </div>

    {simulationRunning ? <div className="flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950"><span className="rounded bg-violet-100 px-2 py-1 font-mono text-xs font-semibold">[SIMULATION]</span><span>Bay changes are generated by the simulator; do not treat them as verified sensor readings.</span></div> : null}

    {summary ? <section aria-label="Bay state summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {[
        ['Total capacity', summary.total ?? slots.length, 'text-slate-900'],
        ['Available', summary.available ?? count('AVAILABLE'), 'text-green-800'],
        ['Occupied', summary.occupied ?? count('OCCUPIED'), 'text-red-800'],
        ['Reserved', summary.reserved ?? count('RESERVED'), 'text-amber-800'],
        ['Out of service', summary.disabled ?? count('DISABLED'), 'text-slate-700'],
        ['Unverified / conflict', summary.unverified ?? 0, 'text-slate-700']
      ].map(([label, value, tone]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-2 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p><p className="mt-1 text-xs text-slate-500">{label === 'Total capacity' ? 'Configured bays' : 'Recorded bay state'}</p></div>)}
    </section> : null}

    <section className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950"><p className="font-semibold">Facility presence is separate from bay occupancy.</p><p className="mt-1 text-blue-900">This prototype does not maintain a verified vehicle-inside ledger or sensor provenance for each bay.</p></section>

    {canSimulate ? <details className="rounded-xl border border-slate-200 bg-white px-4 py-3"><summary className="cursor-pointer text-sm font-medium text-slate-700">Demo controls</summary><div className="mt-3"><SimulationPanel facilityId={facilityId} /></div></details> : null}

    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2" aria-label="Filter by zone">
          {[{ key: 'ALL', name: 'All zones' }, ...zones].map((zone) => <button key={zone.key} type="button" aria-pressed={zoneFilter === zone.key} onClick={() => setZoneFilter(zone.key)} className={`min-h-10 rounded-lg border px-3 text-sm ${zoneFilter === zone.key ? 'border-blue-600 bg-blue-50 font-semibold text-blue-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>{zone.name}</button>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-10 min-w-52 flex-1 items-center gap-2 rounded-lg border border-slate-300 px-3 lg:flex-none"><Search size={16} className="text-slate-500" /><span className="sr-only">Search bays</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a bay" className="w-full text-sm outline-none placeholder:text-slate-500" /></label>
          <select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700"><option value="ALL">All states</option>{Object.entries(statusMeta).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select>
          <div className="flex rounded-lg border border-slate-200 p-1" aria-label="Bay view">
            <button type="button" aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')} className={`flex h-9 w-9 items-center justify-center rounded-md ${view === 'grid' ? 'bg-blue-50 text-blue-800' : 'text-slate-600'}`}><Grid2X2 size={17} /></button>
            <button type="button" aria-label="Table view" aria-pressed={view === 'table'} onClick={() => setView('table')} className={`flex h-9 w-9 items-center justify-center rounded-md ${view === 'table' ? 'bg-blue-50 text-blue-800' : 'text-slate-600'}`}><Table2 size={17} /></button>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-xs text-slate-700">
        {Object.entries(statusMeta).map(([key, meta]) => <span key={key} className="inline-flex items-center gap-1.5"><meta.Icon size={14} aria-hidden="true" />{meta.label}</span>)}
        <span className="inline-flex items-center gap-1.5"><CircleHelp size={14} aria-hidden="true" />Unknown / unverified</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-slate-500"><Clock3 size={14} />{lastUpdatedAt ? `Updated ${lastUpdatedAt.toLocaleTimeString()}` : 'Update time unavailable'}</span>
      </div>
    </section>

    {loadError ? <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><div className="flex gap-2"><AlertCircle size={18} className="mt-0.5 shrink-0" /><div><p className="font-semibold">Parking data could not be loaded</p><p className="mt-1">{loadError}</p></div></div><button type="button" onClick={loadFacilities} className="min-h-10 shrink-0 rounded-lg border border-red-300 px-3 font-medium">Try again</button></div> : null}

    {loading && slots.length === 0 ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">{Array.from({ length: 12 }, (_, index) => <div key={index} className="h-36 animate-pulse rounded-xl border border-slate-200 bg-white" />)}</div> : null}
    {!loading && !loadError && facilities.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"><Building2Icon /><h2 className="mt-3 font-semibold text-slate-900">No facility is configured</h2><p className="mt-1 text-sm text-slate-600">Ask your administrator to set up a facility for this account.</p></div> : null}
    {!loading && !loadError && facilities.length > 0 && slots.length === 0 ? <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center"><p className="font-semibold text-slate-900">No bays are configured for this facility.</p></div> : null}

    {!loadError && slots.length > 0 ? <div className={selectedSlot && view === 'grid' ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]' : ''}>
      <section className="space-y-4" aria-label="Parking bays">
        {view === 'grid' ? <div className="space-y-4">{zones.filter((zone) => zoneFilter === 'ALL' || zone.key === zoneFilter || zone.name === zoneFilter).map((zone) => {
          const zoneSlots = filtered.filter((slot) => (slot.zone?.code || slot.zone?.name) === zone.key || slot.zone?.name === zone.name)
          if (!zoneSlots.length) return null
          return <section key={zone.key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-semibold text-slate-900">{zone.name}</h2><span className="text-xs text-slate-500">{zoneSlots.length} bays shown</span></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">
            {zoneSlots.map((slot) => <BayCard key={slot.id} slot={slot} selected={selectedSlot?.id === slot.id} onClick={() => setSelectedSlot(slot)} />)}
          </div></section>
        })}{filtered.length === 0 ? <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-600">No bays match these filters.</div> : null}</div> : <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full min-w-[560px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600"><tr><th scope="col" className="px-4 py-3">Bay</th><th scope="col" className="px-4 py-3">Zone</th><th scope="col" className="px-4 py-3">Recorded state</th><th scope="col" className="px-4 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{filtered.map((slot) => { const meta = slotMeta(slot.status); return <tr key={slot.id} className="hover:bg-slate-50"><td className="px-4 py-3 font-mono font-medium">{slot.slotCode}</td><td className="px-4 py-3">{slot.zone?.name}</td><td className="px-4 py-3"><span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${meta.className}`}>{meta.label}</span></td><td className="px-4 py-3"><button type="button" onClick={() => setSelectedSlot(slot)} className="min-h-9 rounded-lg px-3 text-sm font-medium text-blue-700 hover:bg-blue-50">Details</button></td></tr>})}</tbody></table></div>}
      </section>
      {selectedSlot && view === 'grid' ? <BayDetails slot={selectedSlot} onClose={() => setSelectedSlot(null)} onReserve={() => selectedSlot.status === 'AVAILABLE' && setBookingSlot(selectedSlot)} /> : null}
    </div> : null}

    {selectedSlot && view === 'table' ? <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/30" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedSlot(null) }}><BayDetails slot={selectedSlot} onClose={() => setSelectedSlot(null)} onReserve={() => selectedSlot.status === 'AVAILABLE' && setBookingSlot(selectedSlot)} drawer /></div> : null}
    {bookingSlot ? <ReservationDialog slot={bookingSlot} onClose={() => setBookingSlot(null)} onCreated={(slotId) => { setSlots((current) => current.map((slot) => slot.id === slotId ? { ...slot, reservationHold: true, displayStatus: slot.status === 'AVAILABLE' ? 'RESERVED' : 'CONFLICTING' } : slot)); refreshFacility(facilityId).catch(() => {}) }} addToast={addToast} /> : null}
  </div>
}

function Building2Icon() {
  return <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><Grid2X2 size={22} /></div>
}

function BayCard({ slot, selected, onClick }) {
  const state = slot.displayStatus || slot.status
  const meta = slotMeta(state)
  const { Icon } = meta
  const available = state === 'AVAILABLE'
  const occupied = state === 'OCCUPIED'
  return <button type="button" onClick={onClick} aria-label={`${slot.slotCode}, ${meta.label}`} aria-pressed={selected} className={`group min-h-36 rounded-xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-300 ${selected ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : 'border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50'}`}>
    <div className="flex items-start justify-between gap-2"><span className="font-mono text-xs font-semibold text-slate-900">{slot.slotCode}</span><span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.className}`}>{meta.label}</span></div>
    <div className={`mx-auto my-3 flex h-14 w-12 items-center justify-center rounded-md border ${available ? 'border-dashed border-green-300 bg-green-50 text-green-700' : occupied ? 'border-red-200 bg-red-50 text-red-700' : state === 'RESERVED' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-300 bg-slate-100 text-slate-600'}`}>
      {occupied ? <CarFront size={30} strokeWidth={1.8} aria-hidden="true" /> : <Icon size={22} aria-hidden="true" />}
    </div>
    <p className={`text-center text-xs ${available ? 'text-green-800' : 'text-slate-600'}`}>{available ? 'Empty bay' : occupied ? 'Vehicle recorded' : state === 'RESERVED' ? 'Held for booking' : state === 'CONFLICTING' ? 'Conflicting signals' : 'Not verified'}</p>
  </button>
}

function BayDetails({ slot, onClose, onReserve, drawer = false }) {
  const displayStatus = slot.displayStatus || slot.status
  const meta = slotMeta(displayStatus)
  return <aside className={`${drawer ? 'h-full w-full max-w-md overflow-y-auto p-5 shadow-xl' : 'rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-20 xl:h-fit'} bg-white`} aria-label={`Details for bay ${slot.slotCode}`}>
    <div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs uppercase tracking-wider text-slate-500">{slot.zone?.name}</p><h2 className="mt-1 text-lg font-semibold text-slate-900">Bay {slot.slotCode}</h2></div><button type="button" aria-label="Close bay details" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"><X size={18} /></button></div>
    <div className={`mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${meta.className}`}><meta.Icon size={16} />{meta.label}</div>
    <div className="mt-4 rounded-lg bg-slate-50 p-3"><p className="text-sm font-medium text-slate-800">Recorded bay state</p><p className="mt-1 text-sm text-slate-600">{displayStatus === 'OCCUPIED' ? 'The current record marks this bay occupied.' : displayStatus === 'AVAILABLE' ? 'The current record marks this bay available.' : displayStatus === 'RESERVED' ? 'A current reservation holds this bay. This does not confirm vehicle arrival.' : displayStatus === 'CONFLICTING' ? 'A reservation overlaps a non-available bay state. Operator review is needed.' : displayStatus === 'UNKNOWN' ? 'The stored status cannot confirm availability or occupancy.' : 'This bay is unavailable for booking.'}</p></div>
    <div className="mt-3 rounded-lg border border-slate-200 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence</p><p className="mt-1 text-sm text-slate-600">This prototype does not attach a sensor observation or confidence score to the bay record.</p><p className="mt-2 font-mono text-xs text-slate-500">Updated {slot.updatedAt ? new Date(slot.updatedAt).toLocaleString() : 'time unavailable'}</p></div>
    {slot.zone?.ratePerHour ? <p className="mt-3 text-sm text-slate-600">Listed rate: ₹{slot.zone.ratePerHour}/hour</p> : null}
    {displayStatus === 'AVAILABLE' ? <button type="button" onClick={onReserve} className="mt-4 min-h-12 w-full rounded-lg bg-blue-600 px-4 font-semibold text-white hover:bg-blue-700">Reserve this bay</button> : null}
  </aside>
}
