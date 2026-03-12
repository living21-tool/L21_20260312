import { format } from 'date-fns'

import type { checkAvailability } from '@/lib/availability-service'

type AvailabilityResult = Awaited<ReturnType<typeof checkAvailability>>

function formatDate(date: string) {
  return format(new Date(date), 'dd.MM.yyyy')
}

export function createAvailabilitySummary(result: AvailabilityResult) {
  const lines = result.allocation.allocations.map(entry => {
    const label = entry.shortCode || entry.propertyName
    return `${label} (${entry.bedsAllocated})`
  })

  if (result.allocation.success) {
    return `Ja, in ${result.location.name} sind ${result.allocation.totalBedsRequested} Betten frei: ${lines.join(', ')}`
  }

  return `Nein, in ${result.location.name} sind im Zeitraum nur ${result.allocation.totalBedsAllocated} von ${result.allocation.totalBedsRequested} Betten frei.`
}

export function createTelegramAvailabilityMessage(
  result: AvailabilityResult,
  request: { checkIn: string; checkOut: string; bedsNeeded: number },
) {
  const allocationLines = result.allocation.allocations.map(entry => {
    const label = entry.shortCode || entry.propertyName
    return `- ${label}: ${entry.bedsAllocated} Bett${entry.bedsAllocated === 1 ? '' : 'en'}`
  })

  if (!result.allocation.success) {
    return [
      `Nicht voll verfuegbar.`,
      ``,
      `<b><u>Wo?</u></b>`,
      `${result.location.name}`,
      ``,
      `<b><u>Wann?</u></b>`,
      `${formatDate(request.checkIn)} - ${formatDate(request.checkOut)}`,
      ``,
      `<b><u>Was?</u></b>`,
      `${request.bedsNeeded} Betten`,
      ``,
      `<b><u>Status</u></b>`,
      `Frei sind nur ${result.allocation.totalBedsAllocated} von ${result.allocation.totalBedsRequested} Betten.`,
    ].join('\n')
  }

  return [
    `Ja, verfuegbar!`,
    ``,
    `<b><u>Wo?</u></b>`,
    `${result.location.name}`,
    ``,
    `<b><u>Wann?</u></b>`,
    `${formatDate(request.checkIn)} - ${formatDate(request.checkOut)}`,
    ``,
    `<b><u>Was?</u></b>`,
    `${request.bedsNeeded} Betten`,
    ``,
    `<b><u>Einheiten:</u></b>`,
    ...allocationLines,
  ].join('\n')
}
