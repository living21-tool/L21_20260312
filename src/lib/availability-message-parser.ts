import 'server-only'

import { addDays, format } from 'date-fns'

import type { AvailabilityLookupInput } from '@/lib/availability-service'
import type { Location } from '@/lib/types'

type ParsedAvailabilityMessage = AvailabilityLookupInput & {
  originalText: string
  normalizedText: string
}

const weekdayMap: Record<string, number> = {
  sonntag: 0,
  montag: 1,
  dienstag: 2,
  mittwoch: 3,
  donnerstag: 4,
  freitag: 5,
  samstag: 6,
}

function normalize(text: string) {
  return text
    .toLocaleLowerCase('de-DE')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[!?.,;:()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toIsoDate(date: Date) {
  return format(date, 'yyyy-MM-dd')
}

function parseBeds(text: string) {
  const directMatch = text.match(/(\d+)\s*(bett|betten)\b/)
  if (directMatch) return Number(directMatch[1])

  const fallbackMatch = text.match(/\bfur\s+(\d+)\b|\bfuer\s+(\d+)\b/)
  if (fallbackMatch) return Number(fallbackMatch[1] ?? fallbackMatch[2])

  throw new Error('Ich konnte keine Bettenanzahl erkennen.')
}

function nextWeekdayAfter(baseDate: Date, targetWeekday: number) {
  const current = baseDate.getDay()
  let offset = (targetWeekday - current + 7) % 7
  if (offset === 0) offset = 7
  return addDays(baseDate, offset)
}

function parseDateToken(token: string, referenceDate: Date, startDate?: Date) {
  if (token === 'heute') return referenceDate
  if (token === 'morgen') return addDays(referenceDate, 1)
  if (token === 'ubermorgen') return addDays(referenceDate, 2)

  const weekday = weekdayMap[token]
  if (weekday !== undefined) {
    return nextWeekdayAfter(startDate ?? referenceDate, weekday)
  }

  const isoMatch = token.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) return new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T00:00:00`)

  const deMatch = token.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/)
  if (deMatch) {
    const day = Number(deMatch[1])
    const month = Number(deMatch[2]) - 1
    const yearPart = deMatch[3]
    const baseYear = startDate?.getFullYear() ?? referenceDate.getFullYear()
    const year = yearPart
      ? Number(yearPart.length === 2 ? `20${yearPart}` : yearPart)
      : baseYear
    const parsed = new Date(year, month, day)

    if (!yearPart && parsed < new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate())) {
      return new Date(year + 1, month, day)
    }

    return parsed
  }

  return null
}

function parseDateRange(text: string, referenceDate: Date) {
  const rangeMatch = text.match(/\b(?:von|ab)\s+([a-z0-9.\-]+)\s+(?:bis|-\s*)\s+([a-z0-9.\-]+)\b/)
  if (!rangeMatch) {
    throw new Error('Ich konnte keinen Zeitraum erkennen.')
  }

  const startDate = parseDateToken(rangeMatch[1], referenceDate)
  if (!startDate) {
    throw new Error(`Startdatum "${rangeMatch[1]}" konnte nicht gelesen werden.`)
  }

  const endDate = parseDateToken(rangeMatch[2], referenceDate, startDate)
  if (!endDate) {
    throw new Error(`Enddatum "${rangeMatch[2]}" konnte nicht gelesen werden.`)
  }

  if (endDate <= startDate) {
    throw new Error('Der erkannte Zeitraum ist ungueltig. checkOut muss nach checkIn liegen.')
  }

  return {
    checkIn: toIsoDate(startDate),
    checkOut: toIsoDate(endDate),
  }
}

function parseLocation(text: string, locations: Location[]) {
  const sortedLocations = [...locations].sort((a, b) => {
    const aLen = Math.max(a.name.length, a.city.length)
    const bLen = Math.max(b.name.length, b.city.length)
    return bLen - aLen
  })

  const byKnownLocation = sortedLocations.find(location => {
    const city = normalize(location.city)
    const name = normalize(location.name)
    return text.includes(` in ${city} `) ||
      text.endsWith(` in ${city}`) ||
      text.includes(` in ${name} `) ||
      text.endsWith(` in ${name}`) ||
      text.includes(` ${city} `) ||
      text.endsWith(` ${city}`) ||
      text.includes(` ${name} `) ||
      text.endsWith(` ${name}`)
  })

  if (byKnownLocation) {
    return {
      locationId: byKnownLocation.id,
      locationName: byKnownLocation.name,
      city: byKnownLocation.city,
    }
  }

  const genericMatch = text.match(/\b(?:in|im)\s+([a-z0-9äöüß\-\s]+)$/i)
  if (genericMatch) {
    return {
      city: genericMatch[1].trim(),
    }
  }

  throw new Error('Ich konnte keinen Standort erkennen.')
}

export function parseAvailabilityMessage(
  text: string,
  locations: Location[],
  referenceDate = new Date(),
): ParsedAvailabilityMessage {
  const normalizedText = ` ${normalize(text)} `
  const bedsNeeded = parseBeds(normalizedText)
  const { checkIn, checkOut } = parseDateRange(normalizedText, referenceDate)
  const location = parseLocation(normalizedText, locations)

  return {
    ...location,
    checkIn,
    checkOut,
    bedsNeeded,
    strategy: 'fewest-properties',
    originalText: text,
    normalizedText: normalizedText.trim(),
  }
}
