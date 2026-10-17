import { useState } from 'react'
import { ArrowRight, Building2, CarFront, Eye, EyeOff, LockKeyhole, RadioTower, Signpost, DoorOpen } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'

const workflow = [
  { title: 'Gate arrival', text: 'A verified perimeter event can establish facility presence.', icon: CarFront, tone: 'blue' },
  { title: 'Wayfinding', text: 'Direct drivers toward suitable zones and available bays.', icon: Signpost, tone: 'violet' },
  { title: 'Bay observation', text: 'A bay-level source supports the physical occupancy state.', icon: RadioTower, tone: 'green' },
  { title: 'Facility departure', text: 'A verified outbound event closes the facility visit.', icon: DoorOpen, tone: 'slate' }
]

export default function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const payload = await login(email.trim(), password)
      const permissions = payload.user?.permissions || []
      const destination = permissions.includes('operations_read')
        ? '/dashboard/map'
        : permissions.includes('reservations_read') || payload.user?.role === 'DRIVER'
          ? '/dashboard/reservations'
          : permissions.includes('alerts_read')
            ? '/dashboard/alerts'
            : permissions.includes('devices_read')
              ? '/dashboard/admin'
              : permissions.includes('finance_read')
                ? '/dashboard/revenue'
                : '/dashboard/analytics'
      navigate(destination)
    } catch (err) {
      setError(err?.response?.data?.error || 'We could not sign you in. Check your details and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 lg:grid lg:grid-cols-2">
      <section className="flex min-h-[42vh] flex-col border-b border-slate-200 bg-slate-50 px-5 py-7 sm:px-10 lg:min-h-screen lg:border-b-0 lg:border-r lg:px-16 lg:py-10">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white"><Building2 size={21} /></span>
          <span className="text-lg font-semibold tracking-tight">BaySignal</span>
          <span className="border-l border-slate-300 pl-3 font-mono text-xs uppercase tracking-wider text-slate-500">Working name</span>
        </div>

        <div className="my-8 max-w-2xl lg:my-auto lg:py-12">
          <p className="text-sm font-semibold text-blue-700">PARKING OPERATIONS</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">A clearer view of every visit and bay.</h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-slate-600">Sign in to manage your facility’s parking operations.</p>

          <div className="mt-7 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
            <span className="font-semibold">Target workflow concept</span>
            <span className="ml-2 text-blue-900">Facility presence, bay occupancy and reservations are tracked as separate states.</span>
          </div>

          <ol className="mt-5 grid gap-3 sm:grid-cols-2">
            {workflow.map(({ title, text, icon: Icon, tone }, index) => (
              <li key={title} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tone === 'blue' ? 'bg-blue-50 text-blue-700' : tone === 'violet' ? 'bg-violet-50 text-violet-700' : tone === 'green' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-700'}`}>
                  <Icon size={19} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold">{index + 1}. {title}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <p className="text-xs text-slate-500">BaySignal is a provisional product name. Operations shown after sign-in depend on configured data sources.</p>
      </section>

      <section className="flex min-h-[58vh] items-center justify-center bg-white px-5 py-10 sm:px-10 lg:min-h-screen">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center justify-between">
            <p className="font-semibold">BaySignal <span className="font-normal text-slate-500">Operator portal</span></p>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">Facility access</span>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">Sign in to your account</h2>
          <p className="mt-2 text-sm text-slate-600">Enter the operator credentials provided by your administrator.</p>

          <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="email">Work email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="min-h-12 w-full rounded-lg border border-slate-300 bg-slate-50 px-4 text-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                placeholder="name@organization.com"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium" htmlFor="password">Password</label>
                <span className="text-xs text-slate-500">Contact your administrator to reset it</span>
              </div>
              <div className="relative">
                <LockKeyhole size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  className="min-h-12 w-full rounded-lg border border-slate-300 bg-slate-50 py-3 pl-11 pr-12 text-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                />
                <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}

            <button type="submit" disabled={submitting} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-70">
              {submitting ? 'Signing in…' : 'Sign in to operations'}
              {!submitting ? <ArrowRight size={18} aria-hidden="true" /> : null}
            </button>
          </form>

          <p className="mt-6 border-t border-slate-200 pt-5 text-xs leading-5 text-slate-500">Access is provided by invitation or administrator approval. Public account registration is not available.</p>
        </div>
      </section>
    </main>
  )
}
