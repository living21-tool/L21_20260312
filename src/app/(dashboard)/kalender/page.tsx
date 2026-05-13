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

function mixColorWithWhite(hex: string, colorWeight: number) {
  const normalized = hex.replace('#', '')
  const safeHex = normalized.length === 3
    ? normalized.split('').map(char => `${char}${char}`).join('')
    : normalized

  if (!/^[0-9a-fA-F]{6}$/.test(safeHex)) return hex

  const channels = safeHex.match(/.{2}/g)?.map(value => parseInt(value, 16)) ?? [255, 255, 255]
  const mixed = channels.map(channel => Math.round(255 - (255 - channel) * colorWeight))
  return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`
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
  const today = new Date()
  const todayOffset = differenceInDays(today, startDate)
  const todayVisible = todayOffset >= 0 && todayOffset < DAYS_TO_SHOW
  const rangeEnd = useMemo(() => addDays(startDate, DAYS_TO_SHOW), [startDate])
  const propertiesByLocationId = useMemo(() => {
    const map = new Map<string, typeof allProperties>()
    for (const property of allProperties) {
      const list = map.get(property.locationId) ?? []
      list.push(property)
      map.set(property.locationId, list)
    }
    return map
  }, [allProperties])
  const visibleBookingsByPropertyId = useMemo(() => {
    const map = new Map<string, Booking[]>()
    for (const booking of allBookings) {
      if (booking.status === 'storniert') continue
      if (booking.source === 'lexoffice_sonstige') continue
      const checkIn = parseISO(booking.checkIn)
      const checkOut = parseISO(booking.checkOut)
      if (!(checkIn < rangeEnd && checkOut > startDate)) continue
      const list = map.get(booking.propertyId) ?? []
      list.push(booking)
      map.set(booking.propertyId, list)
    }
    return map
  }, [allBookings, rangeEnd, startDate])
  const activeBookingCountByLocationId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const [locationId, properties] of propertiesByLocationId) {
      let count = 0
      for (const property of properties) {
        count += visibleBookingsByPropertyId.get(property.id)?.length ?? 0
      }
      counts.set(locationId, count)
    }
    return counts
  }, [propertiesByLocationId, visibleBookingsByPropertyId])

  const toggleLoc = (id: string) =>
    setCollapsedLocs(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
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
        props: (propertiesByLocationId.get(loc.id) ?? []).filter(p => p.active),
      }))
      .filter(g => g.props.length > 0)
  }, [allLocations, filterLocation, propertiesByLocationId])

  function getBookingsForProperty(propertyId: string) {
    return visibleBookingsByPropertyId.get(propertyId) ?? []
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
      <div className="rounded-xl border border-slate-200 bg-white">

        {/* Header row — day numbers */}
        <div className="sticky top-0 z-30 flex border-b-2 border-slate-200 bg-slate-50 shadow-sm">
          <div className="w-44 flex-shrink-0 px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide border-r border-slate-200">
            Objekt
          </div>
          <div className="relative flex-1">
            {todayVisible && (
              <div
                className="pointer-events-none absolute inset-y-0 z-10"
                style={{
                  left: `${(todayOffset * 100) / DAYS_TO_SHOW}%`,
                  width: `${100 / DAYS_TO_SHOW}%`,
                }}
              />
            )}
            <div className="flex">
            {days.map((day, i) => {
              const todayMark = isSameDay(day, today)
              return (
                <div
                  key={i}
                  className={cn(
                    'relative flex-1 text-center py-2 border-r border-slate-100 text-xs',
                    todayMark ? 'bg-blue-50/80' : ''
                  )}
                >
                  {todayMark && (
                    <div className="absolute inset-x-1 top-1 h-1 rounded-full bg-blue-500/80" />
                  )}
                  <div className={cn('font-semibold', todayMark ? 'text-blue-700' : 'text-slate-600')}>
                    {format(day, 'd')}
                  </div>
                  <div className={cn('text-slate-400', todayMark ? 'text-blue-500' : '')}>
                    {format(day, 'EEE', { locale: de }).slice(0, 2)}
                  </div>
                </div>
              )
            })}
            </div>
          </div>
        </div>

        {/* Grouped property rows */}
        {groups.map(({ loc, props }) => {
          const collapsed = collapsedLocs.has(loc.id)
          const locBookingsCount = activeBookingCountByLocationId.get(loc.id) ?? 0
          const locationRowBackground = mixColorWithWhite(loc.color, 0.12)

          return (
            <div key={loc.id}>

              {/* ── Standort-Trennzeile ── */}
              <div
                className="sticky top-[53px] z-20 flex items-center border-b border-slate-200 cursor-pointer select-none"
                style={{ backgroundColor: locationRowBackground }}
                onClick={() => toggleLoc(loc.id)}
              >
                {/* Left label cell */}
                <div
                  className="w-44 flex-shrink-0 px-3 py-2 border-r flex items-center gap-2"
                  style={{ borderColor: `${loc.color}40`, backgroundColor: locationRowBackground }}
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
                <div
                  className="flex-1 px-3 py-2 flex items-center gap-3"
                  style={{ backgroundColor: locationRowBackground }}
                >
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
                          const todayMark = isSameDay(day, today)
                          return (
                            <div key={i} className={cn(
                              'flex-1 border-r border-slate-100',
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
            Kein Portfolio für diesen Standort gefunden.
          </div>
        )}
      </div>
    </div>
  )
}
