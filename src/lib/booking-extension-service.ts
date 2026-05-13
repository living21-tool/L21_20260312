import 'server-only'

import { differenceInDays, format } from 'date-fns'

import {
  loadBookingsServer,
  loadCustomersServer,
  loadPropertiesServer,
  loadLocationsServer,
  getCustomerById,
  updateBookingServer,
} from '@/lib/booking-data-service'
import {
  buildLexofficeInvoicePayload,
  createInvoiceDraftLineId,
  DEFAULT_INVOICE_REMARK,
  formatRange,
  inferCountryCode,
  roundCurrency,
  type InvoiceFormState,
} from '@/lib/booking-workflow'
import { createInvoice, downloadInvoicePdf, getInvoice } from '@/lib/lexoffice'
import type { Booking, Customer, Property, Location } from '@/lib/types'

export type ExtensionCandidate = {
  booking: Booking
  property: Property
  location: Location
  customer: Customer
}

export type ExtensionResult = {
  updatedBooking: Booking
  newInvoiceId: string
  newVoucherNumber?: string
  additionalNights: number
  additionalAmount: number
  pdfBuffer?: ArrayBuffer
  pdfFileName?: string
}

export async function findActiveBookingsForCustomer(customerQuery: string, propertyHint?: string): Promise<ExtensionCandidate[]> {
  const [bookings, customers, properties, locations] = await Promise.all([
    loadBookingsServer(),
    loadCustomersServer(),
    loadPropertiesServer(),
    loadLocationsServer(),
  ])

  const normalizedQuery = customerQuery.trim().toLowerCase()

  // Find matching customers
  const matchingCustomers = customers.filter(customer => {
    const company = customer.companyName.toLowerCase()
    const fullName = `${customer.firstName} ${customer.lastName}`.trim().toLowerCase()
    return (
      company.includes(normalizedQuery) ||
      normalizedQuery.includes(company) ||
      fullName.includes(normalizedQuery) ||
      normalizedQuery.includes(fullName)
    )
  })

  if (matchingCustomers.length === 0) return []

  const customerIds = new Set(matchingCustomers.map(c => c.id))
  const customersById = new Map(matchingCustomers.map(c => [c.id, c]))
  const propertiesById = new Map(properties.map(p => [p.id, p]))
  const locationsById = new Map(locations.map(l => [l.id, l]))

  const today = new Date().toISOString().slice(0, 10)

  // Find active bookings (bestaetigt, not yet checked out)
  const activeBookings = bookings.filter(booking => {
    if (!customerIds.has(booking.customerId)) return false
    if (booking.status !== 'bestaetigt') return false
    if (booking.checkOut < today) return false
    return true
  })

  // If property hint is given, filter further
  const normalizedHint = propertyHint?.trim().toLowerCase()
  const filtered = normalizedHint
    ? activeBookings.filter(booking => {
        const property = propertiesById.get(booking.propertyId)
        if (!property) return false
        return (
          property.name.toLowerCase().includes(normalizedHint) ||
          property.shortCode.toLowerCase().includes(normalizedHint) ||
          property.aliases.some(a => a.toLowerCase().includes(normalizedHint)) ||
          normalizedHint.includes(property.shortCode.toLowerCase()) ||
          normalizedHint.includes(property.name.toLowerCase())
        )
      })
    : activeBookings

  return filtered
    .map(booking => {
      const property = propertiesById.get(booking.propertyId)
      const customer = customersById.get(booking.customerId)
      const location = property ? locationsById.get(property.locationId) : undefined
      if (!property || !customer || !location) return null
      return { booking, property, location, customer }
    })
    .filter((entry): entry is ExtensionCandidate => entry !== null)
    .sort((a, b) => a.booking.checkOut.localeCompare(b.booking.checkOut))
}

export function calculateExtension(booking: Booking, newCheckOut: string) {
  const oldCheckOut = new Date(booking.checkOut)
  const newCheckOutDate = new Date(newCheckOut)
  const additionalNights = differenceInDays(newCheckOutDate, oldCheckOut)

  if (additionalNights <= 0) {
    throw new Error(`Das neue Checkout-Datum (${format(newCheckOutDate, 'dd.MM.yyyy')}) muss nach dem aktuellen Checkout (${format(oldCheckOut, 'dd.MM.yyyy')}) liegen.`)
  }

  const additionalAmount = roundCurrency(additionalNights * booking.pricePerBedNight * booking.bedsBooked)
  const newTotalNights = booking.nights + additionalNights

  return {
    additionalNights,
    additionalAmount,
    newTotalNights,
    oldCheckOut: booking.checkOut,
    newCheckOut,
  }
}

