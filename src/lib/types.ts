// ─── Core Types ───────────────────────────────────────────────────────────────

export type BookingStatus = 'anfrage' | 'option' | 'bestaetigt' | 'storniert' | 'abgeschlossen'
export type PaymentStatus = 'offen' | 'teilweise' | 'bezahlt' | 'erstattet'
export type ObjectType = 'wohnung' | 'haus' | 'studio' | 'villa' | 'zimmer'

export interface Location {
  id: string
  name: string
  city: string
  country: string
  color: string
}

export interface Property {
  id: string
  name: string
  shortCode: string           // z.B. "WS22", "WE8" — so wie in Lexoffice-Rechnungen
  aliases: string[]           // weitere Bezeichnungen zum Abgleich (z.B. ["Wohnung Seeblick 22"])
  type: ObjectType
  locationId: string
  beds: number                // Gesamtanzahl Betten (= maximale Kapazität)
  pricePerBedNight: number    // Preis pro Bett pro Nacht — zentrale KPI im Monteursbusiness
  cleaningFee: number         // Endreinigungspauschale (einmalig pro Buchung)
  description: string
  amenities: string[]
  images: string[]
  active: boolean
}

// Auftraggeber = Firma (Baufirma, Zeitarbeitsfirma usw.)
export interface Customer {
  id: string
  companyName: string         // Firmenname — primäres Feld
  firstName: string           // Ansprechpartner Vorname
  lastName: string            // Ansprechpartner Nachname
  email: string
  phone: string
  address: string
  zip: string
  city: string
  country: string
  taxId?: string              // Steuernummer / USt-IdNr für Rechnungen
  lexofficeContactId?: string
  notes: string
  createdAt: string
}

export interface Booking {
  id: string
  bookingNumber: string
  propertyId: string
  customerId: string
  checkIn: string             // ISO-Datumsstring
  checkOut: string            // ISO-Datumsstring
  nights: number
  bedsBooked: number          // gebuchte Betten (≤ property.beds) — zentrale KPI
  pricePerBedNight: number    // Preis/Bett/Nacht zum Buchungszeitpunkt (snapshot)
  cleaningFee: number
  totalPrice: number          // bedsBooked × nights × pricePerBedNight + cleaningFee
  status: BookingStatus
  paymentStatus: PaymentStatus
  notes: string
  lexofficeInvoiceId?: string
  lexofficeQuotationId?: string
  invoiceNumber?: string
  createdAt: string
  updatedAt: string
  source: 'manual' | 'lexoffice_import' | 'lexoffice_sonstige' | 'direct'
}

export interface LexofficeInvoice {
  id: string
  voucherNumber: string
  voucherDate: string
  customerName: string
  totalGross: number
  taxAmount: number
  status: string
  lineItems: LexofficeLineItem[]
  contactId: string
}

export interface LexofficeLineItem {
  name: string
  description: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

export interface ParsedImport {
  invoice: LexofficeInvoice
  suggested: {
    propertyId?: string
    checkIn?: string
    checkOut?: string
    nights?: number
    bedsBooked?: number
    confidence: 'high' | 'medium' | 'low'
    rawText: string
  }
  status: 'pending' | 'accepted' | 'skipped'
}

export interface DashboardStats {
  revenueThisMonth: number
  revenueLastMonth: number
  bedOccupancyRate: number    // Bettauslastung in %
  avgPricePerBedNight: number // Ø Bettpreis/Nacht
  activeBookings: number
  checkInsToday: number
  checkOutsToday: number
  openInvoices: number
  openInvoicesAmount: number
}
