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

export type BookingListSort = 'invoiceDesc' | 'createdDesc'
export type BookingListViewMode = 'invoices' | 'bookings'

export interface BookingInvoiceGroup {
  invoiceNumber: string
  voucherId?: string
  contactName: string
  totalAmount: number
  bookingCount: number
  bookings: Booking[]
  checkInMin: string
  checkOutMax: string
  nightsTotal: number
  bedsMax: number
  source: string
  paymentStatus: string
  status: string
  isStorniert: boolean
}

export interface BookingListPageResult {
  viewMode: BookingListViewMode
  totalBookings: number
  totalInvoices: number
  totalRevenue: number
  page: number
  pageSize: number
  totalPages: number
  bookings: Booking[]
  invoiceGroups: BookingInvoiceGroup[]
}

interface BookingListParams {
  search?: string
  statusFilter?: string
  locationFilter?: string
  sortBy?: BookingListSort
  viewMode?: BookingListViewMode
  page?: number
  pageSize?: number
}

function sortBookings(bookings: Booking[], sortBy: BookingListSort) {
  return [...bookings].sort((a, b) => {
    if (sortBy === 'invoiceDesc') {
      if (a.invoiceNumber && b.invoiceNumber) {
        return b.invoiceNumber.localeCompare(a.invoiceNumber, undefined, { numeric: true, sensitivity: 'base' })
      }
      if (a.invoiceNumber) return -1
      if (b.invoiceNumber) return 1
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
}

function buildInvoiceGroups(bookings: Booking[], customersById: Map<string, Customer>) {
  const groups = new Map<string, Booking[]>()
  for (const booking of bookings) {
    const key = booking.invoiceNumber || `_single_${booking.id}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(booking)
  }

  const result: BookingInvoiceGroup[] = []
  for (const [invoiceNumber, groupedBookings] of groups) {
    const isSingle = invoiceNumber.startsWith('_single_')
    const firstBooking = groupedBookings[0]
    const customer = customersById.get(firstBooking.customerId)
    const totalAmount = groupedBookings.reduce((sum, booking) => sum + booking.totalPrice, 0)
    const checkInMin = groupedBookings.reduce((min, booking) => booking.checkIn < min ? booking.checkIn : min, groupedBookings[0].checkIn)
    const checkOutMax = groupedBookings.reduce((max, booking) => booking.checkOut > max ? booking.checkOut : max, groupedBookings[0].checkOut)
    const nightsTotal = groupedBookings.reduce((sum, booking) => sum + booking.nights, 0)
    const bedsMax = Math.max(...groupedBookings.map(booking => booking.bedsBooked))
    const isStorniert = groupedBookings.every(booking => booking.status === 'storniert')
    const statusPriority = ['bestaetigt', 'abgeschlossen', 'option', 'anfrage', 'storniert']
    const dominantStatus = statusPriority.find(status => groupedBookings.some(booking => booking.status === status)) ?? groupedBookings[0].status
    const paymentPriority = ['offen', 'teilweise', 'bezahlt', 'erstattet']
    const dominantPayment = paymentPriority.find(status => groupedBookings.some(booking => booking.paymentStatus === status)) ?? groupedBookings[0].paymentStatus

    result.push({
      invoiceNumber: isSingle ? '' : invoiceNumber,
      voucherId: firstBooking.lexofficeInvoiceId,
      contactName: customer?.companyName ?? '–',
      totalAmount,
      bookingCount: groupedBookings.length,
      bookings: groupedBookings,
      checkInMin,
      checkOutMax,
      nightsTotal,
      bedsMax,
      source: firstBooking.source ?? 'manual',
      paymentStatus: dominantPayment,
      status: dominantStatus,
      isStorniert,
    })
  }

  return result
}

export async function loadBookingListPage(params: BookingListParams = {}): Promise<BookingListPageResult> {
  const search = params.search ?? ''
  const statusFilter = params.statusFilter ?? 'all'
  const locationFilter = params.locationFilter ?? 'all'
  const sortBy = params.sortBy ?? 'invoiceDesc'
  const viewMode = params.viewMode ?? 'invoices'
  const pageSize = Math.max(1, params.pageSize ?? 50)
  const page = Math.max(1, params.page ?? 1)

  const [bookings, properties, customers] = await Promise.all([
    loadBookingsServer(),
    loadPropertiesServer(),
    loadCustomersServer(),
  ])

  const propertiesById = new Map(properties.map(property => [property.id, property]))
  const customersById = new Map(customers.map(customer => [customer.id, customer]))
  const normalizedSearch = search.toLowerCase()

  const filtered = sortBookings(bookings.filter(booking => {
    const property = propertiesById.get(booking.propertyId)
    const customer = customersById.get(booking.customerId)
    const matchSearch = !search ||
      booking.bookingNumber.toLowerCase().includes(normalizedSearch) ||
      (property?.name ?? '').toLowerCase().includes(normalizedSearch) ||
      (property?.shortCode ?? '').toLowerCase().includes(normalizedSearch) ||
      (customer?.companyName ?? '').toLowerCase().includes(normalizedSearch) ||
      `${customer?.firstName} ${customer?.lastName}`.toLowerCase().includes(normalizedSearch) ||
      (booking.invoiceNumber ?? '').toLowerCase().includes(normalizedSearch)
    const matchStatus = statusFilter === 'all' || booking.status === statusFilter
    const matchLocation = locationFilter === 'all' || property?.locationId === locationFilter
    return matchSearch && matchStatus && matchLocation
  }), sortBy)

  const invoiceGroups = buildInvoiceGroups(filtered, customersById)
  const totalRevenue = filtered
    .filter(booking => booking.status !== 'storniert')
    .reduce((sum, booking) => sum + booking.totalPrice, 0)

  if (viewMode === 'bookings') {
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const safePage = Math.min(page, totalPages)
    const start = (safePage - 1) * pageSize

    return {
      viewMode,
      totalBookings: filtered.length,
      totalInvoices: invoiceGroups.length,
      totalRevenue,
      page: safePage,
      pageSize,
      totalPages,
      bookings: filtered.slice(start, start + pageSize),
      invoiceGroups: [],
    }
  }

  const totalPages = Math.max(1, Math.ceil(invoiceGroups.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize

  return {
    viewMode,
    totalBookings: filtered.length,
    totalInvoices: invoiceGroups.length,
    totalRevenue,
    page: safePage,
    pageSize,
    totalPages,
    bookings: [],
    invoiceGroups: invoiceGroups.slice(start, start + pageSize),
  }
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

export async function updateBookingServer(bookingId: string, data: Partial<Booking>): Promise<Booking> {
  const row: Record<string, unknown> = {
    updated_at: new Date().toISOString().slice(0, 10),
  }

  if (data.propertyId !== undefined) row.property_id = data.propertyId
  if (data.customerId !== undefined) row.customer_id = data.customerId
  if (data.checkIn !== undefined) row.check_in = data.checkIn
  if (data.checkOut !== undefined) row.check_out = data.checkOut
  if (data.nights !== undefined) row.nights = data.nights
  if (data.bedsBooked !== undefined) row.beds_booked = data.bedsBooked
  if (data.pricePerBedNight !== undefined) row.price_per_bed_night = data.pricePerBedNight
  if (data.cleaningFee !== undefined) row.cleaning_fee = data.cleaningFee
  if (data.totalPrice !== undefined) row.total_price = data.totalPrice
  if (data.status !== undefined) row.status = data.status
  if (data.paymentStatus !== undefined) row.payment_status = data.paymentStatus
  if (data.notes !== undefined) row.notes = data.notes
  if (data.lexofficeInvoiceId !== undefined) row.lexoffice_invoice_id = data.lexofficeInvoiceId
  if (data.lexofficeQuotationId !== undefined) row.lexoffice_quotation_id = data.lexofficeQuotationId
  if (data.invoiceNumber !== undefined) row.invoice_number = data.invoiceNumber
  if (data.source !== undefined) row.source = data.source

  const { data: updated, error } = await supabaseAdmin
    .from('bookings')
    .update(row)
    .eq('id', bookingId)
    .select('*')
    .single()

  if (error) throw new Error(`Buchung konnte nicht aktualisiert werden: ${error.message}`)
  return mapBooking(updated)
}