export async function executeExtension(
  candidate: ExtensionCandidate,
  newCheckOut: string,
  taxRate: 0 | 7 | 19 = 0,
  paymentTermDays = 14,
): Promise<ExtensionResult> {
  const { booking, property, location, customer } = candidate
  const extension = calculateExtension(booking, newCheckOut)

  // 1. Update the booking in Supabase
  const newTotalPrice = roundCurrency(
    extension.newTotalNights * booking.pricePerBedNight * booking.bedsBooked + booking.cleaningFee,
  )

  const updatedBooking = await updateBookingServer(booking.id, {
    checkOut: newCheckOut,
    nights: extension.newTotalNights,
    totalPrice: newTotalPrice,
    notes: `${booking.notes}\n[Verlängerung] ${format(new Date(), 'dd.MM.yyyy')}: ${formatRange(extension.oldCheckOut, newCheckOut)} (+${extension.additionalNights} Nächte)`.trim(),
  })

  // 2. Create new Lexoffice invoice for the extension period
  const invoiceForm: InvoiceFormState = {
    customerName: customer.companyName,
    addressSupplement: customer.firstName || customer.lastName
      ? `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim()
      : '',
    street: customer.address ?? '',
    zip: customer.zip ?? '',
    city: customer.city ?? '',
    countryCode: inferCountryCode(customer),
    voucherDate: new Date().toISOString().slice(0, 10),
    serviceDateFrom: extension.oldCheckOut,
    serviceDateTo: newCheckOut,
    title: 'Rechnung',
    introduction: `Verlängerung für ${customer.companyName}`,
    remark: DEFAULT_INVOICE_REMARK,
    paymentTermDays,
    totalDiscountPercentage: 0,
    lines: [
      {
        id: createInvoiceDraftLineId(),
        kind: 'booking',
        name: property.shortCode || property.name,
        description: `${property.name}, ${location.name}, ${formatRange(extension.oldCheckOut, newCheckOut)}, ${booking.bedsBooked} Betten (Verlängerung)`,
        quantity: extension.additionalNights,
        unitName: booking.bedsBooked === 1 ? 'Nacht' : 'Nächte',
        unitPriceNet: roundCurrency(booking.pricePerBedNight * booking.bedsBooked),
        discountPercentage: 0,
        taxRate,
      },
    ],
  }

  const payload = buildLexofficeInvoicePayload({
    customer,
    invoiceForm,
    fallbackCountryCode: inferCountryCode(customer),
  })

  const createResult = await createInvoice(payload, false)

  let voucherNumber: string | undefined
  try {
    const detail = await getInvoice(createResult.id)
    voucherNumber = detail.voucherNumber
  } catch {
    // optional
  }

  // 3. Try to download the PDF
  let pdfBuffer: ArrayBuffer | undefined
  let pdfFileName: string | undefined
  try {
    const pdf = await downloadInvoicePdf(createResult.id)
    pdfBuffer = pdf.buffer
    pdfFileName = pdf.fileName
  } catch {
    // optional
  }

  return {
    updatedBooking,
    newInvoiceId: createResult.id,
    newVoucherNumber: voucherNumber,
    additionalNights: extension.additionalNights,
    additionalAmount: extension.additionalAmount,
    pdfBuffer,
    pdfFileName,
  }
}

export function formatExtensionConfirmation(
  candidate: ExtensionCandidate,
  newCheckOut: string,
) {
  const { booking, property, location, customer } = candidate
  const extension = calculateExtension(booking, newCheckOut)

  return [
    `<b>Buchung gefunden:</b>`,
    `${customer.companyName} — ${property.shortCode || property.name} (${location.name})`,
    `Aktuell: ${formatRange(booking.checkIn, booking.checkOut)} (${booking.nights} Nächte, ${booking.bedsBooked} Betten)`,
    '',
    `<b>Verlängerung bis ${format(new Date(newCheckOut), 'dd.MM.yyyy')}:</b>`,
    `+${extension.additionalNights} Nächte · +${extension.additionalAmount.toFixed(2)} EUR`,
    `(${booking.bedsBooked} Betten × ${booking.pricePerBedNight.toFixed(2)} EUR/Bett/Nacht)`,
    '',
    `Neue Rechnung wird in Lexoffice erstellt (nur Verlängerungszeitraum).`,
    '',
    `Bestätigen? Antworte mit <code>Ja</code> oder <code>Nein</code>.`,
  ].join('\n')
}

export function formatExtensionSuccess(
  candidate: ExtensionCandidate,
  result: ExtensionResult,
) {
  const { property, customer } = candidate

  return [
    `✅ <b>Verlängerung abgeschlossen!</b>`,
    '',
    `• Buchung ${customer.companyName} / ${property.shortCode || property.name} verlängert bis ${format(new Date(result.updatedBooking.checkOut), 'dd.MM.yyyy')} (${result.updatedBooking.nights} Nächte)`,
    `• Neue Rechnung ${result.newVoucherNumber ?? result.newInvoiceId} erstellt (${result.additionalAmount.toFixed(2)} EUR)`,
    result.pdfBuffer ? '📄 PDF wird als nächstes gesendet.' : '',
  ].filter(Boolean).join('\n')
}
