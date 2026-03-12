import { parseISO, eachDayOfInterval, addDays } from 'date-fns'
import type { Booking, Property } from './types'

// ── Typen ──────────────────────────────────────────────────────────────────────

export interface PropertyAvailability {
  propertyId: string
  propertyName: string
  shortCode: string
  totalBeds: number
  minFreeBeds: number       // Minimum freier Betten über ALLE Tage im Zeitraum
  pricePerBedNight: number
  cleaningFee: number
}

export interface AllocationEntry {
  propertyId: string
  propertyName: string
  shortCode: string
  bedsAllocated: number
  totalBeds: number
  minFreeBeds: number
  pricePerBedNight: number
  cleaningFee: number
  nights: number
  subtotal: number          // bedsAllocated × nights × pricePerBedNight + cleaningFee
}

export interface AllocationResult {
  success: boolean
  totalBedsRequested: number
  totalBedsAllocated: number
  shortfall: number
  allocations: AllocationEntry[]
  totalPrice: number
  nights: number
}

// ── Verfügbarkeit pro Property ─────────────────────────────────────────────────

/**
 * Berechnet für jedes aktive Property die minimalen freien Betten im Zeitraum.
 * Konsistent mit occupancy.ts: Nur 'bestaetigt'+'abgeschlossen' zählen,
 * checkOut-Tag ist NICHT belegt (ci <= day && co > day).
 */
export function calcAvailableBedsPerProperty(
  startDate: Date,
  endDate: Date,
  properties: Property[],
  bookings: Booking[],
): PropertyAvailability[] {
  const activeProps = properties.filter(p => p.active)
  if (activeProps.length === 0) return []

  // Tage im Zeitraum: checkIn bis checkOut-1 (letzter Übernachtungstag)
  const lastNight = addDays(endDate, -1)
  if (lastNight < startDate) return []
  const days = eachDayOfInterval({ start: startDate, end: lastNight })

  const propIds = new Set(activeProps.map(p => p.id))
  const relevant = bookings.filter(b => {
    if (b.status !== 'bestaetigt' && b.status !== 'abgeschlossen') return false
    if (!propIds.has(b.propertyId)) return false
    const ci = parseISO(b.checkIn)
    const co = parseISO(b.checkOut)
    return ci < endDate && co > startDate
  })

  return activeProps.map(prop => {
    // Pro Tag: Summe der gebuchten Betten für dieses Property
    let minFree = prop.beds
    for (const day of days) {
      let bookedOnDay = 0
      for (const b of relevant) {
        if (b.propertyId !== prop.id) continue
        const ci = parseISO(b.checkIn)
        const co = parseISO(b.checkOut)
        if (ci <= day && co > day) {
          bookedOnDay += b.bedsBooked || 0
        }
      }
      // Cap bei Kapazität (wie in occupancy.ts)
      bookedOnDay = Math.min(bookedOnDay, prop.beds)
      const free = prop.beds - bookedOnDay
      if (free < minFree) minFree = free
    }

    return {
      propertyId: prop.id,
      propertyName: prop.name,
      shortCode: prop.shortCode,
      totalBeds: prop.beds,
      minFreeBeds: Math.max(0, minFree),
      pricePerBedNight: prop.pricePerBedNight,
      cleaningFee: prop.cleaningFee,
    }
  }).sort((a, b) => b.minFreeBeds - a.minFreeBeds)
}

// ── Betten-Allokation ──────────────────────────────────────────────────────────

export type AllocationStrategy = 'fewest-properties' | 'cheapest-first'

type ChosenProperty = PropertyAvailability & { originalIndex: number }

