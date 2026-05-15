import 'server-only'

import { checkAvailability, type AvailabilityLookupInput } from '@/lib/availability-service'
import {
  loadBookingListPage,
  findCustomersByQuery,
  getCustomerById,
  addBookingServer,
  updateBookingServer,
  addCustomerServer,
  updateCustomerServer,
  loadLocationsServer,
  loadPropertiesServer,
  loadCustomersServer,
} from '@/lib/booking-data-service'
import { getLexofficeSyncState, listLexofficeImportQueue, runLexofficeSync } from '@/lib/lexoffice-sync'
import type { BookingInsertInput } from '@/lib/booking-workflow'
import type { Booking, Customer } from '@/lib/types'

export type ToolCategory = 'query' | 'action'

export type ToolDefinition = {
  name: string
  category: ToolCategory
  label: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<unknown>
  formatProposal?: (args: Record<string, unknown>) => string
}

const allTools: ToolDefinition[] = [
  // ── Query Tools ──────────────────────────────────────────────
  {
    name: 'check_availability',
    category: 'query',
    label: 'Verfügbarkeit prüfen',
    description: 'Prüft die Bettverfügbarkeit für einen Standort in einem Zeitraum. Gibt freie Betten pro Objekt und einen Belegungsvorschlag zurück.',
    inputSchema: {
      type: 'object',
      properties: {
        locationName: { type: 'string', description: 'Name des Standorts oder der Stadt' },
        locationId: { type: 'string', description: 'ID des Standorts (optional, alternativ zu locationName)' },
        checkIn: { type: 'string', description: 'Check-in Datum im Format YYYY-MM-DD' },
        checkOut: { type: 'string', description: 'Check-out Datum im Format YYYY-MM-DD' },
        bedsNeeded: { type: 'number', description: 'Anzahl benötigter Betten' },
        strategy: { type: 'string', enum: ['fewest-properties', 'cheapest-first'], description: 'Belegungsstrategie (Standard: fewest-properties)' },
      },
      required: ['checkIn', 'checkOut', 'bedsNeeded'],
    },
    async execute(args) {
      return checkAvailability(args as unknown as AvailabilityLookupInput)
    },
  },
  {
    name: 'search_bookings',
    category: 'query',
    label: 'Buchungen suchen',
    description: 'Sucht und filtert Buchungen. Kann nach Text, Status, Standort filtern und paginieren.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Suchtext (Buchungsnummer, Objektname, Kundenname, Rechnungsnummer)' },
        statusFilter: { type: 'string', enum: ['all', 'anfrage', 'option', 'bestaetigt', 'storniert', 'abgeschlossen'], description: 'Status-Filter (Standard: all)' },
        locationFilter: { type: 'string', description: 'Standort-ID zum Filtern (Standard: all)' },
        page: { type: 'number', description: 'Seitennummer (Standard: 1)' },
        pageSize: { type: 'number', description: 'Einträge pro Seite (Standard: 20)' },
      },
    },
    async execute(args) {
      return loadBookingListPage({
        search: args.search as string | undefined,
        statusFilter: args.statusFilter as string | undefined,
        locationFilter: args.locationFilter as string | undefined,
        viewMode: 'bookings',
        page: args.page as number | undefined,
        pageSize: (args.pageSize as number | undefined) ?? 20,
      })
    },
  },
  {
    name: 'search_customers',
    category: 'query',
    label: 'Kunden suchen',
    description: 'Sucht Auftraggeber/Kunden nach Name, E-Mail oder Stadt.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Suchbegriff (Firmenname, Kontaktperson, E-Mail, Stadt)' },
        limit: { type: 'number', description: 'Max. Anzahl Ergebnisse (Standard: 5)' },
      },
      required: ['query'],
    },
    async execute(args) {
      return findCustomersByQuery(args.query as string, (args.limit as number | undefined) ?? 5)
    },
  },
  {
    name: 'get_customer',
    category: 'query',
    label: 'Kunde abrufen',
    description: 'Ruft die vollständigen Details eines einzelnen Auftraggebers/Kunden ab.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'ID des Kunden' },
      },
      required: ['customerId'],
    },
    async execute(args) {
      return getCustomerById(args.customerId as string)
    },
  },
  {
    name: 'get_sync_state',
    category: 'query',
    label: 'Lexoffice Sync-Status',
    description: 'Zeigt den aktuellen Status der Lexoffice-Synchronisation (letzter Sync, Fehler, Zusammenfassung).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      return getLexofficeSyncState()
    },
  },
  {
    name: 'list_import_queue',
    category: 'query',
    label: 'Import-Warteschlange',
    description: 'Listet die Lexoffice Import-Warteschlange auf (ausstehende Rechnungen zum Prüfen/Importieren).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max. Anzahl Einträge (Standard: 20)' },
      },
    },
    async execute(args) {
      return listLexofficeImportQueue((args.limit as number | undefined) ?? 20)
    },
  },

  // ── Action Tools ─────────────────────────────────────────────
  {
    name: 'create_booking',
    category: 'action',
    label: 'Buchung erstellen',
    description: 'Erstellt eine neue Buchung im System.',
    inputSchema: {
      type: 'object',
      properties: {
        propertyId: { type: 'string', description: 'ID des Objekts' },
        customerId: { type: 'string', description: 'ID des Auftraggebers' },
        checkIn: { type: 'string', description: 'Check-in Datum (YYYY-MM-DD)' },
        checkOut: { type: 'string', description: 'Check-out Datum (YYYY-MM-DD)' },
        nights: { type: 'number', description: 'Anzahl Nächte' },
        bedsBooked: { type: 'number', description: 'Anzahl gebuchter Betten' },
        pricePerBedNight: { type: 'number', description: 'Preis pro Bett pro Nacht (netto)' },
        cleaningFee: { type: 'number', description: 'Reinigungsgebühr' },
        totalPrice: { type: 'number', description: 'Gesamtpreis' },
        status: { type: 'string', enum: ['anfrage', 'option', 'bestaetigt'], description: 'Buchungsstatus (Standard: anfrage)' },
        paymentStatus: { type: 'string', enum: ['offen', 'teilweise', 'bezahlt'], description: 'Zahlungsstatus (Standard: offen)' },
        notes: { type: 'string', description: 'Notizen zur Buchung' },
      },
      required: ['propertyId', 'customerId', 'checkIn', 'checkOut', 'nights', 'bedsBooked', 'pricePerBedNight', 'cleaningFee', 'totalPrice'],
    },
    async execute(args) {
      return addBookingServer({
        propertyId: args.propertyId as string,
        customerId: args.customerId as string,
        checkIn: args.checkIn as string,
        checkOut: args.checkOut as string,
        nights: args.nights as number,
        bedsBooked: args.bedsBooked as number,
        pricePerBedNight: args.pricePerBedNight as number,
        cleaningFee: args.cleaningFee as number,
        totalPrice: args.totalPrice as number,
        status: (args.status as Booking['status']) ?? 'anfrage',
        paymentStatus: (args.paymentStatus as Booking['paymentStatus']) ?? 'offen',
        notes: (args.notes as string) ?? '',
        source: 'manual',
        lexofficeInvoiceId: '',
        lexofficeQuotationId: '',
        invoiceNumber: '',
      } satisfies BookingInsertInput)
    },
    formatProposal(args) {
      return `Buchung erstellen: ${args.bedsBooked} Betten, ${args.checkIn} bis ${args.checkOut}, ${args.nights} Nächte, Gesamtpreis: ${args.totalPrice}€`
    },
  },
  {
    name: 'update_booking',
    category: 'action',
    label: 'Buchung aktualisieren',
    description: 'Aktualisiert eine bestehende Buchung (Status, Daten, Preise, Notizen etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        bookingId: { type: 'string', description: 'ID der Buchung' },
        status: { type: 'string', enum: ['anfrage', 'option', 'bestaetigt', 'storniert', 'abgeschlossen'], description: 'Neuer Status' },
        paymentStatus: { type: 'string', enum: ['offen', 'teilweise', 'bezahlt', 'erstattet'], description: 'Neuer Zahlungsstatus' },
        checkIn: { type: 'string', description: 'Neues Check-in Datum (YYYY-MM-DD)' },
        checkOut: { type: 'string', description: 'Neues Check-out Datum (YYYY-MM-DD)' },
        nights: { type: 'number', description: 'Neue Anzahl Nächte' },
        notes: { type: 'string', description: 'Neue Notizen' },
      },
      required: ['bookingId'],
    },
    async execute(args) {
      const bookingId = args.bookingId as string
      const updates: Partial<Booking> = {}
      if (args.status !== undefined) updates.status = args.status as Booking['status']
      if (args.paymentStatus !== undefined) updates.paymentStatus = args.paymentStatus as Booking['paymentStatus']
      if (args.checkIn !== undefined) updates.checkIn = args.checkIn as string
      if (args.checkOut !== undefined) updates.checkOut = args.checkOut as string
      if (args.nights !== undefined) updates.nights = args.nights as number
      if (args.notes !== undefined) updates.notes = args.notes as string
      return updateBookingServer(bookingId, updates)
    },
    formatProposal(args) {
      const parts = [`Buchung ${args.bookingId} aktualisieren`]
      if (args.status) parts.push(`Status → ${args.status}`)
      if (args.paymentStatus) parts.push(`Zahlung → ${args.paymentStatus}`)
      if (args.checkIn || args.checkOut) parts.push(`Zeitraum → ${args.checkIn ?? '...'} bis ${args.checkOut ?? '...'}`)
      return parts.join(', ')
    },
  },
  {
    name: 'create_customer',
    category: 'action',
    label: 'Kunde erstellen',
    description: 'Erstellt einen neuen Auftraggeber/Kunden im System.',
    inputSchema: {
      type: 'object',
      properties: {
        companyName: { type: 'string', description: 'Firmenname (Pflichtfeld)' },
        firstName: { type: 'string', description: 'Vorname des Ansprechpartners' },
        lastName: { type: 'string', description: 'Nachname des Ansprechpartners' },
        email: { type: 'string', description: 'E-Mail-Adresse' },
        phone: { type: 'string', description: 'Telefonnummer' },
        address: { type: 'string', description: 'Straße + Hausnummer' },
        zip: { type: 'string', description: 'Postleitzahl' },
        city: { type: 'string', description: 'Stadt' },
        country: { type: 'string', description: 'Land (Standard: Deutschland)' },
        notes: { type: 'string', description: 'Notizen' },
      },
      required: ['companyName'],
    },
    async execute(args) {
      return addCustomerServer({
        companyName: args.companyName as string,
        firstName: (args.firstName as string) ?? '',
        lastName: (args.lastName as string) ?? '',
        email: (args.email as string) ?? '',
        phone: (args.phone as string) ?? '',
        address: (args.address as string) ?? '',
        zip: (args.zip as string) ?? '',
        city: (args.city as string) ?? '',
        country: (args.country as string) ?? 'Deutschland',
        taxId: '',
        lexofficeContactId: '',
        notes: (args.notes as string) ?? '',
      })
    },
    formatProposal(args) {
      return `Neuen Kunden erstellen: ${args.companyName}${args.city ? ` (${args.city})` : ''}`
    },
  },
  {
    name: 'update_customer',
    category: 'action',
    label: 'Kunde aktualisieren',
    description: 'Aktualisiert die Daten eines bestehenden Auftraggebers/Kunden.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'ID des Kunden' },
        companyName: { type: 'string', description: 'Neuer Firmenname' },
        firstName: { type: 'string', description: 'Neuer Vorname' },
        lastName: { type: 'string', description: 'Neuer Nachname' },
        email: { type: 'string', description: 'Neue E-Mail' },
        phone: { type: 'string', description: 'Neue Telefonnummer' },
        address: { type: 'string', description: 'Neue Adresse' },
        zip: { type: 'string', description: 'Neue PLZ' },
        city: { type: 'string', description: 'Neue Stadt' },
        notes: { type: 'string', description: 'Neue Notizen' },
      },
      required: ['customerId'],
    },
    async execute(args) {
      const customerId = args.customerId as string
      const updates: Partial<Customer> = {}
      if (args.companyName !== undefined) updates.companyName = args.companyName as string
      if (args.firstName !== undefined) updates.firstName = args.firstName as string
      if (args.lastName !== undefined) updates.lastName = args.lastName as string
      if (args.email !== undefined) updates.email = args.email as string
      if (args.phone !== undefined) updates.phone = args.phone as string
      if (args.address !== undefined) updates.address = args.address as string
      if (args.zip !== undefined) updates.zip = args.zip as string
      if (args.city !== undefined) updates.city = args.city as string
      if (args.notes !== undefined) updates.notes = args.notes as string
      return updateCustomerServer(customerId, updates)
    },
    formatProposal(args) {
      return `Kunde ${args.customerId} aktualisieren`
    },
  },
  {
    name: 'sync_lexoffice',
    category: 'action',
    label: 'Lexoffice synchronisieren',
    description: 'Startet eine Synchronisation mit Lexoffice (Rechnungen und Kontakte abrufen).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      return runLexofficeSync()
    },
    formatProposal() {
      return 'Lexoffice-Synchronisation starten'
    },
  },
]

