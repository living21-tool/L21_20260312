import 'server-only'

import { checkAvailability, loadLocations } from '@/lib/availability-service'
import { parseAvailabilityMessage } from '@/lib/availability-message-parser'
import { parseBookingRequest } from '@/lib/booking-request-parser'
import { createTelegramAvailabilityMessage } from '@/lib/availability-response'
import {
  addCustomerServer,
  addBookingServer,
  findCustomersByQuery,
  getCustomerById,
  loadCustomersServer,
  loadPropertiesServer,
  updateCustomerServer,
} from '@/lib/booking-data-service'
import {
  buildBookingInsertInputs,
  buildInvoiceLinesFromAllocation,
  buildLexofficeInvoicePayload,
  calculateInvoiceFormTotals,
  createInitialInvoiceForm,
  DEFAULT_INVOICE_REMARK,
  formatRange,
  inferCountryCode,
  type DraftInvoiceState,
  type InvoiceFormState,
  type InvoiceLineItem,
} from '@/lib/booking-workflow'
import { createContact, createInvoice, downloadInvoicePdf, getInvoice, type CreateContactPayload } from '@/lib/lexoffice'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { BookingStatus, Customer } from '@/lib/types'

type TelegramConversationStage =
  | 'idle'
  | 'awaiting_property_selection'
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

type TelegramPropertyChoice = {
  propertyId: string
  propertyName: string
  shortCode: string
  totalBeds: number
  freeBeds: number
  pricePerBedNight: number
  cleaningFee: number
}

type TelegramRequestContext = {
  matchedCustomerId?: string
  matchedCustomerName?: string
  requestedNetPrice?: number
  requestedDiscountPercentage?: number
  requestedCleaningFee?: number
  requestedTaxRate?: 0 | 7 | 19
  requestedPaymentTermDays?: number
  customerName?: string
  billingCompanyName?: string
  contactName?: string
  email?: string
  phone?: string
  billingAddressSupplement?: string
  billingStreet?: string
  billingZip?: string
  billingCity?: string
  billingCountry?: string
  billingTaxId?: string
  project?: string
  reference?: string
}