function chooseFewestProperties(availabilities: PropertyAvailability[], bedsNeeded: number): ChosenProperty[] {
  const candidates = availabilities
    .filter(entry => entry.minFreeBeds > 0)
    .map((entry, index) => ({ ...entry, originalIndex: index }))

  if (candidates.length === 0 || bedsNeeded <= 0) return []

  const dp: Map<number, { prevSum: number; prevCandidate: number }>[] = Array.from(
    { length: candidates.length + 1 },
    () => new Map<number, { prevSum: number; prevCandidate: number }>(),
  )
  dp[0].set(0, { prevSum: -1, prevCandidate: -1 })

  candidates.forEach((candidate, candidateIndex) => {
    for (let used = candidateIndex; used >= 0; used -= 1) {
      const current = dp[used]
      const next = dp[used + 1]

      current.forEach((_path, sum) => {
        const nextSum = sum + candidate.minFreeBeds
        if (!next.has(nextSum)) {
          next.set(nextSum, { prevSum: sum, prevCandidate: candidateIndex })
        }
      })
    }
  })

  let bestCount = -1
  let bestSum = Number.POSITIVE_INFINITY

  for (let used = 1; used < dp.length; used += 1) {
    const sums = [...dp[used].keys()].filter(sum => sum >= bedsNeeded)
    if (sums.length === 0) continue

    const smallestSum = Math.min(...sums)
    bestCount = used
    bestSum = smallestSum
    break
  }

  if (bestCount === -1) {
    return [...candidates].sort((a, b) => b.minFreeBeds - a.minFreeBeds)
  }

  const chosen: ChosenProperty[] = []
  let remainingSum = bestSum
  let used = bestCount

  while (used > 0) {
    const step = dp[used].get(remainingSum)
    if (!step || step.prevCandidate < 0) break
    chosen.push(candidates[step.prevCandidate])
    remainingSum = step.prevSum
    used -= 1
  }

  return chosen.sort((a, b) => {
    if (a.minFreeBeds !== b.minFreeBeds) return a.minFreeBeds - b.minFreeBeds
    return a.originalIndex - b.originalIndex
  })
}

/**
 * Verteilt den Bettenbedarf auf verfügbare Properties.
 * - "fewest-properties": Größte Verfügbarkeit zuerst → weniger Buchungen
 * - "cheapest-first": Günstigster Preis zuerst → niedrigere Kosten
 */
export function allocateBeds(
  bedsNeeded: number,
  availabilities: PropertyAvailability[],
  nights: number,
  strategy: AllocationStrategy = 'fewest-properties',
): AllocationResult {
  const sorted =
    strategy === 'fewest-properties'
      ? chooseFewestProperties(availabilities, bedsNeeded)
      : [...availabilities]
          .filter(a => a.minFreeBeds > 0)
          .sort((a, b) => {
            if (a.pricePerBedNight !== b.pricePerBedNight) return a.pricePerBedNight - b.pricePerBedNight
            return a.minFreeBeds - b.minFreeBeds
          })

  const allocations: AllocationEntry[] = []
  let remaining = bedsNeeded

  for (const avail of sorted) {
    if (remaining <= 0) break
    const beds = Math.min(remaining, avail.minFreeBeds)
    const subtotal = beds * nights * avail.pricePerBedNight + avail.cleaningFee
    allocations.push({
      propertyId: avail.propertyId,
      propertyName: avail.propertyName,
      shortCode: avail.shortCode,
      bedsAllocated: beds,
      totalBeds: avail.totalBeds,
      minFreeBeds: avail.minFreeBeds,
      pricePerBedNight: avail.pricePerBedNight,
      cleaningFee: avail.cleaningFee,
      nights,
      subtotal,
    })
    remaining -= beds
  }

  const totalAllocated = bedsNeeded - Math.max(0, remaining)
  const totalPrice = allocations.reduce((s, a) => s + a.subtotal, 0)

  return {
    success: remaining <= 0,
    totalBedsRequested: bedsNeeded,
    totalBedsAllocated: totalAllocated,
    shortfall: Math.max(0, remaining),
    allocations,
    totalPrice,
    nights,
  }
}
