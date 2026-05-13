'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { differenceInDays } from 'date-fns'
import {
  AlertTriangle,
  ArrowLeft,
  BedDouble,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Plus,
  Search,
  Trash2,
  Zap,
} from 'lucide-react'

import {
  allocateBeds,
  calcAvailableBedsPerProperty,
  type AllocationEntry,
  type AllocationStrategy,
  type PropertyAvailability,
} from '@/lib/availability'
import { parseBookingRequest, type ParsedBookingRequest } from '@/lib/booking-request-parser'
import {
  buildLexofficeInvoicePayload,
  createInvoiceDraftLineId,
  formatRange,
  roundCurrency,
  type DraftInvoiceState,
  type InvoiceDraftLine,
  type InvoiceFormState,
  type InvoiceLineItem,
} from '@/lib/booking-workflow'
import { useBookings, useCustomers, useLocations, useProperties } from '@/lib/store'
import type { Booking } from '@/lib/types'
import { formatCurrency } from '@/lib/utils'

type RequestItemState = {
  id: string
  locationId: string
  checkIn: string
  checkOut: string
  bedsNeeded: number
  strategy: AllocationStrategy
  manualAllocations: Record<string, number>
  manualPrices: Record<string, number>
  manualCleaning: Record<string, number>
}

type ComputedRequestItem = RequestItemState & {
  locationName: string
  locationColor: string
  nights: number
  valid: boolean
  availabilities: PropertyAvailability[]
  effectiveAllocations: AllocationEntry[]
  activeAllocations: AllocationEntry[]
  totalAllocated: number
  totalFreeBeds: number
  subtotalBeforeDiscount: number
  shortfall: number
}

type CreatedBookingItem = {
  id: string
  bookingNumber: string
  propertyName: string
  beds: number
  positionNumber: number
}

const DEFAULT_INVOICE_REMARK = [
  'Vielen Dank für Ihre Buchung!',
  '',
  '***Die Kündigungsfrist beträgt 2 Wochen vor Vertragsende/Mietende. Die Kündigung muss schriftlich erfolgen. Sollte keine Kündigung erfolgen, so verlängert sich das Mietverhältnis automatisch.***',
].join('\n')

