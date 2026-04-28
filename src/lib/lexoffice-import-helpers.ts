import type { Property } from '@/lib/types'
import type { LexInvoice, LexLineItem, LexVoucherListItem } from '@/lib/lexoffice'
import type { LexofficeImportConfidence, LexofficeImportPosition } from '@/lib/types'

export interface ParsedLexofficeItem {
  voucher: LexVoucherListItem
  detail: LexInvoice
  positions: LexofficeImportPosition[]
  isStorno: boolean
  referencedInvoiceNumber?: string
}

function cleanText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9äöüß]/g, '')
}

export function matchProperty(text: string, properties: Property[]): Property | undefined {
  const textLower = text.toLowerCase()
  const textClean = cleanText(text)
  const byCodeLen = [...properties].sort(
    (a, b) => cleanText(b.shortCode ?? '').length - cleanText(a.shortCode ?? '').length,
  )

  for (const property of byCodeLen) {
    if (!property.shortCode?.trim()) continue
    const escaped = property.shortCode.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const flexed = escaped.replace(/[\s\-_/]+/g, '[\\s\\-_/]*')
    try {
      const regex = new RegExp(`(?<![a-zA-Z0-9])${flexed}(?![a-zA-Z0-9])`, 'i')
      if (regex.test(text)) return property
    } catch {
      // Ignore invalid regex fragments from user-provided short codes.
    }
  }

  for (const property of byCodeLen) {
    if (!property.shortCode?.trim()) continue
    const codeClean = cleanText(property.shortCode)
    if (!codeClean) continue
    const index = textClean.indexOf(codeClean)
    if (index === -1) continue
    const after = textClean[index + codeClean.length]
    if (after === undefined || !/[a-z0-9]/.test(after)) return property
  }

  for (const property of properties) {
    for (const alias of property.aliases ?? []) {
      if (!alias.trim()) continue
      if (textLower.includes(alias.toLowerCase()) || textClean.includes(cleanText(alias))) return property
    }
  }

  return properties.find(property => textClean.includes(cleanText(property.name)))
}

function toIso(value: string): string | undefined {
  const parts = value.split('.')
  if (parts.length < 2) return undefined
  const day = parts[0].padStart(2, '0')
  const month = parts[1].padStart(2, '0')
  const year = parts[2]?.length === 4
    ? parts[2]
    : parts[2]?.length === 2
      ? `20${parts[2]}`
      : new Date().getFullYear().toString()
  const iso = `${year}-${month}-${day}`
  return Number.isNaN(Date.parse(iso)) ? undefined : iso
}

export function extractDatesNights(text: string) {
  const dateMatches = [...text.matchAll(/(\d{1,2}[.]\d{1,2}[.]?\d{0,4})/g)].map(match => match[1])
  const nightsMatch = text.match(/(\d+)\s*N[äa]chte?/i)
    ?? text.match(/(\d+)\s*[Üü]bernachtung/i)
    ?? text.match(/(\d+)\s*Tage?/i)
  const nights = nightsMatch ? parseInt(nightsMatch[1], 10) : undefined
  const checkIn = dateMatches[0] ? toIso(dateMatches[0]) : undefined
  const checkOut = dateMatches[1]
    ? toIso(dateMatches[1])
    : checkIn && nights
      ? new Date(new Date(checkIn).getTime() + nights * 86400000).toISOString().slice(0, 10)
      : undefined

  return { checkIn, checkOut, nights }
}

const CLEANING_RE = /endreinigung|abschlussreinigung|schlussreinigung|reinigungspauschale|reinigungsgeb(?:u|ü)hr|cleaning\s*fee/i

