import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, Car, CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { api } from '../services/api'
import { useAuth } from '../store/auth'
import ToastContainer from '../components/ui/ToastContainer'

const statusTabs = ['ALL', 'UPCOMING', 'ACTIVE', 'COMPLETED', 'CANCELLED']

function fmtDate(value) {
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function statusTone(status) {
  if (status === 'UPCOMING') return 'border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan'
  if (status === 'ACTIVE') return 'border-brand-green/40 bg-brand-green/10 text-brand-green'
  if (status === 'COMPLETED') return 'border-slate-500/40 bg-slate-500/10 text-slate-300'
  if (status === 'CANCELLED') return 'border-brand-red/40 bg-brand-red/10 text-brand-red'
  return 'border-dark-border text-slate-300'
}

export default function ReservationsPage() {
  const { user } = useAuth()
  const [status, setStatus] = useState('ALL')
  const [page, setPage] = useState(1)
  const [limit] = useState(10)
  const [loading, setLoading] = useState(true)
  const [reservations, setReservations] = useState([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [toasts, setToasts] = useState([])
  const [actionLoadingId, setActionLoadingId] = useState('')

  const canManage = user?.permissions?.includes('reservation_checkin')

  const addToast = useCallback((toast) => {
    setToasts((prev) => [...prev, { ...toast, id: crypto.randomUUID() }])
  }, [])

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const fetchReservations = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (status !== 'ALL') params.set('status', status)
      params.set('page', String(page))
      params.set('limit', String(limit))

      const response = await api.get(`/reservations?${params.toString()}`)
      const payload = response.data.data
      setReservations(payload.data)
      setTotal(payload.total)
    } catch (error) {
      addToast({ type: 'error', title: 'Failed to load reservations', message: error?.response?.data?.error || 'Try again.' })
    } finally {
      setLoading(false)
    }
  }, [status, page, limit, addToast])

  useEffect(() => {
    fetchReservations()
  }, [fetchReservations])

  const totalPages = Math.max(1, Math.ceil(total / limit))

  const stats = useMemo(() => {
    return {
      total: reservations.length,
      upcoming: reservations.filter((r) => r.status === 'UPCOMING').length,
      active: reservations.filter((r) => r.status === 'ACTIVE').length,
      completed: reservations.filter((r) => r.status === 'COMPLETED').length
    }
  }, [reservations])

  const selected = useMemo(
    () => reservations.find((item) => item.id === selectedId) || null,
    [reservations, selectedId]
  )

  async function runAction(reservation, action) {
    setActionLoadingId(`${reservation.id}-${action}`)
    try {
      if (action === 'cancel') {
        await api.put(`/reservations/${reservation.id}/cancel`)
      }
      if (action === 'checkin') {
        await api.post(`/reservations/${reservation.id}/checkin`)
      }
      if (action === 'checkout') {
        await api.post(`/reservations/${reservation.id}/checkout`)
      }
      addToast({ type: 'success', title: `Reservation ${action} successful` })
      fetchReservations()
    } catch (error) {
      addToast({ type: 'error', title: `Could not ${action} reservation`, message: error?.response?.data?.error || 'Operation failed.' })
    } finally {
      setActionLoadingId('')
    }
  }

  return (
    <div className="space-y-4">
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="panel-frame"><p className="text-xs text-slate-400">Visible</p><p className="font-mono text-2xl text-white">{stats.total}</p></div>
        <div className="panel-frame"><p className="text-xs text-slate-400">Upcoming</p><p className="font-mono text-2xl text-brand-cyan">{stats.upcoming}</p></div>
        <div className="panel-frame"><p className="text-xs text-slate-400">Active</p><p className="font-mono text-2xl text-brand-green">{stats.active}</p></div>
        <div className="panel-frame"><p className="text-xs text-slate-400">Completed</p><p className="font-mono text-2xl text-slate-200">{stats.completed}</p></div>
      </div>

      <div className="panel-frame flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {statusTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setStatus(tab)
                setPage(1)
              }}
              className={`rounded-lg border px-3 py-1.5 text-xs ${status === tab ? 'border-brand-cyan bg-brand-cyan/20 text-brand-cyan' : 'border-dark-border bg-dark-surface text-slate-300'}`}
            >
              {tab}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={fetchReservations}
          className="inline-flex items-center gap-1 rounded-lg border border-brand-cyan/40 bg-brand-cyan/10 px-3 py-1.5 text-xs text-brand-cyan"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="panel-frame overflow-x-auto">
        {loading ? (
          <div className="flex min-h-[300px] items-center justify-center gap-2 text-brand-cyan"><Loader2 className="animate-spin" size={16} />Loading reservations...</div>
        ) : (
          <table className="w-full min-w-[980px] text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-2 text-left">Code</th>
                <th className="py-2 text-left">Driver</th>
                <th className="py-2 text-left">Vehicle</th>
                <th className="py-2 text-left">Slot</th>
                <th className="py-2 text-left">Start</th>
                <th className="py-2 text-left">Amount</th>
                <th className="py-2 text-left">Status</th>
                <th className="py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reservations.map((reservation) => {
                const loadingForRow = actionLoadingId.startsWith(reservation.id)
                return (
                  <tr
                    key={reservation.id}
                    className="cursor-pointer border-t border-dark-border/60 hover:bg-brand-cyan/5"
                    onClick={() => setSelectedId(reservation.id)}
                  >
                    <td className="py-2 font-mono text-brand-cyan">{reservation.reservationCode}</td>
                    <td className="py-2">{reservation.driverName}</td>
                    <td className="py-2 font-mono">{reservation.vehicleNumber}</td>
                    <td className="py-2">{reservation.slot?.slotCode} <span className="text-xs text-slate-500">({reservation.slot?.zone?.name})</span></td>
                    <td className="py-2 text-xs text-slate-300">{fmtDate(reservation.startTime)}</td>
                    <td className="py-2 font-mono text-brand-green">₹{reservation.totalAmount.toFixed(2)}</td>
                    <td className="py-2"><span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(reservation.status)}`}>{reservation.status}</span></td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {reservation.status === 'UPCOMING' ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              runAction(reservation, 'cancel')
                            }}
                            className="rounded bg-brand-red/15 px-2 py-1 text-xs text-brand-red"
                            disabled={loadingForRow}
                          >
                            Cancel
                          </button>
                        ) : null}

                        {canManage && reservation.status === 'UPCOMING' ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              runAction(reservation, 'checkin')
                            }}
                            className="rounded bg-brand-green/15 px-2 py-1 text-xs text-brand-green"
                            disabled={loadingForRow}
                          >
                            Check-in
                          </button>
                        ) : null}

                        {canManage && reservation.status === 'ACTIVE' ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              runAction(reservation, 'checkout')
                            }}
                            className="rounded bg-brand-amber/20 px-2 py-1 text-xs text-brand-amber"
                            disabled={loadingForRow}
                          >
                            Check-out
                          </button>
                        ) : null}

                        {loadingForRow ? <Loader2 size={12} className="animate-spin text-brand-cyan" /> : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
          <span>Page {page} of {totalPages} • {total} total</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded border border-dark-border px-2 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded border border-dark-border px-2 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {selected ? (
        <div className="panel-frame">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-orbitron text-lg text-brand-cyan">Reservation Details</h3>
            <button type="button" onClick={() => setSelectedId(null)} className="rounded p-1 text-slate-300 hover:bg-white/10"><XCircle size={18} /></button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="glass-card px-3 py-2"><p className="text-xs text-slate-400">Reservation</p><p className="font-mono text-brand-cyan">{selected.reservationCode}</p></div>
            <div className="glass-card px-3 py-2"><p className="text-xs text-slate-400">Slot</p><p>{selected.slot?.slotCode} • {selected.slot?.zone?.name}</p></div>
            <div className="glass-card px-3 py-2"><p className="text-xs text-slate-400">Facility</p><p>{selected.slot?.zone?.facility?.name || '—'}</p></div>
            <div className="glass-card px-3 py-2"><p className="text-xs text-slate-400">Driver</p><p className="inline-flex items-center gap-1"><CalendarClock size={14} /> {selected.driverName}</p></div>
            <div className="glass-card px-3 py-2"><p className="text-xs text-slate-400">Vehicle</p><p className="inline-flex items-center gap-1 font-mono"><Car size={14} /> {selected.vehicleNumber}</p></div>
            <div className="glass-card px-3 py-2"><p className="text-xs text-slate-400">Phone</p><p>{selected.driverPhone}</p></div>
            <div className="glass-card px-3 py-2"><p className="text-xs text-slate-400">Start</p><p>{fmtDate(selected.startTime)}</p></div>
            <div className="glass-card px-3 py-2"><p className="text-xs text-slate-400">End</p><p>{fmtDate(selected.endTime)}</p></div>
            <div className="glass-card px-3 py-2"><p className="text-xs text-slate-400">Amount</p><p className="font-mono text-brand-green">₹{selected.totalAmount.toFixed(2)}</p></div>
          </div>

          <div className="mt-3 inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs text-slate-300">
            {selected.status === 'ACTIVE' ? <CheckCircle2 size={12} className="text-brand-green" /> : null}
            {selected.status === 'CANCELLED' ? <XCircle size={12} className="text-brand-red" /> : null}
            <span>Status: {selected.status}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
