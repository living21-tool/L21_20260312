import { parseISO, eachDayOfInterval, format, getISOWeek, getISOWeekYear } from 'date-fns'
import { de } from 'date-fns/locale'
import type { Booking, Property } from './types'

// ── Typen ──────────────────────────────────────────────────────────────────────

export interface DayOccupancy {
  date: string          // 'YYYY-MM-DD'
  totalBeds: number
  bookedBeds: number
  rate: number          // 0–100
}

export interface PeriodOccupancy {
  label: string         // "KW 12" oder "Mär 26"
  key: string           // "2026-W12" oder "2026-03"
  startDate: string
  endDate: string
  avgRate: number       // 0–100
  totalBeds: number
  avgBookedBeds: number
  days: number
}

export interface OccupancyByEntity {
  entityId: string
  avgRate: number
  totalBeds: number
  avgBookedBeds: number
  bookedBedNights: number
  availableBedNights: number
}

// ── Tägliche Auslastung ────────────────────────────────────────────────────────

/**
 * Berechnet die tägliche Bettauslastung für einen Zeitraum.
 * Nur Buchungen mit Status 'bestaetigt' oder 'abgeschlossen' zählen.
 * checkIn <= tag < checkOut  →  Bett belegt
 */
export function calcDailyOccupancy(
  startDate: Date,
  endDate: Date,
  properties: Property[],
  bookings: Booking[],
): DayOccupancy[] {
  const activeProps = properties.filter(p => p.active)
  const totalBeds = activeProps.reduce((s, p) => s + p.beds, 0)
  if (totalBeds === 0) return []

  // Nur relevante Buchungen (Status + Property in Scope + Zeitraum-Überlappung)
  const propIds = new Set(activeProps.map(p => p.id))
  const relevant = bookings.filter(b => {
    if (b.status !== 'bestaetigt' && b.status !== 'abgeschlossen') return false
    if (!propIds.has(b.propertyId)) return false
    const ci = parseISO(b.checkIn)
    const co = parseISO(b.checkOut)
    return ci < endDate && co > startDate
  })

  const days = eachDayOfInterval({ start: startDate, end: endDate })

  // Lookup: propertyId → beds (für Per-Objekt-Kapping)
  const propBeds = new Map(activeProps.map(p => [p.id, p.beds]))

  return days.map(day => {
    // Pro Objekt separat summieren und auf Objektkapazität kappen,
    // dann erst über alle Objekte summieren.
    // So kann ein einzelnes übergebuchtes Objekt die Standort-Rate nicht auf 100% treiben.
    const bookedPerProp = new Map<string, number>()
    for (const b of relevant) {
      const ci = parseISO(b.checkIn)
      const co = parseISO(b.checkOut)
      if (ci <= day && co > day) {
        const prev = bookedPerProp.get(b.propertyId) ?? 0
        bookedPerProp.set(b.propertyId, prev + (b.bedsBooked || 0))
      }
    }
    let bookedBeds = 0
    for (const [propId, booked] of bookedPerProp) {
      const cap = propBeds.get(propId) ?? 0
      bookedBeds += Math.min(booked, cap)
    }
    return {
      date: format(day, 'yyyy-MM-dd'),
      totalBeds,
      bookedBeds,
      rate: Math.round((bookedBeds / totalBeds) * 1000) / 10,
    }
  })
}

// ── Aggregation: Wochen ────────────────────────────────────────────────────────

export function aggregateToWeeks(dailyData: DayOccupancy[]): PeriodOccupancy[] {
  const map = new Map<string, DayOccupancy[]>()

  for (const day of dailyData) {
    const d = parseISO(day.date)
    const wy = getISOWeekYear(d)
    const wn = getISOWeek(d)
    const key = `${wy}-W${String(wn).padStart(2, '0')}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(day)
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, days]) => {
      const avgRate = days.reduce((s, d) => s + d.rate, 0) / days.length
      const avgBooked = days.reduce((s, d) => s + d.bookedBeds, 0) / days.length
      return {
        label: `KW ${key.split('-W')[1]}`,
        key,
        startDate: days[0].date,
        endDate: days[days.length - 1].date,
        avgRate: Math.round(avgRate * 10) / 10,
        totalBeds: days[0].totalBeds,
        avgBookedBeds: Math.round(avgBooked * 10) / 10,
        days: days.length,
      }
    })
}

// ── Aggregation: Monate ────────────────────────────────────────────────────────

export function aggregateToMonths(dailyData: DayOccupancy[]): PeriodOccupancy[] {
  const map = new Map<string, DayOccupancy[]>()

  for (const day of dailyData) {
    const key = day.date.slice(0, 7) // 'YYYY-MM'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(day)
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, days]) => {
      const avgRate = days.reduce((s, d) => s + d.rate, 0) / days.length
      const avgBooked = days.reduce((s, d) => s + d.bookedBeds, 0) / days.length
      const d = parseISO(key + '-01')
      return {
        label: format(d, 'MMM yy', { locale: de }),
        key,
        startDate: days[0].date,
        endDate: days[days.length - 1].date,
        avgRate: Math.round(avgRate * 10) / 10,
        totalBeds: days[0].totalBeds,
        avgBookedBeds: Math.round(avgBooked * 10) / 10,
        days: days.length,
      }
    })
}

// ── Auslastung pro Entity (Standort oder Objekt) ──────────────────────────────

export function calcOccupancyByEntity(
  startDate: Date,
  endDate: Date,
  entities: { id: string; properties: Property[] }[],
  bookings: Booking[],
): OccupancyByEntity[] {
  return entities.map(entity => {
    const daily = calcDailyOccupancy(startDate, endDate, entity.properties, bookings)
    if (daily.length === 0) {
      const totalBeds = entity.properties.filter(p => p.active).reduce((s, p) => s + p.beds, 0)
      return { entityId: entity.id, avgRate: 0, totalBeds, avgBookedBeds: 0, bookedBedNights: 0, availableBedNights: 0 }
    }
    const days = daily.length
    const avgRate = daily.reduce((s, d) => s + d.rate, 0) / days
    const bookedBedNights = daily.reduce((s, d) => s + d.bookedBeds, 0)
    const avgBooked = bookedBedNights / days
    return {
      entityId: entity.id,
      avgRate: Math.round(avgRate * 10) / 10,
      totalBeds: daily[0].totalBeds,
      avgBookedBeds: Math.round(avgBooked * 10) / 10,
      bookedBedNights: Math.round(bookedBedNights),
      availableBedNights: daily[0].totalBeds * days,
    }
  })
}

// ── Farbkodierung ──────────────────────────────────────────────────────────────

/** Formatiert eine Rate immer mit 1 Nachkommastelle: 69.9%, 0.0%, 100.0% */
export function fmtRate(rate: number): string {
  return rate.toFixed(1)
}

export function occupancyColor(rate: number): { bar: string; text: string; bg: string } {
  if (rate >= 70) return { bar: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-100' }
  if (rate >= 40) return { bar: 'bg-amber-400',   text: 'text-amber-700',   bg: 'bg-amber-100' }
  return { bar: 'bg-red-400', text: 'text-red-700', bg: 'bg-red-100' }
}