const toolsByName = new Map(allTools.map(tool => [tool.name, tool]))

export function getAllToolDefinitions(): ToolDefinition[] {
  return allTools
}

export function getToolByName(name: string): ToolDefinition | undefined {
  return toolsByName.get(name)
}

export function getToolsForClaude(enabledNames: string[]) {
  const enabled = new Set(enabledNames)
  return allTools
    .filter(tool => enabled.has(tool.name))
    .map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }))
}

export async function executeToolByName(name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = toolsByName.get(name)
  if (!tool) throw new Error(`Tool "${name}" nicht gefunden.`)
  return tool.execute(args)
}

export async function loadAgentContext() {
  const [locations, properties, customers] = await Promise.all([
    loadLocationsServer(),
    loadPropertiesServer(),
    loadCustomersServer(),
  ])

  return {
    locations: locations.slice(0, 80).map(l => ({ id: l.id, name: l.name, city: l.city })),
    properties: properties.slice(0, 80).map(p => ({
      id: p.id,
      name: p.name,
      shortCode: p.shortCode,
      locationId: p.locationId,
      beds: p.beds,
      pricePerBedNight: p.pricePerBedNight,
      cleaningFee: p.cleaningFee,
    })),
    customers: customers.slice(0, 120).map(c => ({
      id: c.id,
      companyName: c.companyName,
      city: c.city,
      email: c.email,
    })),
  }
}