export function buildImportPositions(detail: LexInvoice, properties: Property[]): LexofficeImportPosition[] {
  const lines = detail.lineItems.filter(
    (line: LexLineItem) => line.type !== 'text' && (line.name || line.description),
  )
  const fullText = detail.lineItems.map(line => [line.name ?? '', line.description ?? ''].join(' ')).join(' ')
  const fallback = extractDatesNights(fullText)

  if (lines.length === 0) {
    const property = matchProperty(fullText, properties)
    const { checkIn, checkOut, nights } = fallback
    return [{
      index: 0,
      positionType: 'booking',
      rawText: fullText.slice(0, 200),
      propertyId: property?.id,
      checkIn,
      checkOut,
      nights,
      lineAmount: detail.totalPrice?.totalNetAmount,
      confidence: property && checkIn && checkOut ? 'high' : property || (checkIn && checkOut) ? 'medium' : 'low',
    }]
  }

  const positions = lines.map((line, index) => {
    const lineText = [line.name ?? '', line.description ?? ''].join(' ').trim()
    const isCleaning = CLEANING_RE.test(lineText)
    const property = matchProperty(lineText, properties)
      ?? (!isCleaning && lines.length === 1 ? matchProperty(fullText, properties) : undefined)
    const dateParsed = extractDatesNights(lineText)
    const checkIn = isCleaning ? undefined : (dateParsed.checkIn ?? fallback.checkIn)
    const checkOut = isCleaning ? undefined : (dateParsed.checkOut ?? fallback.checkOut)
    const nights = isCleaning ? undefined : (dateParsed.nights ?? fallback.nights)
    const lineAmount = line.totalPrice?.totalNetAmount
      ?? (line.quantity != null && line.unitPrice?.netAmount != null ? line.quantity * line.unitPrice.netAmount : undefined)
    const confidence: LexofficeImportConfidence = isCleaning
      ? (lineAmount != null ? 'medium' : 'low')
      : property && checkIn && checkOut ? 'high' : property || (checkIn && checkOut) ? 'medium' : 'low'

    return {
      index,
      positionType: isCleaning ? 'cleaning' as const : 'booking' as const,
      rawText: lineText.slice(0, 200),
      propertyId: isCleaning ? undefined : property?.id,
      assignedPropertyId: undefined,
      checkIn,
      checkOut,
      nights,
      bedsBooked: property && !isCleaning ? property.beds : undefined,
      lineAmount,
      confidence,
      _cleaningMatchedPropId: isCleaning ? property?.id : undefined,
    } as LexofficeImportPosition & { _cleaningMatchedPropId?: string }
  })

  const bookingPositions = positions.filter(position => position.positionType === 'booking' && position.propertyId)
  for (const position of positions) {
    if (position.positionType !== 'cleaning') continue
    const tempProperty = (position as LexofficeImportPosition & { _cleaningMatchedPropId?: string })._cleaningMatchedPropId
    if (tempProperty && bookingPositions.some(booking => booking.propertyId === tempProperty)) {
      position.assignedPropertyId = tempProperty
      position.confidence = 'high'
      continue
    }
    if (bookingPositions.length === 1) {
      position.assignedPropertyId = bookingPositions[0].propertyId
      position.confidence = 'high'
      continue
    }
    let nearest = bookingPositions.filter(booking => booking.index < position.index).at(-1)
    if (!nearest) nearest = bookingPositions.find(booking => booking.index > position.index)
    if (nearest) {
      position.assignedPropertyId = nearest.propertyId
      position.confidence = 'medium'
    }
  }

  return positions.map(position => {
    const cleanPosition = { ...(position as LexofficeImportPosition & { _cleaningMatchedPropId?: string }) }
    delete cleanPosition._cleaningMatchedPropId
    return cleanPosition
  })
}

export function isStornoVoucher(voucher: LexVoucherListItem) {
  return voucher.voucherType === 'creditnote'
    || voucher.voucherStatus === 'voided'
    || (voucher.voucherType !== 'orderconfirmation' && (voucher.totalAmount ?? 0) < 0)
}

export function extractReferencedInvoiceNumber(voucher: LexVoucherListItem, detail: LexInvoice, isStorno: boolean) {
  if (!isStorno) return undefined
  if (voucher.voucherStatus === 'voided' && voucher.voucherType === 'invoice') {
    return voucher.voucherNumber
  }

  const directReference = detail.relatedVouchers?.find(
    related => related.voucherType === 'invoice' || related.voucherNumber?.startsWith('RE'),
  )?.voucherNumber ?? detail.relatedVouchers?.[0]?.voucherNumber

  if (directReference) return directReference

  const allText = detail.lineItems.map(line => [line.name ?? '', line.description ?? ''].join(' ')).join(' ')
  const match = allText.match(/(?:storno|zur|gutschrift|re-?nr\.?|rechnung(?:s-?nr\.?)?)[:\s]*([A-Z]{2,4}[\d\-]+)/i)
  return match?.[1]
}

export function sortLexofficeVouchers(vouchers: LexVoucherListItem[]) {
  return [...vouchers].sort((left, right) => {
    const leftNumber = (left.voucherNumber ?? '').replace(/\D+/g, '')
    const rightNumber = (right.voucherNumber ?? '').replace(/\D+/g, '')
    if (leftNumber && rightNumber) {
      return rightNumber.localeCompare(leftNumber, undefined, { numeric: true })
    }
    return (right.updatedDate ?? right.voucherDate ?? '').localeCompare(left.updatedDate ?? left.voucherDate ?? '')
  })
}
