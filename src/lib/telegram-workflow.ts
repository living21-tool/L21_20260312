import 'server-only'

import { checkAvailability, loadLocations } from '@/lib/availability-service'
import { parseAvailabilityMessage } from '@/lib/availability-message-parser'
import { createTelegramAvailabilityMessage } from '@/lib/availability-response'
import {
  addBookingServer,
  findCustomersByQuery,
  getCustomerById,
} from '@/lib/booking-data-service'
import {
  buildBookingInsertInputs,
  buildInvoiceLinesFromAllocation,
  buildLexofficeInvoicePayload,
  calculateInvoiceFormTotals,
  createInitialInvoiceForm,
  inferCountryCode,
  type DraftInvoiceState,
  type InvoiceFormState,
  type InvoiceLineItem,
} from '@/lib/booking-workflow'
import { createInvoice, getInvoice } from '@/lib/lexoffice'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { BookingStatus, Customer } from '@/lib/types'

type TelegramConversationStage =
  | 'idle'
  | 'awaiting_create_decision'
  | 'awaiting_customer'
  | 'awaiting_price'
  | 'awaiting_discount'
  | 'awaiting_cleaning'
  | 'awaiting_tax_rate'
  | 'awaiting_payment_term'
  | 'awaiting_draft_confirmation'
  | 'draft_created'
  | 'awaiting_booking_confirmation'
  | 'bookings_created'

type TelegramDraftRequest = {
  locationId: string
  locationName: string
  checkIn: string
  checkOut: string
  bedsNeeded: number
  originalText: string
}

type TelegramConversationState = {
  stage: TelegramConversationStage
  request?: TelegramDraftRequest
  invoiceLines?: InvoiceLineItem[]
  invoiceForm?: InvoiceFormState
  customerId?: string
  bookingStatus?: BookingStatus
  draftInvoice?: DraftInvoiceState
  createdBookingIds?: string[]
}

type ConversationRow = {
  id: string
  chat_id: string
  state: TelegramConversationState
  updated_at: string
  created_at: string
}

type HandlerResult = {
  reply: string
  handled: boolean
}

function defaultState(): TelegramConversationState {
  return {
    stage: 'idle',
    bookingStatus: 'bestaetigt',
  }
}

