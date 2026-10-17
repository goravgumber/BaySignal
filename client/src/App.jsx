import { Suspense, lazy } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './store/auth'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const AppShell = lazy(() => import('./components/layout/AppShell'))
const MapOverviewPage = lazy(() => import('./pages/MapOverviewPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const AlertsPage = lazy(() => import('./pages/AlertsPage'))
const ReservationsPage = lazy(() => import('./pages/ReservationsPage'))

function RouteLoading() {
  return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">Loading your workspace…</div>
}

function ProtectedRoute() {
  const { loading, isAuthenticated } = useAuth()

  if (loading) return <RouteLoading />
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

function RequirePermission({ permission, allowDriver = false, children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <RouteLoading />
  const allowed = user?.permissions?.includes(permission) || (allowDriver && user?.role === 'DRIVER')
  if (!allowed) {
    return (
      <main className="mx-auto max-w-xl px-6 py-20 text-center">
        <h1 className="text-xl font-semibold text-slate-900">Access not available</h1>
        <p className="mt-2 text-sm text-slate-600">Your account does not have permission to open this page.</p>
        <p className="mt-1 text-xs text-slate-500">Requested page: {location.pathname}</p>
      </main>
    )
  }
  return children
}

function HomeRedirect() {
  const { loading, isAuthenticated, user } = useAuth()
  if (loading) return <RouteLoading />
  const permissions = user?.permissions || []
  const defaultPath = permissions.includes('operations_read')
    ? '/dashboard/map'
    : permissions.includes('reservations_read') || user?.role === 'DRIVER'
      ? '/dashboard/reservations'
      : permissions.includes('alerts_read')
        ? '/dashboard/alerts'
        : permissions.includes('devices_read')
          ? '/dashboard/admin'
          : permissions.includes('finance_read')
            ? '/dashboard/revenue'
            : '/dashboard/analytics'
  return <Navigate to={isAuthenticated ? defaultPath : '/login'} replace />
}

function DataUnavailablePage({ feature }) {
  return <main className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
    <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">{feature}</p>
    <h1 className="mt-2 text-xl font-semibold text-slate-900">Data source not configured</h1>
    <p className="mt-2 text-sm leading-6 text-slate-600">This view needs validated production data and a documented calculation method. No sample or estimated values are shown here.</p>
  </main>
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/login" element={<LoginPage />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<AppShell />}>
              <Route index element={<Navigate to="map" replace />} />
              <Route path="map" element={<RequirePermission permission="operations_read"><MapOverviewPage /></RequirePermission>} />
              <Route path="analytics" element={<RequirePermission permission="analytics_read"><DataUnavailablePage feature="Analytics" /></RequirePermission>} />
              <Route path="environment" element={<RequirePermission permission="analytics_read"><DataUnavailablePage feature="Environmental report" /></RequirePermission>} />
              <Route path="reservations" element={<RequirePermission permission="reservations_read" allowDriver><ReservationsPage /></RequirePermission>} />
              <Route path="revenue" element={<RequirePermission permission="finance_read"><DataUnavailablePage feature="Revenue" /></RequirePermission>} />
              <Route path="alerts" element={<RequirePermission permission="alerts_read"><AlertsPage /></RequirePermission>} />
              <Route path="ai" element={<RequirePermission permission="analytics_read"><DataUnavailablePage feature="Forecast" /></RequirePermission>} />
              <Route path="admin" element={<RequirePermission permission="devices_read"><AdminPage /></RequirePermission>} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  )
}
