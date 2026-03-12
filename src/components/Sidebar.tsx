'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, CalendarDays, BookOpen, Building2,
  Users, BarChart3, Settings, Import, ChevronRight, Zap
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/',             label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/kalender',     label: 'Kalender',     icon: CalendarDays },
  { href: '/buchungen',    label: 'Buchungen',    icon: BookOpen },
  { href: '/buchungen/smart', label: 'Smart Booking', icon: Zap },
  { href: '/objekte',      label: 'Objekte',      icon: Building2 },
  { href: '/kunden',       label: 'Kunden',       icon: Users },
  { href: '/analytics',    label: 'Analytics',    icon: BarChart3 },
  { href: '/import',       label: 'Lexoffice',    icon: Import },
  { href: '/einstellungen',label: 'Einstellungen',icon: Settings },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="fixed top-0 left-0 h-screen w-64 bg-slate-900 text-white flex flex-col z-40">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center text-white font-bold text-sm">
            L
          </div>
          <div>
            <p className="font-semibold text-sm leading-tight">L21 Buchungen</p>
            <p className="text-xs text-slate-400 leading-tight">Verwaltungssystem</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="space-y-0.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active =
              href === '/'
                ? pathname === href
                : href === '/buchungen'
                  ? pathname === href || (pathname.startsWith('/buchungen/') && !pathname.startsWith('/buchungen/smart'))
                  : pathname === href || pathname.startsWith(`${href}/`)
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group',
                  active
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                )}
              >
                <Icon size={18} className={cn(active ? 'text-white' : 'text-slate-400 group-hover:text-white')} />
                <span className="flex-1">{label}</span>
                {active && <ChevronRight size={14} className="text-blue-200" />}
              </Link>
            )
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-slate-600 rounded-full flex items-center justify-center text-xs font-bold">
            AD
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">Admin</p>
            <p className="text-xs text-slate-400 truncate">admin@l21.de</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
