import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Clock3, RefreshCw } from 'lucide-react'
import { api } from '../services/api'

const severityClass = {
  CRITICAL: 'border-red-200 bg-red-50 text-red-900',
  WARNING: 'border-amber-200 bg-amber-50 text-amber-900',
  INFO: 'border-blue-200 bg-blue-50 text-blue-900'
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([])
  const [showResolved, setShowResolved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadAlerts = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.get(`/alerts?resolved=${showResolved ? 'true' : 'false'}`)
      setAlerts(response.data.data || [])
    } catch (err) {
      setError(err?.response?.data?.error || 'Operational alerts could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [showResolved])

  useEffect(() => { loadAlerts() }, [loadAlerts])

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Operations</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Alerts</h1><p className="mt-1 text-sm text-slate-600">Alerts returned by the configured application database.</p></div>
      <div className="flex gap-2">
        <button type="button" aria-pressed={!showResolved} onClick={() => setShowResolved(false)} className={`min-h-10 rounded-lg border px-3 text-sm ${!showResolved ? 'border-blue-600 bg-blue-50 font-semibold text-blue-800' : 'border-slate-200 bg-white text-slate-700'}`}>Unresolved</button>
        <button type="button" aria-pressed={showResolved} onClick={() => setShowResolved(true)} className={`min-h-10 rounded-lg border px-3 text-sm ${showResolved ? 'border-blue-600 bg-blue-50 font-semibold text-blue-800' : 'border-slate-200 bg-white text-slate-700'}`}>Resolved</button>
        <button type="button" onClick={loadAlerts} aria-label="Refresh alerts" disabled={loading} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 disabled:opacity-60"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
      </div>
    </div>

    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">Resolution audit is not available.</p><p className="mt-1">This version can display stored alerts, but the backend does not persist a resolver or resolution reason. Alerts are therefore read-only here.</p></div>

    {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><div className="flex items-start gap-2"><AlertCircle size={18} className="mt-0.5" /><div><p className="font-semibold">Could not load alerts</p><p className="mt-1">{error}</p><button type="button" onClick={loadAlerts} className="mt-3 min-h-10 rounded-lg border border-red-300 px-3 font-medium">Try again</button></div></div></div> : null}
    {loading && alerts.length === 0 ? <div className="space-y-3">{[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />)}</div> : null}
    {!loading && !error && alerts.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center"><AlertCircle className="mx-auto text-slate-400" size={24} /><p className="mt-3 font-semibold text-slate-900">No alerts returned</p><p className="mt-1 text-sm text-slate-600">There are no records in this view.</p></div> : null}
    <div className="space-y-3">{alerts.map((alert) => <article key={alert.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${severityClass[alert.severity] || severityClass.INFO}`}>{alert.severity}</span><span className="text-xs text-slate-500">{alert.isResolved ? 'Resolved' : 'Unresolved'}</span></div><h2 className="mt-2 text-base font-semibold text-slate-900">{alert.title}</h2><p className="mt-1 text-sm leading-6 text-slate-600">{alert.description}</p></div><p className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500"><Clock3 size={14} />{new Date(alert.createdAt).toLocaleString()}</p></div>
    </article>)}</div>
  </div>
}
