import 'server-only'

import type { Customer, Location, Property } from '@/lib/types'

export type TelegramAiIntent =
  | 'availability_check'
  | 'create_booking'
  | 'extend_booking'
  | 'modify_current_draft'
  | 'answer_workflow_question'
  | 'status'
  | 'cancel'
  | 'unknown'

export type TelegramAiInterpretation = {
  usedAi: boolean
  intent: TelegramAiIntent
  confidence: number
  checkIn?: string
  checkOut?: string
  newCheckOut?: string
  bedsNeeded?: number
  requestedRooms?: number
  locationName?: string
  propertyHint?: string
  customerName?: string
  requestedNetPrice?: number
  requestedDiscountPercentage?: number
  requestedCleaningFee?: number
  requestedTaxRate?: 0 | 7 | 19
  requestedPaymentTermDays?: number
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
  missingFields: string[]
  ambiguities: string[]
  clarificationQuestion?: string
}

type RawAiInterpretation = {
  intent: TelegramAiIntent
  confidence: number
  fields: {
    checkIn: string | null
    checkOut: string | null
    newCheckOut: string | null
    bedsNeeded: number | null
    requestedRooms: number | null
    locationName: string | null
    propertyHint: string | null
    customerName: string | null
    requestedNetPrice: number | null
    requestedDiscountPercentage: number | null
    requestedCleaningFee: number | null
    requestedTaxRate: 0 | 7 | 19 | null
    requestedPaymentTermDays: number | null
    billingCompanyName: string | null
    contactName: string | null
    email: string | null
    phone: string | null
    billingAddressSupplement: string | null
    billingStreet: string | null
    billingZip: string | null
    billingCity: string | null
    billingCountry: string | null
    billingTaxId: string | null
    project: string | null
    reference: string | null
  }
  missingFields: string[]
  ambiguities: string[]
  clarificationQuestion: string | null
}

const TELEGRAM_AI_MODEL = process.env.ANTHROPIC_TELEGRAM_MODEL || 'claude-sonnet-4-6'
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'

const interpretationInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: {
      type: 'string',
      enum: [
        'availability_check',
        'create_booking',
        'extend_booking',
        'modify_current_draft',
        'answer_workflow_question',
        'status',
        'cancel',
        'unknown',
      ],
    },
    confidence: { type: 'number' },
    fields: {
      type: 'object',
      additionalProperties: false,
      properties: {
        checkIn: { type: ['string', 'null'], description: 'ISO date YYYY-MM-DD, or null if unclear.' },
        checkOut: { type: ['string', 'null'], description: 'ISO date YYYY-MM-DD, or null if unclear.' },
        newCheckOut: { type: ['string', 'null'], description: 'ISO date YYYY-MM-DD. Only for extend_booking intent: the new desired checkout date.' },
        bedsNeeded: { type: ['number', 'null'] },
        requestedRooms: { type: ['number', 'null'] },
        locationName: { type: ['string', 'null'] },
        propertyHint: { type: ['string', 'null'] },
        customerName: { type: ['string', 'null'] },
        requestedNetPrice: { type: ['number', 'null'], description: 'Net price per bed per night, not total.' },
        requestedDiscountPercentage: { type: ['number', 'null'] },
        requestedCleaningFee: { type: ['number', 'null'] },
        requestedTaxRate: { type: ['number', 'null'], enum: [0, 7, 19, null] },
        requestedPaymentTermDays: { type: ['number', 'null'] },
        billingCompanyName: { type: ['string', 'null'] },
        contactName: { type: ['string', 'null'] },
        email: { type: ['string', 'null'] },
        phone: { type: ['string', 'null'] },
        billingAddressSupplement: { type: ['string', 'null'] },
        billingStreet: { type: ['string', 'null'] },
        billingZip: { type: ['string', 'null'] },
        billingCity: { type: ['string', 'null'] },
        billingCountry: { type: ['string', 'null'] },
        billingTaxId: { type: ['string', 'null'] },
        project: { type: ['string', 'null'] },
        reference: { type: ['string', 'null'] },
      },
      required: [
        'checkIn',
        'checkOut',
        'newCheckOut',
        'bedsNeeded',
        'requestedRooms',
        'locationName',
        'propertyHint',
        'customerName',
        'requestedNetPrice',
        'requestedDiscountPercentage',
        'requestedCleaningFee',
        'requestedTaxRate',
        'requestedPaymentTermDays',
        'billingCompanyName',
        'contactName',
        'email',
        'phone',
        'billingAddressSupplement',
        'billingStreet',
        'billingZip',
        'billingCity',
        'billingCountry',
        'billingTaxId',
        'project',
        'reference',
      ],
    },
    missingFields: { type: 'array', items: { type: 'string' } },
    ambiguities: { type: 'array', items: { type: 'string' } },
    clarificationQuestion: { type: ['string', 'null'] },
  },
  required: ['intent', 'confidence', 'fields', 'missingFields', 'ambiguities', 'clarificationQuestion'],
} as const

function compactList<T>(items: T[], max = 80) {
  return items.slice(0, max)
}

function buildContext(args: {
  locations: Location[]
  properties: Property[]
  customers: Customer[]
}) {
  const locations = args.locations.map(location => ({
    id: location.id,
    name: location.name,
    city: location.city,
    country: location.country,
  }))

  const properties = args.properties.map(property => {
    const location = args.locations.find(entry => entry.id === property.locationId)
    return {
      id: property.id,
      name: property.name,
      shortCode: property.shortCode,
      aliases: property.aliases,
      locationName: location?.name ?? '',
      city: location?.city ?? '',
      beds: property.beds,
    }
  })

  const customers = args.customers.map(customer => ({
    id: customer.id,
    companyName: customer.companyName,
    city: customer.city,
    email: customer.email,
  }))

  return {
    locations: compactList(locations),
    properties: compactList(properties),
    customers: compactList(customers, 120),
  }
}

