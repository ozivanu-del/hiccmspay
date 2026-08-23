import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { BookOpenCheck, Building2, ChevronRight, CircleDollarSign, CreditCard, FileClock, HeartPulse, KeyRound, LayoutDashboard, LogOut, Menu, Package, ReceiptText, ScanLine, Settings2, ShieldCheck, Users, WalletCards, X } from 'lucide-react'
import { useApp } from './SmartPayApp'

export function LoadingScreen() { return <div className="loading-screen"><div className="brand-mark">PRJ</div><div className="spinner" /><p>Menyiapkan SmartPay…</p></div> }
export function Spinner() { return <span className="spinner spinner-small" aria-label="Memuat" /> }
export function Empty({ title, detail }: { title: string; detail: string }) { return <div className="empty"><div className="empty-icon"><BookOpenCheck size={26} /></div><strong>{title}</strong><p>{detail}</p></div> }
export function StatusBadge({ value }: { value: string }) { const good = ['ACTIVE','COMPLETED','SYNCED','PAID','ONLINE','CONNECTED'].includes(value); return <span className={`badge ${good ? 'badge-good' : value.includes('PENDING') ? 'badge-warn' : 'badge-neutral'}`}>{value.replaceAll('_',' ')}</span> }
export function PageHeader({ eyebrow, title, detail, action }: { eyebrow?: string; title: string; detail?: string; action?: ReactNode }) { return <header className="page-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{detail && <p>{detail}</p>}</div>{action}</header> }

const iconMap = { dashboard: LayoutDashboard, students: Users, cards: CreditCard, wallets: WalletCards, transactions: ReceiptText, topups: CircleDollarSign, products: Package, merchants: Building2, scan: ScanLine, audit: FileClock, health: HeartPulse, settings: Settings2, password: KeyRound, reconciliation: ShieldCheck }
type IconName = keyof typeof iconMap
type NavItem = { to: string; label: string; icon: IconName }

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, branding, logout } = useApp()
  const [open, setOpen] = useState(false)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const location = useLocation()
  useEffect(() => setOpen(false), [location.pathname])
  useEffect(() => { const on = () => setOnline(true); const off = () => setOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) } }, [])
  if (!user) return null
  const admin: NavItem[] = [
    { to: '/admin', label: 'Dashboard', icon: 'dashboard' }, { to: '/admin/students', label: 'Santri', icon: 'students' },
    { to: '/admin/parents', label: 'Orang Tua', icon: 'students' }, { to: '/admin/cards', label: 'Kartu', icon: 'cards' },
    { to: '/admin/wallets', label: 'Wallet', icon: 'wallets' }, { to: '/admin/transactions', label: 'Transaksi', icon: 'transactions' },
    { to: '/admin/topups', label: 'Setoran Tunai', icon: 'topups' }, { to: '/admin/products', label: 'Produk', icon: 'products' },
    { to: '/admin/merchants', label: 'Kantin', icon: 'merchants' },
    ...(user.role === 'SUPER_ADMIN' ? [{ to: '/admin/audit-logs', label: 'Audit Log', icon: 'audit' as const }, { to: '/admin/system-health', label: 'System Health', icon: 'health' as const }, { to: '/admin/settings/branding', label: 'Branding', icon: 'settings' as const }, { to: '/admin/settings/password', label: 'Ubah Password', icon: 'password' as const }] : []),
  ]
  const parent: NavItem[] = [{ to: '/parent/dashboard', label: 'Beranda', icon: 'dashboard' }, { to: '/parent/transactions', label: 'Riwayat', icon: 'transactions' }]
  const cashier: NavItem[] = [{ to: '/cashier', label: 'Kasir', icon: 'scan' }, { to: '/cashier/history', label: 'Transaksi Saya', icon: 'transactions' }]
  const treasurer: NavItem[] = [{ to: '/treasurer', label: 'Dashboard', icon: 'dashboard' }, { to: '/treasurer/topups', label: 'Setoran Tunai', icon: 'topups' }, { to: '/treasurer/settlements', label: 'Settlement', icon: 'transactions' }, { to: '/treasurer/reconciliation', label: 'Rekonsiliasi', icon: 'reconciliation' }]
  const items = user.role === 'PARENT' ? parent : user.role === 'CASHIER' ? cashier : user.role === 'TREASURER' ? treasurer : admin
  return <div className="app-shell">
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="brand"><div className="brand-mark">PRJ</div><div><strong>{branding.appName}</strong><small>{branding.organizationName}</small></div><button className="icon-button close-menu" onClick={() => setOpen(false)}><X size={20} /></button></div>
      <nav>{items.map((item) => { const Icon = iconMap[item.icon]; return <NavLink key={item.to} to={item.to} end={item.to === '/admin' || item.to === '/cashier' || item.to === '/treasurer'}><Icon size={19} /><span>{item.label}</span><ChevronRight className="nav-arrow" size={15} /></NavLink> })}</nav>
      <div className="sidebar-user"><div className="avatar">{user.name.split(' ').map((part) => part[0]).slice(0,2).join('')}</div><div><strong>{user.name}</strong><small>{user.role.replaceAll('_',' ')}</small></div><button className="icon-button" onClick={() => void logout()} title="Keluar"><LogOut size={18} /></button></div>
    </aside>
    {open && <button className="scrim" onClick={() => setOpen(false)} aria-label="Tutup menu" />}
    <div className="workspace">
      <header className="topbar"><button className="icon-button menu-button" onClick={() => setOpen(true)}><Menu /></button><div className={`connection ${online ? '' : 'offline'}`}><span />{online ? 'Terhubung' : 'Offline'}</div><div className="topbar-user"><span>{user.name}</span><div className="avatar avatar-small">{user.name[0]}</div></div></header>
      <main>{children}</main>
    </div>
    <nav className="bottom-nav">{items.slice(0,4).map((item) => { const Icon = iconMap[item.icon]; return <NavLink key={item.to} to={item.to} end><Icon size={20}/><span>{item.label}</span></NavLink> })}</nav>
  </div>
}