function buildParsedRequestNotes(parsed: ParsedBookingRequest) {
  return [
    parsed.contactName ? `Ansprechpartner: ${parsed.contactName}` : '',
    parsed.email ? `E-Mail: ${parsed.email}` : '',
    parsed.phone ? `Telefon: ${parsed.phone}` : '',
    parsed.customerName ? `Auftraggeber laut Anfrage: ${parsed.customerName}` : '',
    parsed.project ? `Projekt: ${parsed.project}` : '',
    parsed.reference ? `Referenz: ${parsed.reference}` : '',
    parsed.objectHint ? `Objekthinweis: ${parsed.objectHint}` : '',
    parsed.requestedRooms ? `Wunsch: ${parsed.requestedRooms} Zimmer` : '',
    parsed.billingAddress ? `Billing Address:\n${parsed.billingAddress}` : '',
    `Originalanfrage:\n${parsed.originalText}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function inferCountryCodeFromParsedRequest(parsed: ParsedBookingRequest | null, fallbackCountryCode: string) {
  const rawCountry = parsed?.billingCountry?.trim().toLowerCase()
  if (!rawCountry) {
    return fallbackCountryCode
  }
  if (rawCountry === 'de' || rawCountry === 'deutschland' || rawCountry === 'germany') return 'DE'
  if (rawCountry === 'norway' || rawCountry === 'norwegen' || rawCountry === 'no') return 'NO'
  if (rawCountry.length === 2) return rawCountry.toUpperCase()
  return parsed?.billingCountry?.slice(0, 2).toUpperCase() || fallbackCountryCode
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
}) {
  const {
    companyName,
    addressSupplement,
    street,
    zip,
    city,
    countryCode,
    email,
    phone,
    firstName,
    lastName,
    taxId,
    note,
  } = args

  return {
    roles: { customer: {} },
    company: {
      name: companyName,
      taxNumber: taxId || undefined,
      contactPersons: firstName || lastName || email || phone
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

function isSinglePropertySelected(item: ComputedRequestItem, propertyId: string) {
  return (
    item.activeAllocations.length === 1 &&
    item.activeAllocations[0]?.propertyId === propertyId &&
    item.totalAllocated === item.bedsNeeded
  )
}

function createRequestItem(
  seed?: Partial<Pick<RequestItemState, 'locationId' | 'checkIn' | 'checkOut'>>,
): RequestItemState {
  const today = new Date().toISOString().slice(0, 10)

  return {
    id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    locationId: seed?.locationId ?? '',
    checkIn: seed?.checkIn ?? today,
    checkOut: seed?.checkOut ?? '',
    bedsNeeded: 1,
    strategy: 'fewest-properties',
    manualAllocations: {},
    manualPrices: {},
    manualCleaning: {},
  }
}

function isValidRequestItem(item: RequestItemState) {
  if (!item.locationId || !item.checkIn || !item.checkOut) return false
  return differenceInDays(new Date(item.checkOut), new Date(item.checkIn)) > 0 && item.bedsNeeded > 0
}

function buildPlannedBooking(item: ComputedRequestItem, alloc: AllocationEntry): Booking {
  return {
    id: `planned-${item.id}-${alloc.propertyId}`,
    bookingNumber: 'PLANNED',
    propertyId: alloc.propertyId,
    customerId: '',
    checkIn: item.checkIn,
    checkOut: item.checkOut,
    nights: item.nights,
    bedsBooked: alloc.bedsAllocated,
    pricePerBedNight: alloc.pricePerBedNight,
    cleaningFee: alloc.cleaningFee,
    totalPrice: alloc.subtotal,
    status: 'bestaetigt',
    paymentStatus: 'offen',
    notes: '',
    createdAt: item.checkIn,
    updatedAt: item.checkOut,
    source: 'manual',
  }
}

function createInitialInvoiceForm(args: {
  customer: ReturnType<typeof useCustomers>['customers'][number] | undefined
  invoiceLines: InvoiceLineItem[]
  notes: string
  defaultTaxRate: 0 | 7 | 19
  totalDiscountPercentage: number
  fallbackCountryCode: string
}) {
  const { customer, invoiceLines, notes, defaultTaxRate, totalDiscountPercentage, fallbackCountryCode } = args
  const today = new Date().toISOString().slice(0, 10)
  const serviceDates = invoiceLines
    .flatMap(line => [line.checkIn, line.checkOut])
    .filter(Boolean)
    .sort()

  const lines: InvoiceDraftLine[] = invoiceLines.flatMap(line => {
    const sourceKey = `${line.requestId}:${line.propertyId}`
    const bookingLine: InvoiceDraftLine = {
      id: createInvoiceDraftLineId(),
      kind: 'booking',
      sourceKey,
      propertyId: line.propertyId,
      requestId: line.requestId,
      positionNumber: line.positionNumber,
      name: line.shortCode || line.propertyName,
      description: `${line.propertyName}, ${line.locationName}, ${formatRange(line.checkIn, line.checkOut)}, ${line.bedsAllocated} Betten`,
      quantity: line.nights,
      unitName: line.bedsAllocated === 1 ? 'Nacht' : 'Nächte',
      unitPriceNet: roundCurrency(line.pricePerBedNight * line.bedsAllocated),
      discountPercentage: 0,
      taxRate: defaultTaxRate,
    }

    const cleaningLine = line.cleaningFee > 0
      ? [{
          id: createInvoiceDraftLineId(),
          kind: 'cleaning' as const,
          sourceKey,
          propertyId: line.propertyId,
          requestId: line.requestId,
          positionNumber: line.positionNumber,
          name: `${line.shortCode || line.propertyName} - Endreinigung`,
          description: `${line.propertyName}, ${line.locationName}, ${formatRange(line.checkIn, line.checkOut)}`,
          quantity: 1,
          unitName: 'Pauschale',
          unitPriceNet: roundCurrency(line.cleaningFee),
          discountPercentage: 0,
          taxRate: defaultTaxRate,
        }]
      : []

    return [bookingLine, ...cleaningLine]
  })

  return {
    customerName: customer?.companyName ?? '',
    addressSupplement: customer?.firstName || customer?.lastName ? `${customer?.firstName ?? ''} ${customer?.lastName ?? ''}`.trim() : '',
    street: customer?.address ?? '',
    zip: customer?.zip ?? '',
    city: customer?.city ?? '',
    countryCode: fallbackCountryCode,
    voucherDate: today,
    serviceDateFrom: serviceDates[0] ?? today,
    serviceDateTo: serviceDates.at(-1) ?? serviceDates[0] ?? today,
    title: 'Rechnung',
    introduction: customer?.companyName ? `Rechnung für ${customer.companyName}` : 'Rechnung',
    remark: DEFAULT_INVOICE_REMARK,
    paymentTermDays: 14,
    totalDiscountPercentage,
    lines,
  } satisfies InvoiceFormState
}

function calculateInvoiceFormTotals(lines: InvoiceDraftLine[], totalDiscountPercentage: number) {
  const pricedLines = lines.filter(line => line.kind !== 'text')
  const lineSummaries = pricedLines.map(line => {
    const grossBase = line.quantity * line.unitPriceNet
    const discountFactor = 1 - line.discountPercentage / 100
    const netAfterLineDiscount = roundCurrency(grossBase * discountFactor)
    return {
      id: line.id,
      sourceKey: line.sourceKey,
      netAfterLineDiscount,
      taxRate: line.taxRate,
      linkedBooking: line.kind === 'booking' || line.kind === 'cleaning',
    }
  })

  const netBeforeTotalDiscount = roundCurrency(lineSummaries.reduce((sum, line) => sum + line.netAfterLineDiscount, 0))
  const totalDiscountAmount = roundCurrency(netBeforeTotalDiscount * totalDiscountPercentage / 100)

  const lineTotals = lineSummaries.map((line, index) => {
    const proportionalDiscount = netBeforeTotalDiscount > 0
      ? roundCurrency(totalDiscountAmount * (line.netAfterLineDiscount / netBeforeTotalDiscount))
      : 0
    const isLast = index === lineSummaries.length - 1
    const discountShare = isLast
      ? roundCurrency(totalDiscountAmount - lineTotalsSoFar(lineSummaries, totalDiscountAmount, index))
      : proportionalDiscount
    const netAfterTotalDiscount = roundCurrency(Math.max(0, line.netAfterLineDiscount - discountShare))
    const taxAmount = roundCurrency(netAfterTotalDiscount * line.taxRate / 100)

    return {
      id: line.id,
      sourceKey: line.sourceKey,
      linkedBooking: line.linkedBooking,
      netAfterLineDiscount: line.netAfterLineDiscount,
      discountShare,
      netAfterTotalDiscount,
      taxAmount,
      grossAmount: roundCurrency(netAfterTotalDiscount + taxAmount),
    }
  })

  const totalNet = roundCurrency(lineTotals.reduce((sum, line) => sum + line.netAfterTotalDiscount, 0))
  const totalTax = roundCurrency(lineTotals.reduce((sum, line) => sum + line.taxAmount, 0))
  const totalGross = roundCurrency(totalNet + totalTax)

  return {
    lineTotals,
    totalNet,
    totalTax,
    totalGross,
    totalDiscountAmount,
  }
}

function lineTotalsSoFar(
  lineSummaries: Array<{ netAfterLineDiscount: number }>,
  totalDiscountAmount: number,
  limit: number,
) {
  if (limit <= 0) return 0
  const netBeforeTotalDiscount = lineSummaries.reduce((sum, line) => sum + line.netAfterLineDiscount, 0)
  let running = 0
  for (let index = 0; index < limit; index += 1) {
    const line = lineSummaries[index]
    running += netBeforeTotalDiscount > 0
      ? roundCurrency(totalDiscountAmount * (line.netAfterLineDiscount / netBeforeTotalDiscount))
      : 0
  }
  return roundCurrency(running)
}

export default function SmartBookingPage() {
  const { properties } = useProperties()
  const { customers, update: updateCustomer } = useCustomers()
  const { locations } = useLocations()
  const { bookings, add: addBooking } = useBookings()

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1)
  const [requestItems, setRequestItems] = useState<RequestItemState[]>([createRequestItem()])
  const [requestText, setRequestText] = useState('')
  const [parsedRequest, setParsedRequest] = useState<ParsedBookingRequest | null>(null)
  const [customerId, setCustomerId] = useState('')
  const [bookingStatus, setBookingStatus] = useState<'anfrage' | 'option' | 'bestaetigt'>('bestaetigt')
  const [notes, setNotes] = useState('')
  const [discountPercent, setDiscountPercent] = useState(0)
  const [vatRate, setVatRate] = useState<0 | 7 | 19>(0)
  const [invoiceForm, setInvoiceForm] = useState<InvoiceFormState | null>(null)
  const [creatingDraft, setCreatingDraft] = useState(false)
  const [creatingContact, setCreatingContact] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draftInvoice, setDraftInvoice] = useState<DraftInvoiceState | null>(null)
  const [draftError, setDraftError] = useState('')
  const [createdBookings, setCreatedBookings] = useState<CreatedBookingItem[]>([])
  const [createError, setCreateError] = useState('')

  const computedRequests = useMemo(() => {
    const plannedBookings: Booking[] = []

    return requestItems.map(item => {
      const location = locations.find(entry => entry.id === item.locationId)
      const locationProps = properties.filter(prop => prop.locationId === item.locationId && prop.active)
      const nights = item.checkIn && item.checkOut
        ? Math.max(0, differenceInDays(new Date(item.checkOut), new Date(item.checkIn)))
        : 0
      const valid = isValidRequestItem(item)
      const availabilities = valid
        ? calcAvailableBedsPerProperty(
            new Date(item.checkIn),
            new Date(item.checkOut),
            locationProps,
            [...bookings, ...plannedBookings],
          )
        : []
      const autoResult = valid ? allocateBeds(item.bedsNeeded, availabilities, nights, item.strategy) : null

      const effectiveAllocations = availabilities.map(availability => {
        const autoAllocation = autoResult?.allocations.find(entry => entry.propertyId === availability.propertyId)
        const manualBeds = item.manualAllocations[availability.propertyId]
        const bedsAllocated = Math.max(
          0,
          Math.min(
            availability.minFreeBeds,
            manualBeds !== undefined ? manualBeds : (autoAllocation?.bedsAllocated ?? 0),
          ),
        )
        const pricePerBedNight = item.manualPrices[availability.propertyId] ?? availability.pricePerBedNight
        const cleaningFee = item.manualCleaning[availability.propertyId] ?? availability.cleaningFee
        const subtotal = bedsAllocated * nights * pricePerBedNight + (bedsAllocated > 0 ? cleaningFee : 0)

        return {
          propertyId: availability.propertyId,
          propertyName: availability.propertyName,
          shortCode: availability.shortCode,
          bedsAllocated,
          totalBeds: availability.totalBeds,
          minFreeBeds: availability.minFreeBeds,
          pricePerBedNight,
          cleaningFee,
          nights,
          subtotal,
        } satisfies AllocationEntry
      })

      const activeAllocations = effectiveAllocations.filter(entry => entry.bedsAllocated > 0)
      const totalAllocated = activeAllocations.reduce((sum, entry) => sum + entry.bedsAllocated, 0)
      const subtotalBeforeDiscount = activeAllocations.reduce((sum, entry) => sum + entry.subtotal, 0)
      const computedItem: ComputedRequestItem = {
        ...item,
        locationName: location?.name ?? 'Standort unbekannt',
        locationColor: location?.color ?? '#94a3b8',
        nights,
        valid,
        availabilities,
        effectiveAllocations,
        activeAllocations,
        totalAllocated,
        totalFreeBeds: availabilities.reduce((sum, entry) => sum + entry.minFreeBeds, 0),
        subtotalBeforeDiscount,
        shortfall: Math.max(item.bedsNeeded - totalAllocated, 0),
      }

      activeAllocations.forEach(entry => {
        plannedBookings.push(buildPlannedBooking(computedItem, entry))
      })

      return computedItem
    })
  }, [bookings, locations, properties, requestItems])

  const invoiceLines = useMemo<InvoiceLineItem[]>(
    () =>
      computedRequests
        .flatMap(item =>
          item.activeAllocations.map(entry => ({
            ...entry,
            requestId: item.id,
            locationName: item.locationName,
            checkIn: item.checkIn,
            checkOut: item.checkOut,
          })),
        )
        .map((entry, index) => ({
          ...entry,
          positionNumber: index + 1,
        })),
    [computedRequests],
  )

  const totalAllocated = invoiceLines.reduce((sum, entry) => sum + entry.bedsAllocated, 0)
  const currentCustomer = customers.find(customer => customer.id === customerId)
  const requestDataValid = requestItems.every(item => isValidRequestItem(item))
  const canCreateDraft = Boolean(customerId) && Boolean(invoiceForm?.lines.length) && !creatingDraft && !creatingContact
  const canCreateBookings = Boolean(customerId) && invoiceLines.length > 0 && !creating && Boolean(draftInvoice)
  const canContinueToCustomer = invoiceLines.length > 0
  const canContinueToInvoice = Boolean(customerId) && invoiceLines.length > 0

  const countryCode = useMemo(() => {
    const rawCountry = currentCustomer?.country?.trim().toLowerCase()
    if (!rawCountry || rawCountry === 'de' || rawCountry === 'deutschland' || rawCountry === 'germany') return 'DE'
    return currentCustomer?.country?.slice(0, 2).toUpperCase() || 'DE'
  }, [currentCustomer])

  const invoiceTotals = useMemo(
    () => calculateInvoiceFormTotals(invoiceForm?.lines ?? [], invoiceForm?.totalDiscountPercentage ?? 0),
    [invoiceForm],
  )

  useEffect(() => {
    if (!currentCustomer || step < 4) return
    setInvoiceForm(prev => {
      if (!prev) return prev
      return {
        ...prev,
        customerName: currentCustomer.companyName || prev.customerName,
        addressSupplement: prev.addressSupplement || `${currentCustomer.firstName ?? ''} ${currentCustomer.lastName ?? ''}`.trim() || parsedRequest?.billingAddressSupplement || parsedRequest?.contactName || '',
        street: prev.street || currentCustomer.address || parsedRequest?.billingStreet || '',
        zip: prev.zip || currentCustomer.zip || parsedRequest?.billingZip || '',
        city: prev.city || currentCustomer.city || parsedRequest?.billingCity || '',
        countryCode: prev.countryCode || countryCode || inferCountryCodeFromParsedRequest(parsedRequest, countryCode),
      }
    })
  }, [countryCode, currentCustomer, parsedRequest, step])

  const updateRequestItem = (requestId: string, updater: (item: RequestItemState) => RequestItemState) => {
    setRequestItems(prev => prev.map(item => (item.id === requestId ? updater(item) : item)))
  }

  const updateInvoiceForm = (updater: (form: InvoiceFormState) => InvoiceFormState) => {
    setInvoiceForm(prev => (prev ? updater(prev) : prev))
  }

  const updateInvoiceField = <K extends keyof InvoiceFormState>(field: K, value: InvoiceFormState[K]) => {
    updateInvoiceForm(form => ({ ...form, [field]: value }))
  }

  const updateInvoiceLine = (lineId: string, updater: (line: InvoiceDraftLine) => InvoiceDraftLine) => {
    updateInvoiceForm(form => ({
      ...form,
      lines: form.lines.map(line => (line.id === lineId ? updater(line) : line)),
    }))
  }

  const addInvoiceLine = (kind: 'custom' | 'text') => {
    updateInvoiceForm(form => ({
      ...form,
      lines: [
        ...form.lines,
        {
          id: createInvoiceDraftLineId(),
          kind,
          name: kind === 'text' ? 'Freitext' : 'Zusatzposition',
          description: '',
          quantity: kind === 'text' ? 0 : 1,
          unitName: kind === 'text' ? '' : 'Stück',
          unitPriceNet: 0,
          discountPercentage: 0,
          taxRate: vatRate,
        },
      ],
    }))
  }

  const removeInvoiceLine = (lineId: string) => {
    updateInvoiceForm(form => ({
      ...form,
      lines: form.lines.filter(line => line.id !== lineId),
    }))
  }

  const updateRequestField = (
    requestId: string,
    field: 'locationId' | 'checkIn' | 'checkOut' | 'bedsNeeded' | 'strategy',
    value: string | number,
  ) => {
    updateRequestItem(requestId, item => {
      if (field === 'bedsNeeded') {
        return { ...item, bedsNeeded: Math.max(1, Number(value) || 1) }
      }
      if (field === 'strategy') {
        return { ...item, strategy: value as AllocationStrategy, manualAllocations: {} }
      }
      return { ...item, [field]: value }
    })
  }

  const updateManualValue = (
    requestId: string,
    field: 'manualAllocations' | 'manualPrices' | 'manualCleaning',
    propertyId: string,
    value: number,
  ) => {
    updateRequestItem(requestId, item => ({
      ...item,
      [field]: {
        ...item[field],
        [propertyId]: value,
      },
    }))
  }

  const clearManualAllocations = (requestId: string) => {
    updateRequestItem(requestId, item => ({
      ...item,
      manualAllocations: {},
    }))
  }

  const applyExclusivePropertySelection = (
    requestId: string,
    propertyId: string,
    bedsNeeded: number,
    availabilities: PropertyAvailability[],
  ) => {
    updateRequestItem(requestId, item => {
      const nextManualAllocations = availabilities.reduce<Record<string, number>>((acc, availability) => {
        acc[availability.propertyId] =
          availability.propertyId === propertyId
            ? Math.min(availability.minFreeBeds, bedsNeeded)
            : 0
        return acc
      }, {})

      return {
        ...item,
        manualAllocations: nextManualAllocations,
      }
    })
  }

  const handleAnalyzeRequest = () => {
    const parsed = parseBookingRequest(requestText, {
      properties,
      locations,
      customers,
    })
    setParsedRequest(parsed)

    const firstItem = requestItems[0]
    const scopedProperties = parsed.matchedLocationId
      ? properties.filter(property => property.locationId === parsed.matchedLocationId)
      : []
    const manualPrices = parsed.requestedNetPrice !== undefined
      ? scopedProperties.reduce<Record<string, number>>((acc, property) => {
          acc[property.id] = parsed.requestedNetPrice!
          return acc
        }, {})
      : {}

    setRequestItems(prev => prev.map((item, index) => {
      if (index !== 0) return item
      return {
        ...item,
        locationId: parsed.matchedLocationId ?? item.locationId,
        checkIn: parsed.checkIn ?? item.checkIn,
        checkOut: parsed.checkOut ?? item.checkOut,
        bedsNeeded: parsed.bedsNeeded ?? item.bedsNeeded,
        manualPrices: Object.keys(manualPrices).length > 0 ? manualPrices : item.manualPrices,
      }
    }))

    if (parsed.matchedCustomerId) {
      setCustomerId(parsed.matchedCustomerId)
    }

    const parsedNotes = buildParsedRequestNotes(parsed)
    setNotes(currentNotes => {
      if (!parsedNotes) return currentNotes
      if (!currentNotes.trim()) return parsedNotes
      if (currentNotes.includes(parsed.originalText)) return currentNotes
      return `${parsedNotes}\n\n${currentNotes}`
    })

    if (firstItem && parsed.matchedLocationId && parsed.checkIn && parsed.checkOut && parsed.bedsNeeded) {
      setStep(1)
    }
  }

  const handleAddRequestItem = (returnToStep1 = false) => {
    setRequestItems(prev => {
      const last = prev.at(-1)
      return [
        ...prev,
        createRequestItem({
          locationId: last?.locationId,
        }),
      ]
    })

    if (returnToStep1) {
      setStep(1)
    }
  }

  const handleRemoveRequestItem = (requestId: string) => {
    setRequestItems(prev => (prev.length === 1 ? prev : prev.filter(item => item.id !== requestId)))
  }

  const handleCheckAvailability = () => {
    if (!requestDataValid) return
    setStep(2)
  }

  const handleOpenCustomerStep = () => {
    if (!canContinueToCustomer) return
    setStep(3)
  }

  const handleOpenInvoiceStep = () => {
    if (!canContinueToInvoice) return
    setDraftInvoice(null)
    setDraftError('')
    const fallbackCountryCode = inferCountryCodeFromParsedRequest(parsedRequest, countryCode)
    const initialForm = createInitialInvoiceForm({
      customer: currentCustomer,
      invoiceLines,
      notes,
      defaultTaxRate: vatRate,
      totalDiscountPercentage: discountPercent,
      fallbackCountryCode,
    })

    setInvoiceForm({
      ...initialForm,
      customerName: initialForm.customerName || parsedRequest?.billingCompanyName || parsedRequest?.customerName || '',
      addressSupplement: initialForm.addressSupplement || parsedRequest?.billingAddressSupplement || parsedRequest?.contactName || '',
      street: initialForm.street || parsedRequest?.billingStreet || '',
      zip: initialForm.zip || parsedRequest?.billingZip || '',
      city: initialForm.city || parsedRequest?.billingCity || '',
      countryCode: initialForm.countryCode || fallbackCountryCode,
    })
    setStep(4)
  }

  const handleCreateDraft = async () => {
    if (!currentCustomer || !customerId || !invoiceForm || invoiceForm.lines.length === 0) return

    setCreatingDraft(true)
    setDraftError('')
    setDraftInvoice(null)

    try {
      let lexofficeContactId = currentCustomer.lexofficeContactId

      if (!lexofficeContactId) {
        setCreatingContact(true)

        const contactPayload = buildLexofficeContactPayload({
          companyName: invoiceForm.customerName || currentCustomer.companyName,
          addressSupplement: invoiceForm.addressSupplement,
          street: invoiceForm.street,
          zip: invoiceForm.zip,
          city: invoiceForm.city,
          countryCode: invoiceForm.countryCode || countryCode,
          email: parsedRequest?.email || currentCustomer.email,
          phone: parsedRequest?.phone || currentCustomer.phone,
          firstName: currentCustomer.firstName || parsedRequest?.contactName?.split(' ').slice(0, -1).join(' '),
          lastName: currentCustomer.lastName || parsedRequest?.contactName?.split(' ').at(-1),
          taxId: currentCustomer.taxId || parsedRequest?.billingTaxId,
          note: notes.trim(),
        })

        const contactRes = await fetch('/api/lexoffice/create-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId,
            payload: contactPayload,
          }),
        })

        const contactData = await contactRes.json()
        if (!contactRes.ok || !contactData?.ok || !contactData?.id) {
          throw new Error(contactData?.error || 'Lexoffice-Kontakt konnte nicht erstellt werden.')
        }

        lexofficeContactId = contactData.id
        await updateCustomer(customerId, { lexofficeContactId })
      }

      const payload = buildLexofficeInvoicePayload({
        customer: {
          ...currentCustomer,
          lexofficeContactId,
        },
        invoiceForm,
        fallbackCountryCode: countryCode,
      })

      const createRes = await fetch('/api/lexoffice/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'invoice',
          finalize: false,
          ...payload,
        }),
      })

      const createData = await createRes.json()
      if (!createRes.ok || !createData?.ok || !createData?.id) {
        throw new Error(createData?.error || 'Lexoffice-Entwurf konnte nicht erstellt werden.')
      }

      let voucherNumber: string | undefined
      let voucherStatus: string | undefined

      try {
        const detailRes = await fetch(`/api/lexoffice/vouchers?type=invoice&id=${encodeURIComponent(createData.id)}`)
        const detailData = await detailRes.json()
        if (detailRes.ok) {
          voucherNumber = detailData?.voucherNumber
          voucherStatus = detailData?.voucherStatus
        }
      } catch {
        // Detaildaten sind optional. Der Entwurf gilt trotzdem als erstellt.
      }

      const query = voucherNumber || createData.id
      setDraftInvoice({
        id: createData.id,
        voucherNumber,
        voucherStatus,
        lexofficeUrl: `https://app.lexoffice.de/vouchers#!/VoucherList/?filter=lastedited&sort=sortByLastModifiedDate&query=${encodeURIComponent(query)}`,
      })
      setStep(5)
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : String(error))
    } finally {
      setCreatingContact(false)
      setCreatingDraft(false)
    }
  }

  const handleCreateBookings = async () => {
    if (!customerId || invoiceLines.length === 0 || !draftInvoice || !invoiceForm) return
    setCreating(true)
    setCreateError('')
    const created: CreatedBookingItem[] = []
    const bookingLineTotals = invoiceTotals.lineTotals.reduce((acc, line) => {
      if (!line.linkedBooking || !line.sourceKey) return acc
      acc[line.sourceKey] = roundCurrency((acc[line.sourceKey] ?? 0) + line.netAfterTotalDiscount + line.taxAmount)
      return acc
    }, {} as Record<string, number>)
    const positionSummary = computedRequests
      .map((item, index) => `Pos. ${index + 1}: ${item.locationName}, ${formatRange(item.checkIn, item.checkOut)}, ${item.bedsNeeded} Betten`)
      .join('\n')
    const sharedNotes = [
      'Sammelbuchung',
      positionSummary,
      invoiceForm.totalDiscountPercentage > 0 ? `Gesamtrabatt: ${invoiceForm.totalDiscountPercentage}%` : '',
      invoiceForm.remark.trim(),
    ]
      .filter(Boolean)
      .join('\n')

    try {
      for (const line of invoiceLines) {
        const finalPrice = bookingLineTotals[`${line.requestId}:${line.propertyId}`] ?? line.subtotal
        const booking = await addBooking({
          propertyId: line.propertyId,
          customerId,
          checkIn: line.checkIn,
          checkOut: line.checkOut,
          nights: line.nights,
          bedsBooked: line.bedsAllocated,
          pricePerBedNight: line.pricePerBedNight,
          cleaningFee: line.cleaningFee,
          totalPrice: finalPrice,
          status: bookingStatus,
          paymentStatus: 'offen',
          notes: `${sharedNotes}\nRechnungsposition ${line.positionNumber}: ${line.locationName}, ${formatRange(line.checkIn, line.checkOut)}`,
          lexofficeInvoiceId: draftInvoice.id,
          invoiceNumber: draftInvoice.voucherNumber ?? '',
          source: 'manual',
        })

        created.push({
          id: booking.id,
          bookingNumber: booking.bookingNumber,
          propertyName: line.propertyName,
          beds: line.bedsAllocated,
          positionNumber: line.positionNumber,
        })
      }

      setCreatedBookings(created)
      setStep(6)
    } catch (error) {
      setCreateError(
        `Fehler beim Erstellen: ${error instanceof Error ? error.message : String(error)}. ${created.length} von ${invoiceLines.length} Buchungen wurden erstellt.`,
      )
      if (created.length > 0) {
        setCreatedBookings(created)
        setStep(6)
      }
    } finally {
      setCreating(false)
    }
  }

  const handleReset = () => {
    setStep(1)
    setRequestItems([createRequestItem()])
    setRequestText('')
    setParsedRequest(null)
    setCustomerId('')
    setBookingStatus('bestaetigt')
    setNotes('')
    setDiscountPercent(0)
    setVatRate(0)
    setInvoiceForm(null)
    setCreatingDraft(false)
    setCreatingContact(false)
    setCreating(false)
    setDraftInvoice(null)
    setDraftError('')
    setCreatedBookings([])
    setCreateError('')
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/buchungen" className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft size={18} className="text-slate-600" />
        </Link>
        <div className="flex items-center gap-2">
          <Zap size={20} className="text-amber-500" />
          <h1 className="text-2xl font-bold text-slate-900">Leerstand</h1>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-6">
        {[
          { n: 1, label: 'Bedarf' },
          { n: 2, label: 'Verfügbarkeit' },
          { n: 3, label: 'Auftraggeber' },
          { n: 4, label: 'Rechnung' },
          { n: 5, label: 'Entwurf' },
          { n: 6, label: 'Fertig' },
        ].map(({ n, label }, index) => (
          <div key={n} className="flex items-center gap-2">
            {index > 0 && <div className={`w-8 h-px ${step >= n ? 'bg-blue-400' : 'bg-slate-200'}`} />}
            <div
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                step === n
                  ? 'bg-blue-600 text-white'
                  : step > n
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-400'
              }`}
            >
              {step > n ? <Check size={12} /> : <span>{n}</span>}
              <span>{label}</span>
            </div>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
            <div>
              <h2 className="font-semibold text-slate-900 mb-1">Verfügbarkeit prüfen</h2>
              <p className="text-sm text-slate-500">
                Prüfe zuerst nur Standort, Zeitraum und Bettenbedarf. Auftraggeber und Rechnungsdaten kannst du später eintragen.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">Kundenanfrage einfÃ¼gen</p>
                <p className="text-sm text-slate-500">
                  Freitext, Mail oder Chatnachricht einfÃ¼gen. Die relevanten Felder werden automatisch erkannt und soweit mÃ¶glich vorbelegt.
                </p>
              </div>

              <textarea
                value={requestText}
                onChange={event => setRequestText(event.target.value)}
                rows={10}
                placeholder="Anfrage hier einfÃ¼gen..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />

              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={handleAnalyzeRequest}
                  disabled={!requestText.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Search size={16} />
                  Anfrage analysieren
                </button>
                {parsedRequest && (
                  <span className="text-sm text-slate-500">
                    Zeitraum, Personen, Standort, Preis und Rechnungsinfos wurden in die Eingabemaske Ã¼bernommen.
                  </span>
                )}
              </div>

              {parsedRequest && (
                <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-900 mb-3">Erkannt</p>
                    <div className="grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                      <p><span className="font-medium text-slate-900">Zeitraum:</span> {parsedRequest.checkIn && parsedRequest.checkOut ? formatRange(parsedRequest.checkIn, parsedRequest.checkOut) : 'nicht erkannt'}</p>
                      <p><span className="font-medium text-slate-900">Personen:</span> {parsedRequest.bedsNeeded ?? 'nicht erkannt'}</p>
                      <p><span className="font-medium text-slate-900">Standort:</span> {parsedRequest.matchedLocationName ?? parsedRequest.objectHint ?? 'nicht erkannt'}</p>
                      <p><span className="font-medium text-slate-900">Preis netto:</span> {parsedRequest.requestedNetPrice !== undefined ? `${parsedRequest.requestedNetPrice} EUR` : 'nicht erkannt'}</p>
                      <p><span className="font-medium text-slate-900">Auftraggeber:</span> {parsedRequest.matchedCustomerName ?? parsedRequest.customerName ?? 'nicht erkannt'}</p>
                      <p><span className="font-medium text-slate-900">Ansprechpartner:</span> {parsedRequest.contactName ?? 'nicht erkannt'}</p>
                      <p><span className="font-medium text-slate-900">E-Mail:</span> {parsedRequest.email ?? 'nicht erkannt'}</p>
                      <p><span className="font-medium text-slate-900">Telefon:</span> {parsedRequest.phone ?? 'nicht erkannt'}</p>
                    </div>

                    {parsedRequest.matchedProperties.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-400 mb-2">Objekt-Treffer</p>
                        <div className="flex flex-wrap gap-2">
                          {parsedRequest.matchedProperties.slice(0, 6).map(property => (
                            <span key={property.id} className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                              {property.shortCode || property.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-semibold text-amber-900 mb-2">Gezielt nachfragen</p>
                    {parsedRequest.clarificationQuestions.length > 0 ? (
                      <div className="space-y-2">
                        {parsedRequest.clarificationQuestions.map(question => (
                          <p key={question} className="text-sm text-amber-800">{question}</p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-amber-800">
                        Keine offenen Punkte erkannt. Du kannst direkt die VerfÃ¼gbarkeit prÃ¼fen.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-900">Positionen</h2>
              <p className="text-sm text-slate-500">Füge beliebig viele Zeiträume oder Standorte in einer Sammelrechnung hinzu.</p>
            </div>
            <button
              onClick={() => handleAddRequestItem(false)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Plus size={16} />
              Position
            </button>
          </div>

          {requestItems.map((item, index) => {
            const selectedLocation = locations.find(location => location.id === item.locationId)
            const locationProps = properties.filter(property => property.locationId === item.locationId && property.active)
            const locationBeds = locationProps.reduce((sum, property) => sum + property.beds, 0)
            const nights = item.checkIn && item.checkOut
              ? Math.max(0, differenceInDays(new Date(item.checkOut), new Date(item.checkIn)))
              : 0

            return (
              <div key={item.id} className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Position {index + 1}</p>
                    <p className="text-sm text-slate-500">Standort, Zeitraum und Bettenbedarf für diese Rechnungsposition.</p>
                  </div>
                  {requestItems.length > 1 && (
                    <button
                      onClick={() => handleRemoveRequestItem(item.id)}
                      className="inline-flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      <Trash2 size={15} />
                      Entfernen
                    </button>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Standort *</label>
                  <select
                    value={item.locationId}
                    onChange={event => updateRequestField(item.id, 'locationId', event.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Standort wählen...</option>
                    {locations.map(location => {
                      const propsAtLocation = properties.filter(property => property.locationId === location.id && property.active)
                      const bedsAtLocation = propsAtLocation.reduce((sum, property) => sum + property.beds, 0)
                      return (
                        <option key={location.id} value={location.id}>
                          {location.name} - {propsAtLocation.length} Portfolio, {bedsAtLocation} Betten
                        </option>
                      )
                    })}
                  </select>
                  {selectedLocation && (
                    <p className="text-xs text-slate-500 mt-1">
                      {locationProps.length} Portfolio - {locationBeds} Betten gesamt am Standort {selectedLocation.name}
                    </p>
                  )}
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Anreise *</label>
                    <input
                      type="date"
                      value={item.checkIn}
                      onChange={event => updateRequestField(item.id, 'checkIn', event.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Abreise *</label>
                    <input
                      type="date"
                      value={item.checkOut}
                      min={item.checkIn || undefined}
                      onChange={event => updateRequestField(item.id, 'checkOut', event.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      <span className="flex items-center gap-1.5"><BedDouble size={15} /> Betten benötigt *</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={item.bedsNeeded}
                      onChange={event => updateRequestField(item.id, 'bedsNeeded', event.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {nights > 0 && (
                  <p className="text-xs text-slate-500 -mt-2">
                    {nights} Nächte für Position {index + 1}
                  </p>
                )}
              </div>
            )
          })}

          <button
            onClick={handleCheckAvailability}
            disabled={!requestDataValid}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Search size={16} />
            Verfügbarkeit prüfen
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold text-slate-900">Verfügbarkeit und Zuteilung</h2>
              <p className="text-sm text-slate-500">
                {requestItems.length} Position{requestItems.length !== 1 ? 'en' : ''} geprüft. Hier kannst du die Verteilung prüfen und bei Bedarf weitere Positionen hinzufügen.
              </p>
            </div>
            <button
              onClick={() => handleAddRequestItem(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Plus size={16} />
              Weitere Position
            </button>
          </div>

          {computedRequests.map((item, index) => {
            const canFulfill = item.totalAllocated >= item.bedsNeeded
            const partial = item.totalAllocated > 0 && !canFulfill

            return (
              <div key={item.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Position {index + 1}</p>
                      <h3 className="text-base font-semibold text-slate-900">{item.locationName}</h3>
                      <p className="text-sm text-slate-500">
                        {formatRange(item.checkIn, item.checkOut)} - {item.nights} Nächte - {item.bedsNeeded} Betten gesucht
                      </p>
                    </div>
                    <span
                      className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                        canFulfill
                          ? 'bg-emerald-100 text-emerald-700'
                          : partial
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {item.totalAllocated} von {item.bedsNeeded} Betten zugewiesen
                    </span>
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Strategie:</span>
                    <div className="flex bg-slate-100 rounded-full p-0.5">
                      <button
                        onClick={() => updateRequestField(item.id, 'strategy', 'fewest-properties')}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          item.strategy === 'fewest-properties' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                        }`}
                      >
                        Wenig Portfolio
                      </button>
                      <button
                        onClick={() => updateRequestField(item.id, 'strategy', 'cheapest-first')}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          item.strategy === 'cheapest-first' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                        }`}
                      >
                        Günstigster Preis
                      </button>
                    </div>
                  </div>

                  {item.effectiveAllocations.filter(allocation => allocation.minFreeBeds >= item.bedsNeeded).length > 1 && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 space-y-3">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <p className="text-sm font-semibold text-blue-900">Wohnung direkt auswÃ¤hlen</p>
                          <p className="text-sm text-blue-700">
                            Mehrere Einheiten kÃ¶nnen die komplette Position aufnehmen. Du kannst hier gezielt mit 1, 2, 3 ... die gewÃ¼nschte Wohnung festlegen.
                          </p>
                        </div>
                        <button
                          onClick={() => clearManualAllocations(item.id)}
                          className="text-xs font-medium text-blue-700 hover:text-blue-900"
                        >
                          Automatik wiederherstellen
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {item.effectiveAllocations
                          .filter(allocation => allocation.minFreeBeds >= item.bedsNeeded)
                          .map((allocation, candidateIndex) => {
                            const selected = isSinglePropertySelected(item, allocation.propertyId)
                            return (
                              <button
                                key={allocation.propertyId}
                                onClick={() =>
                                  applyExclusivePropertySelection(
                                    item.id,
                                    allocation.propertyId,
                                    item.bedsNeeded,
                                    item.availabilities,
                                  )
                                }
                                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                                  selected
                                    ? 'border-blue-600 bg-blue-600 text-white'
                                    : 'border-blue-200 bg-white text-blue-800 hover:border-blue-300 hover:bg-blue-100'
                                }`}
                              >
                                <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                                  selected ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-700'
                                }`}>
                                  {candidateIndex + 1}
                                </span>
                                <span>{allocation.shortCode || allocation.propertyName}</span>
                              </button>
                            )
                          })}
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-600">
                          <th className="text-center px-3 py-2.5 font-medium w-14">Nr.</th>
                          <th className="text-left px-4 py-2.5 font-medium">Objekt</th>
                          <th className="text-center px-3 py-2.5 font-medium w-20">Kap.</th>
                          <th className="text-center px-3 py-2.5 font-medium w-16">Frei</th>
                          <th className="text-center px-3 py-2.5 font-medium w-28">Zugewiesen</th>
                          <th className="text-right px-3 py-2.5 font-medium w-28">EUR/Bett/N</th>
                          <th className="text-right px-3 py-2.5 font-medium w-28">Reinigung</th>
                          <th className="text-right px-4 py-2.5 font-medium w-28">Summe</th>
                        </tr>
                      </thead>
                      <tbody>
                        {item.effectiveAllocations.map((allocation, allocationIndex) => {
                          const isFull = allocation.minFreeBeds === 0
                          const isAssigned = allocation.bedsAllocated > 0

                          return (
                            <tr
                              key={allocation.propertyId}
                              className={`border-b border-slate-100 transition-colors ${
                                isAssigned
                                  ? 'bg-emerald-50/80 shadow-[inset_4px_0_0_0_rgb(16_185_129)]'
                                  : isFull
                                    ? 'opacity-40'
                                    : 'hover:bg-slate-50'
                              }`}
                            >
                              <td className="px-3 py-3 text-center">
                                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                                  isAssigned ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {allocationIndex + 1}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.locationColor }} />
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <p className="font-medium text-slate-800 truncate max-w-[240px]">{allocation.propertyName}</p>
                                      {isAssigned && (
                                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                                          {allocation.bedsAllocated} Bett{allocation.bedsAllocated !== 1 ? 'en' : ''} zugewiesen
                                        </span>
                                      )}
                                    </div>
                                    {allocation.shortCode && (
                                      <span className={`text-xs font-mono ${isAssigned ? 'text-emerald-700/80' : 'text-slate-400'}`}>
                                        {allocation.shortCode}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="text-center px-3 py-3 text-slate-600">{allocation.totalBeds}</td>
                              <td className="text-center px-3 py-3">
                                <span
                                  className={`font-medium ${
                                    allocation.minFreeBeds === 0
                                      ? 'text-red-500'
                                      : allocation.minFreeBeds <= 2
                                        ? 'text-amber-600'
                                        : 'text-emerald-600'
                                  }`}
                                >
                                  {allocation.minFreeBeds}
                                </span>
                              </td>
                              <td className="text-center px-3 py-3">
                                {isFull ? (
                                  <span className="text-xs text-slate-400">belegt</span>
                                ) : (
                                  <input
                                    type="number"
                                    min={0}
                                    max={allocation.minFreeBeds}
                                    value={allocation.bedsAllocated}
                                    onChange={event =>
                                      updateManualValue(
                                        item.id,
                                        'manualAllocations',
                                        allocation.propertyId,
                                        Math.max(0, Math.min(allocation.minFreeBeds, Number(event.target.value) || 0)),
                                      )
                                    }
                                    className={`w-16 mx-auto px-2 py-1 border rounded text-center text-sm focus:outline-none focus:ring-2 ${
                                      isAssigned
                                        ? 'border-emerald-300 bg-white font-semibold text-emerald-700 focus:ring-emerald-300'
                                        : 'border-slate-200 focus:ring-blue-500'
                                    }`}
                                  />
                                )}
                              </td>
                              <td className="text-right px-3 py-3">
                                {isFull ? (
                                  <span className="text-slate-400">-</span>
                                ) : (
                                  <div className="relative inline-block">
                                    <input
                                      type="number"
                                      min={0}
                                      step={0.5}
                                      value={allocation.pricePerBedNight || ''}
                                      onChange={event =>
                                        updateManualValue(
                                          item.id,
                                          'manualPrices',
                                          allocation.propertyId,
                                          Math.max(0, Number(event.target.value) || 0),
                                        )
                                      }
                                      placeholder="0"
                                      className="w-24 pl-5 pr-2 py-1 border border-slate-200 rounded text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                    <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">EUR</span>
                                  </div>
                                )}
                              </td>
                              <td className="text-right px-3 py-3">
                                {isFull ? (
                                  <span className="text-slate-400">-</span>
                                ) : (
                                  <div className="relative inline-block">
                                    <input
                                      type="number"
                                      min={0}
                                      step={5}
                                      value={allocation.cleaningFee || ''}
                                      onChange={event =>
                                        updateManualValue(
                                          item.id,
                                          'manualCleaning',
                                          allocation.propertyId,
                                          Math.max(0, Number(event.target.value) || 0),
                                        )
                                      }
                                      placeholder="0"
                                      className="w-24 pl-5 pr-2 py-1 border border-slate-200 rounded text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                    <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">EUR</span>
                                  </div>
                                )}
                              </td>
                              <td className="text-right px-4 py-3 font-medium text-slate-800">
                                {allocation.bedsAllocated > 0 ? formatCurrency(allocation.subtotal) : '-'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {item.shortfall > 0 && (
                    <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
                      <p className="text-sm text-amber-800">
                        Für Position {index + 1} fehlen noch {item.shortfall} Bett{item.shortfall !== 1 ? 'en' : ''}.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          <div className="flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <ChevronLeft size={16} />
              Zurück
            </button>
            <button
              onClick={handleOpenCustomerStep}
              disabled={!canContinueToCustomer}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={16} />
              Kunden anlegen
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
            <div>
              <h2 className="font-semibold text-slate-900 mb-1">Auftraggeber und Buchungsdaten</h2>
              <p className="text-sm text-slate-500">
                Wähle jetzt den Auftraggeber und die gemeinsamen Angaben für alle geplanten Buchungen.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Auftraggeber *</label>
                <select
                  value={customerId}
                  onChange={event => setCustomerId(event.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Firma wählen...</option>
                  {customers.map(customer => (
                    <option key={customer.id} value={customer.id}>
                      {customer.companyName}
                      {(customer.firstName || customer.lastName) ? ` (${customer.firstName} ${customer.lastName})`.trim() : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Status</label>
                <select
                  value={bookingStatus}
                  onChange={event => setBookingStatus(event.target.value as typeof bookingStatus)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="anfrage">Anfrage</option>
                  <option value="option">Option</option>
                  <option value="bestaetigt">Bestätigt</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Notiz für alle Positionen</label>
              <textarea
                value={notes}
                onChange={event => setNotes(event.target.value)}
                rows={3}
                placeholder="Optional..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            {!customerId && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
                <p className="text-sm text-amber-800">
                  Bitte wähle einen Auftraggeber aus, bevor du mit der Rechnungsfinalisierung weitermachst.
                </p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-sm font-semibold text-slate-900">Zwischenstand</p>
            <p className="mt-1 text-sm text-slate-500">
              {invoiceLines.length} geplante Buchung{invoiceLines.length !== 1 ? 'en' : ''} für {totalAllocated} Betten.
            </p>
            <p className="text-sm text-slate-500">
              Auftraggeber: {currentCustomer?.companyName ?? 'noch nicht ausgewählt'}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(2)}
              className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <ChevronLeft size={16} />
              Zur Verfügbarkeit
            </button>
            <button
              onClick={handleOpenInvoiceStep}
              disabled={!canContinueToInvoice}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileText size={16} />
              Rechnung finalisieren
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold text-slate-900">Rechnungsentwurf</h2>
              <p className="text-sm text-slate-500">
                Fülle die Rechnungsfelder wie in Lexoffice und erstelle daraus den Entwurf.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
              Auftraggeber: <span className="font-semibold text-slate-900">{currentCustomer?.companyName ?? '-'}</span>
            </div>
          </div>

          {invoiceForm && (
            <>
              <div className="grid gap-5 xl:grid-cols-[1.3fr_0.9fr]">
                <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                  <div>
                    <h3 className="font-semibold text-slate-900">Kundendaten</h3>
                    <p className="text-sm text-slate-500">Die Felder werden aus dem Auftraggeber vorbelegt und können hier angepasst werden.</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Kunde</label>
                      <input
                        value={invoiceForm.customerName}
                        onChange={event => updateInvoiceField('customerName', event.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Adresszusatz</label>
                      <input
                        value={invoiceForm.addressSupplement}
                        onChange={event => updateInvoiceField('addressSupplement', event.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Strasse</label>
                      <input
                        value={invoiceForm.street}
                        onChange={event => updateInvoiceField('street', event.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">PLZ</label>
                      <input
                        value={invoiceForm.zip}
                        onChange={event => updateInvoiceField('zip', event.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Ort</label>
                      <input
                        value={invoiceForm.city}
                        onChange={event => updateInvoiceField('city', event.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Land</label>
                      <input
                        value={invoiceForm.countryCode}
                        onChange={event => updateInvoiceField('countryCode', event.target.value.toUpperCase())}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                  <div>
                    <h3 className="font-semibold text-slate-900">Belegdaten</h3>
                    <p className="text-sm text-slate-500">Datum, Leistungszeitraum und Zahlungsziel für den Entwurf.</p>
                  </div>
                  <div className="grid gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Rechnungsdatum</label>
                      <input
                        type="date"
                        value={invoiceForm.voucherDate}
                        onChange={event => updateInvoiceField('voucherDate', event.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Leistungsbeginn</label>
                        <input
                          type="date"
                          value={invoiceForm.serviceDateFrom}
                          onChange={event => updateInvoiceField('serviceDateFrom', event.target.value)}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Leistungsende</label>
                        <input
                          type="date"
                          value={invoiceForm.serviceDateTo}
                          onChange={event => updateInvoiceField('serviceDateTo', event.target.value)}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Zahlungsziel (Tage)</label>
                      <input
                        type="number"
                        min={0}
                        value={invoiceForm.paymentTermDays}
                        onChange={event => updateInvoiceField('paymentTermDays', Math.max(0, Number(event.target.value) || 0))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Gesamtrabatt</label>
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          value={invoiceForm.totalDiscountPercentage || ''}
                          onChange={event => updateInvoiceField('totalDiscountPercentage', Math.max(0, Math.min(100, Number(event.target.value) || 0)))}
                          className="w-full pl-3 pr-8 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Belegtitel</label>
                    <input
                      value={invoiceForm.title}
                      onChange={event => updateInvoiceField('title', event.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Einleitung</label>
                    <input
                      value={invoiceForm.introduction}
                      onChange={event => updateInvoiceField('introduction', event.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Bemerkung</label>
                  <textarea
                    rows={3}
                    value={invoiceForm.remark}
                    onChange={event => updateInvoiceField('remark', event.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 bg-slate-50 flex-wrap">
                  <div>
                    <p className="font-semibold text-slate-900">Positionen</p>
                    <p className="text-sm text-slate-500">Vorbelegt aus der Verteilung. Jede Position kann für Lexoffice angepasst werden.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => addInvoiceLine('custom')}
                      className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <Plus size={15} />
                      Artikel
                    </button>
                    <button
                      onClick={() => addInvoiceLine('text')}
                      className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <Plus size={15} />
                      Freitext
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-slate-100">
                  {invoiceForm.lines.map((line, index) => {
                    const computedLine = invoiceTotals.lineTotals.find(entry => entry.id === line.id)
                    const isReadonlyText = line.kind === 'text'
                    const systemLine = line.kind === 'booking' || line.kind === 'cleaning'

                    return (
                      <div key={line.id} className="p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-sm font-semibold">
                              {index + 1}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                {line.kind === 'booking' ? 'Buchungsposition' : line.kind === 'cleaning' ? 'Endreinigung' : line.kind === 'text' ? 'Freitext' : 'Zusatzposition'}
                              </p>
                              {systemLine && (
                                <p className="text-xs text-slate-400">Vorbelegt aus Leerstand und Zuteilung</p>
                              )}
                            </div>
                          </div>
                          {!systemLine && (
                            <button
                              onClick={() => removeInvoiceLine(line.id)}
                              className="p-2 text-slate-400 hover:text-red-600 transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>

                        <div className="grid gap-4 mt-4 md:grid-cols-[minmax(0,2.5fr)_110px_110px_120px_100px_110px]">
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">Bezeichnung</label>
                            <input
                              value={line.name}
                              onChange={event => updateInvoiceLine(line.id, current => ({ ...current, name: event.target.value }))}
                              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          {!isReadonlyText && (
                            <>
                              <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Menge</label>
                                <input
                                  type="number"
                                  min={0}
                                  step={0.25}
                                  value={line.quantity}
                                  onChange={event => updateInvoiceLine(line.id, current => ({ ...current, quantity: Math.max(0, Number(event.target.value) || 0) }))}
                                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Einheit</label>
                                <input
                                  value={line.unitName}
                                  onChange={event => updateInvoiceLine(line.id, current => ({ ...current, unitName: event.target.value }))}
                                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">VK Netto</label>
                                <input
                                  type="number"
                                  min={0}
                                  step={0.01}
                                  value={line.unitPriceNet}
                                  onChange={event => updateInvoiceLine(line.id, current => ({ ...current, unitPriceNet: Math.max(0, Number(event.target.value) || 0) }))}
                                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Rabatt %</label>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={0.5}
                                  value={line.discountPercentage}
                                  onChange={event => updateInvoiceLine(line.id, current => ({ ...current, discountPercentage: Math.max(0, Math.min(100, Number(event.target.value) || 0)) }))}
                                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">USt</label>
                                <select
                                  value={line.taxRate}
                                  onChange={event => updateInvoiceLine(line.id, current => ({ ...current, taxRate: Number(event.target.value) as 0 | 7 | 19 }))}
                                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                  <option value={0}>0%</option>
                                  <option value={7}>7%</option>
                                  <option value={19}>19%</option>
                                </select>
                              </div>
                            </>
                          )}
                        </div>

                        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_160px]">
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">Beschreibung</label>
                            <textarea
                              rows={2}
                              value={line.description}
                              onChange={event => updateInvoiceLine(line.id, current => ({ ...current, description: event.target.value }))}
                              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                            />
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <p className="text-xs uppercase tracking-wide text-slate-400">Zeilensumme</p>
                            <p className="mt-1 text-lg font-semibold text-slate-900">
                              {formatCurrency(computedLine?.grossAmount ?? 0)}
                            </p>
                            {!isReadonlyText && (
                              <p className="text-xs text-slate-500 mt-1">
                                Netto {formatCurrency(computedLine?.netAfterTotalDiscount ?? 0)}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm text-slate-300">Gesamtumfang</p>
                    <p className="text-lg font-semibold">{invoiceForm.lines.length} Rechnungspositionen</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-slate-300">Netto / USt / Gesamt</p>
                    <p className="text-lg font-semibold">
                      {formatCurrency(invoiceTotals.totalNet)} / {formatCurrency(invoiceTotals.totalTax)} / {formatCurrency(invoiceTotals.totalGross)}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep(3)}
              className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <ChevronLeft size={16} />
              Zum Auftraggeber
            </button>
            <button
              onClick={handleCreateDraft}
              disabled={!canCreateDraft}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creatingDraft ? (
                <span>{creatingContact ? 'Lexoffice-Kontakt wird angelegt...' : 'Entwurf wird erstellt...'}</span>
              ) : (
                <>
                  <FileText size={16} />
                  Entwurf in Lexoffice erstellen
                </>
              )}
            </button>
          </div>

          {!currentCustomer?.lexofficeContactId && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
              <p className="text-sm text-amber-800">
                Für den Auftraggeber ist noch keine Lexoffice-Kontakt-ID hinterlegt. Beim Erstellen des Entwurfs wird deshalb zuerst automatisch ein Lexoffice-Kontakt angelegt.
              </p>
            </div>
          )}

          {draftError && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {draftError}
            </div>
          )}
        </div>
      )}

      {step === 5 && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0">
                <Check size={24} className="text-emerald-600" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-slate-900 mb-1">Lexoffice-Entwurf erstellt</h2>
                <p className="text-sm text-slate-500">
                  Die Rechnung wurde als Entwurf angelegt. Prüfe jetzt das PDF in Lexoffice und lege erst danach die Buchungen an.
                </p>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Auftraggeber</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{currentCustomer?.companyName ?? '-'}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Entwurf</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{draftInvoice?.voucherNumber ?? draftInvoice?.id ?? '-'}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Gesamtbetrag</p>
                    <p className="mt-1 text-sm font-medium text-slate-900">{formatCurrency(invoiceTotals.totalGross)}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {draftInvoice && (
            <div className="bg-violet-50 rounded-xl border border-violet-200 p-4 flex items-center gap-3">
              <FileText size={18} className="text-violet-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-violet-900">Lexoffice-Dokument verknüpft</p>
                <p className="text-xs text-violet-600">
                  {draftInvoice.voucherNumber ?? 'Noch keine Rechnungsnummer'} · ID: {draftInvoice.id}
                  {draftInvoice.voucherStatus ? ` · Status: ${draftInvoice.voucherStatus}` : ''}
                </p>
              </div>
              <a
                href={draftInvoice.lexofficeUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs text-violet-700 hover:text-violet-900 font-medium"
              >
                <ExternalLink size={13} />
                In Lexoffice öffnen
              </a>
            </div>
          )}

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-800">
              Wenn du Rechnungsdaten, Positionen oder Auftraggeber änderst, erstelle danach einen neuen Entwurf.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => {
                setDraftInvoice(null)
                setDraftError('')
                setStep(4)
              }}
              className="flex items-center justify-center gap-2 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <ChevronLeft size={16} />
              Entwurf neu erzeugen
            </button>
            <button
              onClick={handleCreateBookings}
              disabled={!canCreateBookings}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? (
                <span>Buchungen werden angelegt...</span>
              ) : (
                <>
                  <Plus size={16} />
                  {invoiceLines.length} Buchung{invoiceLines.length !== 1 ? 'en' : ''} jetzt anlegen
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {step === 6 && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Check size={24} className="text-emerald-600" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900 mb-1">
              {createdBookings.length} Buchung{createdBookings.length !== 1 ? 'en' : ''} erstellt
            </h2>
            <p className="text-sm text-slate-500">
              {requestItems.length} Position{requestItems.length !== 1 ? 'en' : ''} für {currentCustomer?.companyName ?? 'den Auftraggeber'} - {formatCurrency(invoiceTotals.totalGross)}
            </p>
          </div>

          {createError && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {createError}
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {createdBookings.map(booking => (
              <Link
                key={booking.id}
                href={`/buchungen/${booking.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors group"
              >
                <div>
                  <p className="font-medium text-slate-800 group-hover:text-blue-700 transition-colors">
                    {booking.bookingNumber}
                  </p>
                  <p className="text-xs text-slate-500">
                    Position {booking.positionNumber} - {booking.propertyName} - {booking.beds} Betten
                  </p>
                </div>
                <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-400" />
              </Link>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleReset}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <Zap size={16} />
              Weiteren Leerstand anlegen
            </button>
            <Link
              href="/buchungen"
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Zur Buchungsliste
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
