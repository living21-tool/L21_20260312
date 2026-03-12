'use client'
import { useState, useMemo } from 'react'
import { useBookings, useProperties, useLocations } from '@/lib/store'
import { formatDate, statusConfig, cn } from '@/lib/utils'
import { parseISO, addDays, format, isSameDay, addMonths, subMonths, differenceInDays } from 'date-fns'
import { de } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, Plus, ChevronDown, ChevronUp } from 'lucide-react'
import Link from 'next/link'
import { Booking } from '@/lib/types'

const DAYS_TO_SHOW = 35

const statusColors: Record<string, string> = {
  bestaetigt:   'bg-emerald-500 hover:bg-emerald-600',
  option:       'bg-amber-400 hover:bg-amber-500',
  anfrage:      'bg-slate-400 hover:bg-slate-500',
  abgeschlossen:'bg-blue-400 hover:bg-blue-500',
  storniert:    'bg-red-400 hover:bg-red-500',
}

export default function KalenderPage() {
  const { bookings: allBookings, loading: loadingB } = useBookings()
  const { properties: allProperties, loading: loadingP } = useProperties()
  const { locations: allLocations } = useLocations()
  const loading = loadingB || loadingP

  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(1); return d
  })
  const [filterLocation, setFilterLocation] = useState<string>('all')
  const [hoveredBooking, setHoveredBooking] = useState<string | null>(null)
  const [collapsedLocs, setCollapsedLocs] = useState<Set<string>>(new Set())

  const days = useMemo(
    () => Array.from({ length: DAYS_TO_SHOW }, (_, i) => addDays(startDate, i)),
    [startDate]
  )

  const toggleLoc = (id: string) =>
    setCollapsedLocs(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // Objekte nach Standort gruppieren
  const groups = useMemo(() => {
    const locs = filterLocation === 'all'
      ? allLocations
      : allLocations.filter(l => l.id === filterLocation)

    return locs
      .map(loc => ({
        loc,
        props: allProperties.filter(p => p.locationId === loc.id && p.active),
      }))
      .filter(g => g.props.length > 0)
  }, [allLocations, allProperties, filterLocation])

  function getBookingsForProperty(propertyId: string) {
    return allBookings.filter(b => {
      if (b.propertyId !== propertyId) return false
      if (b.status === 'storniert') return false
      if (b.source === 'lexoffice_sonstige') return false  // Sonstige: kein Objekt/Zeitraum
      const checkIn = parseISO(b.checkIn)
      const checkOut = parseISO(b.checkOut)
      const rangeEnd = addDays(startDate, DAYS_TO_SHOW)
      return checkIn < rangeEnd && checkOut > startDate
    })
  }

  function getBookingStyle(booking: Booking) {
    const checkIn = parseISO(booking.checkIn)
    const checkOut = parseISO(booking.checkOut)
    const visibleStart = checkIn < startDate ? startDate : checkIn
    const visibleEnd = checkOut > addDays(startDate, DAYS_TO_SHOW) ? addDays(startDate, DAYS_TO_SHOW) : checkOut
    const startOffset = differenceInDays(visibleStart, startDate)
    const duration = differenceInDays(visibleEnd, visibleStart)
    const cellWidth = 100 / DAYS_TO_SHOW
    return {
      left: `${startOffset * cellWidth}%`,
      width: `calc(${duration * cellWidth}% - 2px)`,
    }
  }

  const prev = () => setStartDate(d => subMonths(d, 1))
  const next = () => setStartDate(d => addMonths(d, 1))
  const toToday = () => { const d = new Date(); d.setDate(1); setStartDate(d) }

  if (loading) return (
    <div className="p-6 flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3" />
        <p className="text-slate-400 text-sm">Kalender wird geladen…</p>
      </div>
    </div>
  )

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Belegungskalender</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {format(startDate, 'MMMM yyyy', { locale: de })} —{' '}
            {format(addDays(startDate, DAYS_TO_SHOW - 1), 'MMMM yyyy', { locale: de })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterLocation}
            onChange={e => setFilterLocation(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">Alle Standorte</option>
            {allLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button onClick={prev} className="p-2 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors">
            <ChevronLeft size={18} className="text-slate-600" />
          </button>
          <button onClick={toToday} className="px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
            Heute
          </button>
          <button onClick={next} className="p-2 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors">
            <ChevronRight size={18} className="text-slate-600" />
          </button>
          <Link
            href="/buchungen/neu"
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors ml-2"
          >
            <Plus size={16}/> Buchung
          </Link>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-4 text-xs">
        {(['bestaetigt','option','anfrage','abgeschlossen'] as const).map(s => (
          <div key={s} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded ${statusColors[s]}`} />
            <span className="text-slate-600">{statusConfig[s].label}</span>
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">

        {/* Header row — day numbers */}
        <div className="flex border-b-2 border-slate-200 bg-slate-50 sticky top-0 z-30">
          <div className="w-44 flex-shrink-0 px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide border-r border-slate-200">
            Objekt
          </div>
          <div className="flex-1 flex">
            {days.map((day, i) => {
              const isWeekend = day.getDay() === 0 || day.getDay() === 6
              const todayMark = isSameDay(day, new Date())
              return (
                <div
                  key={i}
                  className={cn(
                    'flex-1 text-center py-2 border-r border-slate-100 text-xs',
                    isWeekend ? 'bg-slate-100/70' : '',
                    todayMark ? 'bg-blue-50' : ''
                  )}
                >
                  <div className={cn('font-semibold', todayMark ? 'text-blue-600' : 'text-slate-600')}>
                    {format(day, 'd')}
                  </div>
                  <div className={cn('text-slate-400', todayMark ? 'text-blue-400' : '')}>
                    {format(day, 'EEE', { locale: de }).slice(0, 2)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Grouped property rows */}
        {groups.map(({ loc, props }) => {
          const collapsed = collapsedLocs.has(loc.id)
          const locBookingsCount = allBookings.filter(
            b => props.some(p => p.id === b.propertyId) && b.status !== 'storniert'
          ).length

          return (
            <div key={loc.id}>

              {/* ── Standort-Trennzeile ── */}
              <div
                className="flex items-center border-b border-slate-200 cursor-pointer select-none sticky top-[60px] z-20"
                style={{ backgroundColor: `${loc.color}18` }}
                onClick={() => toggleLoc(loc.id)}
              >
                {/* Left label cell */}
                <div
                  className="w-44 flex-shrink-0 px-3 py-2 border-r flex items-center gap-2"
                  style={{ borderColor: `${loc.color}40` }}
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: loc.color }}
                  />
                  <span className="text-xs font-bold text-slate-700 truncate flex-1">{loc.name}</span>
                  <span className="text-slate-400 flex-shrink-0">
                    {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                  </span>
                </div>
                {/* Right info cell */}
                <div className="flex-1 px-3 py-2 flex items-center gap-3">
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{ color: loc.color, backgroundColor: `${loc.color}20` }}
                  >
                    {props.length} Obj. · {props.reduce((s, p) => s + p.beds, 0)} Betten
                  </span>
                  {locBookingsCount > 0 && (
                    <span className="text-xs text-slate-500">
                      {locBookingsCount} aktive Buchungen
                    </span>
                  )}
                  {collapsed && (
                    <span className="text-xs text-slate-400 italic">eingeklappt</span>
                  )}
                </div>
              </div>

              {/* ── Objekt-Zeilen ── */}
              {!collapsed && props.map(prop => {
                const bookings = getBookingsForProperty(prop.id)
                return (
                  <div
                    key={prop.id}
                    className="flex border-b border-slate-100 hover:bg-slate-50/50 transition-colors"
                    style={{ minHeight: '48px' }}
                  >
                    {/* Property label */}
                    <div
                      className="w-44 flex-shrink-0 px-3 py-2.5 border-r border-slate-200 flex items-start gap-2"
                      style={{ borderLeftWidth: 3, borderLeftColor: loc.color, borderLeftStyle: 'solid' }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-blue-700 font-mono leading-tight truncate">
                          {prop.shortCode || prop.name}
                        </p>
                        <p className="text-xs text-slate-400 truncate">{prop.beds} Betten</p>
                      </div>
                    </div>

                    {/* Timeline */}
                    <div className="flex-1 relative" style={{ minHeight: '48px' }}>
                      {/* Background grid */}
                      <div className="absolute inset-0 flex pointer-events-none">
                        {days.map((day, i) => {
                          const isWeekend = day.getDay() === 0 || day.getDay() === 6
                          const todayMark = isSameDay(day, new Date())
                          return (
                            <div key={i} className={cn(
                              'flex-1 border-r border-slate-100',
                              isWeekend ? 'bg-slate-50' : '',
                              todayMark ? 'bg-blue-50/50' : ''
                            )} />
                          )
                        })}
                      </div>

                      {/* Booking bars */}
                      {bookings.map(booking => {
                        const color = statusColors[booking.status] ?? 'bg-slate-400'
                        const style = getBookingStyle(booking)
                        return (
                          <Link
                            key={booking.id}
                            href={`/buchungen/${booking.id}`}
                            className={cn(
                              'absolute top-2 rounded text-white text-xs font-medium px-2 flex items-center overflow-hidden z-10 transition-all shadow-sm',
                              color,
                              hoveredBooking === booking.id ? 'shadow-md z-20' : ''
                            )}
                            style={{ ...style, height: '28px' }}
                            onMouseEnter={() => setHoveredBooking(booking.id)}
                            onMouseLeave={() => setHoveredBooking(null)}
                            title={`${formatDate(booking.checkIn)} – ${formatDate(booking.checkOut)} · ${booking.nights} Nächte · ${booking.bedsBooked} Betten`}
                          >
                            <span className="truncate">{booking.bedsBooked}B · {booking.nights}N</span>
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}

        {groups.length === 0 && (
          <div className="text-center py-16 text-slate-400 text-sm">
            Keine Objekte für diesen Standort gefunden.
          </div>
        )}
      </div>
    </div>
  )
}