function normalize(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('de-DE')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function isYes(value: string) {
  return ['ja', 'j', 'yes', 'y', 'ok', 'okay', 'gern', 'bitte', 'machen'].includes(normalize(value))
}

function isNo(value: string) {
  return ['nein', 'n', 'no', 'stop', 'abbrechen', 'nicht'].includes(normalize(value))
}

function isSkip(value: string) {
  return ['weiter', 'uebernehmen', 'übernehmen', 'skip', 'weiter so', 'passt', 'standard'].includes(normalize(value))
}

function looksLikeAvailabilityRequest(value: string) {
  const normalized = normalize(value)
  const hasBeds = /\b\d+\s*bett/.test(normalized) || normalized.includes(' betten')
  const hasFree = normalized.includes('frei')
  const hasDateSignal =
    normalized.includes('von ') ||
    normalized.includes('bis ') ||
    /\d{1,2}\.\d{1,2}\.\d{2,4}/.test(normalized) ||
    /\d{4}-\d{2}-\d{2}/.test(normalized)

  return hasBeds && hasFree && hasDateSignal
}

function parseNumberFromText(value: string): number | null {
  const match = value.match(/-?\d+(?:[.,]\d+)?/)
  if (!match) return null
  return Number(match[0].replace(',', '.'))
}

function formatMoney(value: number) {
  return `${value.toFixed(2)} EUR`
}

function buildHelpMessage() {
  return [
    'Ich führe dich Schritt für Schritt durch Buchung und Rechnungsentwurf.',
    '',
    '<b>Ablauf</b>',
    '1. Sende eine Verfügbarkeitsanfrage',
    '2. Ich antworte zuerst mit der Verfügbarkeit',
    '3. Danach frage ich, ob ich für diese Verfügbarkeit weiterarbeiten soll',
    '4. Dann frage ich Auftraggeber, Preis, Rabatt, Reinigung, Steuersatz und Zahlungsziel ab',
    '5. Danach fasse ich alles zusammen und frage nach dem Lexoffice-Entwurf',
    '',
    '<b>Befehle</b>',
    '/neu - neuen Vorgang starten',
    '/status - aktuellen Stand anzeigen',
    '/abbrechen - Vorgang verwerfen',
  ].join('\n')
}

function buildBookingPricePrompt(invoiceForm: InvoiceFormState) {
  const bookingLines = invoiceForm.lines.filter(line => line.kind === 'booking')
  const priceSummary = bookingLines.map(line => `${line.name}: ${formatMoney(line.unitPriceNet)}`).join(', ')

  return [
    'Wie soll der Bettenpreis sein?',
    `Aktuell: ${priceSummary || 'kein Preis gefunden'}`,
    'Antworte mit einer Zahl wie <code>30</code> oder mit <code>übernehmen</code>.',
  ].join('\n')
}

function buildCleaningPrompt(invoiceForm: InvoiceFormState) {
  const cleaningLines = invoiceForm.lines.filter(line => line.kind === 'cleaning')
  if (cleaningLines.length === 0) {
    return 'Für diese Anfrage gibt es keine Reinigungsposition. Antworte mit <code>übernehmen</code>, dann frage ich direkt den Steuersatz.'
  }

  const cleaningSummary = cleaningLines.map(line => `${line.name}: ${formatMoney(line.unitPriceNet)}`).join(', ')
  return [
    'Soll eine Endreinigung mit rein?',
    `Aktuell: ${cleaningSummary}`,
    'Antworte mit einer Zahl wie <code>45</code>, mit <code>übernehmen</code> oder mit <code>0</code>.',
  ].join('\n')
}

function buildTaxRatePrompt(invoiceForm: InvoiceFormState) {
  const taxRates = Array.from(
    new Set(invoiceForm.lines.filter(line => line.kind !== 'text').map(line => line.taxRate)),
  )

  return [
    'Welcher Steuersatz soll gelten?',
    `Aktuell: ${taxRates.join(', ') || 0}%`,
    'Antworte mit <code>0</code>, <code>7</code> oder <code>19</code>.',
  ].join('\n')
}

function formatInvoiceFormSummary(state: TelegramConversationState, customer?: Customer | null) {
  const request = state.request
  const invoiceForm = state.invoiceForm
  if (!request || !invoiceForm) {
    return 'Noch kein aktiver Vorgang.'
  }

  const totals = calculateInvoiceFormTotals(invoiceForm.lines, invoiceForm.totalDiscountPercentage)
  const linePreview = invoiceForm.lines
    .filter(line => line.kind !== 'text')
    .map(line => `- ${line.name}: ${line.quantity} ${line.unitName} × ${formatMoney(line.unitPriceNet)} · ${line.taxRate}%`)
    .slice(0, 12)

  return [
    '<b>Aktueller Stand</b>',
    '',
    `<b>Standort:</b> ${request.locationName}`,
    `<b>Zeitraum:</b> ${request.checkIn} bis ${request.checkOut}`,
    `<b>Betten:</b> ${request.bedsNeeded}`,
    `<b>Auftraggeber:</b> ${customer?.companyName ?? 'noch nicht gesetzt'}`,
    `<b>Zahlungsziel:</b> ${invoiceForm.paymentTermDays} Tage`,
    `<b>Rabatt:</b> ${invoiceForm.totalDiscountPercentage || 0}%`,
    '',
    '<b>Positionen</b>',
    ...linePreview,
    '',
    `<b>Summen:</b> Netto ${formatMoney(totals.totalNet)} · Steuer ${formatMoney(totals.totalTax)} · Brutto ${formatMoney(totals.totalGross)}`,
    state.draftInvoice
      ? `<b>Lexoffice:</b> ${state.draftInvoice.voucherNumber ?? state.draftInvoice.id} (${state.draftInvoice.voucherStatus ?? 'draft'})`
      : '<b>Lexoffice:</b> noch kein Entwurf',
  ].join('\n')
}

function setAllLinePrices(state: TelegramConversationState, lineKind: 'booking' | 'cleaning', amount: number) {
  if (!state.invoiceForm) {
    throw new Error('Es gibt noch keinen aktiven Vorgang.')
  }

  let changed = false
  state.invoiceForm = {
    ...state.invoiceForm,
    lines: state.invoiceForm.lines.map(line => {
      if (line.kind !== lineKind) return line
      changed = true
      return {
        ...line,
        unitPriceNet: amount,
      }
    }),
  }

  if (!changed && lineKind === 'cleaning') {
    return
  }
  if (!changed) {
    throw new Error('Es wurden keine passenden Positionen gefunden.')
  }

  state.draftInvoice = undefined
}

function setAllTaxRates(state: TelegramConversationState, taxRate: 0 | 7 | 19) {
  if (!state.invoiceForm) {
    throw new Error('Es gibt noch keinen aktiven Vorgang.')
  }

  state.invoiceForm = {
    ...state.invoiceForm,
    lines: state.invoiceForm.lines.map(line => (
      line.kind === 'text'
        ? line
        : {
            ...line,
            taxRate,
          }
    )),
  }

  state.draftInvoice = undefined
}

async function loadConversation(chatId: number | string): Promise<ConversationRow | null> {
  const { data, error } = await supabaseAdmin
    .from('telegram_conversations')
    .select('*')
    .eq('chat_id', String(chatId))
    .maybeSingle()

  if (error) throw new Error(`Telegram-Konversation konnte nicht geladen werden: ${error.message}`)
  return data as ConversationRow | null
}

async function saveConversation(chatId: number | string, state: TelegramConversationState) {
  const now = new Date().toISOString()
  const row = {
    id: `tg-${String(chatId)}`,
    chat_id: String(chatId),
    state,
    updated_at: now,
    created_at: now,
  }

  const { error } = await supabaseAdmin
    .from('telegram_conversations')
    .upsert(row, { onConflict: 'chat_id' })

  if (error) throw new Error(`Telegram-Konversation konnte nicht gespeichert werden: ${error.message}`)
}

async function resetConversation(chatId: number | string) {
  await saveConversation(chatId, defaultState())
}

async function handleAvailabilityStart(chatId: number | string, text: string): Promise<HandlerResult> {
  const locations = await loadLocations()
  const parsedRequest = parseAvailabilityMessage(text, locations)
  const result = await checkAvailability(parsedRequest)
  const availabilityReply = createTelegramAvailabilityMessage(result, parsedRequest)

  if (!result.allocation.success || result.allocation.allocations.length === 0) {
    await resetConversation(chatId)
    return {
      handled: true,
      reply: availabilityReply,
    }
  }

  const invoiceLines = buildInvoiceLinesFromAllocation({
    requestId: `tg-${Date.now()}`,
    locationName: result.location.name,
    checkIn: parsedRequest.checkIn,
    checkOut: parsedRequest.checkOut,
    allocations: result.allocation.allocations,
  })

  const invoiceForm = createInitialInvoiceForm({
    customer: undefined,
    invoiceLines,
    notes: `Telegram-Anfrage: ${parsedRequest.originalText}`,
    defaultTaxRate: 0,
    totalDiscountPercentage: 0,
    fallbackCountryCode: 'DE',
  })

  const state: TelegramConversationState = {
    stage: 'awaiting_create_decision',
    request: {
      locationId: result.location.id,
      locationName: result.location.name,
      checkIn: parsedRequest.checkIn,
      checkOut: parsedRequest.checkOut,
      bedsNeeded: parsedRequest.bedsNeeded,
      originalText: parsedRequest.originalText,
    },
    invoiceLines,
    invoiceForm,
    bookingStatus: 'bestaetigt',
  }

  await saveConversation(chatId, state)

  return {
    handled: true,
    reply: [
      availabilityReply,
      '',
      'Willst du für diese Verfügbarkeit eine Buchung bzw. einen Rechnungsentwurf erstellen?',
      'Antworte mit <code>Ja</code> oder <code>Nein</code>.',
    ].join('\n'),
  }
}

async function selectCustomer(state: TelegramConversationState, query: string) {
  const matches = await findCustomersByQuery(query, 5)
  if (matches.length === 0) {
    return {
      state,
      reply: 'Ich habe keinen passenden Auftraggeber mit Lexoffice-Kontakt-ID gefunden. Wie heißt der Auftraggeber genau?',
    }
  }

  if (matches.length > 1 && normalize(matches[0].companyName) !== normalize(query)) {
    return {
      state,
      reply: [
        'Ich habe mehrere Auftraggeber gefunden.',
        ...matches.map(customer => `- ${customer.companyName}${customer.city ? ` (${customer.city})` : ''}`),
        '',
        'Wie heißt der Auftraggeber genau?',
      ].join('\n'),
    }
  }

  const customer = matches[0]
  if (!state.invoiceLines) {
    throw new Error('Es gibt noch keine vorbereiteten Rechnungspositionen.')
  }

  const invoiceForm = createInitialInvoiceForm({
    customer,
    invoiceLines: state.invoiceLines,
    notes: state.invoiceForm?.remark ?? state.request?.originalText ?? '',
    defaultTaxRate: state.invoiceForm?.lines.find(line => line.kind !== 'text')?.taxRate ?? 0,
    totalDiscountPercentage: state.invoiceForm?.totalDiscountPercentage ?? 0,
    fallbackCountryCode: inferCountryCode(customer),
  })

  if (state.invoiceForm) {
    invoiceForm.lines = state.invoiceForm.lines
    invoiceForm.paymentTermDays = state.invoiceForm.paymentTermDays
    invoiceForm.totalDiscountPercentage = state.invoiceForm.totalDiscountPercentage
    invoiceForm.title = state.invoiceForm.title
    invoiceForm.introduction = customer.companyName ? `Rechnung für ${customer.companyName}` : state.invoiceForm.introduction
    invoiceForm.remark = state.invoiceForm.remark
  }

  state.customerId = customer.id
  state.invoiceForm = {
    ...invoiceForm,
    customerName: customer.companyName || invoiceForm.customerName,
    addressSupplement: invoiceForm.addressSupplement || `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim(),
    street: invoiceForm.street || customer.address || '',
    zip: invoiceForm.zip || customer.zip || '',
    city: invoiceForm.city || customer.city || '',
    countryCode: invoiceForm.countryCode || inferCountryCode(customer),
  }
  state.stage = 'awaiting_price'
  state.draftInvoice = undefined

  return {
    state,
    reply: [
      `Auftraggeber gesetzt: <b>${customer.companyName}</b>`,
      '',
      buildBookingPricePrompt(state.invoiceForm),
    ].join('\n'),
  }
}

async function createDraftForState(state: TelegramConversationState) {
  if (!state.customerId || !state.invoiceForm) {
    throw new Error('Bitte zuerst den Auftraggeber festlegen.')
  }

  const customer = await getCustomerById(state.customerId)
  if (!customer?.lexofficeContactId) {
    throw new Error('Der Auftraggeber hat keine Lexoffice-Kontakt-ID.')
  }

  const payload = buildLexofficeInvoicePayload({
    customer,
    invoiceForm: state.invoiceForm,
    fallbackCountryCode: inferCountryCode(customer),
  })

  const createResult = await createInvoice(payload, false)
  let voucherNumber: string | undefined
  let voucherStatus: string | undefined

  try {
    const detail = await getInvoice(createResult.id)
    voucherNumber = detail.voucherNumber
    voucherStatus = detail.voucherStatus
  } catch {
    // optional
  }

  state.draftInvoice = {
    id: createResult.id,
    voucherNumber,
    voucherStatus,
    lexofficeUrl: `https://app.lexoffice.de/vouchers#!/VoucherList/?filter=lastedited&sort=sortByLastModifiedDate&query=${encodeURIComponent(voucherNumber || createResult.id)}`,
  }
  state.stage = 'awaiting_booking_confirmation'

  return state.draftInvoice
}

async function createBookingsForState(state: TelegramConversationState) {
  if (!state.customerId || !state.invoiceForm || !state.invoiceLines || !state.request) {
    throw new Error('Der Vorgang ist noch nicht vollständig.')
  }
  if (!state.draftInvoice) {
    throw new Error('Bitte zuerst den Lexoffice-Entwurf anlegen.')
  }

  const bookingInputs = buildBookingInsertInputs({
    customerId: state.customerId,
    bookingStatus: state.bookingStatus ?? 'bestaetigt',
    invoiceLines: state.invoiceLines,
    invoiceForm: state.invoiceForm,
    draftInvoice: state.draftInvoice,
    locationName: state.request.locationName,
    bedsNeeded: state.request.bedsNeeded,
  })

  const created = []
  for (const input of bookingInputs) {
    const booking = await addBookingServer(input)
    created.push(booking.id)
  }

  state.createdBookingIds = created
  state.stage = 'bookings_created'
  return created.length
}

async function handleCreateDecision(chatId: number | string, state: TelegramConversationState, text: string): Promise<HandlerResult> {
  if (isYes(text)) {
    state.stage = 'awaiting_customer'
    await saveConversation(chatId, state)
    return {
      handled: true,
      reply: 'Wie heißt der Auftraggeber? Bitte sende einfach den Firmennamen.',
    }
  }

  if (isNo(text)) {
    await resetConversation(chatId)
    return {
      handled: true,
      reply: 'Okay, dann habe ich nur die Verfügbarkeit geprüft. Wenn du neu starten willst, sende einfach die nächste Anfrage.',
    }
  }

  return {
    handled: true,
    reply: 'Bitte antworte mit <code>Ja</code> oder <code>Nein</code>. Willst du für diese Verfügbarkeit weiterarbeiten?',
  }
}

async function handlePriceStep(chatId: number | string, state: TelegramConversationState, text: string): Promise<HandlerResult> {
  if (!state.invoiceForm) {
    throw new Error('Es gibt noch keinen aktiven Vorgang.')
  }

  if (!isSkip(text)) {
    const amount = parseNumberFromText(text)
    if (amount === null || amount < 0) {
      return {
        handled: true,
        reply: buildBookingPricePrompt(state.invoiceForm),
      }
    }
    setAllLinePrices(state, 'booking', amount)
  }

  state.stage = 'awaiting_discount'
  await saveConversation(chatId, state)
  return {
    handled: true,
    reply: 'Soll ein Rabatt berücksichtigt werden? Antworte mit einer Zahl wie <code>5</code> oder mit <code>nein</code>.',
  }
}

async function handleDiscountStep(chatId: number | string, state: TelegramConversationState, text: string): Promise<HandlerResult> {
  if (!state.invoiceForm) {
    throw new Error('Es gibt noch keinen aktiven Vorgang.')
  }

  if (isNo(text) || isSkip(text)) {
    state.invoiceForm.totalDiscountPercentage = 0
  } else {
    const amount = parseNumberFromText(text)
    if (amount === null || amount < 0 || amount > 100) {
      return {
        handled: true,
        reply: 'Bitte antworte mit einem Rabatt in Prozent wie <code>5</code> oder mit <code>nein</code>.',
      }
    }
    state.invoiceForm.totalDiscountPercentage = amount
  }

  state.stage = 'awaiting_cleaning'
  state.draftInvoice = undefined
  await saveConversation(chatId, state)
  return {
    handled: true,
    reply: buildCleaningPrompt(state.invoiceForm),
  }
}

async function handleCleaningStep(chatId: number | string, state: TelegramConversationState, text: string): Promise<HandlerResult> {
  if (!state.invoiceForm) {
    throw new Error('Es gibt noch keinen aktiven Vorgang.')
  }

  const hasCleaningLines = state.invoiceForm.lines.some(line => line.kind === 'cleaning')
  if (hasCleaningLines && !isSkip(text)) {
    const amount = parseNumberFromText(text)
    if (amount === null || amount < 0) {
      return {
        handled: true,
        reply: buildCleaningPrompt(state.invoiceForm),
      }
    }
    setAllLinePrices(state, 'cleaning', amount)
  }

  state.stage = 'awaiting_tax_rate'
  await saveConversation(chatId, state)
  return {
    handled: true,
    reply: buildTaxRatePrompt(state.invoiceForm),
  }
}

async function handleTaxRateStep(chatId: number | string, state: TelegramConversationState, text: string): Promise<HandlerResult> {
  if (!state.invoiceForm) {
    throw new Error('Es gibt noch keinen aktiven Vorgang.')
  }

  const amount = parseNumberFromText(text)
  if (amount !== 0 && amount !== 7 && amount !== 19) {
    return {
      handled: true,
      reply: buildTaxRatePrompt(state.invoiceForm),
    }
  }

  setAllTaxRates(state, amount as 0 | 7 | 19)
  state.stage = 'awaiting_payment_term'
  await saveConversation(chatId, state)
  return {
    handled: true,
    reply: 'Welches Zahlungsziel soll gelten? Antworte z. B. mit <code>14</code> für 14 Tage.',
  }
}

async function handlePaymentTermStep(chatId: number | string, state: TelegramConversationState, text: string): Promise<HandlerResult> {
  if (!state.invoiceForm) {
    throw new Error('Es gibt noch keinen aktiven Vorgang.')
  }

  const amount = parseNumberFromText(text)
  if (amount === null || amount < 0) {
    return {
      handled: true,
      reply: 'Bitte antworte mit einer Anzahl Tagen, z. B. <code>14</code>.',
    }
  }

  state.invoiceForm.paymentTermDays = Math.round(amount)
  state.stage = 'awaiting_draft_confirmation'
  state.draftInvoice = undefined
  const customer = state.customerId ? await getCustomerById(state.customerId) : null
  await saveConversation(chatId, state)

  return {
    handled: true,
    reply: [
      formatInvoiceFormSummary(state, customer),
      '',
      'Soll ich den Lexoffice-Entwurf jetzt erstellen?',
      'Antworte mit <code>Ja</code> oder <code>Nein</code>.',
    ].join('\n'),
  }
}

async function handleDraftConfirmationStep(chatId: number | string, state: TelegramConversationState, text: string): Promise<HandlerResult> {
  if (isNo(text)) {
    state.stage = 'awaiting_price'
    await saveConversation(chatId, state)
    return {
      handled: true,
      reply: `Okay. Dann passe ich den Vorgang weiter an.\n\n${buildBookingPricePrompt(state.invoiceForm!)}`,
    }
  }

  if (!isYes(text)) {
    return {
      handled: true,
      reply: 'Bitte antworte mit <code>Ja</code> oder <code>Nein</code>. Soll ich den Lexoffice-Entwurf jetzt erstellen?',
    }
  }

  const draft = await createDraftForState(state)
  await saveConversation(chatId, state)
  return {
    handled: true,
    reply: [
      'Lexoffice-Entwurf wurde erstellt.',
      `Beleg: ${draft.voucherNumber ?? draft.id}`,
      draft.voucherStatus ? `Status: ${draft.voucherStatus}` : '',
      draft.lexofficeUrl,
      '',
      'Soll ich jetzt auch die Buchungen anlegen?',
      'Antworte mit <code>Ja</code> oder <code>Nein</code>.',
    ].filter(Boolean).join('\n'),
  }
}

async function handleBookingConfirmationStep(chatId: number | string, state: TelegramConversationState, text: string): Promise<HandlerResult> {
  if (isNo(text)) {
    state.stage = 'draft_created'
    await saveConversation(chatId, state)
    return {
      handled: true,
      reply: 'Okay. Der Lexoffice-Entwurf bleibt bestehen. Wenn du später buchen willst, antworte einfach mit <code>Ja</code> oder sende <code>/status</code>.',
    }
  }

  if (!isYes(text)) {
    return {
      handled: true,
      reply: 'Bitte antworte mit <code>Ja</code> oder <code>Nein</code>. Soll ich jetzt auch die Buchungen anlegen?',
    }
  }

  const createdCount = await createBookingsForState(state)
  await saveConversation(chatId, state)
  return {
    handled: true,
    reply: `${createdCount} Buchung${createdCount === 1 ? '' : 'en'} wurden angelegt und mit dem Lexoffice-Entwurf verknüpft.`,
  }
}

export async function handleTelegramWorkflowMessage(chatId: number | string, text: string): Promise<HandlerResult> {
  const trimmed = text.trim()
  const normalized = normalize(trimmed)
  const row = await loadConversation(chatId)
  const state = row?.state ?? defaultState()

  if (normalized === '/start' || normalized === '/hilfe' || normalized === 'hilfe') {
    return { handled: true, reply: buildHelpMessage() }
  }

  if (normalized === '/abbrechen' || normalized === 'abbrechen') {
    await resetConversation(chatId)
    return { handled: true, reply: 'Der aktuelle Vorgang wurde verworfen.' }
  }

  if (normalized === '/neu' || normalized === 'neu' || normalized === 'neue buchung') {
    await resetConversation(chatId)
    return {
      handled: true,
      reply: 'Neuer Vorgang gestartet. Sende jetzt eine Verfügbarkeitsanfrage wie: Ist von heute bis Donnerstag 5 Betten in Berlin frei?',
    }
  }

  if (normalized === '/status' || normalized === 'status') {
    const customer = state.customerId ? await getCustomerById(state.customerId) : null
    return {
      handled: true,
      reply: formatInvoiceFormSummary(state, customer),
    }
  }

  if (looksLikeAvailabilityRequest(trimmed)) {
    return handleAvailabilityStart(chatId, trimmed)
  }

  if (state.stage === 'idle') {
    return handleAvailabilityStart(chatId, trimmed)
  }

  if (state.stage === 'awaiting_create_decision') {
    return handleCreateDecision(chatId, state, trimmed)
  }

  if (state.stage === 'awaiting_customer') {
    const result = await selectCustomer(state, trimmed)
    await saveConversation(chatId, result.state)
    return { handled: true, reply: result.reply }
  }

  if (state.stage === 'awaiting_price') {
    return handlePriceStep(chatId, state, trimmed)
  }

  if (state.stage === 'awaiting_discount') {
    return handleDiscountStep(chatId, state, trimmed)
  }

  if (state.stage === 'awaiting_cleaning') {
    return handleCleaningStep(chatId, state, trimmed)
  }

  if (state.stage === 'awaiting_tax_rate') {
    return handleTaxRateStep(chatId, state, trimmed)
  }

  if (state.stage === 'awaiting_payment_term') {
    return handlePaymentTermStep(chatId, state, trimmed)
  }

  if (state.stage === 'awaiting_draft_confirmation') {
    return handleDraftConfirmationStep(chatId, state, trimmed)
  }

  if (state.stage === 'awaiting_booking_confirmation' || state.stage === 'draft_created') {
    return handleBookingConfirmationStep(chatId, state, trimmed)
  }

  if (state.stage === 'bookings_created') {
    return {
      handled: true,
      reply: 'Dieser Vorgang ist abgeschlossen. Starte mit <code>/neu</code> einen neuen Ablauf.',
    }
  }

  return { handled: false, reply: '' }
}
