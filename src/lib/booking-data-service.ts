import 'server-only'

import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeLocationName } from '@/lib/utils'
import type { Booking, Customer, Location, Property } from '@/lib/types'
import type { BookingInsertInput } from '@/lib/booking-workflow'

type DbRow = Record<string, unknown>

function mapLocation(row: DbRow): Location {
  return {
    id: row.id as string,
    name: normalizeLocationName(row.name as string),
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

function mapCustomer(row: DbRow): Customer {
  return {
    id: row.id as string,
    companyName: (row.company_name as string) ?? '',
    firstName: (row.first_name as string) ?? '',
    lastName: (row.last_name as string) ?? '',
    email: (row.email as string) ?? '',
    phone: (row.phone as string) ?? '',
    address: (row.address as string) ?? '',
    zip: (row.zip as string) ?? '',
    city: (row.city as string) ?? '',
    country: (row.country as string) ?? 'Deutschland',
    taxId: (row.tax_id as string) ?? '',
    lexofficeContactId: (row.lexoffice_contact_id as string) ?? '',
    notes: (row.notes as string) ?? '',
    createdAt: row.created_at as string,
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

function normalizeSearch(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('de-DE')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export async function loadLocationsServer(): Promise<Location[]> {
  const { data, error } = await supabaseAdmin.from('locations').select('*').order('name')
  if (error) throw new Error(`Standorte konnten nicht geladen werden: ${error.message}`)
  return (data ?? []).map(mapLocation)
}

export async function loadPropertiesServer(locationId?: string): Promise<Property[]> {
  let query = supabaseAdmin.from('properties').select('*').eq('active', true).order('name')
  if (locationId) query = query.eq('location_id', locationId)
  const { data, error } = await query
  if (error) throw new Error(`Objekte konnten nicht geladen werden: ${error.message}`)
  return (data ?? []).map(mapProperty)
}

export async function loadBookingsServer(): Promise<Booking[]> {
  const { data, error } = await supabaseAdmin.from('bookings').select('*')
  if (error) throw new Error(`Buchungen konnten nicht geladen werden: ${error.message}`)
  return (data ?? []).map(mapBooking)
}

export async function loadCustomersServer(): Promise<Customer[]> {
  const { data, error } = await supabaseAdmin.from('customers').select('*').order('company_name')
  if (error) throw new Error(`Auftraggeber konnten nicht geladen werden: ${error.message}`)
  return (data ?? []).map(mapCustomer)
}

export async function findCustomersByQuery(query: string, limit = 5): Promise<Customer[]> {
  const normalizedQuery = normalizeSearch(query)
  if (!normalizedQuery) return []
  const customers = await loadCustomersServer()
  return customers
    .map(customer => {
      const haystack = normalizeSearch([
        customer.companyName,
        customer.firstName,
        customer.lastName,
        customer.city,
        customer.email,
      ].filter(Boolean).join(' '))

      const exactCompany = normalizeSearch(customer.companyName) === normalizedQuery
      const startsCompany = normalizeSearch(customer.companyName).startsWith(normalizedQuery)
      const exactContact = normalizeSearch(`${customer.firstName} ${customer.lastName}`.trim()) === normalizedQuery
      const startsContact = normalizeSearch(`${customer.firstName} ${customer.lastName}`.trim()).startsWith(normalizedQuery)
      const includes = haystack.includes(normalizedQuery)
      const score = exactCompany ? 100 : startsCompany ? 80 : exactContact ? 70 : startsContact ? 60 : includes ? 40 : 0
      return { customer, score }
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.customer.companyName.localeCompare(b.customer.companyName, 'de'))
    .slice(0, limit)
    .map(entry => entry.customer)
}

export async function getCustomerById(customerId: string): Promise<Customer | null> {
  const { data, error } = await supabaseAdmin.from('customers').select('*').eq('id', customerId).maybeSingle()
  if (error) throw new Error(`Auftraggeber konnte nicht geladen werden: ${error.message}`)
  return data ? mapCustomer(data) : null
}

export async function updateCustomerServer(customerId: string, data: Partial<Customer>): Promise<Customer> {
  const row: Record<string, unknown> = {}
  if (data.companyName !== undefined) row.company_name = data.companyName
  if (data.firstName !== undefined) row.first_name = data.firstName
  if (data.lastName !== undefined) row.last_name = data.lastName
  if (data.email !== undefined) row.email = data.email
  if (data.phone !== undefined) row.phone = data.phone
  if (data.address !== undefined) row.address = data.address
  if (data.zip !== undefined) row.zip = data.zip
  if (data.city !== undefined) row.city = data.city
  if (data.country !== undefined) row.country = data.country
  if (data.taxId !== undefined) row.tax_id = data.taxId
  if (data.lexofficeContactId !== undefined) row.lexoffice_contact_id = data.lexofficeContactId
  if (data.notes !== undefined) row.notes = data.notes

  const { data: updated, error } = await supabaseAdmin
    .from('customers')
    .update(row)
    .eq('id', customerId)
    .select('*')
    .single()

  if (error) throw new Error(`Auftraggeber konnte nicht aktualisiert werden: ${error.message}`)
  return mapCustomer(updated)
}

export async function addCustomerServer(input: Omit<Customer, 'id' | 'createdAt'>): Promise<Customer> {
  const id = `cust-${Date.now()}`
  const now = new Date().toISOString().slice(0, 10)

  const row = {
    id,
    company_name: input.companyName,
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    phone: input.phone,
    address: input.address,
    zip: input.zip,
    city: input.city,
    country: input.country,
    tax_id: input.taxId ?? '',
    lexoffice_contact_id: input.lexofficeContactId ?? '',
    notes: input.notes,
    created_at: now,
  }

  const { data, error } = await supabaseAdmin.from('customers').insert(row).select('*').single()
  if (error) throw new Error(`Auftraggeber konnte nicht erstellt werden: ${error.message}`)
  return mapCustomer(data)
}

export async function addBookingServer(input: BookingInsertInput): Promise<Booking> {
  const now = new Date().toISOString().slice(0, 10)
  const year = new Date().getFullYear()
  const seq = String(Date.now()).slice(-5)
  const id = `book-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const row = {
    id,
    booking_number: `MV-${year}-${seq}`,
    property_id: input.propertyId || null,
    customer_id: input.customerId || null,
    check_in: input.checkIn,
    check_out: input.checkOut,
    nights: input.nights,
    beds_booked: input.bedsBooked,
    price_per_bed_night: input.pricePerBedNight,
    cleaning_fee: input.cleaningFee,
    total_price: input.totalPrice,
    status: input.status,
    payment_status: input.paymentStatus,
    notes: input.notes ?? '',
    lexoffice_invoice_id: input.lexofficeInvoiceId ?? '',
    lexoffice_quotation_id: input.lexofficeQuotationId ?? '',
    invoice_number: input.invoiceNumber ?? '',
    created_at: now,
    updated_at: now,
    source: input.source ?? 'manual',
  }

  const { data, error } = await supabaseAdmin.from('bookings').insert(row).select().single()
  if (error) throw new Error(`Buchung konnte nicht erstellt werden: ${error.message}`)
  return mapBooking(data)
}
