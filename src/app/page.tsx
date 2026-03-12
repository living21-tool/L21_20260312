'use client'
import { useBookings, useProperties, useLocations, useCustomers } from '@/lib/store'
import { formatCurrency, formatDate, statusConfig } from '@/lib/utils'
import { parseISO, isToday, format } from 'date-fns'
import { de } from 'date-fns/locale'
import {
  TrendingUp, TrendingDown, CalendarCheck, Users, Euro,
  AlertCircle, ArrowRight, Building2, LogIn, LogOut, BedDouble
} from 'lucide-react'
import Link from 'next/link'

function StatCard({ title, value, sub, trend, icon: Icon, color }: {
  title: string; value: string; sub: string; trend?: number; icon: React.ElementType; color: string
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-start gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon size={22} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{title}</p>
        <p className="text-2xl font-bold text-slate-900 mt-0.5">{value}</p>
        <div className="flex items-center gap-2 mt-1">
          <p className="text-xs text-slate-500">{sub}</p>
          {trend !== undefined && (
            <span className={`flex items-center gap-0.5 text-xs font-medium ${trend >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {trend >= 0 ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}
              {Math.abs(trend)}%
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { bookings: allBookings, loading: loadingB } = useBookings()
  const { properties: allProperties, loading: loadingP } = useProperties()
  const { locations: allLocations } = useLocations()
  const { customers: allCustomers } = useCustomers()
  const loading = loadingB || loadingP

  const today = new Date()
  const thisMonth = today.getMonth()
  const thisYear = today.getFullYear()
  const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1
  const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear

  const completedBookings = allBookings.filter(b => b.status !== 'storniert')

  const revenueThisMonth = completedBookings
    .filter(b => { const d = parseISO(b.checkIn); return d.getMonth() === thisMonth && d.getFullYear() === thisYear })
    .reduce((s, b) => s + b.totalPrice, 0)

  const revenueLastMonth = completedBookings
    .filter(b => { const d = parseISO(b.checkIn); return d.getMonth() === lastMonth && d.getFullYear() === lastMonthYear })
    .reduce((s, b) => s + b.totalPrice, 0)

  const revenueTrend = revenueLastMonth > 0
    ? Math.round(((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100) : 0

  const activeBookings = allBookings.filter(b => b.status === 'bestaetigt' || b.status === 'option')
  const checkInsToday = allBookings.filter(b => isToday(parseISO(b.checkIn)))
  const checkOutsToday = allBookings.filter(b => isToday(parseISO(b.checkOut)))
  const openInvoices = allBookings.filter(b => b.paymentStatus === 'offen' && b.status !== 'storniert')
  const openAmount = openInvoices.reduce((s, b) => s + b.totalPrice, 0)

  // Bettauslastung: gebuchte Betten heute / Gesamtbetten
  const totalBeds = allProperties.filter(p => p.active).reduce((s, p) => s + p.beds, 0)
  const bedsOccupiedToday = allBookings
    .filter(b => b.status === 'bestaetigt' || b.status === 'option')
    .filter(b => {
      const ci = parseISO(b.checkIn); const co = parseISO(b.checkOut)
      return ci <= today && co > today
    })
    .reduce((s, b) => s + b.bedsBooked, 0)
  const bedOccupancy = totalBeds > 0 ? Math.round((bedsOccupiedToday / totalBeds) * 100) : 0

  // Ø Bettpreis/Nacht (alle aktiven Buchungen)
  const avgBedPrice = completedBookings.length > 0
    ? completedBookings.reduce((s, b) => s + b.pricePerBedNight, 0) / completedBookings.length
    : 0

  const last6Months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - 5 + i, 1)
    return { label: format(d, 'MMM', { locale: de }), month: d.getMonth(), year: d.getFullYear() }
  })
  const monthlyRevenue = last6Months.map(m => ({
    ...m,
    revenue: completedBookings
      .filter(b => { const d = parseISO(b.checkIn); return d.getMonth() === m.month && d.getFullYear() === m.year })
      .reduce((s, b) => s + b.totalPrice, 0)
  }))
  const maxRevenue = Math.max(...monthlyRevenue.map(m => m.revenue), 1)
  const upcoming = allBookings.filter(b => b.status === 'bestaetigt' || b.status === 'option').slice(0, 5)

  if (loading) return (
    <div className="p-6 max-w-7xl mx-auto flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-slate-400 text-sm">Dashboard wird geladen…</p>
      </div>
    </div>
  )

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">{format(today, "EEEE, d. MMMM yyyy", { locale: de })}</p>
        </div>
        <Link href="/buchungen/neu" className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          + Neue Buchung
        </Link>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard title="Umsatz (Monat)" value={formatCurrency(revenueThisMonth)} sub={`Vormonat: ${formatCurrency(revenueLastMonth)}`} trend={revenueTrend} icon={Euro} color="bg-blue-500" />
        <StatCard title="Bettauslastung" value={`${bedOccupancy}%`} sub={`${bedsOccupiedToday} / ${totalBeds} Betten belegt`} icon={BedDouble} color="bg-emerald-500" />
        <StatCard title="Ø Bettpreis/Nacht" value={avgBedPrice > 0 ? formatCurrency(avgBedPrice) : '—'} sub={`${allProperties.length} Objekte · ${totalBeds} Betten`} icon={TrendingUp} color="bg-violet-500" />
        <StatCard title="Offene Rechnungen" value={formatCurrency(openAmount)} sub={`${openInvoices.length} Rechnungen offen`} icon={AlertCircle} color="bg-amber-500" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <div className="xl:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">Umsatz letzte 6 Monate</h2>
            <Link href="/analytics" className="text-xs text-blue-600 hover:underline flex items-center gap-1">Alle Analysen <ArrowRight size={12}/></Link>
          </div>
          <div className="flex items-end gap-3 h-36">
            {monthlyRevenue.map(m => (
              <div key={m.label} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-xs text-slate-500 font-medium">{m.revenue > 0 ? Math.round(m.revenue).toLocaleString('de') : '–'}</span>
                <div className="w-full flex items-end" style={{ height: '96px' }}>
                  <div className="w-full rounded-t-md bg-blue-500 hover:bg-blue-600 transition-colors" style={{ height: `${Math.round((m.revenue / maxRevenue) * 96)}px`, minHeight: m.revenue > 0 ? '4px' : '0' }} />
                </div>
                <span className="text-xs text-slate-500">{m.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-semibold text-slate-900 mb-4">Heute</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 bg-emerald-50 rounded-lg">
              <LogIn size={18} className="text-emerald-600 flex-shrink-0" />
              <div><p className="text-sm font-medium text-slate-900">Anreisen heute</p><p className="text-xl font-bold text-emerald-600">{checkInsToday.length}</p></div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
              <LogOut size={18} className="text-blue-600 flex-shrink-0" />
              <div><p className="text-sm font-medium text-slate-900">Abreisen heute</p><p className="text-xl font-bold text-blue-600">{checkOutsToday.length}</p></div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
              <Users size={18} className="text-slate-600 flex-shrink-0" />
              <div><p className="text-sm font-medium text-slate-900">Auftraggeber</p><p className="text-xl font-bold text-slate-900">{allCustomers.length}</p></div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">Aktuelle Buchungen</h2>
            <Link href="/buchungen" className="text-xs text-blue-600 hover:underline flex items-center gap-1">Alle anzeigen <ArrowRight size={12}/></Link>
          </div>
          <div className="space-y-2">
            {upcoming.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">Keine aktiven Buchungen</p>}
            {upcoming.map(b => {
              const prop = allProperties.find(p => p.id === b.propertyId)
              const cust = allCustomers.find(c => c.id === b.customerId)
              const loc = allLocations.find(l => l.id === prop?.locationId)
              const sc = statusConfig[b.status]
              return (
                <Link key={b.id} href={`/buchungen/${b.id}`} className="flex items-center gap-4 p-3 hover:bg-slate-50 rounded-lg transition-colors group">
                  <div className="w-1 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: loc?.color ?? '#94a3b8' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{prop?.name}</p>
                    <p className="text-xs text-slate-500 truncate">{cust?.companyName ?? `${cust?.firstName} ${cust?.lastName}`}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-slate-600">{formatDate(b.checkIn)} – {formatDate(b.checkOut)}</p>
                    <p className="text-xs text-slate-500">{b.nights} Nächte · {b.bedsBooked} Betten</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${sc.bg} ${sc.color}`}>{sc.label}</span>
                  <ArrowRight size={14} className="text-slate-300 group-hover:text-slate-500 flex-shrink-0" />
                </Link>
              )
            })}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">Standorte</h2>
            <Link href="/objekte" className="text-xs text-blue-600 hover:underline flex items-center gap-1">Alle <ArrowRight size={12}/></Link>
          </div>
          <div className="space-y-2">
            {allLocations.length === 0 && <p className="text-sm text-slate-400 text-center py-4">Noch keine Standorte</p>}
            {allLocations.map(loc => {
              const props = allProperties.filter(p => p.locationId === loc.id)
              const beds = props.reduce((s, p) => s + p.beds, 0)
              return (
                <div key={loc.id} className="p-3 rounded-lg border border-slate-100">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: loc.color }} />
                    <p className="text-sm font-medium text-slate-900 truncate">{loc.name}</p>
                  </div>
                  <p className="text-xs text-slate-500 ml-4">{props.length} Objekte · {beds} Betten · {loc.city}</p>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
