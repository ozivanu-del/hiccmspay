import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import type { Branding, Role, User } from '../lib/types'
import { AppLayout, LoadingScreen } from './components'
import { AuditPage, BrandingPage, CashierPage, DashboardPage, HealthPage, LoginPage, ModulePage, ParentPage, StudentsPage, TransactionsPage } from './pages'

type AppContextValue = {
  user: User | null
  branding: Branding
  loading: boolean
  login: (email: string, password: string) => Promise<User>
  logout: () => Promise<void>
  refreshBranding: () => Promise<void>
}

const fallbackBranding: Branding = { appName: 'PRJ SmartPay', organizationName: 'Pondok Raudhatul Jannah', tagline: 'Satu Kartu. Satu Saldo. Semua Transaksi.', primaryColor: '#0f766e', secondaryColor: '#14b8a6' }
const AppContext = createContext<AppContextValue | null>(null)

export function useApp() {
  const value = useContext(AppContext)
  if (!value) throw new Error('App context unavailable')
  return value
}

function homeFor(role: Role): string {
  if (role === 'PARENT') return '/parent/dashboard'
  if (role === 'CASHIER') return '/cashier'
  if (role === 'TREASURER') return '/treasurer'
  return '/admin'
}

function Provider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [branding, setBranding] = useState(fallbackBranding)
  const [loading, setLoading] = useState(true)
  const refreshBranding = useCallback(async () => {
    try {
      const value = await api<Branding>('/api/branding')
      setBranding(value)
      document.title = value.appName
      document.documentElement.style.setProperty('--brand', value.primaryColor)
      document.documentElement.style.setProperty('--accent', value.secondaryColor)
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value.primaryColor)
    } catch { /* Keep offline-safe branding. */ }
  }, [])
  useEffect(() => {
    Promise.allSettled([refreshBranding(), api<User>('/api/me').then(setUser)]).finally(() => setLoading(false))
  }, [refreshBranding])
  const login = useCallback(async (email: string, password: string) => {
    const response = await api<{ user: { id: string; email: string; name: string; role: Role; parentId?: string } }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
    const next = { sub: response.user.id, ...response.user }
    setUser(next)
    return next
  }, [])
  const logout = useCallback(async () => { await api('/api/auth/logout', { method: 'POST' }); setUser(null) }, [])
  const value = useMemo(() => ({ user, branding, loading, login, logout, refreshBranding }), [user, branding, loading, login, logout, refreshBranding])
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

function Gate({ children, allowed }: { children: ReactNode; allowed?: Role[] }) {
  const { user, loading } = useApp()
  const location = useLocation()
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (allowed && !allowed.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />
  return <AppLayout>{children}</AppLayout>
}

function LoginRoute() {
  const { user, loading } = useApp()
  if (loading) return <LoadingScreen />
  return user ? <Navigate to={homeFor(user.role)} replace /> : <LoginPage />
}

function AppRoutes() {
  const { user } = useApp()
  return <Routes>
    <Route path="/login" element={<LoginRoute />} />
    <Route path="/admin" element={<Gate allowed={['SUPER_ADMIN','ADMIN']}><DashboardPage /></Gate>} />
    <Route path="/admin/students" element={<Gate allowed={['SUPER_ADMIN','ADMIN']}><StudentsPage /></Gate>} />
    <Route path="/admin/transactions" element={<Gate allowed={['SUPER_ADMIN','ADMIN']}><TransactionsPage /></Gate>} />
    <Route path="/admin/audit-logs" element={<Gate allowed={['SUPER_ADMIN']}><AuditPage /></Gate>} />
    <Route path="/admin/settings/branding" element={<Gate allowed={['SUPER_ADMIN']}><BrandingPage /></Gate>} />
    <Route path="/admin/system-health" element={<Gate allowed={['SUPER_ADMIN']}><HealthPage /></Gate>} />
    <Route path="/admin/:module" element={<Gate allowed={['SUPER_ADMIN','ADMIN']}><ModulePage /></Gate>} />
    <Route path="/parent/*" element={<Gate allowed={['PARENT']}><ParentPage /></Gate>} />
    <Route path="/cashier/*" element={<Gate allowed={['CASHIER','SUPER_ADMIN']}><CashierPage /></Gate>} />
    <Route path="/treasurer" element={<Gate allowed={['TREASURER','SUPER_ADMIN']}><DashboardPage /></Gate>} />
    <Route path="/treasurer/:module" element={<Gate allowed={['TREASURER','SUPER_ADMIN']}><ModulePage /></Gate>} />
    <Route path="/" element={<Navigate to={user ? homeFor(user.role) : '/login'} replace />} />
    <Route path="*" element={<Navigate to={user ? homeFor(user.role) : '/login'} replace />} />
  </Routes>
}

export default function SmartPayApp() {
  return <BrowserRouter><Provider><AppRoutes /></Provider></BrowserRouter>
}