type TelegramConversationState = {
  stage: TelegramConversationStage
  request?: TelegramDraftRequest
  requestContext?: TelegramRequestContext
  invoiceLines?: InvoiceLineItem[]
  invoiceForm?: InvoiceFormState
  customerId?: string
  propertyChoices?: TelegramPropertyChoice[]
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
  document?: {
    fileName: string
    contentType: string
    data: ArrayBuffer
    caption?: string
  }
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

function inferCountryCodeFromValue(value?: string) {
  const raw = value?.trim().toLowerCase()
  if (!raw || raw === 'de' || raw === 'deutschland' || raw === 'germany') return 'DE'
  if (raw === 'norway' || raw === 'norwegen' || raw === 'no') return 'NO'
  if (raw.length === 2) return raw.toUpperCase()
  return value?.slice(0, 2).toUpperCase() || 'DE'
}

function trimForLexofficeNote(value?: string, maxLength = 1000) {
  const normalized = value?.trim()
  if (!normalized) return undefined
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function buildLexofficeContactPayload(args: {
  companyName: string
  addressSupplement?: string
  street?: string
  zip?: string
  city?: string
  countryCode: string
  email?: string
  phone?: string
  firstName?: string
  lastName?: string
  taxId?: string
  note?: string
}): CreateContactPayload {
  const { companyName, addressSupplement, street, zip, city, countryCode, email, phone, firstName, lastName, taxId, note } = args

  return {
    roles: { customer: {} },
    company: {
      name: companyName,
      taxNumber: taxId || undefined,
      contactPersons: lastName || firstName || email || phone
        ? [{
            firstName: firstName || undefined,
            lastName: lastName || undefined,
            emailAddress: email || undefined,
            phoneNumber: phone || undefined,
            primary: true,
          }]
        : undefined,
    },
    addresses: {
      billing: [{
        supplement: addressSupplement || undefined,
        street: street || undefined,
        zip: zip || undefined,
        city: city || undefined,
        countryCode,
      }],
    },
    emailAddresses: email ? { business: [email] } : undefined,
    phoneNumbers: phone ? { business: [phone] } : undefined,
    note: trimForLexofficeNote(note),
  }
}

function buildPropertyChoiceReply(choices: TelegramPropertyChoice[]) {
  return [
    'Mehrere passende Wohnungen sind frei. Welche Einheit soll ich nehmen?',
    ...choices.map((choice, index) =>
      `${index + 1}. ${choice.shortCode || choice.propertyName} · ${choice.freeBeds}/${choice.totalBeds} frei · ${formatMoney(choice.pricePerBedNight)} pro Bett/Nacht`
    ),
    '',
    'Antworte mit der Nummer, z. B. <code>1</code>.',
  ].join('\n')
}

async function createCustomerFromRequestContext(
  state: TelegramConversationState,
  explicitCompanyName?: string,
) {
  const companyName =
    explicitCompanyName?.trim() ||
    state.requestContext?.billingCompanyName?.trim() ||
    state.requestContext?.customerName?.trim()

  if (!companyName) {
    return null
  }

  const contactNameParts = state.requestContext?.contactName?.trim().split(/\s+/).filter(Boolean) ?? []
  const firstName = contactNameParts.length > 1 ? contactNameParts.slice(0, -1).join(' ') : ''
  const lastName = contactNameParts.at(-1) || ''

  return addCustomerServer({
    companyName,
    firstName,
    lastName,
    email: state.requestContext?.email ?? '',
    phone: state.requestContext?.phone ?? '',
    address: state.requestContext?.billingStreet ?? '',
    zip: state.requestContext?.billingZip ?? '',
    city: state.requestContext?.billingCity ?? '',
    country: state.requestContext?.billingCountry ?? 'Deutschland',
    taxId: state.requestContext?.billingTaxId ?? '',
    lexofficeContactId: '',
    notes: [
      state.requestContext?.project ? `Projekt: ${state.requestContext.project}` : '',
      state.requestContext?.reference ? `Referenz: ${state.requestContext.reference}` : '',
      state.request?.originalText ? `Bot-Freitextanfrage:\n${state.request.originalText}` : '',
    ].filter(Boolean).join('\n'),
  })
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
  const priceSummary = bookingLines.map(line => {
    const bedsAllocated = Number(line.description.match(/,\s*(\d+)\s+Betten?$/)?.[1] ?? '1')
    const pricePerBedNight = bedsAllocated > 0 ? line.unitPriceNet / bedsAllocated : line.unitPriceNet
    return `${line.name}: ${formatMoney(pricePerBedNight)} pro Bett/Nacht`
  }).join(', ')

  return [
    'Wie soll der Bettenpreis sein?',
    `Aktuell: ${priceSummary || 'kein Preis gefunden'}`,
    'Antworte mit einer Zahl wie <code>30</code> für EUR pro Bett/Nacht oder mit <code>übernehmen</code>.',
  ].join('\n')
}

function applyBookingPriceToForm(
  invoiceForm: InvoiceFormState,
  invoiceLines: InvoiceLineItem[] | undefined,
  amount: number,
) {
  return {
    ...invoiceForm,
    lines: invoiceForm.lines.map(line => {
      if (line.kind !== 'booking') return line

      const relatedInvoiceLine = invoiceLines?.find(invoiceLine =>
        line.sourceKey && line.sourceKey === `${invoiceLine.requestId}:${invoiceLine.propertyId}`,
      )
      const bedsAllocated =
        relatedInvoiceLine?.bedsAllocated ??
        Number(line.description.match(/,\s*(\d+)\s+Betten?$/)?.[1] ?? '1')

      return {
        ...line,
        unitPriceNet: amount * Math.max(1, bedsAllocated),
      }
    }),
  }
}

function addCleaningLineToForm(
  invoiceForm: InvoiceFormState,
  invoiceLines: InvoiceLineItem[] | undefined,
  amount: number,
) {
  return {
    ...invoiceForm,
    lines: [
      ...invoiceForm.lines,
      {
        id: `draft-line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind: 'cleaning' as const,
        sourceKey: invoiceForm.lines.find(line => line.kind === 'booking')?.sourceKey,
        propertyId: invoiceLines?.[0]?.propertyId,
        requestId: invoiceLines?.[0]?.requestId,
        positionNumber: invoiceLines?.[0]?.positionNumber,
        name: `${invoiceLines?.[0]?.shortCode || invoiceLines?.[0]?.propertyName || 'Endreinigung'} - Endreinigung`,
        description: invoiceLines?.[0]
          ? `${invoiceLines[0].propertyName}, ${invoiceLines[0].locationName}, ${formatRange(invoiceLines[0].checkIn, invoiceLines[0].checkOut)}`
          : 'Endreinigung',
        quantity: 1,
        unitName: 'Pauschale',
        unitPriceNet: amount,
        discountPercentage: 0,
        taxRate: invoiceForm.lines.find(line => line.kind === 'booking')?.taxRate ?? 0,
      },
    ],
  }
}

function buildDraftConfirmationReply(state: TelegramConversationState, customer?: Customer | null) {
  return [
    formatInvoiceFormSummary(state, customer),
    '',
    'Soll ich den Lexoffice-Entwurf jetzt erstellen?',
    'Antworte mit <code>Ja</code> oder <code>Nein</code>.',
  ].join('\n')
}

function buildCleaningPrompt(invoiceForm: InvoiceFormState) {
  const cleaningLines = invoiceForm.lines.filter(line => line.kind === 'cleaning')
  if (cleaningLines.length === 0) {
    return [
      'Soll eine Reinigungsgebühr anfallen?',
      'Falls ja, antworte mit einer Zahl wie <code>150</code>.',
      'Falls nein, antworte mit <code>0</code> oder <code>übernehmen</code>.',
    ].join('\n')
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
  const bookingLines = invoiceForm.lines.filter(line => line.kind === 'booking')
  const cleaningLines = invoiceForm.lines.filter(line => line.kind === 'cleaning')
  const priceSummary = bookingLines
    .map(line => {
      const bedsAllocated =
        state.invoiceLines?.find(invoiceLine => line.sourceKey === `${invoiceLine.requestId}:${invoiceLine.propertyId}`)?.bedsAllocated ??
        Number(line.description.match(/,\s*(\d+)\s+Betten?$/)?.[1] ?? '1')
      const pricePerBedNight = bedsAllocated > 0 ? line.unitPriceNet / bedsAllocated : line.unitPriceNet
      return `${line.name}: ${formatMoney(pricePerBedNight)} pro Bett/Nacht`
    })
    .join(', ')
  const cleaningSummary = cleaningLines.length > 0
    ? cleaningLines.map(line => `${line.name}: ${formatMoney(line.unitPriceNet)}`).join(', ')
    : 'keine'
  const taxRates = Array.from(new Set(invoiceForm.lines.filter(line => line.kind !== 'text').map(line => line.taxRate)))
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
    `<b>Preis:</b> ${priceSummary || 'nicht gesetzt'}`,
    `<b>Reinigung:</b> ${cleaningSummary}`,
    `<b>Steuersatz:</b> ${taxRates.join(', ') || 0}%`,
    `<b>Zahlungsziel:</b> ${invoiceForm.paymentTermDays} Tage`,
    `<b>Rabatt:</b> ${invoiceForm.totalDiscountPercentage || 0}%`,
    `<b>Rechnungsadresse:</b> ${[invoiceForm.street, invoiceForm.zip, invoiceForm.city, invoiceForm.countryCode].filter(Boolean).join(', ') || 'nicht gesetzt'}`,
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
      if (lineKind === 'booking') {
        const relatedInvoiceLine = state.invoiceLines?.find(invoiceLine =>
          line.sourceKey && line.sourceKey === `${invoiceLine.requestId}:${invoiceLine.propertyId}`,
        )
        const bedsAllocated = relatedInvoiceLine?.bedsAllocated ?? Number(line.description.match(/,\s*(\d+)\s+Betten?$/)?.[1] ?? '1')
        return {
          ...line,
          unitPriceNet: amount * Math.max(1, bedsAllocated),
        }
      }
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

async function moveToNextRequiredStep(chatId: number | string, state: TelegramConversationState): Promise<HandlerResult> {
  if (!state.invoiceForm) {
    throw new Error('Es gibt noch keinen aktiven Vorgang.')
  }

  if (!state.customerId) {
    state.stage = 'awaiting_customer'
    await saveConversation(chatId, state)
    return {
      handled: true,
      reply: 'Wie heißt der Auftraggeber? Bitte sende einfach den Firmennamen.',
    }
  }

  if (state.requestContext?.requestedNetPrice === undefined) {
    state.stage = 'awaiting_price'
    await saveConversation(chatId, state)
    return {
      handled: true,
      reply: buildBookingPricePrompt(state.invoiceForm),
    }
  }

  if (state.requestContext?.requestedDiscountPercentage === undefined) {
    state.stage = 'awaiting_discount'
    await saveConversation(chatId, state)
    return {
      handled: true,
      reply: 'Soll ein Rabatt berücksichtigt werden? Antworte mit einer Zahl wie <code>5</code> oder mit <code>nein</code>.',
    }
  }

  const hasCleaningLines = state.invoiceForm.lines.some(line => line.kind === 'cleaning')
  if (!hasCleaningLines && state.requestContext?.requestedCleaningFee === undefined) {
    state.stage = 'awaiting_cleaning'
    await saveConversation(chatId, state)
    return {
      handled: true,
      reply: buildCleaningPrompt(state.invoiceForm),
    }
  }

  if (state.requestContext?.requestedTaxRate === undefined) {
    state.stage = 'awaiting_tax_rate'
    await saveConversation(chatId, state)
    return {
      handled: true,
      reply: buildTaxRatePrompt(state.invoiceForm),
    }
  }

  if (state.requestContext?.requestedPaymentTermDays === undefined) {
    state.stage = 'awaiting_payment_term'
    await saveConversation(chatId, state)
    return {
      handled: true,
      reply: 'Welches Zahlungsziel soll gelten? Antworte z. B. mit <code>14</code> für 14 Tage.',
    }
  }

  state.stage = 'awaiting_draft_confirmation'
  state.draftInvoice = undefined
  const customer = state.customerId ? await getCustomerById(state.customerId) : null
  await saveConversation(chatId, state)
  return {
    handled: true,
    reply: buildDraftConfirmationReply(state, customer),
  }
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

async function buildConversationStateFromAvailability(args: {
  text: string
  forcedPropertyId?: string
}) {
  const { text, forcedPropertyId } = args
  const [locations, properties, customers] = await Promise.all([
    loadLocations(),
    loadPropertiesServer(),
    loadCustomersServer(),
  ])

  const richParsed = parseBookingRequest(text, { properties, locations, customers })
  const parsedRequest =
    richParsed.checkIn && richParsed.checkOut && richParsed.bedsNeeded && richParsed.matchedLocationId
      ? {
          locationId: richParsed.matchedLocationId,
          locationName: richParsed.matchedLocationName,
          checkIn: richParsed.checkIn,
          checkOut: richParsed.checkOut,
          bedsNeeded: richParsed.bedsNeeded,
          strategy: 'fewest-properties' as const,
          originalText: richParsed.originalText,
          normalizedText: richParsed.originalText,
        }
      : parseAvailabilityMessage(text, locations)

  const result = await checkAvailability(parsedRequest)
  const availabilityReply = createTelegramAvailabilityMessage(result, parsedRequest)

  if (!result.allocation.success || result.allocation.allocations.length === 0) {
    return { state: defaultState(), reply: availabilityReply }
  }

  const preferredIds = new Set(richParsed.matchedProperties.map(property => property.id))
  const choiceCandidates = result.matchingProperties
    .filter(property => property.freeBeds >= parsedRequest.bedsNeeded)
    .filter(property => preferredIds.size === 0 || preferredIds.has(property.propertyId))

  if (!forcedPropertyId && choiceCandidates.length > 1) {
    const propertyChoices = choiceCandidates.map(choice => ({
      propertyId: choice.propertyId,
      propertyName: choice.propertyName,
      shortCode: choice.shortCode,
      totalBeds: choice.totalBeds,
      freeBeds: choice.freeBeds,
      pricePerBedNight: choice.pricePerBedNight,
      cleaningFee: choice.cleaningFee,
    }))

    return {
      state: {
        stage: 'awaiting_property_selection' as const,
        request: {
          locationId: result.location.id,
          locationName: result.location.name,
          checkIn: parsedRequest.checkIn,
          checkOut: parsedRequest.checkOut,
          bedsNeeded: parsedRequest.bedsNeeded,
          originalText: parsedRequest.originalText,
        },
        requestContext: {
          matchedCustomerId: richParsed.matchedCustomerId,
          matchedCustomerName: richParsed.matchedCustomerName,
          requestedNetPrice: richParsed.requestedNetPrice,
          requestedDiscountPercentage: richParsed.requestedDiscountPercentage,
          requestedCleaningFee: richParsed.requestedCleaningFee,
          requestedTaxRate: richParsed.requestedTaxRate,
          requestedPaymentTermDays: richParsed.requestedPaymentTermDays,
          customerName: richParsed.customerName,
          billingCompanyName: richParsed.billingCompanyName,
          contactName: richParsed.contactName,
          email: richParsed.email,
          phone: richParsed.phone,
          billingAddressSupplement: richParsed.billingAddressSupplement,
          billingStreet: richParsed.billingStreet,
          billingZip: richParsed.billingZip,
          billingCity: richParsed.billingCity,
          billingCountry: richParsed.billingCountry,
          billingTaxId: richParsed.billingTaxId,
          project: richParsed.project,
          reference: richParsed.reference,
        },
        propertyChoices,
        bookingStatus: 'bestaetigt' as const,
      },
      reply: [availabilityReply, '', buildPropertyChoiceReply(propertyChoices)].join('\n'),
    }
  }

  const selectedChoice = forcedPropertyId
    ? result.matchingProperties.find(property => property.propertyId === forcedPropertyId)
    : choiceCandidates.length === 1
      ? choiceCandidates[0]
      : undefined

  const allocations = selectedChoice
    ? [{
        propertyId: selectedChoice.propertyId,
        propertyName: selectedChoice.propertyName,
        shortCode: selectedChoice.shortCode,
        bedsAllocated: parsedRequest.bedsNeeded,
        totalBeds: selectedChoice.totalBeds,
        minFreeBeds: selectedChoice.freeBeds,
        pricePerBedNight: selectedChoice.pricePerBedNight,
        cleaningFee: selectedChoice.cleaningFee,
        nights: result.allocation.nights,
        subtotal: selectedChoice.pricePerBedNight * parsedRequest.bedsNeeded * result.allocation.nights + selectedChoice.cleaningFee,
      }]
    : result.allocation.allocations

  const selectedAvailabilityReply = createTelegramAvailabilityMessage(result, parsedRequest, allocations)

  const invoiceLines = buildInvoiceLinesFromAllocation({
    requestId: `tg-${Date.now()}`,
    locationName: result.location.name,
    checkIn: parsedRequest.checkIn,
    checkOut: parsedRequest.checkOut,
    allocations,
  })

  const matchedCustomer = richParsed.matchedCustomerId
    ? customers.find(customer => customer.id === richParsed.matchedCustomerId)
    : undefined
  const fallbackCountryCode = inferCountryCodeFromValue(richParsed.billingCountry || matchedCustomer?.country)
  const invoiceForm = createInitialInvoiceForm({
    customer: matchedCustomer,
    invoiceLines,
    notes: parsedRequest.originalText,
    defaultTaxRate: 0,
    totalDiscountPercentage: 0,
    fallbackCountryCode,
  })

  if (richParsed.requestedNetPrice !== undefined) {
    Object.assign(invoiceForm, applyBookingPriceToForm(invoiceForm, invoiceLines, richParsed.requestedNetPrice))
  }
  if (richParsed.requestedDiscountPercentage !== undefined) {
    invoiceForm.totalDiscountPercentage = richParsed.requestedDiscountPercentage
  }
  if (richParsed.requestedCleaningFee !== undefined) {
    const hasCleaningLines = invoiceForm.lines.some(line => line.kind === 'cleaning')
    if (hasCleaningLines) {
      Object.assign(invoiceForm, {
        ...invoiceForm,
        lines: invoiceForm.lines.map(line => (
          line.kind === 'cleaning'
            ? { ...line, unitPriceNet: richParsed.requestedCleaningFee! }
            : line
        )),
      })
    } else if (richParsed.requestedCleaningFee > 0) {
      Object.assign(invoiceForm, addCleaningLineToForm(invoiceForm, invoiceLines, richParsed.requestedCleaningFee))
    }
  }
  if (richParsed.requestedTaxRate !== undefined) {
    Object.assign(invoiceForm, {
      ...invoiceForm,
      lines: invoiceForm.lines.map(line => (
        line.kind === 'text'
          ? line
          : { ...line, taxRate: richParsed.requestedTaxRate! }
      )),
    })
  }
  if (richParsed.requestedPaymentTermDays !== undefined) {
    invoiceForm.paymentTermDays = richParsed.requestedPaymentTermDays
  }

  invoiceForm.customerName = invoiceForm.customerName || richParsed.billingCompanyName || richParsed.customerName || ''
  invoiceForm.addressSupplement = invoiceForm.addressSupplement || richParsed.billingAddressSupplement || richParsed.contactName || ''
  invoiceForm.street = invoiceForm.street || richParsed.billingStreet || ''
  invoiceForm.zip = invoiceForm.zip || richParsed.billingZip || ''
  invoiceForm.city = invoiceForm.city || richParsed.billingCity || ''
  invoiceForm.countryCode = invoiceForm.countryCode || fallbackCountryCode
  invoiceForm.remark = DEFAULT_INVOICE_REMARK

  return {
    state: {
      stage: 'awaiting_create_decision' as const,
      request: {
        locationId: result.location.id,
        locationName: result.location.name,
        checkIn: parsedRequest.checkIn,
        checkOut: parsedRequest.checkOut,
        bedsNeeded: parsedRequest.bedsNeeded,
        originalText: parsedRequest.originalText,
      },
      requestContext: {
        matchedCustomerId: richParsed.matchedCustomerId,
        matchedCustomerName: richParsed.matchedCustomerName,
        requestedNetPrice: richParsed.requestedNetPrice,
        requestedDiscountPercentage: richParsed.requestedDiscountPercentage,
        requestedCleaningFee: richParsed.requestedCleaningFee,
        requestedTaxRate: richParsed.requestedTaxRate,
        requestedPaymentTermDays: richParsed.requestedPaymentTermDays,
        customerName: richParsed.customerName,
        billingCompanyName: richParsed.billingCompanyName,
        contactName: richParsed.contactName,
        email: richParsed.email,
        phone: richParsed.phone,
        billingAddressSupplement: richParsed.billingAddressSupplement,
        billingStreet: richParsed.billingStreet,
        billingZip: richParsed.billingZip,
        billingCity: richParsed.billingCity,
        billingCountry: richParsed.billingCountry,
        billingTaxId: richParsed.billingTaxId,
        project: richParsed.project,
        reference: richParsed.reference,
      },
      invoiceLines,
      invoiceForm,
      customerId: matchedCustomer?.id,
      bookingStatus: 'bestaetigt' as const,
    },
    reply: selectedAvailabilityReply,
  }
}

async function handleAvailabilityStart(chatId: number | string, text: string): Promise<HandlerResult> {
  const { state, reply } = await buildConversationStateFromAvailability({ text })

  if (!state.request || (state.stage !== 'awaiting_property_selection' && (!state.invoiceLines || state.invoiceLines.length === 0))) {
    await resetConversation(chatId)
    return {
      handled: true,
      reply,
    }
  }

  await saveConversation(chatId, state)

  if (state.stage === 'awaiting_property_selection') {
    return { handled: true, reply }
  }

  return {
    handled: true,
    reply: [
      reply,
      '',
      'Willst du für diese Verfügbarkeit eine Buchung bzw. einen Rechnungsentwurf erstellen?',
      'Antworte mit <code>Ja</code> oder <code>Nein</code>.',
    ].join('\n'),
  }
}

async function selectCustomer(state: TelegramConversationState, query: string) {
  const matches = await findCustomersByQuery(query, 5)
  if (matches.length === 0) {
    const createdCustomer = await createCustomerFromRequestContext(state, query)
    if (createdCustomer && state.invoiceLines) {
      const invoiceForm = createInitialInvoiceForm({
        customer: createdCustomer,
        invoiceLines: state.invoiceLines,
        notes: state.request?.originalText ?? '',
        defaultTaxRate: state.invoiceForm?.lines.find(line => line.kind !== 'text')?.taxRate ?? 0,
        totalDiscountPercentage: state.invoiceForm?.totalDiscountPercentage ?? 0,
        fallbackCountryCode: inferCountryCodeFromValue(state.requestContext?.billingCountry || createdCustomer.country),
      })

      if (state.invoiceForm) {
        invoiceForm.lines = state.invoiceForm.lines
        invoiceForm.paymentTermDays = state.invoiceForm.paymentTermDays
        invoiceForm.totalDiscountPercentage = state.invoiceForm.totalDiscountPercentage
        invoiceForm.title = state.invoiceForm.title
        invoiceForm.introduction = createdCustomer.companyName ? `Rechnung für ${createdCustomer.companyName}` : state.invoiceForm.introduction
        invoiceForm.remark = state.invoiceForm.remark
      }

      state.customerId = createdCustomer.id
      state.invoiceForm = {
        ...invoiceForm,
        customerName: createdCustomer.companyName || invoiceForm.customerName,
        addressSupplement: invoiceForm.addressSupplement || state.requestContext?.billingAddressSupplement || state.requestContext?.contactName || '',
        street: invoiceForm.street || state.requestContext?.billingStreet || '',
        zip: invoiceForm.zip || state.requestContext?.billingZip || '',
        city: invoiceForm.city || state.requestContext?.billingCity || '',
        countryCode: invoiceForm.countryCode || inferCountryCodeFromValue(state.requestContext?.billingCountry || createdCustomer.country),
      }
      state.draftInvoice = undefined

      return {
        state,
        reply: `Auftraggeber neu angelegt: <b>${createdCustomer.companyName}</b>`,
      }
    }

    return {
      state,
      reply: 'Ich habe keinen passenden Auftraggeber gefunden. Wie heißt der Auftraggeber genau?',
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
    addressSupplement: invoiceForm.addressSupplement || `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim() || state.requestContext?.billingAddressSupplement || state.requestContext?.contactName || '',
    street: invoiceForm.street || customer.address || state.requestContext?.billingStreet || '',
    zip: invoiceForm.zip || customer.zip || state.requestContext?.billingZip || '',
    city: invoiceForm.city || customer.city || state.requestContext?.billingCity || '',
    countryCode: invoiceForm.countryCode || inferCountryCodeFromValue(state.requestContext?.billingCountry || customer.country),
  }
  state.draftInvoice = undefined

  return {
    state,
    reply: `Auftraggeber gesetzt: <b>${customer.companyName}</b>`,
  }
}

async function createDraftForState(state: TelegramConversationState) {
  if (!state.customerId || !state.invoiceForm) {
    throw new Error('Bitte zuerst den Auftraggeber festlegen.')
  }

  let customer = await getCustomerById(state.customerId)
  if (!customer) {
    throw new Error('Der Auftraggeber konnte nicht geladen werden.')
  }

  if (!customer.lexofficeContactId) {
    const fallbackCountryCode = inferCountryCodeFromValue(state.requestContext?.billingCountry || customer.country)
    const contactNameParts = state.requestContext?.contactName?.trim().split(/\s+/).filter(Boolean) ?? []
    const firstName = customer.firstName || (contactNameParts.length > 1 ? contactNameParts.slice(0, -1).join(' ') : '')
    const lastName = customer.lastName || contactNameParts.at(-1) || ''

    const contactPayload = buildLexofficeContactPayload({
      companyName: state.invoiceForm.customerName || customer.companyName,
      addressSupplement: state.invoiceForm.addressSupplement,
      street: state.invoiceForm.street,
      zip: state.invoiceForm.zip,
      city: state.invoiceForm.city,
      countryCode: state.invoiceForm.countryCode || fallbackCountryCode,
      email: state.requestContext?.email || customer.email,
      phone: state.requestContext?.phone || customer.phone,
      firstName,
      lastName,
      taxId: customer.taxId || state.requestContext?.billingTaxId,
      note: `${state.request?.originalText ?? ''}\n${state.requestContext?.project ? `Projekt: ${state.requestContext.project}` : ''}`.trim(),
    })

    const createdContact = await createContact(contactPayload)
    customer = await updateCustomerServer(state.customerId, { lexofficeContactId: createdContact.id })
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
    if (state.customerId) {
      const next = await moveToNextRequiredStep(chatId, state)
      return {
        ...next,
        reply: [
          `Auftraggeber erkannt: <b>${state.invoiceForm?.customerName ?? state.requestContext?.matchedCustomerName ?? 'Auftraggeber'}</b>`,
          '',
          next.reply,
        ].join('\n'),
      }
    }

    const createdCustomer = await createCustomerFromRequestContext(state)
    if (createdCustomer && state.invoiceLines) {
      const invoiceForm = createInitialInvoiceForm({
        customer: createdCustomer,
        invoiceLines: state.invoiceLines,
        notes: state.request?.originalText ?? '',
        defaultTaxRate: state.invoiceForm?.lines.find(line => line.kind !== 'text')?.taxRate ?? 0,
        totalDiscountPercentage: state.invoiceForm?.totalDiscountPercentage ?? 0,
        fallbackCountryCode: inferCountryCodeFromValue(state.requestContext?.billingCountry || createdCustomer.country),
      })

      if (state.invoiceForm) {
        invoiceForm.lines = state.invoiceForm.lines
        invoiceForm.paymentTermDays = state.invoiceForm.paymentTermDays
        invoiceForm.totalDiscountPercentage = state.invoiceForm.totalDiscountPercentage
        invoiceForm.title = state.invoiceForm.title
        invoiceForm.introduction = createdCustomer.companyName ? `Rechnung für ${createdCustomer.companyName}` : state.invoiceForm.introduction
        invoiceForm.remark = state.invoiceForm.remark
      }

      state.customerId = createdCustomer.id
      state.invoiceForm = {
        ...invoiceForm,
        customerName: createdCustomer.companyName || invoiceForm.customerName,
        addressSupplement: invoiceForm.addressSupplement || state.requestContext?.billingAddressSupplement || state.requestContext?.contactName || '',
        street: invoiceForm.street || state.requestContext?.billingStreet || '',
        zip: invoiceForm.zip || state.requestContext?.billingZip || '',
        city: invoiceForm.city || state.requestContext?.billingCity || '',
        countryCode: invoiceForm.countryCode || inferCountryCodeFromValue(state.requestContext?.billingCountry || createdCustomer.country),
      }
      const next = await moveToNextRequiredStep(chatId, state)
      return {
        ...next,
        reply: [
          `Auftraggeber neu angelegt: <b>${createdCustomer.companyName}</b>`,
          '',
          next.reply,
        ].join('\n'),
      }
    }

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

async function handlePropertySelection(chatId: number | string, state: TelegramConversationState, text: string): Promise<HandlerResult> {
  const selection = parseNumberFromText(text)
  if (!selection || !state.propertyChoices || selection < 1 || selection > state.propertyChoices.length || !state.request) {
    return {
      handled: true,
      reply: buildPropertyChoiceReply(state.propertyChoices ?? []),
    }
  }

  const choice = state.propertyChoices[selection - 1]
  const rebuilt = await buildConversationStateFromAvailability({
    text: state.request.originalText,
    forcedPropertyId: choice.propertyId,
  })

  const nextState: TelegramConversationState = {
    ...rebuilt.state,
    bookingStatus: state.bookingStatus ?? 'bestaetigt',
  }

  await saveConversation(chatId, nextState)

  return {
    handled: true,
    reply: [
      rebuilt.reply,
      '',
      `Ausgewählt: <b>${choice.shortCode || choice.propertyName}</b>`,
      '',
      'Willst du für diese Verfügbarkeit eine Buchung bzw. einen Rechnungsentwurf erstellen?',
      'Antworte mit <code>Ja</code> oder <code>Nein</code>.',
    ].join('\n'),
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
      state.requestContext = {
        ...state.requestContext,
        requestedNetPrice: amount,
      }
  }

  return moveToNextRequiredStep(chatId, state)
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
    state.requestContext = {
      ...state.requestContext,
      requestedDiscountPercentage: 0,
    }
  } else {
    const amount = parseNumberFromText(text)
    if (amount === null || amount < 0 || amount > 100) {
      return {
        handled: true,
        reply: 'Bitte antworte mit einem Rabatt in Prozent wie <code>5</code> oder mit <code>nein</code>.',
      }
    }
    state.invoiceForm.totalDiscountPercentage = amount
    state.requestContext = {
      ...state.requestContext,
      requestedDiscountPercentage: amount,
    }
  }
  return moveToNextRequiredStep(chatId, state)
}

async function handleCleaningStep(chatId: number | string, state: TelegramConversationState, text: string): Promise<HandlerResult> {
  if (!state.invoiceForm) {
    throw new Error('Es gibt noch keinen aktiven Vorgang.')
  }

  const hasCleaningLines = state.invoiceForm.lines.some(line => line.kind === 'cleaning')
  if (!isSkip(text)) {
    const amount = parseNumberFromText(text)
    if (amount === null || amount < 0) {
      return {
        handled: true,
        reply: buildCleaningPrompt(state.invoiceForm),
      }
    }

    if (hasCleaningLines) {
      setAllLinePrices(state, 'cleaning', amount)
    } else if (amount > 0) {
      state.invoiceForm = addCleaningLineToForm(state.invoiceForm, state.invoiceLines, amount)
    }
    state.requestContext = {
      ...state.requestContext,
      requestedCleaningFee: amount,
    }
  }

  return moveToNextRequiredStep(chatId, state)
  state.stage = 'awaiting_tax_rate'
  await saveConversation(chatId, state)
  return {
    handled: true,
    reply: buildTaxRatePrompt(state.invoiceForm!),
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
  state.requestContext = {
    ...state.requestContext,
    requestedTaxRate: amount as 0 | 7 | 19,
  }
  return moveToNextRequiredStep(chatId, state)
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
  state.requestContext = {
    ...state.requestContext,
    requestedPaymentTermDays: Math.round(amount),
  }
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
  let document: HandlerResult['document']

  try {
    const pdf = await downloadInvoicePdf(draft.id)
    document = {
      fileName: pdf.fileName,
      contentType: pdf.contentType,
      data: pdf.buffer,
      caption: `Lexoffice-PDF: ${draft.voucherNumber ?? draft.id}`,
    }
  } catch {
    document = undefined
  }

  await saveConversation(chatId, state)
  return {
    handled: true,
    reply: [
      'Lexoffice-Entwurf wurde erstellt.',
      `Beleg: ${draft.voucherNumber ?? draft.id}`,
      draft.voucherStatus ? `Status: ${draft.voucherStatus}` : '',
      draft.lexofficeUrl,
      '',
      document ? 'Ich schicke dir die PDF direkt hier in Telegram.' : 'Die PDF konnte ich noch nicht direkt anhängen. Nutze vorerst den Lexoffice-Link.',
      '',
      'Soll ich jetzt auch die Buchungen anlegen?',
      'Antworte mit <code>Ja</code> oder <code>Nein</code>.',
    ].filter(Boolean).join('\n'),
    document,
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

  if (state.stage === 'awaiting_property_selection') {
    return handlePropertySelection(chatId, state, trimmed)
  }

  if (state.stage === 'awaiting_create_decision') {
    return handleCreateDecision(chatId, state, trimmed)
  }

  if (state.stage === 'awaiting_customer') {
    const result = await selectCustomer(state, trimmed)
    if (!result.state.customerId) {
      await saveConversation(chatId, result.state)
      return { handled: true, reply: result.reply }
    }

    const next = await moveToNextRequiredStep(chatId, result.state)
    return {
      handled: true,
      reply: [result.reply, '', next.reply].join('\n'),
    }
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
