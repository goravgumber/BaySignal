import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, RefreshCw, Router } from 'lucide-react'
import { api } from '../services/api'

const statusStyles = {
  ONLINE: 'border-green-200 bg-green-50 text-green-800',
  OFFLINE: 'border-red-200 bg-red-50 text-red-800',
  MAINTENANCE: 'border-slate-300 bg-slate-100 text-slate-700'
}

export default function AdminPage() {
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadDevices = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.get('/devices')
      setDevices(response.data.data || [])
    } catch (err) {
      setError(err?.response?.data?.error || 'Device records could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadDevices() }, [loadDevices])

  return <div className="space-y-5">
    <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Administration</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Device records</h1><p className="mt-1 text-sm text-slate-600">Stored device and last-reporting values from the application database.</p></div><button type="button" onClick={loadDevices} aria-label="Refresh devices" disabled={loading} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 disabled:opacity-60"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button></div>
    {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><div className="flex gap-2"><AlertCircle size={18} /><div><p className="font-semibold">Device records unavailable</p><p className="mt-1">{error}</p><button type="button" onClick={loadDevices} className="mt-3 min-h-10 rounded-lg border border-red-300 px-3">Try again</button></div></div></div> : null}
    {loading && devices.length === 0 ? <div className="grid gap-3 md:grid-cols-2">{[0, 1].map((item) => <div key={item} className="h-40 animate-pulse rounded-xl border border-slate-200 bg-white" />)}</div> : null}
    {!loading && !error && devices.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center"><Router size={24} className="mx-auto text-slate-400" /><p className="mt-3 font-semibold text-slate-900">No device records</p><p className="mt-1 text-sm text-slate-600">No devices are registered for the accessible facilities.</p></div> : null}
    <div className="grid gap-3 lg:grid-cols-2">{devices.map((device) => <article key={device.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700"><Router size={19} /></span><div><h2 className="font-mono text-sm font-semibold text-slate-900">{device.deviceCode}</h2><p className="mt-1 text-sm text-slate-600">{device.zone || 'Zone not recorded'}</p></div></div><span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusStyles[device.status] || statusStyles.MAINTENANCE}`}>{device.status}</span></div>
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm"><div><dt className="text-xs text-slate-500">Last heartbeat recorded</dt><dd className="mt-1 text-slate-800">{device.lastPingAt ? new Date(device.lastPingAt).toLocaleString() : 'Not recorded'}</dd></div><div><dt className="text-xs text-slate-500">Temperature</dt><dd className="mt-1 text-slate-800">{Number.isFinite(device.temperature) ? `${device.temperature} °C` : 'Not recorded'}</dd></div><div><dt className="text-xs text-slate-500">CPU</dt><dd className="mt-1 text-slate-800">{Number.isFinite(device.cpuPercent) ? `${device.cpuPercent}%` : 'Not recorded'}</dd></div><div><dt className="text-xs text-slate-500">Memory</dt><dd className="mt-1 text-slate-800">{Number.isFinite(device.ramPercent) ? `${device.ramPercent}%` : 'Not recorded'}</dd></div></dl>
    </article>)}</div>
    <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">The stored status is not a live connectivity check. This prototype does not expose device history, camera configuration or organization-level device permissions.</p>
  </div>
}
