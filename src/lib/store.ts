'use client'
import { useState, useEffect, useCallback } from 'react'
import { Property, Location, Customer, Booking } from './types'
import { supabase } from './supabase'
import { normalizeLocationName } from './utils'

// ─── Mapper: DB (snake_case) → App (camelCase) ────────────────────────────────

function mapLocation(r: Record<string, unknown>): Location {
  return {
    id:      r.id as string,
    name:    normalizeLocationName(r.name as string),
    city:    r.city as string,
    country: r.country as string,
    color:   r.color as string,
  }
}

function mapProperty(r: Record<string, unknown>): Property {
  return {
    id:               r.id as string,
    name:             r.name as string,
    shortCode:        r.short_code as string,
    aliases:          (r.aliases as string[]) ?? [],
    type:             r.type as Property['type'],
    locationId:       r.location_id as string,
    beds:             r.beds as number,
    pricePerBedNight: r.price_per_bed_night as number,
    cleaningFee:      r.cleaning_fee as number,
    description:      (r.description as string) ?? '',
    amenities:        (r.amenities as string[]) ?? [],
    images:           (r.images as string[]) ?? [],
    active:           r.active as boolean,
  }
}

function mapCustomer(r: Record<string, unknown>): Customer {
  return {
    id:                  r.id as string,
    companyName:         (r.company_name as string) ?? '',
    firstName:           (r.first_name as string) ?? '',
    lastName:            (r.last_name as string) ?? '',
    email:               (r.email as string) ?? '',
    phone:               (r.phone as string) ?? '',
    address:             (r.address as string) ?? '',
    zip:                 (r.zip as string) ?? '',
    city:                (r.city as string) ?? '',
    country:             (r.country as string) ?? 'Deutschland',
    taxId:               (r.tax_id as string) ?? '',
    lexofficeContactId:  (r.lexoffice_contact_id as string) ?? '',
    notes:               (r.notes as string) ?? '',
    createdAt:           r.created_at as string,
  }
}

function mapBooking(r: Record<string, unknown>): Booking {
  return {
    id:                    r.id as string,
    bookingNumber:         r.booking_number as string,
    propertyId:            r.property_id as string,
    customerId:            (r.customer_id as string) ?? '',
    checkIn:               r.check_in as string,
    checkOut:              r.check_out as string,
    nights:                r.nights as number,
    bedsBooked:            r.beds_booked as number,
    pricePerBedNight:      r.price_per_bed_night as number,
    cleaningFee:           r.cleaning_fee as number,
    totalPrice:            r.total_price as number,
    status:                r.status as Booking['status'],
    paymentStatus:         r.payment_status as Booking['paymentStatus'],
    notes:                 (r.notes as string) ?? '',
    lexofficeInvoiceId:    (r.lexoffice_invoice_id as string) ?? '',
    lexofficeQuotationId:  (r.lexoffice_quotation_id as string) ?? '',
    invoiceNumber:         (r.invoice_number as string) ?? '',
    createdAt:             r.created_at as string,
    updatedAt:             r.updated_at as string,
    source:                (r.source as Booking['source']) ?? 'manual',
  }
}

type EntityCache<T> = {
  data: T[] | null
  promise: Promise<T[]> | null
}

const locationsCache: EntityCache<Location> = { data: null, promise: null }
const propertiesCache: EntityCache<Property> = { data: null, promise: null }
const customersCache: EntityCache<Customer> = { data: null, promise: null }
const bookingsCache: EntityCache<Booking> = { data: null, promise: null }

async function loadCached<T>(cache: EntityCache<T>, fetcher: () => Promise<T[]>): Promise<T[]> {
  if (cache.data) {
    return cache.data
  }

  if (cache.promise) {
    return cache.promise
  }

  cache.promise = fetcher()
    .then(data => {
      cache.data = data
      return data
    })
    .finally(() => {
      cache.promise = null
    })

  return cache.promise
}

function setCacheData<T>(cache: EntityCache<T>, data: T[]) {
  cache.data = data
}

// ─── useLocations ─────────────────────────────────────────────────────────────

