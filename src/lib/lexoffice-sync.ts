import 'server-only'

import { addBookingServer, addCustomerServer, loadBookingsServer, loadCustomersServer, loadPropertiesServer, updateBookingServer, updateCustomerServer } from '@/lib/booking-data-service'
import {
  getAllContacts,
  getCreditNote,
  getDownPaymentInvoice,
  getInvoice,
  getOrderConfirmation,
  getVoucherList,
  getQuotation,
  rateLimitedDelay,
  type LexContact,
  type LexInvoice,
  type LexVoucherListItem,
  type LexVoucherType,
} from '@/lib/lexoffice'
import {
  buildImportPositions,
  extractReferencedInvoiceNumber,
  isStornoVoucher,
  sortLexofficeVouchers,
} from '@/lib/lexoffice-import-helpers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type {
  Booking,
  Customer,
  LexofficeImportPosition,
  LexofficeImportQueueItem,
  LexofficeImportStatus,
  LexofficeSyncState,
  Property,
} from '@/lib/types'

type QueueRow = Record<string, unknown>

type SyncSummary = {
  scanned: number
  pendingReview: number
  autoImported: number
  duplicates: number
  errors: number
  stornoUpdated: number
}

const SYNC_STATE_ID = 'default'
const DEFAULT_LOOKBACK_DAYS = 120

function toQueueItem(row: QueueRow): LexofficeImportQueueItem {
  return {
    voucherId: row.voucher_id as string,
    voucherNumber: (row.voucher_number as string) ?? '',
    voucherType: (row.voucher_type as string) ?? '',
    voucherStatus: (row.voucher_status as string) ?? '',
    voucherDate: (row.voucher_date as string) ?? '',
    contactName: (row.contact_name as string) ?? '',
    lexofficeContactId: (row.lexoffice_contact_id as string) ?? '',
    totalAmount: Number(row.total_amount ?? 0),
    currency: (row.currency as string) ?? 'EUR',
    isStorno: Boolean(row.is_storno),
    confidence: (row.confidence as LexofficeImportQueueItem['confidence']) ?? 'low',
    importStatus: (row.import_status as LexofficeImportStatus) ?? 'pending_review',
    reviewReason: (row.review_reason as string) ?? '',
    errorMessage: (row.error_message as string) ?? '',
    suggestedCustomerId: ((row.suggested_customer_id as string) || undefined),
    bookingIds: (row.booking_ids as string[]) ?? [],
    positions: ((row.positions_payload as LexofficeImportPosition[]) ?? []),
    detail: (row.detail_payload as Record<string, unknown>) ?? {},
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    lastSeenAt: new Date(row.last_seen_at as string).toISOString(),
    importedAt: row.imported_at ? new Date(row.imported_at as string).toISOString() : undefined,
  }
}

function fromQueueItemToVoucher(item: LexofficeImportQueueItem): LexVoucherListItem {
  return {
    id: item.voucherId,
    voucherType: item.voucherType,
    voucherStatus: item.voucherStatus,
    voucherNumber: item.voucherNumber,
    voucherDate: item.voucherDate,
    contactId: item.lexofficeContactId,
    contactName: item.contactName,
    totalAmount: item.totalAmount,
    currency: item.currency,
    archived: false,
  }
}