function firstToolInput(response: unknown) {
  if (!response || typeof response !== 'object') return ''
  const content = (response as { content?: unknown }).content
  if (!Array.isArray(content)) return ''

  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const type = (item as { type?: unknown }).type
    const name = (item as { name?: unknown }).name
    if (type === 'tool_use' && name === 'interpret_telegram_message') {
      return (item as { input?: unknown }).input
    }
  }

  return undefined
}

function nonEmpty(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function finiteNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeRaw(raw: RawAiInterpretation): TelegramAiInterpretation {
  const fields = raw.fields
  return {
    usedAi: true,
    intent: raw.intent,
    confidence: Math.max(0, Math.min(1, finiteNumber(raw.confidence) ?? 0)),
    checkIn: nonEmpty(fields.checkIn),
    checkOut: nonEmpty(fields.checkOut),
    newCheckOut: nonEmpty(fields.newCheckOut),
    bedsNeeded: finiteNumber(fields.bedsNeeded),
    requestedRooms: finiteNumber(fields.requestedRooms),
    locationName: nonEmpty(fields.locationName),
    propertyHint: nonEmpty(fields.propertyHint),
    customerName: nonEmpty(fields.customerName),
    requestedNetPrice: finiteNumber(fields.requestedNetPrice),
    requestedDiscountPercentage: finiteNumber(fields.requestedDiscountPercentage),
    requestedCleaningFee: finiteNumber(fields.requestedCleaningFee),
    requestedTaxRate: fields.requestedTaxRate === 0 || fields.requestedTaxRate === 7 || fields.requestedTaxRate === 19
      ? fields.requestedTaxRate
      : undefined,
    requestedPaymentTermDays: finiteNumber(fields.requestedPaymentTermDays),
    billingCompanyName: nonEmpty(fields.billingCompanyName),
    contactName: nonEmpty(fields.contactName),
    email: nonEmpty(fields.email),
    phone: nonEmpty(fields.phone),
    billingAddressSupplement: nonEmpty(fields.billingAddressSupplement),
    billingStreet: nonEmpty(fields.billingStreet),
    billingZip: nonEmpty(fields.billingZip),
    billingCity: nonEmpty(fields.billingCity),
    billingCountry: nonEmpty(fields.billingCountry),
    billingTaxId: nonEmpty(fields.billingTaxId),
    project: nonEmpty(fields.project),
    reference: nonEmpty(fields.reference),
    missingFields: Array.isArray(raw.missingFields) ? raw.missingFields.filter(Boolean) : [],
    ambiguities: Array.isArray(raw.ambiguities) ? raw.ambiguities.filter(Boolean) : [],
    clarificationQuestion: nonEmpty(raw.clarificationQuestion),
  }
}

export async function interpretTelegramMessageWithAi(args: {
  text: string
  locations: Location[]
  properties: Property[]
  customers: Customer[]
}): Promise<TelegramAiInterpretation | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
  const context = buildContext(args)

  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: TELEGRAM_AI_MODEL,
      max_tokens: 1600,
      temperature: 0,
      system: [
        'Du bist die Verstehensschicht fuer einen Telegram-Bot eines Monteurzimmer-Buchungssystems.',
        'Lies freie deutsche Nachrichten tolerant: Tippfehler, Umgangssprache, gemischte Reihenfolge und weitergeleitete Kundenmails sind normal.',
        'Extrahiere nur Informationen, die im Text wirklich gemeint sind. Erfinde keine Kunden, Standorte, Objekte oder Preise.',
        'Nutze ISO-Daten. Heute in Europe/Berlin ist ' + today + '.',
        'Wenn relative Zeitraeume eindeutig sind, loese sie auf. Wenn sie nicht eindeutig sind, lasse checkIn/checkOut null und stelle eine kurze Rueckfrage.',
        'requestedNetPrice ist immer Netto-Preis pro Bett pro Nacht. Wenn ein Gesamtpreis gemeint sein koennte, markiere es als Ambiguitaet.',
        'Fuer kritische Aktionen: create_booking nur, wenn die Nachricht mehr als reine Verfuegbarkeit will. Sonst availability_check.',
        'extend_booking: wenn der Nutzer eine bestehende Buchung verlaengern will ("Kunde X verlaengert bis ...", "Verlaengerung bis ...", "bleibt laenger bis ..."). Setze customerName auf den genannten Kunden und newCheckOut auf das neue Checkout-Datum. propertyHint kann optional gesetzt werden.',
        'Rufe immer das Tool interpret_telegram_message auf. Antworte nicht mit Freitext.',
      ].join('\n'),
      tools: [
        {
          name: 'interpret_telegram_message',
          description: 'Extract intent and booking fields from a free-form Telegram message.',
          input_schema: interpretationInputSchema,
        },
      ],
      tool_choice: {
        type: 'tool',
        name: 'interpret_telegram_message',
      },
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            message: args.text,
            knownData: context,
          }),
        },
      ],
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Anthropic Telegram-Interpretation fehlgeschlagen: ${response.status} ${body}`)
  }

  const json = await response.json()
  const toolInput = firstToolInput(json)
  if (!toolInput) {
    throw new Error('Anthropic Telegram-Interpretation hat kein Tool-Ergebnis geliefert.')
  }

  return normalizeRaw(toolInput as RawAiInterpretation)
}