export function useLocations() {
  const [locations, setLocations] = useState<Location[]>(() => locationsCache.data ?? [])
  const [loading, setLoading]     = useState(locationsCache.data === null)

  const load = useCallback(async () => {
    try {
      const nextLocations = await loadCached(locationsCache, async () => {
        const { data, error } = await supabase.from('locations').select('*').order('name')
        if (error) throw error
        return (data ?? []).map(mapLocation)
      })
      setLocations(nextLocations)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const add = async (loc: Omit<Location, 'id'>): Promise<Location> => {
    const id = `loc-${Date.now()}`
    const row = { id, name: normalizeLocationName(loc.name), city: loc.city, country: loc.country, color: loc.color }
    const { data, error } = await supabase.from('locations').insert(row).select().single()
    if (error) throw error
    const newLoc = mapLocation(data)
    setLocations(prev => {
      const next = [...prev, newLoc]
      setCacheData(locationsCache, next)
      return next
    })
    return newLoc
  }

  const upsert = async (loc: Location): Promise<void> => {
    const normalizedLoc = { ...loc, name: normalizeLocationName(loc.name) }
    const row = { id: normalizedLoc.id, name: normalizedLoc.name, city: normalizedLoc.city, country: normalizedLoc.country, color: normalizedLoc.color }
    const { error } = await supabase.from('locations').upsert(row)
    if (error) throw error
    setLocations(prev => {
      const next = prev.some(l => l.id === loc.id)
        ? prev.map(l => l.id === loc.id ? normalizedLoc : l)
        : [...prev, normalizedLoc]
      setCacheData(locationsCache, next)
      return next
    })
  }

  const update = async (id: string, data: Partial<Location>): Promise<void> => {
    const row: Record<string, unknown> = {}
    if (data.name    !== undefined) row.name    = normalizeLocationName(data.name)
    if (data.city    !== undefined) row.city    = data.city
    if (data.country !== undefined) row.country = data.country
    if (data.color   !== undefined) row.color   = data.color
    const { error } = await supabase.from('locations').update(row).eq('id', id)
    if (error) throw error
    setLocations(prev => {
      const next = prev.map(l => l.id === id
        ? { ...l, ...data, name: data.name !== undefined ? normalizeLocationName(data.name) : l.name }
        : l
      )
      setCacheData(locationsCache, next)
      return next
    })
  }

  const remove = async (id: string): Promise<void> => {
    const { error } = await supabase.from('locations').delete().eq('id', id)
    if (error) throw error
    setLocations(prev => {
      const next = prev.filter(l => l.id !== id)
      setCacheData(locationsCache, next)
      return next
    })
  }

  const clearAll = async (): Promise<void> => {
    await supabase.from('locations').delete().neq('id', '')
    setCacheData(locationsCache, [])
    setLocations([])
  }

  return { locations, loading, load, add, upsert, update, remove, clearAll }
}

// ─── useProperties ────────────────────────────────────────────────────────────

export function useProperties() {
  const [properties, setProperties] = useState<Property[]>(() => propertiesCache.data ?? [])
  const [loading, setLoading]       = useState(propertiesCache.data === null)

  const load = useCallback(async () => {
    try {
      const nextProperties = await loadCached(propertiesCache, async () => {
        const { data, error } = await supabase.from('properties').select('*').order('name')
        if (error) throw error
        return (data ?? []).map(mapProperty)
      })
      setProperties(nextProperties)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const add = async (prop: Omit<Property, 'id'>): Promise<Property> => {
    const id = `prop-${Date.now()}`
    const row = {
      id,
      name:               prop.name,
      short_code:         prop.shortCode,
      aliases:            prop.aliases,
      type:               prop.type,
      location_id:        prop.locationId,
      beds:               prop.beds,
      price_per_bed_night: prop.pricePerBedNight,
      cleaning_fee:       prop.cleaningFee,
      description:        prop.description,
      amenities:          prop.amenities,
      images:             prop.images,
      active:             prop.active,
    }
    const { data, error } = await supabase.from('properties').insert(row).select().single()
    if (error) throw error
    const newProp = mapProperty(data)
    setProperties(prev => {
      const next = [...prev, newProp]
      setCacheData(propertiesCache, next)
      return next
    })
    return newProp
  }

  const upsert = async (prop: Property): Promise<void> => {
    const row = {
      id:                 prop.id,
      name:               prop.name,
      short_code:         prop.shortCode,
      aliases:            prop.aliases,
      type:               prop.type,
      location_id:        prop.locationId,
      beds:               prop.beds,
      price_per_bed_night: prop.pricePerBedNight,
      cleaning_fee:       prop.cleaningFee,
      description:        prop.description,
      amenities:          prop.amenities,
      images:             prop.images,
      active:             prop.active,
    }
    const { error } = await supabase.from('properties').upsert(row)
    if (error) throw error
    setProperties(prev => {
      const next = prev.some(p => p.id === prop.id)
        ? prev.map(p => p.id === prop.id ? prop : p)
        : [...prev, prop]
      setCacheData(propertiesCache, next)
      return next
    })
  }

  const update = async (id: string, data: Partial<Property>): Promise<void> => {
    const row: Record<string, unknown> = {}
    if (data.name               !== undefined) row.name                = data.name
    if (data.shortCode          !== undefined) row.short_code          = data.shortCode
    if (data.aliases            !== undefined) row.aliases             = data.aliases
    if (data.type               !== undefined) row.type                = data.type
    if (data.locationId         !== undefined) row.location_id         = data.locationId
    if (data.beds               !== undefined) row.beds                = data.beds
    if (data.pricePerBedNight   !== undefined) row.price_per_bed_night = data.pricePerBedNight
    if (data.cleaningFee        !== undefined) row.cleaning_fee        = data.cleaningFee
    if (data.description        !== undefined) row.description         = data.description
    if (data.amenities          !== undefined) row.amenities           = data.amenities
    if (data.images             !== undefined) row.images              = data.images
    if (data.active             !== undefined) row.active              = data.active
    const { error } = await supabase.from('properties').update(row).eq('id', id)
    if (error) throw error
    setProperties(prev => {
      const next = prev.map(p => p.id === id ? { ...p, ...data } : p)
      setCacheData(propertiesCache, next)
      return next
    })
  }

  const remove = async (id: string): Promise<void> => {
    const { error } = await supabase.from('properties').delete().eq('id', id)
    if (error) throw error
    setProperties(prev => {
      const next = prev.filter(p => p.id !== id)
      setCacheData(propertiesCache, next)
      return next
    })
  }

  const clearAll = async (): Promise<void> => {
    await supabase.from('properties').delete().neq('id', '')
    setCacheData(propertiesCache, [])
    setProperties([])
  }

  return { properties, loading, load, add, upsert, update, remove, clearAll }
}

// ─── useCustomers ─────────────────────────────────────────────────────────────

export function useCustomers() {
  const [customers, setCustomers] = useState<Customer[]>(() => customersCache.data ?? [])
  const [loading, setLoading]     = useState(customersCache.data === null)

  const load = useCallback(async () => {
    try {
      const nextCustomers = await loadCached(customersCache, async () => {
        const { data, error } = await supabase.from('customers').select('*').order('company_name')
        if (error) throw error
        return (data ?? []).map(mapCustomer)
      })
      setCustomers(nextCustomers)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const add = async (c: Omit<Customer, 'id'>): Promise<Customer> => {
    const id  = `cust-${Date.now()}`
    const now = new Date().toISOString().slice(0, 10)
    const row = {
      id,
      company_name:        c.companyName,
      first_name:          c.firstName,
      last_name:           c.lastName,
      email:               c.email,
      phone:               c.phone,
      address:             c.address,
      zip:                 c.zip,
      city:                c.city,
      country:             c.country,
      tax_id:              c.taxId ?? '',
      lexoffice_contact_id: c.lexofficeContactId ?? '',
      notes:               c.notes,
      created_at:          c.createdAt || now,
    }
    const { data, error } = await supabase.from('customers').insert(row).select().single()
    if (error) throw error
    const newC = mapCustomer(data)
    setCustomers(prev => {
      const next = [...prev, newC]
      setCacheData(customersCache, next)
      return next
    })
    return newC
  }

  const upsert = async (c: Customer): Promise<void> => {
    const row = {
      id:                   c.id,
      company_name:         c.companyName,
      first_name:           c.firstName,
      last_name:            c.lastName,
      email:                c.email,
      phone:                c.phone,
      address:              c.address,
      zip:                  c.zip,
      city:                 c.city,
      country:              c.country,
      tax_id:               c.taxId ?? '',
      lexoffice_contact_id: c.lexofficeContactId ?? '',
      notes:                c.notes,
      created_at:           c.createdAt,
    }
    const { error } = await supabase.from('customers').upsert(row)
    if (error) throw error
    setCustomers(prev => {
      const next = prev.some(x => x.id === c.id)
        ? prev.map(x => x.id === c.id ? c : x)
        : [...prev, c]
      setCacheData(customersCache, next)
      return next
    })
  }

  const update = async (id: string, data: Partial<Customer>): Promise<void> => {
    const row: Record<string, unknown> = {}
    if (data.companyName        !== undefined) row.company_name         = data.companyName
    if (data.firstName          !== undefined) row.first_name           = data.firstName
    if (data.lastName           !== undefined) row.last_name            = data.lastName
    if (data.email              !== undefined) row.email                = data.email
    if (data.phone              !== undefined) row.phone                = data.phone
    if (data.address            !== undefined) row.address              = data.address
    if (data.zip                !== undefined) row.zip                  = data.zip
    if (data.city               !== undefined) row.city                 = data.city
    if (data.country            !== undefined) row.country              = data.country
    if (data.taxId              !== undefined) row.tax_id               = data.taxId
    if (data.lexofficeContactId !== undefined) row.lexoffice_contact_id = data.lexofficeContactId
    if (data.notes              !== undefined) row.notes                = data.notes
    const { error } = await supabase.from('customers').update(row).eq('id', id)
    if (error) throw error
    setCustomers(prev => {
      const next = prev.map(c => c.id === id ? { ...c, ...data } : c)
      setCacheData(customersCache, next)
      return next
    })
  }

  const remove = async (id: string): Promise<void> => {
    const { error } = await supabase.from('customers').delete().eq('id', id)
    if (error) throw error
    setCustomers(prev => {
      const next = prev.filter(c => c.id !== id)
      setCacheData(customersCache, next)
      return next
    })
  }

  const clearAll = async (): Promise<void> => {
    await supabase.from('customers').delete().neq('id', '')
    setCacheData(customersCache, [])
    setCustomers([])
  }

  return { customers, loading, load, add, upsert, update, remove, clearAll }
}

// ─── useBookings ──────────────────────────────────────────────────────────────

export function useBookings() {
  const [bookings, setBookings] = useState<Booking[]>(() => bookingsCache.data ?? [])
  const [loading, setLoading]   = useState(bookingsCache.data === null)

  const load = useCallback(async () => {
    try {
      const nextBookings = await loadCached(bookingsCache, async () => {
        const { data, error } = await supabase.from('bookings').select('*').order('check_in', { ascending: false })
        if (error) throw error
        return (data ?? []).map(mapBooking)
      })
      setBookings(nextBookings)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const add = async (b: Omit<Booking, 'id' | 'bookingNumber' | 'createdAt' | 'updatedAt'>): Promise<Booking> => {
    const now  = new Date().toISOString().slice(0, 10)
    const year = new Date().getFullYear()
    const seq  = String(Date.now()).slice(-5)
    const num  = `MV-${year}-${seq}`
    const totalPrice = b.totalPrice
    // Add random suffix to avoid duplicate IDs when multiple bookings are created in same ms
    const id   = `book-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const row = {
      id,
      booking_number:        num,
      property_id:           b.propertyId || null,
      // Use null instead of '' to avoid FK constraint violation when customer is unknown
      customer_id:           b.customerId || null,
      check_in:              b.checkIn,
      check_out:             b.checkOut,
      nights:                b.nights,
      beds_booked:           b.bedsBooked,
      price_per_bed_night:   b.pricePerBedNight,
      cleaning_fee:          b.cleaningFee,
      total_price:           totalPrice,
      status:                b.status,
      payment_status:        b.paymentStatus,
      notes:                 b.notes ?? '',
      lexoffice_invoice_id:  b.lexofficeInvoiceId ?? '',
      lexoffice_quotation_id: b.lexofficeQuotationId ?? '',
      invoice_number:        b.invoiceNumber ?? '',
      created_at:            now,
      updated_at:            now,
      source:                b.source ?? 'manual',
    }
    const { data, error } = await supabase.from('bookings').insert(row).select().single()
    if (error) throw error
    const newB = mapBooking(data)
    setBookings(prev => {
      const next = [newB, ...prev]
      setCacheData(bookingsCache, next)
      return next
    })
    return newB
  }

  const upsert = async (b: Booking): Promise<void> => {
    const row = {
      id:                     b.id,
      booking_number:         b.bookingNumber,
      property_id:            b.propertyId,
      customer_id:            b.customerId,
      check_in:               b.checkIn,
      check_out:              b.checkOut,
      nights:                 b.nights,
      beds_booked:            b.bedsBooked,
      price_per_bed_night:    b.pricePerBedNight,
      cleaning_fee:           b.cleaningFee,
      total_price:            b.totalPrice,
      status:                 b.status,
      payment_status:         b.paymentStatus,
      notes:                  b.notes ?? '',
      lexoffice_invoice_id:   b.lexofficeInvoiceId ?? '',
      lexoffice_quotation_id: b.lexofficeQuotationId ?? '',
      invoice_number:         b.invoiceNumber ?? '',
      created_at:             b.createdAt,
      updated_at:             b.updatedAt,
      source:                 b.source ?? 'manual',
    }
    const { error } = await supabase.from('bookings').upsert(row)
    if (error) throw error
    setBookings(prev => {
      const next = prev.some(x => x.id === b.id)
        ? prev.map(x => x.id === b.id ? b : x)
        : [b, ...prev]
      setCacheData(bookingsCache, next)
      return next
    })
  }

  const update = async (id: string, data: Partial<Booking>): Promise<void> => {
    const now = new Date().toISOString().slice(0, 10)
    const row: Record<string, unknown> = { updated_at: now }
    if (data.propertyId           !== undefined) row.property_id            = data.propertyId
    if (data.customerId           !== undefined) row.customer_id            = data.customerId
    if (data.checkIn              !== undefined) row.check_in               = data.checkIn
    if (data.checkOut             !== undefined) row.check_out              = data.checkOut
    if (data.nights               !== undefined) row.nights                 = data.nights
    if (data.bedsBooked           !== undefined) row.beds_booked            = data.bedsBooked
    if (data.pricePerBedNight     !== undefined) row.price_per_bed_night    = data.pricePerBedNight
    if (data.cleaningFee          !== undefined) row.cleaning_fee           = data.cleaningFee
    if (data.totalPrice           !== undefined) row.total_price            = data.totalPrice
    if (data.status               !== undefined) row.status                 = data.status
    if (data.paymentStatus        !== undefined) row.payment_status         = data.paymentStatus
    if (data.notes                !== undefined) row.notes                  = data.notes
    if (data.lexofficeInvoiceId   !== undefined) row.lexoffice_invoice_id   = data.lexofficeInvoiceId
    if (data.lexofficeQuotationId !== undefined) row.lexoffice_quotation_id = data.lexofficeQuotationId
    if (data.invoiceNumber        !== undefined) row.invoice_number         = data.invoiceNumber
    if (data.source               !== undefined) row.source                 = data.source
    const { error } = await supabase.from('bookings').update(row).eq('id', id)
    if (error) throw error
    setBookings(prev => {
      const next = prev.map(b => b.id === id ? { ...b, ...data, updatedAt: now } : b)
      setCacheData(bookingsCache, next)
      return next
    })
  }

  const remove = async (id: string): Promise<void> => {
    const { error } = await supabase.from('bookings').delete().eq('id', id)
    if (error) throw error
    setBookings(prev => {
      const next = prev.filter(b => b.id !== id)
      setCacheData(bookingsCache, next)
      return next
    })
  }

  const clearAll = async (): Promise<void> => {
    await supabase.from('bookings').delete().neq('id', '')
    setCacheData(bookingsCache, [])
    setBookings([])
  }

  return { bookings, loading, load, add, upsert, update, remove, clearAll }
}

// ─── Reset all data ───────────────────────────────────────────────────────────
export async function clearAllData() {
  await supabase.from('bookings').delete().neq('id', '')
  await supabase.from('properties').delete().neq('id', '')
  await supabase.from('customers').delete().neq('id', '')
  await supabase.from('locations').delete().neq('id', '')
  setCacheData(bookingsCache, [])
  setCacheData(propertiesCache, [])
  setCacheData(customersCache, [])
  setCacheData(locationsCache, [])
  window.location.reload()
}