function normalizeSearch(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('de-DE')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function getLookbackDays() {
  const parsed = Number.parseInt(process.env.LEXOFFICE_SYNC_LOOKBACK_DAYS ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LOOKBACK_DAYS
}

async function getVoucherDetail(voucher: LexVoucherListItem): Promise<LexInvoice> {
  switch (voucher.voucherType as LexVoucherType) {
    case 'creditnote':
      return getCreditNote(voucher.id)
    case 'orderconfirmation':
      return getOrderConfirmation(voucher.id)
    case 'downpaymentinvoice':
      return getDownPaymentInvoice(voucher.id)
    case 'quotation':
      return getQuotation(voucher.id)
    default:
      return getInvoice(voucher.id)
  }
}

async function getAllVouchersForType(
  voucherType: LexVoucherType,
  dateFrom?: string,
  dateTo?: string,
  statusOverride?: string,
) {
  const first = await getVoucherList(voucherType, 0, 100, statusOverride, dateFrom, dateTo)
  const all = [...first.content]
  for (let page = 1; page < first.totalPages; page += 1) {
    await rateLimitedDelay()
    const next = await getVoucherList(voucherType, page, 100, statusOverride, dateFrom, dateTo)
    all.push(...next.content)
  }
  return all
}

async function loadAllSyncVouchers(dateFrom?: string, dateTo?: string) {
  const all: LexVoucherListItem[] = []
  const seen = new Set<string>()
  const append = (items: LexVoucherListItem[]) => {
    for (const item of items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      all.push(item)
    }
  }

  append(await getAllVouchersForType('invoice', dateFrom, dateTo))
  append(await getAllVouchersForType('invoice', dateFrom, dateTo, 'overdue'))
  for (const voucherType of ['creditnote', 'orderconfirmation', 'downpaymentinvoice'] as const) {
    append(await getAllVouchersForType(voucherType, dateFrom, dateTo))
  }
  return sortLexofficeVouchers(all)
}

function parseLexofficeTimestamp(value?: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function hasVoucherChangedSince(voucher: LexVoucherListItem, changedSince: Date) {
  const updatedAt = parseLexofficeTimestamp(voucher.updatedDate)
  if (updatedAt) return updatedAt.getTime() >= changedSince.getTime()

  const voucherAt = parseLexofficeTimestamp(voucher.voucherDate)
  if (voucherAt) return voucherAt.getTime() >= changedSince.getTime()

  return false
}

function matchExistingCustomer(args: {
  customers: Customer[]
  addressName: string
  contactId?: string
}) {
  const { customers, addressName, contactId } = args
  if (contactId) {
    const byContactId = customers.find(customer => customer.lexofficeContactId === contactId)
    if (byContactId) return byContactId
  }

  const normalizedName = normalizeSearch(addressName)
  return customers.find(customer => normalizeSearch(customer.companyName) === normalizedName)
}

async function ensureCustomer(args: {
  customers: Customer[]
  contacts: LexContact[]
  detail: LexInvoice
  voucher: LexVoucherListItem
}) {
  const { customers, contacts, detail, voucher } = args
  const addressName = (detail.address?.name ?? voucher.contactName ?? 'Unbekannt').trim()
  const existing = matchExistingCustomer({
    customers,
    addressName,
    contactId: detail.address?.contactId,
  })
  if (existing) {
    if (detail.address?.contactId && !existing.lexofficeContactId) {
      const updated = await updateCustomerServer(existing.id, { lexofficeContactId: detail.address.contactId })
      return updated
    }
    return existing
  }

  const contact = contacts.find(entry => entry.id === detail.address?.contactId)
  const created = await addCustomerServer({
    companyName: addressName,
    firstName: contact?.person?.firstName ?? '',
    lastName: contact?.person?.lastName ?? '',
    email: contact?.emailAddresses?.business?.[0] ?? contact?.emailAddresses?.private?.[0] ?? '',
    phone: contact?.phoneNumbers?.business?.[0] ?? contact?.phoneNumbers?.mobile?.[0] ?? '',
    address: contact?.addresses?.billing?.[0]?.street ?? '',
    zip: contact?.addresses?.billing?.[0]?.zip ?? '',
    city: contact?.addresses?.billing?.[0]?.city ?? '',
    country: contact?.addresses?.billing?.[0]?.countryCode === 'AT'
      ? 'Österreich'
      : contact?.addresses?.billing?.[0]?.countryCode === 'CH'
        ? 'Schweiz'
        : 'Deutschland',
    taxId: '',
    lexofficeContactId: detail.address?.contactId,
    notes: '',
  })
  customers.push(created)
  return created
}

function summarizeConfidence(positions: LexofficeImportPosition[]) {
  if (positions.length === 0) return 'low'
  if (positions.every(position => position.confidence === 'high')) return 'high'
  if (positions.some(position => position.confidence === 'medium' || position.confidence === 'high')) return 'medium'
  return 'low'
}

function buildReviewReason(args: {
  positions: LexofficeImportPosition[]
  isStorno: boolean
  referencedInvoiceNumber?: string
}) {
  const reasons = new Set<string>()
  if (args.isStorno) {
    if (!args.referencedInvoiceNumber) reasons.add('Storno ohne erkennbare Referenzrechnung')
    else reasons.add(`Storno prüfen: ${args.referencedInvoiceNumber}`)
  }

  const bookingPositions = args.positions.filter(position => position.positionType === 'booking')
  if (bookingPositions.length === 0) reasons.add('Keine buchbare Objektposition erkannt')

  for (const position of bookingPositions) {
    if (!position.propertyId) reasons.add('Objekt konnte nicht eindeutig erkannt werden')
    if (!position.checkIn || !position.checkOut) reasons.add('Zeitraum konnte nicht eindeutig erkannt werden')
    if (position.confidence !== 'high') reasons.add('Mindestens eine Position hat keine hohe Sicherheit')
  }

  for (const position of args.positions.filter(position => position.positionType === 'cleaning')) {
    if (!position.assignedPropertyId) reasons.add('Endreinigung konnte keiner Wohnung eindeutig zugeordnet werden')
  }

  return [...reasons].join(' · ')
}

function evaluateQueue(args: {
  positions: LexofficeImportPosition[]
  isStorno: boolean
  referencedInvoiceNumber?: string
}) {
  return {
    confidence: summarizeConfidence(args.positions),
    reviewReason: buildReviewReason(args),
    canImport: canAutoImport(args.positions, args.isStorno) || (args.isStorno && Boolean(args.referencedInvoiceNumber)),
  }
}

function canAutoImport(positions: LexofficeImportPosition[], isStorno: boolean) {
  if (isStorno) return false
  const bookingPositions = positions.filter(position => position.positionType === 'booking')
  if (bookingPositions.length === 0) return false
  return positions.every(position => {
    if (position.positionType === 'booking') {
      return Boolean(position.propertyId && position.checkIn && position.checkOut && position.confidence === 'high')
    }
    return Boolean(position.assignedPropertyId)
  })
}

function normalizeQueuePositions(positions: LexofficeImportPosition[]) {
  return positions.map(position => {
    if (position.positionType === 'booking') {
      const hasProperty = Boolean(position.propertyId)
      const hasDates = Boolean(position.checkIn && position.checkOut)
      return {
        ...position,
        confidence: hasProperty && hasDates ? 'high' : hasProperty || hasDates ? 'medium' : 'low',
      } satisfies LexofficeImportPosition
    }

    return {
      ...position,
      confidence: position.assignedPropertyId ? 'high' : (position.lineAmount != null ? 'medium' : 'low'),
    } satisfies LexofficeImportPosition
  })
}

async function markReferencedBookingsAsStorno(args: {
  bookings: Booking[]
  referencedInvoiceNumber?: string
  voucherNumber?: string
}) {
  const { bookings, referencedInvoiceNumber, voucherNumber } = args
  if (!referencedInvoiceNumber) return 0
  const affected = bookings.filter(
    booking => booking.invoiceNumber === referencedInvoiceNumber && booking.status !== 'storniert',
  )
  for (const booking of affected) {
    const updated = await updateBookingServer(booking.id, {
      status: 'storniert',
      paymentStatus: 'erstattet',
      notes: [(booking.notes ?? '').trim(), `Storniert durch ${voucherNumber ?? 'Lexoffice-Storno'}`].filter(Boolean).join('\n'),
    })
    const index = bookings.findIndex(entry => entry.id === booking.id)
    if (index >= 0) bookings[index] = updated
  }
  return affected.length
}

async function markVoucherBookingsAsVoided(args: {
  bookings: Booking[]
  voucherId: string
}) {
  const affected = args.bookings.filter(
    booking => booking.lexofficeInvoiceId === args.voucherId && booking.status !== 'storniert',
  )
  for (const booking of affected) {
    const updated = await updateBookingServer(booking.id, {
      status: 'storniert',
      paymentStatus: 'erstattet',
      notes: [(booking.notes ?? '').trim(), 'Storniert (Beleg in Lexoffice storniert)'].filter(Boolean).join('\n'),
    })
    const index = args.bookings.findIndex(entry => entry.id === booking.id)
    if (index >= 0) args.bookings[index] = updated
  }
  return affected.length
}

async function autoImportVoucher(args: {
  voucher: LexVoucherListItem
  detail: LexInvoice
  positions: LexofficeImportPosition[]
  customers: Customer[]
  contacts: LexContact[]
  properties: Property[]
  bookings: Booking[]
}) {
  const { voucher, detail, positions, customers, contacts, properties, bookings } = args
  const customer = await ensureCustomer({ customers, contacts, detail, voucher })
  const createdIds: string[] = []

  for (const position of positions) {
    if (position.positionType !== 'booking') continue
    const property = properties.find(entry => entry.id === position.propertyId)
    if (!property || !position.checkIn || !position.checkOut) {
      throw new Error('Position ist nicht vollständig für den Auto-Import vorbereitet.')
    }

    const pendingCleanings = positions.filter(cleaning =>
      cleaning.positionType === 'cleaning'
      && cleaning.assignedPropertyId === position.propertyId,
    )
    const cleaningFee = pendingCleanings.reduce((sum, entry) => sum + (entry.lineAmount ?? 0), 0)
    const nights = position.nights ?? Math.max(
      0,
      Math.round((new Date(position.checkOut).getTime() - new Date(position.checkIn).getTime()) / 86400000),
    )
    const bedsBooked = property.beds ?? position.bedsBooked ?? 1
    const bookingNet = position.lineAmount ?? voucher.totalAmount ?? 0
    const totalPrice = bookingNet + cleaningFee
    const pricePerBedNight = nights > 0 && bedsBooked > 0
      ? Math.round((bookingNet / (nights * bedsBooked)) * 100) / 100
      : 0

    const booking = await addBookingServer({
      propertyId: property.id,
      customerId: customer.id,
      checkIn: position.checkIn,
      checkOut: position.checkOut,
      nights,
      bedsBooked,
      pricePerBedNight,
      cleaningFee,
      totalPrice,
      status: voucher.voucherStatus === 'paidoff' || voucher.voucherStatus === 'paid' ? 'abgeschlossen' : 'bestaetigt',
      paymentStatus: voucher.voucherStatus === 'paidoff' ? 'bezahlt' : voucher.voucherStatus === 'paid' ? 'teilweise' : 'offen',
      notes: position.rawText,
      lexofficeInvoiceId: voucher.id,
      invoiceNumber: voucher.voucherNumber,
      source: 'lexoffice_import',
    })
    bookings.push(booking)
    createdIds.push(booking.id)
  }

  return { customerId: customer.id, bookingIds: createdIds }
}

async function upsertQueueRow(row: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from('lexoffice_import_queue').upsert(row, {
    onConflict: 'voucher_id',
  })
  if (error) throw new Error(`Queue-Eintrag konnte nicht gespeichert werden: ${error.message}`)
}

async function updateSyncState(patch: Partial<LexofficeSyncState>) {
  const row = {
    id: SYNC_STATE_ID,
    last_run_at: patch.lastRunAt ?? null,
    last_success_at: patch.lastSuccessAt ?? null,
    last_error: patch.lastError ?? '',
    last_summary: patch.lastSummary ?? {},
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabaseAdmin.from('lexoffice_sync_state').upsert(row, { onConflict: 'id' })
  if (error) throw new Error(`Sync-Status konnte nicht gespeichert werden: ${error.message}`)
}

export async function getLexofficeSyncState(): Promise<LexofficeSyncState> {
  const { data, error } = await supabaseAdmin.from('lexoffice_sync_state').select('*').eq('id', SYNC_STATE_ID).maybeSingle()
  if (error) throw new Error(`Sync-Status konnte nicht geladen werden: ${error.message}`)
  if (!data) return {}
  return {
    lastRunAt: data.last_run_at ?? undefined,
    lastSuccessAt: data.last_success_at ?? undefined,
    lastError: data.last_error ?? '',
    lastSummary: data.last_summary ?? undefined,
  }
}

export async function listLexofficeImportQueue(limit = 20) {
  const { data, error } = await supabaseAdmin
    .from('lexoffice_import_queue')
    .select('*')
    .in('import_status', ['pending_review', 'error'])
    .order('last_seen_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Import-Queue konnte nicht geladen werden: ${error.message}`)
  return (data ?? []).map(entry => toQueueItem(entry as QueueRow))
}

export async function getLexofficeImportOverview(limit = 12) {
  const [queueItems, state, countsResponse] = await Promise.all([
    listLexofficeImportQueue(limit),
    getLexofficeSyncState(),
    supabaseAdmin.from('lexoffice_import_queue').select('import_status', { count: 'exact', head: false }),
  ])

  const counts = {
    pendingReview: 0,
    autoImported: 0,
    duplicates: 0,
    errors: 0,
  }
  for (const row of countsResponse.data ?? []) {
    const status = row.import_status as LexofficeImportStatus
    if (status === 'pending_review') counts.pendingReview += 1
    if (status === 'auto_imported') counts.autoImported += 1
    if (status === 'duplicate') counts.duplicates += 1
    if (status === 'error') counts.errors += 1
  }

  return {
    state,
    counts,
    items: queueItems,
  }
}

export async function getLexofficeImportQueueItem(voucherId: string) {
  const { data, error } = await supabaseAdmin
    .from('lexoffice_import_queue')
    .select('*')
    .eq('voucher_id', voucherId)
    .maybeSingle()

  if (error) throw new Error(`Queue-Eintrag konnte nicht geladen werden: ${error.message}`)
  if (!data) throw new Error('Queue-Eintrag wurde nicht gefunden.')
  return toQueueItem(data as QueueRow)
}

export async function updateLexofficeImportQueueItem(args: {
  voucherId: string
  positions: LexofficeImportPosition[]
}) {
  const item = await getLexofficeImportQueueItem(args.voucherId)
  const normalizedPositions = normalizeQueuePositions(args.positions)
  const voucher = fromQueueItemToVoucher(item)
  const detail = (item.detail ?? {}) as unknown as LexInvoice
  const referencedInvoiceNumber = extractReferencedInvoiceNumber(voucher, detail, item.isStorno)
  const evaluation = evaluateQueue({
    positions: normalizedPositions,
    isStorno: item.isStorno,
    referencedInvoiceNumber,
  })

  await upsertQueueRow({
    voucher_id: item.voucherId,
    voucher_number: item.voucherNumber,
    voucher_type: item.voucherType,
    voucher_status: item.voucherStatus,
    voucher_date: item.voucherDate,
    contact_name: item.contactName,
    lexoffice_contact_id: item.lexofficeContactId ?? '',
    total_amount: item.totalAmount,
    currency: item.currency,
    is_storno: item.isStorno,
    confidence: evaluation.confidence,
    import_status: 'pending_review',
    review_reason: evaluation.reviewReason,
    detail_payload: item.detail ?? {},
    positions_payload: normalizedPositions,
    suggested_customer_id: item.suggestedCustomerId || null,
    booking_ids: item.bookingIds,
    error_message: '',
    created_at: item.createdAt,
    updated_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    imported_at: item.importedAt ?? null,
  })

  return getLexofficeImportQueueItem(args.voucherId)
}

export async function importLexofficeImportQueueItem(voucherId: string) {
  const item = await getLexofficeImportQueueItem(voucherId)
  const voucher = fromQueueItemToVoucher(item)
  const detail = (item.detail ?? {}) as unknown as LexInvoice
  const referencedInvoiceNumber = extractReferencedInvoiceNumber(voucher, detail, item.isStorno)
  const evaluation = evaluateQueue({
    positions: item.positions,
    isStorno: item.isStorno,
    referencedInvoiceNumber,
  })

  if (!evaluation.canImport) {
    throw new Error(evaluation.reviewReason || 'Der Queue-Eintrag ist noch nicht vollständig genug für den Import.')
  }

  const [properties, customers, bookings, contacts] = await Promise.all([
    loadPropertiesServer(),
    loadCustomersServer(),
    loadBookingsServer(),
    getAllContacts(),
  ])
  const existingBookings = bookings.filter(booking => booking.lexofficeInvoiceId === item.voucherId)
  if (existingBookings.length > 0) {
    await upsertQueueRow({
      voucher_id: item.voucherId,
      voucher_number: item.voucherNumber,
      voucher_type: item.voucherType,
      voucher_status: item.voucherStatus,
      voucher_date: item.voucherDate,
      contact_name: item.contactName,
      lexoffice_contact_id: item.lexofficeContactId ?? '',
      total_amount: item.totalAmount,
      currency: item.currency,
      is_storno: item.isStorno,
      confidence: evaluation.confidence,
      import_status: 'duplicate',
      review_reason: 'Beleg ist bereits als Buchung im System vorhanden',
      detail_payload: item.detail ?? {},
      positions_payload: item.positions,
      suggested_customer_id: item.suggestedCustomerId || null,
      booking_ids: existingBookings.map(booking => booking.id),
      error_message: '',
      created_at: item.createdAt,
      updated_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      imported_at: item.importedAt ?? new Date().toISOString(),
    })
    return getLexofficeImportQueueItem(voucherId)
  }

  let bookingIds: string[] = []
  let reviewReason = item.reviewReason

  if (item.isStorno) {
    const updated = await markReferencedBookingsAsStorno({
      bookings,
      referencedInvoiceNumber,
      voucherNumber: item.voucherNumber,
    })
    if (updated === 0) {
      throw new Error('Für dieses Storno wurde keine passende importierte Ursprungsrechnung gefunden.')
    }
    reviewReason = `Manuell importiert: Storno auf ${updated} Buchung(en) angewendet`
  } else {
    const imported = await autoImportVoucher({
      voucher,
      detail,
      positions: item.positions,
      customers,
      contacts,
      properties,
      bookings,
    })
    bookingIds = imported.bookingIds
    reviewReason = 'Manuell importiert'
  }

  await upsertQueueRow({
    voucher_id: item.voucherId,
    voucher_number: item.voucherNumber,
    voucher_type: item.voucherType,
    voucher_status: item.voucherStatus,
    voucher_date: item.voucherDate,
    contact_name: item.contactName,
    lexoffice_contact_id: item.lexofficeContactId ?? '',
    total_amount: item.totalAmount,
    currency: item.currency,
    is_storno: item.isStorno,
    confidence: evaluation.confidence,
    import_status: 'auto_imported',
    review_reason: reviewReason,
    detail_payload: item.detail ?? {},
    positions_payload: item.positions,
    suggested_customer_id: item.suggestedCustomerId || null,
    booking_ids: bookingIds,
    error_message: '',
    created_at: item.createdAt,
    updated_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    imported_at: new Date().toISOString(),
  })

  return getLexofficeImportQueueItem(voucherId)
}

export async function runLexofficeSync() {
  const startedAt = new Date().toISOString()
  const previousState = await getLexofficeSyncState()
  const summary: SyncSummary = {
    scanned: 0,
    pendingReview: 0,
    autoImported: 0,
    duplicates: 0,
    errors: 0,
    stornoUpdated: 0,
  }

  await updateSyncState({ lastRunAt: startedAt, lastError: '', lastSummary: summary })

  try {
    const lookbackDays = getLookbackDays()
    const now = new Date()
    const lastSuccessAt = parseLexofficeTimestamp(previousState.lastSuccessAt)
    const changedSince = lastSuccessAt
      ? lastSuccessAt
      : new Date(now.getTime() - lookbackDays * 86400000)
    const isInitialSync = !lastSuccessAt
    const dateTo = isInitialSync ? now.toISOString().slice(0, 10) : undefined
    const dateFrom = isInitialSync ? new Date(now.getTime() - lookbackDays * 86400000).toISOString().slice(0, 10) : undefined
    const [properties, customers, bookings, contacts] = await Promise.all([
      loadPropertiesServer(),
      loadCustomersServer(),
      loadBookingsServer(),
      getAllContacts(),
    ])
    const allVouchers = await loadAllSyncVouchers(dateFrom, dateTo)
    const vouchers = isInitialSync
      ? allVouchers
      : allVouchers.filter(voucher => hasVoucherChangedSince(voucher, changedSince))
    summary.scanned = vouchers.length

    for (const voucher of vouchers) {
      await rateLimitedDelay()
      try {
        const detail = await getVoucherDetail(voucher)
        const positions = buildImportPositions(detail, properties)
        const isStorno = isStornoVoucher(voucher)
        const referencedInvoiceNumber = extractReferencedInvoiceNumber(voucher, detail, isStorno)
        const confidence = summarizeConfidence(positions)
        const existingCustomer = matchExistingCustomer({
          customers,
          addressName: (detail.address?.name ?? voucher.contactName ?? 'Unbekannt').trim(),
          contactId: detail.address?.contactId,
        })
        const existingBookings = bookings.filter(booking => booking.lexofficeInvoiceId === voucher.id)

        let importStatus: LexofficeImportStatus = 'pending_review'
        let reviewReason = buildReviewReason({ positions, isStorno, referencedInvoiceNumber })
        let bookingIds: string[] = existingBookings.map(booking => booking.id)
        let importedAt: string | null = null

        if (existingBookings.length > 0) {
          importStatus = 'duplicate'
          reviewReason = 'Beleg ist bereits als Buchung im System vorhanden'
          summary.duplicates += 1
          if (voucher.voucherStatus === 'voided') {
            summary.stornoUpdated += await markVoucherBookingsAsVoided({ bookings, voucherId: voucher.id })
          }
        } else if (isStorno) {
          const updated = await markReferencedBookingsAsStorno({
            bookings,
            referencedInvoiceNumber,
            voucherNumber: voucher.voucherNumber,
          })
          if (updated > 0) {
            importStatus = 'auto_imported'
            reviewReason = `Storno automatisch auf ${updated} Buchung(en) angewendet`
            summary.autoImported += 1
            summary.stornoUpdated += updated
            importedAt = new Date().toISOString()
          } else {
            importStatus = 'pending_review'
            summary.pendingReview += 1
          }
        } else if (canAutoImport(positions, isStorno)) {
          const imported = await autoImportVoucher({
            voucher,
            detail,
            positions,
            customers,
            contacts,
            properties,
            bookings,
          })
          importStatus = 'auto_imported'
          reviewReason = 'Automatisch importiert (hohe Sicherheit)'
          bookingIds = imported.bookingIds
          importedAt = new Date().toISOString()
          summary.autoImported += 1
        } else {
          importStatus = 'pending_review'
          summary.pendingReview += 1
        }

        await upsertQueueRow({
          voucher_id: voucher.id,
          voucher_number: voucher.voucherNumber ?? '',
          voucher_type: voucher.voucherType ?? 'invoice',
          voucher_status: voucher.voucherStatus ?? '',
          voucher_date: voucher.voucherDate ?? '',
          contact_name: voucher.contactName ?? detail.address?.name ?? '',
          lexoffice_contact_id: detail.address?.contactId ?? '',
          total_amount: voucher.totalAmount ?? 0,
          currency: voucher.currency ?? 'EUR',
          is_storno: isStorno,
          confidence,
          import_status: importStatus,
          review_reason: reviewReason,
          detail_payload: detail,
          positions_payload: positions,
          suggested_customer_id: existingCustomer?.id ?? null,
          booking_ids: bookingIds,
          error_message: '',
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          imported_at: importedAt,
        })
      } catch (error) {
        summary.errors += 1
        const message = error instanceof Error ? error.message : String(error)
        await upsertQueueRow({
          voucher_id: voucher.id,
          voucher_number: voucher.voucherNumber ?? '',
          voucher_type: voucher.voucherType ?? 'invoice',
          voucher_status: voucher.voucherStatus ?? '',
          voucher_date: voucher.voucherDate ?? '',
          contact_name: voucher.contactName ?? '',
          lexoffice_contact_id: voucher.contactId ?? '',
          total_amount: voucher.totalAmount ?? 0,
          currency: voucher.currency ?? 'EUR',
          is_storno: isStornoVoucher(voucher),
          confidence: 'low',
          import_status: 'error',
          review_reason: 'Fehler beim automatischen Verarbeiten',
          detail_payload: {},
          positions_payload: [],
          suggested_customer_id: null,
          booking_ids: [],
          error_message: message,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          imported_at: null,
        })
      }
    }

    await updateSyncState({
      lastRunAt: startedAt,
      lastSuccessAt: new Date().toISOString(),
      lastError: '',
      lastSummary: summary,
    })

    return {
      ok: true,
      ...summary,
      changedSince: changedSince.toISOString(),
      dateFrom: dateFrom ?? null,
      dateTo: dateTo ?? null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await updateSyncState({
      lastRunAt: startedAt,
      lastError: message,
      lastSummary: summary,
    })
    throw error
  }
}
