'use client'
import { useState, useMemo } from 'react'
import { useBookings, useProperties, useLocations, useCustomers } from '@/lib/store'
import { formatCurrency } from '@/lib/utils'
import {
  format, subMonths, subWeeks, startOfMonth, endOfMonth,
  startOfISOWeek, endOfISOWeek, getISOWeek, getISOWeekYear, addDays,
} from 'date-fns'
import { de } from 'date-fns/locale'
import {
  BedDouble, Euro, Building2, Users, TrendingUp, TrendingDown,
  ChevronRight, ChevronLeft, Percent, BarChart3, CalendarDays,
} from 'lucide-react'
import {
  calcDailyOccupancy, aggregateToWeeks, aggregateToMonths,
  calcOccupancyByEntity, occupancyColor, fmtRate,
  type PeriodOccupancy,
} from '@/lib/occupancy'

export default function AnalyticsPage() {
  const { bookings: allBookings } = useBookings()
  const { properties: allProperties } = useProperties()
  const { locations: allLocations } = useLocations()
  const { customers: allCustomers } = useCustomers()

  // ── View-Mode ───────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<'revenue' | 'occupancy'>('revenue')
  const [timeGranularity, setTimeGranularity] = useState<'weekly' | 'monthly'>('monthly')

  // ── Monat-Filter (Revenue + Occupancy monthly) ─────────────────────────────
  const [selectedMonth, setSelectedMonth] = useState<string>('all') // 'all' | 'YYYY-MM'

  // ── Woche-Filter (Occupancy weekly) ────────────────────────────────────────
  const today = new Date()
  const currentWeekKey = `${getISOWeekYear(today)}-W${String(getISOWeek(today)).padStart(2, '0')}`
  const [selectedWeek, setSelectedWeek] = useState<string>(currentWeekKey)

  // ── Drill-Down ──────────────────────────────────────────────────────────────
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null)

  const drillLevel: 'locations' | 'properties' | 'property' =
    selectedPropertyId ? 'property' :
    selectedLocationId ? 'properties' :
    'locations'

  const selectedLocation = allLocations.find(l => l.id === selectedLocationId)
  const selectedProperty = allProperties.find(p => p.id === selectedPropertyId)

  // ── Basis: Stornos ausschließen ─────────────────────────────────────────────
  const validBookings = allBookings.filter(b => b.status !== 'storniert')

  // ── Analytics-Filter: Nur Standorte mit Buchungsdaten (z.B. Mülheim raus) ─
  const analyticsLocations = allLocations.filter(l => {
    const props = allProperties.filter(p => p.locationId === l.id)
    return props.some(p => p.active) && validBookings.some(b => props.some(p2 => p2.id === b.propertyId))
  })
  const analyticsLocIds = new Set(analyticsLocations.map(l => l.id))
  const analyticsProperties = allProperties.filter(p => analyticsLocIds.has(p.locationId))

  // ── Monat-Filter anwenden ───────────────────────────────────────────────────
  const monthFilteredBookings = selectedMonth === 'all'
    ? validBookings
    : validBookings.filter(b => b.checkIn.slice(0, 7) === selectedMonth)

  // ── Kontext-Filter (Drill-Down) ─────────────────────────────────────────────
  const contextBookings = selectedPropertyId
    ? monthFilteredBookings.filter(b => b.propertyId === selectedPropertyId)
    : selectedLocationId
      ? monthFilteredBookings.filter(b =>
          allProperties.find(p => p.id === b.propertyId)?.locationId === selectedLocationId
        )
      : monthFilteredBookings

  // ── Verfügbare Monate (letzte 24) ───────────────────────────────────────────
  const last24Months = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - 23 + i, 1)
    const key = format(d, 'yyyy-MM')
    return {
      value: key,
      label: format(d, 'MMM yy', { locale: de }),
      hasData: validBookings.some(b => b.checkIn.startsWith(key)),
    }
  })

  // ── Verfügbare Wochen (letzte 16) ──────────────────────────────────────────
  const last16Weeks = useMemo(() => {
    return Array.from({ length: 16 }, (_, i) => {
      const weekStart = startOfISOWeek(subWeeks(today, 15 - i))
      const wy = getISOWeekYear(weekStart)
      const wn = getISOWeek(weekStart)
      const key = `${wy}-W${String(wn).padStart(2, '0')}`
      const wEnd = endOfISOWeek(weekStart)
      return {
        value: key,
        label: `KW ${wn}`,
        sub: `${format(weekStart, 'dd.MM.')} – ${format(wEnd, 'dd.MM.')}`,
        start: weekStart,
        end: wEnd,
        hasData: validBookings.some(b => {
          const ci = new Date(b.checkIn)
          const co = new Date(b.checkOut)
          return ci <= wEnd && co >= weekStart
        }),
      }
    })
  }, [validBookings])

  // ── Aktueller Occupancy-Monat (default = aktueller Monat) ─────────────────
  const effectiveOccMonth = useMemo(() => {
    if (viewMode !== 'occupancy' || timeGranularity !== 'monthly') return null
    const currentMonth = format(today, 'yyyy-MM')
    // Wenn selectedMonth auf 'all' steht, zeige aktuellen Monat
    return selectedMonth === 'all' ? currentMonth : selectedMonth
  }, [viewMode, timeGranularity, selectedMonth])

  // ═══════════════════════════════════════════════════════════════════════════════
  //  REVENUE-Berechnungen
  // ═══════════════════════════════════════════════════════════════════════════════

  const totalRevenue  = contextBookings.reduce((s, b) => s + b.totalPrice, 0)
  const totalBedNights = contextBookings.reduce((s, b) => s + b.bedsBooked * b.nights, 0)
  const avgBedPrice   = contextBookings.length > 0
    ? contextBookings.reduce((s, b) => s + b.pricePerBedNight, 0) / contextBookings.length : 0
  const avgNights     = contextBookings.length > 0
    ? Math.round(contextBookings.reduce((s, b) => s + b.nights, 0) / contextBookings.length * 10) / 10 : 0
  const totalBeds     = analyticsProperties.filter(p => p.active).reduce((s, p) => s + p.beds, 0)

  // ── Chart: Kontext ohne Monat-Filter ────────────────────────────────────────
  const chartBase = selectedPropertyId
    ? validBookings.filter(b => b.propertyId === selectedPropertyId)
    : selectedLocationId
      ? validBookings.filter(b =>
          allProperties.find(p => p.id === b.propertyId)?.locationId === selectedLocationId
        )
      : validBookings

  const months12 = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - 11 + i, 1)
    return { label: format(d, 'MMM yy', { locale: de }), key: format(d, 'yyyy-MM') }
  })
  const monthlyData = months12.map(m => ({
    ...m,
    revenue:   chartBase.filter(b => b.checkIn.startsWith(m.key)).reduce((s, b) => s + b.totalPrice, 0),
    bedNights: chartBase.filter(b => b.checkIn.startsWith(m.key)).reduce((s, b) => s + b.bedsBooked * b.nights, 0),
    bookings:  chartBase.filter(b => b.checkIn.startsWith(m.key)).length,
  }))
  const maxMonthRevenue = Math.max(...monthlyData.map(m => m.revenue), 1)

  // ── Standort-Daten (Level 0) ────────────────────────────────────────────────
  const totalLocRevenue = contextBookings.reduce((s, b) => s + b.totalPrice, 1)
  const locData = analyticsLocations.map(l => {
    const props = analyticsProperties.filter(p => p.locationId === l.id)
    const bks   = contextBookings.filter(b => props.some(p => p.id === b.propertyId))
    return {
      ...l,
      revenue:     bks.reduce((s, b) => s + b.totalPrice, 0),
      bookings:    bks.length,
      bedNights:   bks.reduce((s, b) => s + b.bedsBooked * b.nights, 0),
      propCount:   props.length,
      beds:        props.filter(p => p.active).reduce((s, p) => s + p.beds, 0),
      avgBedPrice: bks.length > 0 ? bks.reduce((s, b) => s + b.pricePerBedNight, 0) / bks.length : 0,
    }
  }).sort((a, b) => b.revenue - a.revenue)
  const maxLocRevenue = Math.max(...locData.map(l => l.revenue), 1)

  // ── Objekt-Daten (Level 1) ──────────────────────────────────────────────────
  const propsForLocation = selectedLocationId
    ? allProperties.filter(p => p.locationId === selectedLocationId)
    : []
  const propData = propsForLocation.map(p => {
    const bks = contextBookings.filter(b => b.propertyId === p.id)
    return {
      ...p,
      revenue:     bks.reduce((s, b) => s + b.totalPrice, 0),
      bookings:    bks.length,
      bedNights:   bks.reduce((s, b) => s + b.bedsBooked * b.nights, 0),
      avgBedPrice: bks.length > 0 ? bks.reduce((s, b) => s + b.pricePerBedNight, 0) / bks.length : 0,
    }
  }).sort((a, b) => b.revenue - a.revenue)
  const maxPropRev = Math.max(...propData.map(p => p.revenue), 1)

  // ── Buchungen (Level 2) ─────────────────────────────────────────────────────
  const propertyBookings = [...contextBookings].sort((a, b) => b.checkIn.localeCompare(a.checkIn))

  // ── Top Auftraggeber ────────────────────────────────────────────────────────
  const custData = allCustomers.map(c => ({
    ...c,
    revenue:   contextBookings.filter(b => b.customerId === c.id).reduce((s, b) => s + b.totalPrice, 0),
    bookings:  contextBookings.filter(b => b.customerId === c.id).length,
    bedNights: contextBookings.filter(b => b.customerId === c.id).reduce((s, b) => s + b.bedsBooked * b.nights, 0),
  })).filter(c => c.bookings > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 10)

  // ═══════════════════════════════════════════════════════════════════════════════
  //  OCCUPANCY-Berechnungen
  // ═══════════════════════════════════════════════════════════════════════════════

  // ── Chart-Zeitraum (voller Überblick für Chart) ────────────────────────────
  const occupancyChartRange = useMemo(() => {
    const end = endOfMonth(today)
    if (timeGranularity === 'weekly') {
      return { start: startOfISOWeek(subWeeks(today, 15)), end }
    }
    return { start: startOfMonth(subMonths(today, 11)), end }
  }, [timeGranularity])

  // ── Ausgewählter Zeitraum (für KPIs + Cards) ──────────────────────────────
  const occupancySelectedRange = useMemo(() => {
    if (timeGranularity === 'monthly') {
      const monthKey = effectiveOccMonth ?? format(today, 'yyyy-MM')
      const d = new Date(monthKey + '-01')
      return { start: startOfMonth(d), end: endOfMonth(d) }
    }
    // weekly
    const weekInfo = last16Weeks.find(w => w.value === selectedWeek)
    if (weekInfo) return { start: weekInfo.start, end: weekInfo.end }
    // Fallback: aktuelle Woche
    return { start: startOfISOWeek(today), end: endOfISOWeek(today) }
  }, [timeGranularity, effectiveOccMonth, selectedWeek, last16Weeks])

  // Properties im aktuellen Scope (Drill-Down, nur Analytics-Standorte)
  const scopedProperties = useMemo(() => {
    if (selectedPropertyId) return analyticsProperties.filter(p => p.id === selectedPropertyId)
    if (selectedLocationId) return analyticsProperties.filter(p => p.locationId === selectedLocationId)
    return analyticsProperties
  }, [selectedPropertyId, selectedLocationId, analyticsProperties])

  // ── Chart-Daten (voller Zeitraum) ─────────────────────────────────────────
  const dailyOccupancyChart = useMemo(() => {
    if (viewMode !== 'occupancy') return []
    return calcDailyOccupancy(occupancyChartRange.start, occupancyChartRange.end, scopedProperties, allBookings)
  }, [viewMode, occupancyChartRange, scopedProperties, allBookings])

  const occupancyChartData = useMemo((): PeriodOccupancy[] => {
    if (viewMode !== 'occupancy' || dailyOccupancyChart.length === 0) return []
    return timeGranularity === 'weekly'
      ? aggregateToWeeks(dailyOccupancyChart)
      : aggregateToMonths(dailyOccupancyChart)
  }, [viewMode, timeGranularity, dailyOccupancyChart])

  // ── Ausgewählter Zeitraum: für KPIs + Cards ──────────────────────────────
  const dailyOccupancySelected = useMemo(() => {
    if (viewMode !== 'occupancy') return []
    return calcDailyOccupancy(occupancySelectedRange.start, occupancySelectedRange.end, scopedProperties, allBookings)
  }, [viewMode, occupancySelectedRange, scopedProperties, allBookings])

  // Auslastung pro Standort (Level 0) — NUR für den gewählten Zeitraum
  const occupancyByLocation = useMemo(() => {
    if (viewMode !== 'occupancy' || drillLevel !== 'locations') return []
    const entities = analyticsLocations.map(l => ({
      id: l.id,
      properties: analyticsProperties.filter(p => p.locationId === l.id),
    }))
    return calcOccupancyByEntity(occupancySelectedRange.start, occupancySelectedRange.end, entities, allBookings)
  }, [viewMode, drillLevel, analyticsLocations, analyticsProperties, allBookings, occupancySelectedRange])

  // Auslastung pro Objekt (Level 1) — NUR für den gewählten Zeitraum
  const occupancyByProperty = useMemo(() => {
    if (viewMode !== 'occupancy' || drillLevel !== 'properties') return []
    const props = analyticsProperties.filter(p => p.locationId === selectedLocationId)
    const entities = props.map(p => ({ id: p.id, properties: [p] }))
    return calcOccupancyByEntity(occupancySelectedRange.start, occupancySelectedRange.end, entities, allBookings)
  }, [viewMode, drillLevel, selectedLocationId, analyticsProperties, allBookings, occupancySelectedRange])

  // KPIs — NUR für den gewählten Zeitraum
  const occKpis = useMemo(() => {
    if (dailyOccupancySelected.length === 0) return null
    const avgRate = dailyOccupancySelected.reduce((s, d) => s + d.rate, 0) / dailyOccupancySelected.length
    const beds = dailyOccupancySelected[0]?.totalBeds ?? 0
    const days = dailyOccupancySelected.length
    // Bettnächte = Summe über alle Tage (nicht Tagesdurchschnitt)
    const bookedBedNights = dailyOccupancySelected.reduce((s, d) => s + d.bookedBeds, 0)
    const availableBedNights = beds * days
    const todayStr = format(new Date(), 'yyyy-MM-dd')
    const todayData = dailyOccupancySelected.find(d => d.date === todayStr)
    return {
      currentRate: todayData?.rate ?? 0,
      currentBooked: todayData?.bookedBeds ?? 0,
      avgRate: Math.round(avgRate * 10) / 10,
      totalBeds: beds,
      bookedBedNights: Math.round(bookedBedNights),
      availableBedNights,
      peakRate: Math.max(...dailyOccupancySelected.map(d => d.rate)),
      lowRate: Math.min(...dailyOccupancySelected.map(d => d.rate)),
      days,
    }
  }, [dailyOccupancySelected])

  // Label für den ausgewählten Zeitraum
  const selectedPeriodLabel = useMemo(() => {
    if (timeGranularity === 'monthly') {
      const m = effectiveOccMonth ?? format(today, 'yyyy-MM')
      const d = new Date(m + '-01')
      return format(d, 'MMMM yyyy', { locale: de })
    }
    const wk = last16Weeks.find(w => w.value === selectedWeek)
    return wk ? `${wk.label} (${wk.sub})` : selectedWeek
  }, [timeGranularity, effectiveOccMonth, selectedWeek, last16Weeks])

  // ── Welcher Chart-Key ist aktuell selektiert? ─────────────────────────────
  const selectedChartKey = useMemo(() => {
    if (timeGranularity === 'monthly') return effectiveOccMonth ?? format(today, 'yyyy-MM')
    return selectedWeek
  }, [timeGranularity, effectiveOccMonth, selectedWeek])

  // ── Navigation ──────────────────────────────────────────────────────────────
  function goToLocation(id: string) { setSelectedLocationId(id); setSelectedPropertyId(null) }
  function goToProperty(id: string) { setSelectedPropertyId(id) }
  function goBack() {
    if (selectedPropertyId) setSelectedPropertyId(null)
    else { setSelectedLocationId(null); setSelectedPropertyId(null) }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════════════════════

  return (
    <div className="p-6 max-w-7xl mx-auto">

      {/* ── Header + Breadcrumb ── */}
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <nav className="flex items-center gap-1 text-sm text-slate-400 mb-0.5">
            <button
              onClick={() => { setSelectedLocationId(null); setSelectedPropertyId(null) }}
              className={`hover:text-blue-600 transition-colors ${drillLevel === 'locations' ? 'text-slate-900 font-semibold' : 'text-slate-400 hover:text-blue-600'}`}
            >
              Analytics
            </button>
            {selectedLocation && (
              <>
                <ChevronRight size={13} />
                <button
                  onClick={() => setSelectedPropertyId(null)}
                  className={`hover:text-blue-600 transition-colors ${drillLevel === 'properties' ? 'text-slate-900 font-semibold' : 'text-slate-400 hover:text-blue-600'}`}
                >
                  {selectedLocation.name}
                </button>
              </>
            )}
            {selectedProperty && (
              <>
                <ChevronRight size={13} />
                <span className="text-slate-900 font-semibold">
                  {selectedProperty.shortCode ?? selectedProperty.name}
                </span>
              </>
            )}
          </nav>
          <h1 className="text-2xl font-bold text-slate-900">
            {selectedProperty
              ? (selectedProperty.shortCode ?? selectedProperty.name)
              : selectedLocation
                ? selectedLocation.name
                : 'Analytics'}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Auswertungen und Kennzahlen · Monteursvermietung</p>
        </div>
        {drillLevel !== 'locations' && (
          <button
            onClick={goBack}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <ChevronLeft size={14} /> Zurück
          </button>
        )}
      </div>

      {/* ── View-Toggle: Umsatz | Auslastung ── */}
      <div className="mb-5 flex items-center gap-3 flex-wrap">
        <div className="flex bg-slate-100 rounded-lg p-0.5">
          <button
            onClick={() => setViewMode('revenue')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              viewMode === 'revenue'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Euro size={14} />
            Umsatz
          </button>
          <button
            onClick={() => setViewMode('occupancy')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              viewMode === 'occupancy'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Percent size={14} />
            Auslastung
          </button>
        </div>

        {/* Woche/Monat Toggle (nur bei Auslastung) */}
        {viewMode === 'occupancy' && (
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setTimeGranularity('weekly')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                timeGranularity === 'weekly'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <CalendarDays size={13} />
              Woche
            </button>
            <button
              onClick={() => setTimeGranularity('monthly')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                timeGranularity === 'monthly'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <BarChart3 size={13} />
              Monat
            </button>
          </div>
        )}
      </div>

      {/* ── Zeitraum-Filter ── */}
      {/* Revenue: Monats-Pills mit "Alle Monate" */}
      {viewMode === 'revenue' && (
        <div className="mb-5 overflow-x-auto pb-1">
          <div className="flex gap-1.5 min-w-max">
            <button
              onClick={() => setSelectedMonth('all')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 border ${
                selectedMonth === 'all'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Alle Monate
            </button>
            {last24Months.map(m => (
              <button
                key={m.value}
                onClick={() => setSelectedMonth(prev => prev === m.value ? 'all' : m.value)}
                disabled={!m.hasData}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 border ${
                  selectedMonth === m.value
                    ? 'bg-blue-600 text-white border-blue-600'
                    : m.hasData
                      ? 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      : 'bg-slate-50 border-slate-100 text-slate-300 cursor-default'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Occupancy Monthly: Monats-Pills (ohne "Alle", default = aktueller Monat) */}
      {viewMode === 'occupancy' && timeGranularity === 'monthly' && (
        <div className="mb-5 overflow-x-auto pb-1">
          <div className="flex gap-1.5 min-w-max">
            {last24Months.map(m => {
              const isSelected = effectiveOccMonth === m.value
              return (
                <button
                  key={m.value}
                  onClick={() => setSelectedMonth(m.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 border ${
                    isSelected
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {m.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Occupancy Weekly: KW-Pills */}
      {viewMode === 'occupancy' && timeGranularity === 'weekly' && (
        <div className="mb-5 overflow-x-auto pb-1">
          <div className="flex gap-1.5 min-w-max">
            {last16Weeks.map(w => {
              const isSelected = selectedWeek === w.value
              return (
                <button
                  key={w.value}
                  onClick={() => setSelectedWeek(w.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 border ${
                    isSelected
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>{w.label}</span>
                  <span className={`block text-[10px] ${isSelected ? 'text-blue-200' : 'text-slate-400'}`}>{w.sub}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════
          UMSATZ-ANSICHT
      ═══════════════════════════════════════════════════════════════════════════ */}
      {viewMode === 'revenue' && (
        <>
          {/* ── KPIs ── */}
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-4 mb-5">
            {[
              { label: 'Umsatz', value: formatCurrency(totalRevenue), sub: `${contextBookings.length} Buchungen`, icon: Euro, color: 'bg-blue-500' },
              { label: 'Ø Bettpreis/Nacht', value: avgBedPrice > 0 ? formatCurrency(avgBedPrice) : '—', sub: 'Zentrale KPI', icon: TrendingUp, color: 'bg-emerald-500' },
              { label: 'Bettnächte', value: totalBedNights.toLocaleString('de'), sub: 'Betten × Nächte', icon: BedDouble, color: 'bg-violet-500' },
              { label: 'Portfolio / Betten', value: `${analyticsProperties.length} / ${totalBeds}`, sub: `${analyticsLocations.length} Standorte`, icon: Building2, color: 'bg-amber-500' },
              { label: 'Ø Aufenthalt', value: `${avgNights}N`, sub: `${allCustomers.length} Auftraggeber`, icon: Users, color: 'bg-slate-500' },
            ].map((kpi, i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${kpi.color}`}>
                  <kpi.icon size={18} className="text-white" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">{kpi.label}</p>
                  <p className="text-lg font-bold text-slate-900">{kpi.value}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{kpi.sub}</p>
                </div>
              </div>
            ))}
          </div>

          {/* ── Monatsumsatz-Chart ── */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 mb-5">
            <div className="flex items-baseline gap-2 mb-4 flex-wrap">
              <h2 className="font-semibold text-slate-900">Monatsumsatz — 12 Monate</h2>
              {selectedLocation && <span className="text-sm text-slate-400">· {selectedLocation.name}</span>}
              {selectedProperty && <span className="text-sm text-slate-400">· {selectedProperty.shortCode ?? selectedProperty.name}</span>}
              <span className="text-xs text-slate-400 ml-auto">Balken klicken zum Filtern</span>
            </div>
            {validBookings.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">Noch keine Buchungsdaten vorhanden</p>
            ) : (
              <div className="flex items-end gap-1.5" style={{ height: '150px' }}>
                {monthlyData.map(m => (
                  <div key={m.key} className="flex-1 flex flex-col items-center gap-1 h-full min-w-0">
                    <div className="w-full flex-1 flex items-end">
                      <div
                        className={`w-full rounded-t-md transition-colors cursor-pointer group relative ${
                          selectedMonth === m.key
                            ? 'bg-blue-600 hover:bg-blue-700'
                            : selectedMonth !== 'all'
                              ? 'bg-slate-200 hover:bg-blue-400'
                              : 'bg-blue-400 hover:bg-blue-600'
                        }`}
                        style={{ height: `${Math.max((m.revenue / maxMonthRevenue) * 100, m.revenue > 0 ? 3 : 0)}%` }}
                        title={`${m.label}: ${formatCurrency(m.revenue)} · ${m.bedNights} Bettnächte · ${m.bookings} Buchungen`}
                        onClick={() => setSelectedMonth(prev => prev === m.key ? 'all' : m.key)}
                      >
                        {m.revenue > 0 && (
                          <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10 pointer-events-none">
                            {formatCurrency(m.revenue)}
                          </div>
                        )}
                      </div>
                    </div>
                    <span className={`text-xs text-center leading-tight truncate w-full ${
                      selectedMonth === m.key ? 'text-blue-600 font-semibold' : 'text-slate-400'
                    }`}>
                      {m.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ══ Level 0: Standorte ══ */}
          {drillLevel === 'locations' && (
            <>
              <h2 className="font-semibold text-slate-900 mb-3">
                Umsatz nach Standort
                {selectedMonth !== 'all' && (
                  <span className="text-sm font-normal text-blue-600 ml-2">
                    · {last24Months.find(m => m.value === selectedMonth)?.label}
                  </span>
                )}
              </h2>
              {locData.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8 bg-white rounded-xl border border-slate-200">Noch keine Daten</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-5">
                  {locData.map(l => (
                    <button
                      key={l.id}
                      onClick={() => goToLocation(l.id)}
                      className="bg-white rounded-xl border border-slate-200 p-5 text-left hover:border-blue-300 hover:shadow-md transition-all group cursor-pointer"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: l.color }} />
                          <div>
                            <p className="font-semibold text-slate-900 group-hover:text-blue-700 transition-colors">{l.name}</p>
                            <p className="text-xs text-slate-400">{l.city} · {l.propCount} Portfolio · {l.beds} Betten</p>
                          </div>
                        </div>
                        <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-400 transition-colors flex-shrink-0" />
                      </div>
                      <div className="mb-3">
                        <div className="flex items-baseline justify-between mb-1.5">
                          <span className="text-2xl font-bold text-slate-900">{formatCurrency(l.revenue)}</span>
                          <span className="text-xs text-slate-400 font-medium">
                            {Math.round((l.revenue / totalLocRevenue) * 100)}%
                          </span>
                        </div>
                        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${(l.revenue / maxLocRevenue) * 100}%`, backgroundColor: l.color }}
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                        <span>{l.bookings} Buchungen</span>
                        <span>·</span>
                        <span>{l.bedNights} Bettnächte</span>
                        {l.avgBedPrice > 0 && (
                          <>
                            <span>·</span>
                            <span className="text-blue-600 font-semibold">{formatCurrency(l.avgBedPrice)}/B/N</span>
                          </>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {custData.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <h2 className="font-semibold text-slate-900 mb-4">Top Auftraggeber</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
                          <th className="text-left pb-3 font-semibold">#</th>
                          <th className="text-left pb-3 font-semibold">Firma</th>
                          <th className="text-left pb-3 font-semibold">Ort</th>
                          <th className="text-right pb-3 font-semibold">Buchungen</th>
                          <th className="text-right pb-3 font-semibold">Bettnächte</th>
                          <th className="text-right pb-3 font-semibold">Umsatz</th>
                        </tr>
                      </thead>
                      <tbody>
                        {custData.map((c, i) => {
                          const initials = c.companyName.split(' ').filter(w => w.length > 0).slice(0, 2).map(w => w[0].toUpperCase()).join('')
                          return (
                            <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="py-3 text-slate-400 font-medium">{i + 1}</td>
                              <td className="py-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-violet-600 rounded-md flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                    {initials}
                                  </div>
                                  <div>
                                    <p className="font-medium text-slate-900">{c.companyName}</p>
                                    {(c.firstName || c.lastName) && (
                                      <p className="text-xs text-slate-400">{c.firstName} {c.lastName}</p>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 text-slate-500">{c.city}</td>
                              <td className="py-3 text-right">{c.bookings}</td>
                              <td className="py-3 text-right">{c.bedNights}</td>
                              <td className="py-3 text-right font-semibold text-slate-900">{formatCurrency(c.revenue)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ══ Level 1: Objekte ══ */}
          {drillLevel === 'properties' && (
            <>
              <h2 className="font-semibold text-slate-900 mb-3">
                Portfolio in {selectedLocation?.name}
                {selectedMonth !== 'all' && (
                  <span className="text-sm font-normal text-blue-600 ml-2">
                    · {last24Months.find(m => m.value === selectedMonth)?.label}
                  </span>
                )}
              </h2>
              {propData.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8 bg-white rounded-xl border border-slate-200">Kein Portfolio gefunden</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-5">
                  {propData.map(p => {
                    const loc = allLocations.find(l => l.id === p.locationId)
                    return (
                      <button
                        key={p.id}
                        onClick={() => goToProperty(p.id)}
                        className="bg-white rounded-xl border border-slate-200 p-4 text-left hover:border-blue-300 hover:shadow-md transition-all group cursor-pointer"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: loc?.color }} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="font-semibold text-slate-900 group-hover:text-blue-700 transition-colors truncate">
                                  {p.name}
                                </p>
                                {p.shortCode && (
                                  <span className="text-xs font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded flex-shrink-0">
                                    {p.shortCode}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-400">{p.beds} Betten</p>
                            </div>
                          </div>
                          <ChevronRight size={15} className="text-slate-300 group-hover:text-blue-400 transition-colors flex-shrink-0 ml-2" />
                        </div>
                        <div className="mb-2">
                          <div className="flex items-baseline justify-between mb-1">
                            <span className="text-xl font-bold text-slate-900">{formatCurrency(p.revenue)}</span>
                            {p.avgBedPrice > 0 && (
                              <span className="text-xs text-blue-600 font-semibold">{formatCurrency(p.avgBedPrice)}/B/N</span>
                            )}
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${(p.revenue / maxPropRev) * 100}%`, backgroundColor: loc?.color ?? '#94a3b8' }}
                            />
                          </div>
                        </div>
                        <p className="text-xs text-slate-400">{p.bookings} Buchungen · {p.bedNights} Bettnächte</p>
                      </button>
                    )
                  })}
                </div>
              )}

              {custData.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <h2 className="font-semibold text-slate-900 mb-4">Top Auftraggeber · {selectedLocation?.name}</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
                          <th className="text-left pb-3 font-semibold">#</th>
                          <th className="text-left pb-3 font-semibold">Firma</th>
                          <th className="text-right pb-3 font-semibold">Buchungen</th>
                          <th className="text-right pb-3 font-semibold">Bettnächte</th>
                          <th className="text-right pb-3 font-semibold">Umsatz</th>
                        </tr>
                      </thead>
                      <tbody>
                        {custData.map((c, i) => {
                          const initials = c.companyName.split(' ').filter(w => w.length > 0).slice(0, 2).map(w => w[0].toUpperCase()).join('')
                          return (
                            <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="py-2.5 text-slate-400 font-medium">{i + 1}</td>
                              <td className="py-2.5">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-violet-600 rounded flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                    {initials}
                                  </div>
                                  <p className="font-medium text-slate-900">{c.companyName}</p>
                                </div>
                              </td>
                              <td className="py-2.5 text-right">{c.bookings}</td>
                              <td className="py-2.5 text-right">{c.bedNights}</td>
                              <td className="py-2.5 text-right font-semibold text-slate-900">{formatCurrency(c.revenue)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ══ Level 2: Buchungshistorie ══ */}
          {drillLevel === 'property' && selectedProperty && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                  <h2 className="font-semibold text-slate-900">
                    Buchungshistorie · {selectedProperty.shortCode ?? selectedProperty.name}
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {selectedProperty.beds} Betten
                    {selectedMonth !== 'all' && ` · ${last24Months.find(m => m.value === selectedMonth)?.label}`}
                  </p>
                </div>
                <span className="text-sm text-slate-400">{propertyBookings.length} Buchungen</span>
              </div>

              {propertyBookings.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">Keine Buchungen im gewählten Zeitraum</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
                        <th className="text-left pb-2.5 font-semibold">Zeitraum</th>
                        <th className="text-left pb-2.5 font-semibold">Auftraggeber</th>
                        <th className="text-center pb-2.5 font-semibold">Nächte</th>
                        <th className="text-center pb-2.5 font-semibold">Betten</th>
                        <th className="text-right pb-2.5 font-semibold">€/B/N</th>
                        <th className="text-right pb-2.5 font-semibold">Reinigung</th>
                        <th className="text-right pb-2.5 font-semibold">Umsatz</th>
                        <th className="text-center pb-2.5 font-semibold">Zahlung</th>
                      </tr>
                    </thead>
                    <tbody>
                      {propertyBookings.map(b => {
                        const cust = allCustomers.find(c => c.id === b.customerId)
                        return (
                          <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="py-2.5">
                              <p className="font-medium text-slate-800 text-xs">
                                {b.checkIn} – {b.checkOut}
                              </p>
                              {b.invoiceNumber && (
                                <p className="text-xs text-slate-400 font-mono">{b.invoiceNumber}</p>
                              )}
                            </td>
                            <td className="py-2.5 text-slate-600 text-sm">{cust?.companyName ?? '–'}</td>
                            <td className="py-2.5 text-center text-slate-600">{b.nights}</td>
                            <td className="py-2.5 text-center text-slate-600">{b.bedsBooked}</td>
                            <td className="py-2.5 text-right text-blue-600 font-semibold text-sm">
                              {b.pricePerBedNight > 0 ? formatCurrency(b.pricePerBedNight) : '–'}
                            </td>
                            <td className="py-2.5 text-right text-slate-500 text-xs">
                              {b.cleaningFee > 0 ? formatCurrency(b.cleaningFee) : '–'}
                            </td>
                            <td className="py-2.5 text-right font-bold text-slate-900">
                              {formatCurrency(b.totalPrice)}
                            </td>
                            <td className="py-2.5 text-center">
                              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                                b.paymentStatus === 'bezahlt'   ? 'bg-emerald-100 text-emerald-700' :
                                b.paymentStatus === 'erstattet' ? 'bg-red-100 text-red-700' :
                                b.paymentStatus === 'teilweise' ? 'bg-amber-100 text-amber-700' :
                                'bg-slate-100 text-slate-500'
                              }`}>
                                {b.paymentStatus}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-200 bg-slate-50">
                        <td colSpan={6} className="py-2.5 px-0 text-xs text-slate-500 font-semibold">
                          Gesamt ({propertyBookings.length} Buchungen)
                        </td>
                        <td className="py-2.5 text-right font-bold text-slate-900">
                          {formatCurrency(propertyBookings.reduce((s, b) => s + b.totalPrice, 0))}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════
          AUSLASTUNG-ANSICHT
      ═══════════════════════════════════════════════════════════════════════════ */}
      {viewMode === 'occupancy' && (
        <>
          {/* ── Auslastungs-KPIs (für den gewählten Zeitraum) ── */}
          {occKpis && (
            <div className="grid grid-cols-2 xl:grid-cols-5 gap-4 mb-5">
              {[
                {
                  label: 'Auslastung',
                  value: `${fmtRate(occKpis.avgRate)}%`,
                  sub: selectedPeriodLabel,
                  icon: Percent,
                  color: occupancyColor(occKpis.avgRate).bar,
                },
                {
                  label: 'Bettnächte',
                  value: occKpis.bookedBedNights.toLocaleString('de-DE'),
                  sub: `von ${occKpis.availableBedNights.toLocaleString('de-DE')} verfügbar`,
                  icon: BedDouble,
                  color: 'bg-violet-500',
                },
                {
                  label: 'Spitze',
                  value: `${fmtRate(occKpis.peakRate)}%`,
                  sub: 'Höchste Auslastung',
                  icon: TrendingUp,
                  color: 'bg-emerald-500',
                },
                {
                  label: 'Tiefstwert',
                  value: `${fmtRate(occKpis.lowRate)}%`,
                  sub: 'Niedrigste Auslastung',
                  icon: TrendingDown,
                  color: 'bg-amber-500',
                },
                {
                  label: 'Heute',
                  value: `${fmtRate(occKpis.currentRate)}%`,
                  sub: `${occKpis.currentBooked} / ${occKpis.totalBeds} Betten`,
                  icon: CalendarDays,
                  color: occupancyColor(occKpis.currentRate).bar,
                },
              ].map((kpi, i) => (
                <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${kpi.color}`}>
                    <kpi.icon size={18} className="text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">{kpi.label}</p>
                    <p className="text-lg font-bold text-slate-900">{kpi.value}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{kpi.sub}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Auslastungs-Chart (voller Zeitraum, Selektion hervorgehoben) ── */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 mb-5">
            <div className="flex items-baseline gap-2 mb-4 flex-wrap">
              <h2 className="font-semibold text-slate-900">
                Bettauslastung — {timeGranularity === 'weekly' ? '16 Wochen' : '12 Monate'}
              </h2>
              {selectedLocation && <span className="text-sm text-slate-400">· {selectedLocation.name}</span>}
              {selectedProperty && <span className="text-sm text-slate-400">· {selectedProperty.shortCode ?? selectedProperty.name}</span>}
              <span className="text-xs text-slate-400 ml-auto">Balken klicken zum Auswählen</span>
            </div>

            {occupancyChartData.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">Noch keine Buchungsdaten vorhanden</p>
            ) : (
              <div className="flex">
                {/* Y-Achse */}
                <div className="w-10 flex flex-col justify-between text-xs text-slate-400 pr-2 py-0.5" style={{ height: '180px' }}>
                  <span>100%</span>
                  <span>75%</span>
                  <span>50%</span>
                  <span>25%</span>
                  <span>0%</span>
                </div>
                {/* Balken */}
                <div className="flex-1 relative" style={{ height: '180px' }}>
                  {[0, 25, 50, 75, 100].map(v => (
                    <div key={v} className="absolute left-0 right-0 border-t border-slate-100" style={{ bottom: `${v}%` }} />
                  ))}
                  <div className="absolute left-0 right-0 border-t border-dashed border-amber-300" style={{ bottom: '40%' }} />
                  <div className="absolute left-0 right-0 border-t border-dashed border-emerald-300" style={{ bottom: '70%' }} />

                  <div className="flex items-end gap-1 h-full relative z-10">
                    {occupancyChartData.map(period => {
                      const isSelected = period.key === selectedChartKey
                      const colors = occupancyColor(period.avgRate)
                      return (
                        <div key={period.key} className="flex-1 flex flex-col items-center gap-1 h-full min-w-0">
                          <div className="w-full flex-1 flex items-end">
                            <div
                              className={`w-full rounded-t-md transition-all group relative cursor-pointer ${
                                isSelected
                                  ? `${colors.bar} ring-2 ring-blue-500 ring-offset-1`
                                  : `${colors.bar} opacity-40 hover:opacity-70`
                              }`}
                              style={{ height: `${Math.max(period.avgRate, period.avgRate > 0 ? 2 : 0)}%` }}
                              onClick={() => {
                                if (timeGranularity === 'monthly') {
                                  setSelectedMonth(period.key)
                                } else {
                                  setSelectedWeek(period.key)
                                }
                              }}
                            >
                              <div className="absolute -top-9 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-20 pointer-events-none">
                                {fmtRate(period.avgRate)}% · {period.avgBookedBeds}/{period.totalBeds} Betten
                              </div>
                            </div>
                          </div>
                          <span className={`text-[10px] text-center leading-tight truncate w-full ${
                            isSelected ? 'text-blue-600 font-bold' : 'text-slate-400'
                          }`}>
                            {period.label}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-4 mt-3 text-xs text-slate-400 border-t border-slate-100 pt-3">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-emerald-500" />
                <span>≥ 70%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-amber-400" />
                <span>40–69%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-red-400" />
                <span>&lt; 40%</span>
              </div>
            </div>
          </div>

          {/* ══ Level 0: Standorte (Auslastung) ══ */}
          {drillLevel === 'locations' && (
            <>
              <h2 className="font-semibold text-slate-900 mb-3">
                Auslastung nach Standort
                <span className="text-sm font-normal text-blue-600 ml-2">· {selectedPeriodLabel}</span>
              </h2>
              {analyticsLocations.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8 bg-white rounded-xl border border-slate-200">Keine Standorte vorhanden</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-5">
                  {analyticsLocations.map(loc => {
                    const occ = occupancyByLocation.find(o => o.entityId === loc.id)
                    const rate = occ?.avgRate ?? 0
                    const colors = occupancyColor(rate)
                    const props = analyticsProperties.filter(p => p.locationId === loc.id)
                    const beds = props.filter(p => p.active).reduce((s, p) => s + p.beds, 0)
                    return (
                      <button
                        key={loc.id}
                        onClick={() => goToLocation(loc.id)}
                        className="bg-white rounded-xl border border-slate-200 p-5 text-left hover:border-blue-300 hover:shadow-md transition-all group cursor-pointer"
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2.5">
                            <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: loc.color }} />
                            <div>
                              <p className="font-semibold text-slate-900 group-hover:text-blue-700 transition-colors">{loc.name}</p>
                              <p className="text-xs text-slate-400">{loc.city} · {props.length} Portfolio · {beds} Betten</p>
                            </div>
                          </div>
                          <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-400 transition-colors flex-shrink-0" />
                        </div>
                        <div className="mb-3">
                          <div className="flex items-baseline justify-between mb-1.5">
                            <span className={`text-2xl font-bold ${colors.text}`}>{fmtRate(rate)}%</span>
                            <span className="text-xs text-slate-400">
                              {(occ?.bookedBedNights ?? 0).toLocaleString('de-DE')} / {(occ?.availableBedNights ?? 0).toLocaleString('de-DE')} Bettnächte
                            </span>
                          </div>
                          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${colors.bar}`}
                              style={{ width: `${Math.min(rate, 100)}%` }}
                            />
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                          <span className={`font-medium ${colors.text}`}>
                            {rate >= 70 ? 'Gut ausgelastet' : rate >= 40 ? 'Mittlere Auslastung' : 'Niedrige Auslastung'}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* ══ Level 1: Objekte eines Standorts (Auslastung) ══ */}
          {drillLevel === 'properties' && selectedLocation && (
            <>
              <h2 className="font-semibold text-slate-900 mb-3">
                Auslastung in {selectedLocation.name}
                <span className="text-sm font-normal text-blue-600 ml-2">· {selectedPeriodLabel}</span>
              </h2>
              {propsForLocation.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8 bg-white rounded-xl border border-slate-200">Kein Portfolio gefunden</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-5">
                  {propsForLocation.map(p => {
                    const occ = occupancyByProperty.find(o => o.entityId === p.id)
                    const rate = occ?.avgRate ?? 0
                    const colors = occupancyColor(rate)
                    return (
                      <button
                        key={p.id}
                        onClick={() => goToProperty(p.id)}
                        className="bg-white rounded-xl border border-slate-200 p-4 text-left hover:border-blue-300 hover:shadow-md transition-all group cursor-pointer"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: selectedLocation.color }} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="font-semibold text-slate-900 group-hover:text-blue-700 transition-colors truncate">
                                  {p.name}
                                </p>
                                {p.shortCode && (
                                  <span className="text-xs font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded flex-shrink-0">
                                    {p.shortCode}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-400">{p.beds} Betten</p>
                            </div>
                          </div>
                          <ChevronRight size={15} className="text-slate-300 group-hover:text-blue-400 transition-colors flex-shrink-0 ml-2" />
                        </div>
                        <div className="mb-2">
                          <div className="flex items-baseline justify-between mb-1">
                            <span className={`text-xl font-bold ${colors.text}`}>{fmtRate(rate)}%</span>
                            <span className="text-xs text-slate-400">
                              {(occ?.bookedBedNights ?? 0).toLocaleString('de-DE')} / {(occ?.availableBedNights ?? 0).toLocaleString('de-DE')} Bettnächte
                            </span>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${colors.bar}`}
                              style={{ width: `${Math.min(rate, 100)}%` }}
                            />
                          </div>
                        </div>
                        <p className={`text-xs font-medium ${colors.text}`}>
                          {rate >= 70 ? 'Gut ausgelastet' : rate >= 40 ? 'Mittlere Auslastung' : 'Niedrige Auslastung'}
                        </p>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* ══ Level 2: Einzelobjekt (Auslastung-Timeline) ══ */}
          {drillLevel === 'property' && selectedProperty && (
            <OccupancyPropertyDetail
              property={selectedProperty}
              bookings={allBookings}
              properties={[selectedProperty]}
              timeGranularity={timeGranularity}
              selectedPeriodLabel={selectedPeriodLabel}
              selectedRange={occupancySelectedRange}
            />
          )}
        </>
      )}
    </div>
  )
}

// ── Subkomponente: Einzelobjekt-Auslastung ──────────────────────────────────────

function OccupancyPropertyDetail({
  property,
  bookings,
  properties,
  timeGranularity,
  selectedPeriodLabel,
  selectedRange,
}: {
  property: { id: string; name: string; shortCode?: string; beds: number }
  bookings: { checkIn: string; checkOut: string; bedsBooked: number; status: string; propertyId: string; customerId: string; nights: number; id: string }[]
  properties: { id: string; beds: number; active: boolean }[]
  timeGranularity: 'weekly' | 'monthly'
  selectedPeriodLabel: string
  selectedRange: { start: Date; end: Date }
}) {
  const today = new Date()

  // Chart-Daten: voller Zeitraum
  const chartRange = useMemo(() => {
    const end = endOfMonth(today)
    if (timeGranularity === 'weekly') {
      return { start: startOfISOWeek(subWeeks(today, 15)), end }
    }
    return { start: startOfMonth(subMonths(today, 11)), end }
  }, [timeGranularity])

  const dailyChart = useMemo(() => {
    return calcDailyOccupancy(chartRange.start, chartRange.end, properties as any, bookings as any)
  }, [chartRange, properties, bookings])

  const chartData = useMemo((): PeriodOccupancy[] => {
    if (dailyChart.length === 0) return []
    return timeGranularity === 'weekly' ? aggregateToWeeks(dailyChart) : aggregateToMonths(dailyChart)
  }, [timeGranularity, dailyChart])

  // KPIs: NUR für den gewählten Zeitraum
  const dailySelected = useMemo(() => {
    return calcDailyOccupancy(selectedRange.start, selectedRange.end, properties as any, bookings as any)
  }, [selectedRange, properties, bookings])

  const avgRate = dailySelected.length > 0 ? Math.round(dailySelected.reduce((s, d) => s + d.rate, 0) / dailySelected.length * 10) / 10 : 0
  const avgBooked = dailySelected.length > 0 ? Math.round(dailySelected.reduce((s, d) => s + d.bookedBeds, 0) / dailySelected.length * 10) / 10 : 0
  const peak = dailySelected.length > 0 ? Math.max(...dailySelected.map(d => d.rate)) : 0
  const colors = occupancyColor(avgRate)

  return (
    <div className="space-y-4">
      {/* KPI-Karten */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Auslastung</p>
          <p className={`text-2xl font-bold ${colors.text}`}>{fmtRate(avgRate)}%</p>
          <p className="text-xs text-slate-400 mt-0.5">{selectedPeriodLabel}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Ø Betten belegt</p>
          <p className="text-2xl font-bold text-slate-900">{avgBooked}</p>
          <p className="text-xs text-slate-400 mt-0.5">von {property.beds} verfügbar</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Spitze</p>
          <p className="text-2xl font-bold text-emerald-600">{fmtRate(peak)}%</p>
          <p className="text-xs text-slate-400 mt-0.5">Maximum im Zeitraum</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium mb-1">Kapazität</p>
          <p className="text-2xl font-bold text-slate-900">{property.beds}</p>
          <p className="text-xs text-slate-400 mt-0.5">{property.beds} Betten</p>
        </div>
      </div>

      {/* Timeline-Chart */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-semibold text-slate-900 mb-4">
          Verlauf · {property.shortCode ?? property.name}
          <span className="text-sm font-normal text-slate-400 ml-2">
            {timeGranularity === 'weekly' ? '16 Wochen' : '12 Monate'}
          </span>
        </h3>

        {chartData.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">Keine Daten</p>
        ) : (
          <div className="flex">
            <div className="w-10 flex flex-col justify-between text-xs text-slate-400 pr-2 py-0.5" style={{ height: '160px' }}>
              <span>100%</span>
              <span>75%</span>
              <span>50%</span>
              <span>25%</span>
              <span>0%</span>
            </div>
            <div className="flex-1 relative" style={{ height: '160px' }}>
              {[0, 25, 50, 75, 100].map(v => (
                <div key={v} className="absolute left-0 right-0 border-t border-slate-100" style={{ bottom: `${v}%` }} />
              ))}
              <div className="absolute left-0 right-0 border-t border-dashed border-amber-300" style={{ bottom: '40%' }} />
              <div className="absolute left-0 right-0 border-t border-dashed border-emerald-300" style={{ bottom: '70%' }} />

              <div className="flex items-end gap-1 h-full relative z-10">
                {chartData.map(period => {
                  const c = occupancyColor(period.avgRate)
                  return (
                    <div key={period.key} className="flex-1 flex flex-col items-center gap-1 h-full min-w-0">
                      <div className="w-full flex-1 flex items-end">
                        <div
                          className={`w-full rounded-t-md transition-all group relative ${c.bar} hover:opacity-80`}
                          style={{ height: `${Math.max(period.avgRate, period.avgRate > 0 ? 2 : 0)}%` }}
                        >
                          <div className="absolute -top-9 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-20 pointer-events-none">
                            {fmtRate(period.avgRate)}% · {period.avgBookedBeds}/{period.totalBeds} Betten
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-400 text-center leading-tight truncate w-full">
                        {period.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-4 mt-3 text-xs text-slate-400 border-t border-slate-100 pt-3">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-emerald-500" />
            <span>≥ 70%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-amber-400" />
            <span>40–69%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-red-400" />
            <span>&lt; 40%</span>
          </div>
        </div>
      </div>
    </div>
  )
}
