import 'server-only'

import { differenceInDays } from 'date-fns'

import {
  allocateBeds,
  calcAvailableBedsPerProperty,
  type AllocationStrategy,
} from '@/lib/availability'
import { supabaseServer } from '@/lib/supabase-server'
import type { Booking, Location, Property } from '@/lib/types'

export type AvailabilityLookupInput = {
  locationId?: string
  locationName?: string
  city?: string
  checkIn: string
  checkOut: string
  bedsNeeded: number
  strategy?: AllocationStrategy
}

export type AvailabilityLookupResult = {
  location: Location
  propertiesChecked: number
  totalFreeBeds: number
  matchingProperties: Array<{
    propertyId: string
    propertyName: string
    shortCode: string
    totalBeds: number
    freeBeds: number
    pricePerBedNight: number
    cleaningFee: number
  }>
  allocation: ReturnType<typeof allocateBeds>
}

type DbRow = Record<string, unknown>

function mapLocation(row: DbRow): Location {
  return {
    id: row.id as string,
    name: row.name as string,
    city: row.city as string,
    country: row.country as string,
    color: row.color as string,
  }
}

function mapProperty(row: DbRow): Property {
  return {
    id: row.id as string,
    name: row.name as string,
    shortCode: (row.short_code as string) ?? '',
    aliases: (row.aliases as string[]) ?? [],
    type: row.type as Property['type'],
    locationId: row.location_id as string,
    beds: row.beds as number,
    pricePerBedNight: row.price_per_bed_night as number,
    cleaningFee: row.cleaning_fee as number,
    description: (row.description as string) ?? '',
    amenities: (row.amenities as string[]) ?? [],
    images: (row.images as string[]) ?? [],
    active: row.active as boolean,
  }
}

function mapBooking(row: DbRow): Booking {
  return {
    id: row.id as string,
    bookingNumber: row.booking_number as string,
    propertyId: row.property_id as string,
    customerId: (row.customer_id as string) ?? '',
    checkIn: row.check_in as string,
    checkOut: row.check_out as string,
    nights: row.nights as number,
    bedsBooked: row.beds_booked as number,
    pricePerBedNight: row.price_per_bed_night as number,
    cleaningFee: row.cleaning_fee as number,
    totalPrice: row.total_price as number,
    status: row.status as Booking['status'],
    paymentStatus: row.payment_status as Booking['paymentStatus'],
    notes: (row.notes as string) ?? '',
    lexofficeInvoiceId: (row.lexoffice_invoice_id as string) ?? '',
    lexofficeQuotationId: (row.lexoffice_quotation_id as string) ?? '',
    invoiceNumber: (row.invoice_number as string) ?? '',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    source: (row.source as Booking['source']) ?? 'manual',
  }
}

function normalize(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('de-DE')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function assertValidInput(input: AvailabilityLookupInput) {
  if (!isIsoDate(input.checkIn) || !isIsoDate(input.checkOut)) {
    throw new Error('checkIn und checkOut muessen als ISO-Datum im Format YYYY-MM-DD gesendet werden.')
  }
  if (!Number.isFinite(input.bedsNeeded) || input.bedsNeeded < 1) {
    throw new Error('bedsNeeded muss mindestens 1 sein.')
  }
  const nights = differenceInDays(new Date(input.checkOut), new Date(input.checkIn))
  if (nights <= 0) {
    throw new Error('checkOut muss nach checkIn liegen.')
  }
  if (!input.locationId && !input.locationName && !input.city) {
    throw new Error('Es muss mindestens locationId, locationName oder city angegeben werden.')
  }
}

export async function loadLocations(): Promise<Location[]> {
  const { data, error } = await supabaseServer.from('locations').select('*').order('name')
  if (error) throw new Error(`Standorte konnten nicht geladen werden: ${error.message}`)
  return (data ?? []).map(mapLocation)
}

async function loadProperties(locationId: string): Promise<Property[]> {
  const { data, error } = await supabaseServer
    .from('properties')
    .select('*')
    .eq('location_id', locationId)
    .eq('active', true)
    .order('name')

  if (error) throw new Error(`Objekte konnten nicht geladen werden: ${error.message}`)
  return (data ?? []).map(mapProperty)
}

async function loadBookings(): Promise<Booking[]> {
  const { data, error } = await supabaseServer.from('bookings').select('*')
  if (error) throw new Error(`Buchungen konnten nicht geladen werden: ${error.message}`)
  return (data ?? []).map(mapBooking)
}

function findLocation(locations: Location[], input: AvailabilityLookupInput): Location {
  if (input.locationId) {
    const byId = locations.find(location => location.id === input.locationId)
    if (byId) return byId
  }

  const candidates = [input.locationName, input.city].filter(Boolean).map(value => normalize(value as string))
  const byName = locations.find(location => {
    const name = normalize(location.name)
    const city = normalize(location.city)
    return candidates.some(candidate => candidate === name || candidate === city)
  })

  if (byName) return byName

  throw new Error('Kein passender Standort gefunden.')
}

export async function checkAvailability(input: AvailabilityLookupInput): Promise<AvailabilityLookupResult> {
  assertValidInput(input)

  const locations = await loadLocations()
  const location = findLocation(locations, input)
  const [properties, bookings] = await Promise.all([
    loadProperties(location.id),
    loadBookings(),
  ])

  const nights = differenceInDays(new Date(input.checkOut), new Date(input.checkIn))
  const availabilities = calcAvailableBedsPerProperty(
    new Date(input.checkIn),
    new Date(input.checkOut),
    properties,
    bookings,
  )
  const allocation = allocateBeds(
    input.bedsNeeded,
    availabilities,
    nights,
    input.strategy ?? 'fewest-properties',
  )

  return {
    location,
    propertiesChecked: properties.length,
    totalFreeBeds: availabilities.reduce((sum, entry) => sum + entry.minFreeBeds, 0),
    matchingProperties: availabilities
      .filter(entry => entry.minFreeBeds > 0)
      .map(entry => ({
        propertyId: entry.propertyId,
        propertyName: entry.propertyName,
        shortCode: entry.shortCode,
        totalBeds: entry.totalBeds,
        freeBeds: entry.minFreeBeds,
        pricePerBedNight: entry.pricePerBedNight,
        cleaningFee: entry.cleaningFee,
      })),
    allocation,
  }
}
