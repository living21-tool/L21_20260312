'use client'
import { useEffect, useRef, useState } from 'react'
import { useProperties, useLocations, useCustomers, useBookings } from '@/lib/store'
import { formatCurrency } from '@/lib/utils'
import { LexVoucherListItem, LexInvoice, LexContact, LexLineItem } from '@/lib/lexoffice'
import {
  CheckCircle, XCircle, AlertCircle, ChevronRight,
  RefreshCw, Wifi, Download, Pencil, ChevronLeft, ChevronRight as ChevronR,
  FileText, Clock3, Save
} from 'lucide-react'
import { LexofficeImportPosition, LexofficeImportQueueItem, LexofficeSyncState, Property } from '@/lib/types'
import { PropertySearchInput } from '@/components/PropertySearchInput'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedPosition {
  index: number
  rawText: string
  positionType: 'booking' | 'cleaning'  // Buchung oder Endreinigung
  propertyId?: string
  assignedPropertyId?: string           // Nur für cleaning: welcher Buchung zuordnen
  checkIn?: string
  checkOut?: string
  nights?: number
  bedsBooked?: number
  lineAmount?: number          // Nettobetrag dieser Position
  confidence: 'high' | 'medium' | 'low'
  status: 'pending' | 'accepted' | 'skipped'
}

interface ParsedItem {
  voucher: LexVoucherListItem
  detail?: LexInvoice
  positions: ParsedPosition[]
  customerId?: string
  status: 'idle' | 'loading' | 'pending' | 'accepted' | 'skipped'
  isStorno: boolean
  referencedInvoiceNumber?: string  // Nur bei Gutschriften: die stornierte Rechnungsnummer
}

interface VoucherPage {
  items: LexVoucherListItem[]
  totalElements: number
  totalPages: number
  currentPage: number
  pageSize: number
}

interface LexofficeSyncOverview {
  configured?: boolean
  setupMessage?: string
  state: LexofficeSyncState
  counts: {
    pendingReview: number
    autoImported: number
    duplicates: number
    errors: number
  }
  items: LexofficeImportQueueItem[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function matchProperty(text: string, properties: Property[]): Property | undefined {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]/g, '')
  const textLower = text.toLowerCase()
  const textClean = clean(text)

  // Längere ShortCodes zuerst → "WE14" wird vor "WE1" geprüft
  const byCodeLen = [...properties].sort(
    (a, b) => clean(b.shortCode ?? '').length - clean(a.shortCode ?? '').length
  )

  // 1. Flexibler Trennzeichen-Regex
  //    ShortCode "CCS7 WE5" matcht auch "CCS7 / WE5", "CCS7-WE5", "CCS7/WE5" etc.
  //    Negativer Lookahead/Lookbehind verhindert Teilmatches (WE1 ≠ WE14)
  for (const p of byCodeLen) {
    if (!p.shortCode?.trim()) continue
    const code = p.shortCode.trim()
    // Sonderzeichen escapen, dann Leerzeichen/Trennzeichen flexibel machen
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const flexed  = escaped.replace(/[\s\-_/]+/g, '[\\s\\-_/]*')
    try {
      const re = new RegExp('(?<![a-zA-Z0-9])' + flexed + '(?![a-zA-Z0-9])', 'i')
      if (re.test(text)) return p
    } catch { /* ungültige Regex ignorieren */ }
  }

  // 2. Bereinigter Substring-Match (entfernt alle Sonderzeichen)
  //    Nur gültig wenn KEIN weiteres alphanumerisches Zeichen direkt folgt
  //    (verhindert "rld6we1" ⊂ "rld6we14")
  for (const p of byCodeLen) {
    if (!p.shortCode?.trim()) continue
    const codeClean = clean(p.shortCode)
    if (!codeClean) continue
    const idx = textClean.indexOf(codeClean)
    if (idx === -1) continue
    const after = textClean[idx + codeClean.length]
    if (after === undefined || !/[a-z0-9]/.test(after)) return p
  }

  // 3. Alias-Match
  for (const p of properties) {
    for (const alias of (p.aliases ?? [])) {
      if (!alias.trim()) continue
      if (textLower.includes(alias.toLowerCase()) || textClean.includes(clean(alias))) return p
    }
  }

  // 4. Vollständiger Name
  for (const p of properties) {
    if (textClean.includes(clean(p.name))) return p
  }

  return undefined
}

const toIso = (d: string): string | undefined => {
  const parts = d.split('.')
  if (parts.length < 2) return undefined
  const day   = parts[0].padStart(2, '0')
  const month = parts[1].padStart(2, '0')
  const year  = parts[2]?.length === 4 ? parts[2]
              : parts[2]?.length === 2 ? `20${parts[2]}`
              : new Date().getFullYear().toString()
  const iso = `${year}-${month}-${day}`
  return isNaN(Date.parse(iso)) ? undefined : iso
}

function extractDatesNights(text: string) {
  const dateRe = /(\d{1,2}[.]\d{1,2}[.]?\d{0,4})/g
  const dates = [...text.matchAll(dateRe)].map(m => m[1])
  const nightsMatch = text.match(/(\d+)\s*N[äa]chte?/i)
    ?? text.match(/(\d+)\s*[Üü]bernachtung/i)
    ?? text.match(/(\d+)\s*Tage?/i)
  const nights = nightsMatch ? parseInt(nightsMatch[1]) : undefined
  const checkIn  = dates[0] ? toIso(dates[0]) : undefined
  const checkOut = dates[1]
    ? toIso(dates[1])
    : checkIn && nights
      ? new Date(new Date(checkIn).getTime() + nights * 86400000).toISOString().slice(0, 10)
      : undefined
  return { checkIn, checkOut, nights }
}

// Erkennt Endreinigungspositionen anhand von Schlüsselwörtern
const CLEANING_RE = /endreinigung|abschlussreinigung|schlussreinigung|reinigungspauschale|reinigungsgeb(?:u|ü)hr|cleaning\s*fee/i

/** Erstellt ParsedPosition[] aus den Positionen einer LexInvoice. */
function buildPositions(detail: LexInvoice, properties: Property[]): ParsedPosition[] {
  // Nur "echte" Positionen (keine Text-Trennzeilen)
  const lines = detail.lineItems.filter(
    (l: LexLineItem) => l.type !== 'text' && (l.name || l.description)
  )

  // Rechnungs-level Fallback-Daten (aus allen Texten zusammen)
  const fullText = detail.lineItems
    .map((l: LexLineItem) => [l.name ?? '', l.description ?? ''].join(' '))
    .join(' ')
  const fallback = extractDatesNights(fullText)

  if (lines.length === 0) {
    // Leere Rechnung – eine generische Position
    const prop = matchProperty(fullText, properties)
    const { checkIn, checkOut, nights } = fallback
    return [{
      index: 0,
      positionType: 'booking',
      rawText: fullText.slice(0, 200),
      propertyId: prop?.id,
      checkIn, checkOut, nights,
      lineAmount: detail.totalPrice?.totalNetAmount,
      confidence: prop && checkIn && checkOut ? 'high' : prop || (checkIn && checkOut) ? 'medium' : 'low',
      status: 'pending',
    }]
  }

  // Erster Durchlauf: Positionen aufbauen
  const positions: ParsedPosition[] = lines.map((li: LexLineItem, idx: number) => {
    const lineText = [li.name ?? '', li.description ?? ''].join(' ').trim()

    // Endreinigung erkennen
    const isCleaning = CLEANING_RE.test(lineText)
    const positionType: 'booking' | 'cleaning' = isCleaning ? 'cleaning' : 'booking'

    // Objekt: Auch für Endreinigungen versuchen (ShortCode im Text)
    const prop = matchProperty(lineText, properties)
      ?? (!isCleaning && lines.length === 1 ? matchProperty(fullText, properties) : undefined)

    // Datum: erst aus Positionstext, dann Fallback (für Buchungen)
    const dateParsed = extractDatesNights(lineText)
    const checkIn  = isCleaning ? undefined : (dateParsed.checkIn  ?? fallback.checkIn)
    const checkOut = isCleaning ? undefined : (dateParsed.checkOut ?? fallback.checkOut)
    const nights   = isCleaning ? undefined : (dateParsed.nights   ?? fallback.nights)

    // Betten: immer aus dem im System hinterlegten Objekt — NICHT aus dem Rechnungstext
    const bedsBooked: number | undefined = prop && !isCleaning ? prop.beds : undefined

    // Betrag dieser Position
    const lineAmount = li.totalPrice?.totalNetAmount
      ?? (li.quantity != null && li.unitPrice?.netAmount != null
          ? li.quantity * li.unitPrice.netAmount : undefined)

    const confidence: 'high' | 'medium' | 'low' = isCleaning
      ? (lineAmount != null ? 'medium' : 'low')
      : prop && checkIn && checkOut ? 'high'
        : prop || (checkIn && checkOut) ? 'medium'
        : 'low'

    return {
      index: idx,
      positionType,
      rawText: lineText.slice(0, 200),
      propertyId: isCleaning ? undefined : prop?.id,
      assignedPropertyId: undefined,
      checkIn, checkOut, nights, bedsBooked, lineAmount,
      confidence,
      status: 'pending' as const,
      // Temporär: gematchtes Property für Cleaning merken
      _cleaningMatchedPropId: isCleaning ? prop?.id : undefined,
    } as ParsedPosition & { _cleaningMatchedPropId?: string }
  })

  // Zweiter Durchlauf: Endreinigungen automatisch einer Wohnung zuweisen
  const bookingPositions = positions.filter(p => p.positionType === 'booking' && p.propertyId)

  for (const pos of positions) {
    if (pos.positionType !== 'cleaning') continue

    const tempProp = (pos as ParsedPosition & { _cleaningMatchedPropId?: string })._cleaningMatchedPropId

    // 1. ShortCode im Reinigungstext erkannt → direkt zuweisen
    if (tempProp && bookingPositions.some(b => b.propertyId === tempProp)) {
      pos.assignedPropertyId = tempProp
      pos.confidence = 'high'
      continue
    }

    // 2. Nur eine Buchungsposition in der Rechnung → eindeutig zuweisbar
    if (bookingPositions.length === 1) {
      pos.assignedPropertyId = bookingPositions[0].propertyId
      pos.confidence = 'high'
      continue
    }

    // 3. Nächste Buchungsposition darüber finden (positionale Nähe)
    if (bookingPositions.length > 1) {
      let nearest: ParsedPosition | undefined
      for (const bp of bookingPositions) {
        if (bp.index < pos.index) nearest = bp
      }
      // Fallback: erste Buchungsposition darunter
      if (!nearest) nearest = bookingPositions.find(bp => bp.index > pos.index)
      if (nearest) {
        pos.assignedPropertyId = nearest.propertyId
        pos.confidence = 'medium'
        continue
      }
    }
  }

  // Temporäres Feld entfernen
  for (const pos of positions) {
    delete (pos as unknown as Record<string, unknown>)._cleaningMatchedPropId
  }

  return positions
}

const confStyle = {
  high:   'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  low:    'bg-red-100 text-red-600',
}
const confLabel = { high: 'Hoch', medium: 'Mittel', low: 'Niedrig' }

function evaluateQueueDraft(item: LexofficeImportQueueItem) {
  return evaluateQueueDraftStrict(item)

  if (item.isStorno) {
    return {
      confidence: 'medium' as const,
      canImport: false,
      message: item.reviewReason || 'Storno kann erst importiert werden, wenn die Ursprungsrechnung bereits im System ist.',
    }
  }

  if (item.isStorno) {
    return {
      confidence: item.confidence,
      canImport: item.confidence === 'high',
      message: item.reviewReason || 'Storno prüfen',
    }
  }

  let hasAnySignal = false
  const reasons = new Set<string>()

  for (const position of item.positions) {
    if (position.positionType === 'booking') {
      if (position.propertyId || position.checkIn || position.checkOut) hasAnySignal = true
      if (!position.propertyId) reasons.add('Objekt fehlt')
      if (!position.checkIn || !position.checkOut) reasons.add('Zeitraum fehlt')
    }
    if (position.positionType === 'cleaning') {
      if (position.assignedPropertyId) hasAnySignal = true
      if (!position.assignedPropertyId) reasons.add('Endreinigung nicht zugeordnet')
    }
  }

  const canImport = reasons.size === 0 && item.positions.some(position => position.positionType === 'booking')
  return {
    confidence: canImport ? 'high' as const : hasAnySignal ? 'medium' as const : 'low' as const,
    canImport,
    message: canImport ? 'Bereit für manuellen Import' : [...reasons].join(' · '),
  }
}

function evaluateQueueDraftStrict(item: LexofficeImportQueueItem) {
  if (item.isStorno) {
    return {
      confidence: 'medium' as const,
      canImport: false,
      message: item.reviewReason || 'Storno kann erst importiert werden, wenn die Ursprungsrechnung bereits im System ist.',
    }
  }

  let hasAnySignal = false
  const reasons = new Set<string>()

  for (const position of item.positions) {
    if (position.positionType === 'booking') {
      if (position.propertyId || position.checkIn || position.checkOut) hasAnySignal = true
      if (!position.propertyId) reasons.add('Objekt fehlt')
      if (!position.checkIn || !position.checkOut) reasons.add('Zeitraum fehlt')
      if (position.confidence !== 'high') reasons.add('Mindestens eine Buchungsposition ist noch nicht auf hoher Sicherheit')
    }
    if (position.positionType === 'cleaning') {
      if (position.assignedPropertyId) hasAnySignal = true
      if (!position.assignedPropertyId) reasons.add('Endreinigung nicht zugeordnet')
      if (position.confidence !== 'high') reasons.add('Mindestens eine Endreinigung ist noch nicht auf hoher Sicherheit')
    }
  }

  const canImport = reasons.size === 0 && item.positions.some(position => position.positionType === 'booking')
  return {
    confidence: canImport ? 'high' as const : hasAnySignal ? 'medium' as const : 'low' as const,
    canImport,
    message: canImport ? 'Bereit fuer manuellen Import' : [...reasons].join(' · '),
  }
}

function recalculatePositionConfidence(position: LexofficeImportPosition): LexofficeImportPosition {
  if (position.positionType === 'booking') {
    const hasProperty = Boolean(position.propertyId)
    const hasDates = Boolean(position.checkIn && position.checkOut)
    return {
      ...position,
      confidence: hasProperty && hasDates ? 'high' : hasProperty || hasDates ? 'medium' : 'low',
    }
  }

  return {
    ...position,
    confidence: position.assignedPropertyId ? 'high' : (position.lineAmount != null ? 'medium' : 'low'),
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const { properties } = useProperties()
  const { locations }  = useLocations()
  const { customers, add: addCustomer, update: updateCustomer } = useCustomers()
  const { bookings, add: addBooking, update: updateBooking, load } = useBookings()

  const [step, setStep]   = useState<'connect' | 'load' | 'review'>('connect')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [totalInvoices, setTotalInvoices] = useState(0)
  const [totalPages, setTotalPages]       = useState(0)
  const [currentPage, setCurrentPage]     = useState(0)
  const [items, setItems]       = useState<ParsedItem[]>([])
  const [contacts, setContacts] = useState<LexContact[]>([])
  const [detailProgress, setDetailProgress] = useState({ done: 0, total: 0 })
  const [editingPos, setEditingPos] = useState<{ voucherId: string; idx: number } | null>(null)
  const [pageSize, setPageSize] = useState(25)
  const [loadAllProgress, setLoadAllProgress] = useState<{ page: number; total: number } | null>(null)
  const [dateFrom, setDateFrom] = useState(() => `${new Date().getFullYear()}-01-01`)
  const [dateTo,   setDateTo]   = useState(() => new Date().toISOString().slice(0, 10))
  const [syncOverview, setSyncOverview] = useState<LexofficeSyncOverview | null>(null)
  const [syncLoading, setSyncLoading] = useState(true)
  const [syncRunning, setSyncRunning] = useState(false)
  const [syncSavingId, setSyncSavingId] = useState<string | null>(null)
  const [syncImportingId, setSyncImportingId] = useState<string | null>(null)
  const [expandedQueueId, setExpandedQueueId] = useState<string | null>(null)
  const [syncFeedback, setSyncFeedback] = useState<{ type: 'success' | 'info'; message: string } | null>(null)
  const abortRef = useRef(false)

  async function loadSyncOverview() {
    try {
      const response = await fetch('/api/lexoffice/sync?limit=100', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Sync-Übersicht konnte nicht geladen werden.')
      setSyncOverview(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncLoading(false)
    }
  }

  useEffect(() => {
    void loadSyncOverview()
  }, [])

  async function runSyncNow() {
    try {
      setSyncRunning(true)
      setError(null)
      setSyncFeedback(null)
      const response = await fetch('/api/lexoffice/sync', { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Sync konnte nicht gestartet werden.')
      setSyncFeedback({
        type: 'success',
        message: `Lexoffice-Sync abgeschlossen: ${data.autoImported ?? 0} importiert, ${data.pendingReview ?? 0} offen zur Prüfung.`,
      })
      await loadSyncOverview()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncRunning(false)
    }
  }

  function updateQueuePosition(voucherId: string, index: number, patch: Partial<LexofficeImportPosition>) {
    setSyncOverview(prev => prev ? {
      ...prev,
      items: prev.items.map(item => item.voucherId !== voucherId ? item : {
        ...item,
        positions: item.positions.map((position, positionIndex) =>
          positionIndex === index ? recalculatePositionConfidence({ ...position, ...patch }) : position,
        ),
      }),
    } : prev)
  }

  async function saveQueueItem(voucherId: string, options?: { throwOnError?: boolean; suppressFeedback?: boolean }) {
    const item = syncOverview?.items.find(entry => entry.voucherId === voucherId)
    if (!item) return
    try {
      setSyncSavingId(voucherId)
      setError(null)
      setSyncFeedback(null)
      const response = await fetch(`/api/lexoffice/queue/${encodeURIComponent(voucherId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions: item.positions }),
      })
      const data = await response.json()
      if (!response.ok || data?.ok === false) throw new Error(data.error ?? 'Queue-Eintrag konnte nicht gespeichert werden.')
      setSyncOverview(prev => prev ? {
        ...prev,
        items: prev.items.map(entry => entry.voucherId === voucherId ? data : entry),
      } : prev)
      if (!options?.suppressFeedback) {
        setSyncFeedback({
          type: 'info',
          message: `${item.voucherNumber || voucherId} wurde gespeichert.`,
        })
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      if (options?.throwOnError) {
        throw new Error(message)
      }
    } finally {
      setSyncSavingId(null)
    }
  }

  async function importQueueItem(voucherId: string) {
    try {
      setSyncImportingId(voucherId)
      setError(null)
      setSyncFeedback(null)
      await saveQueueItem(voucherId, { throwOnError: true, suppressFeedback: true })
      const response = await fetch(`/api/lexoffice/queue/${encodeURIComponent(voucherId)}/import`, {
        method: 'POST',
      })
      const data = await response.json()
      if (!response.ok || data?.ok === false) throw new Error(data.error ?? 'Queue-Eintrag konnte nicht importiert werden.')
      setSyncOverview(prev => prev ? {
        ...prev,
        counts: {
          ...prev.counts,
          pendingReview: Math.max(0, prev.counts.pendingReview - 1),
          autoImported: prev.counts.autoImported + 1,
        },
        items: prev.items.filter(entry => entry.voucherId !== voucherId),
      } : prev)
      setSyncFeedback({
        type: 'success',
        message: `${data.voucherNumber || voucherId} wurde erfolgreich importiert.`,
      })
      await loadSyncOverview()
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncImportingId(null)
    }
  }

  // ── Sort vouchers by Rechnungsnummer DESC (z.B. RE2026-0218 > RE2026-0217) ──
  function sortVouchers(vs: LexVoucherListItem[]): LexVoucherListItem[] {
    return [...vs].sort((a, b) => {
      const na = (a.voucherNumber ?? '').replace(/\D+/g, '')
      const nb = (b.voucherNumber ?? '').replace(/\D+/g, '')
      if (na && nb) return nb.localeCompare(na, undefined, { numeric: true })
      return (b.voucherDate ?? '').localeCompare(a.voucherDate ?? '')
    })
  }

  // ── Gemeinsame Detail-Ladefunktion (nach dem Sammeln aller Vouchers) ──────────
  async function startDetailLoad(allVouchers: LexVoucherListItem[], loadedContacts: LexContact[]) {
    const sorted = sortVouchers(allVouchers)
    const importedIds = new Set(
      bookings.filter(b => b.lexofficeInvoiceId).map(b => b.lexofficeInvoiceId)
    )
    const newItems: ParsedItem[] = sorted.map(v => ({
      voucher: v, status: 'idle' as const, positions: [], customerId: undefined,
      isStorno: v.voucherType === 'creditnote'
        || v.voucherStatus === 'voided'
        || (v.voucherType !== 'orderconfirmation' && (v.totalAmount ?? 0) < 0),
      referencedInvoiceNumber: undefined,
    }))
    setItems(newItems)
    setStep('review')
    setDetailProgress({ done: 0, total: newItems.length })

    for (let i = 0; i < newItems.length; i++) {
      if (abortRef.current) break
      const item = newItems[i]
      setItems(prev => prev.map(p => p.voucher.id === item.voucher.id ? { ...p, status: 'loading' } : p))
      try {
        if (i > 0) await new Promise(r => setTimeout(r, 400))
        const detailType = item.voucher.voucherType || (item.isStorno ? 'creditnote' : 'invoice')
        const dr     = await fetch(`/api/lexoffice/vouchers?type=${detailType}&id=${item.voucher.id}`)
        const detail: LexInvoice = await dr.json()
        const positions = buildPositions(detail, properties)
        const custId = loadedContacts
          ? customers.find(c => c.lexofficeContactId === detail.address?.contactId)?.id
          : undefined
        const alreadyDone = importedIds.has(item.voucher.id)

        let referencedInvoiceNumber: string | undefined
        if (item.isStorno) {
          // Bei voided Invoices: die eigene Rechnungsnummer ist die Referenz
          if (item.voucher.voucherStatus === 'voided' && item.voucher.voucherType === 'invoice') {
            referencedInvoiceNumber = item.voucher.voucherNumber
          } else {
            referencedInvoiceNumber = detail.relatedVouchers?.find(
              rv => rv.voucherType === 'invoice' || rv.voucherNumber?.startsWith('RE')
            )?.voucherNumber ?? detail.relatedVouchers?.[0]?.voucherNumber
            if (!referencedInvoiceNumber) {
              const allText = detail.lineItems
                .map(l => [l.name ?? '', l.description ?? ''].join(' ')).join(' ')
              const match = allText.match(/(?:storno|zur|gutschrift|re-?nr\.?|rechnung(?:s-?nr\.?)?)[:\s]*([A-Z]{2,4}[\d\-]+)/i)
              if (match) referencedInvoiceNumber = match[1]
            }
          }
        }

        // ── Auto-Storno: Wenn Storno eine bereits importierte Rechnung referenziert ──
        let autoStorniert = false
        if (item.isStorno && referencedInvoiceNumber) {
          const affected = bookings.filter(
            b => b.invoiceNumber === referencedInvoiceNumber && b.status !== 'storniert'
          )
          if (affected.length > 0) {
            affected.forEach(b => {
              updateBooking(b.id, {
                status:        'storniert',
                paymentStatus: 'erstattet',
                notes: [(b.notes ?? '').trim(), `Storniert durch ${item.voucher.voucherNumber}`]
                  .filter(Boolean).join('\n'),
              })
            })
            autoStorniert = true
          }
          // Bereits stornierte Buchungen → auch als erledigt betrachten
          if (!autoStorniert) {
            const alreadyStorniert = bookings.some(
              b => b.invoiceNumber === referencedInvoiceNumber && b.status === 'storniert'
            )
            if (alreadyStorniert) autoStorniert = true
          }
        }

        // ── Voided Invoice die bereits importiert war → Buchung stornieren ──
        if (alreadyDone && item.voucher.voucherStatus === 'voided') {
          const affected = bookings.filter(
            b => b.lexofficeInvoiceId === item.voucher.id && b.status !== 'storniert'
          )
          affected.forEach(b => {
            updateBooking(b.id, {
              status:        'storniert',
              paymentStatus: 'erstattet',
              notes: [(b.notes ?? '').trim(), `Storniert (Beleg in Lexoffice storniert)`]
                .filter(Boolean).join('\n'),
            })
          })
          autoStorniert = true
        }

        const itemDone = alreadyDone || autoStorniert

        setItems(prev => prev.map(p => p.voucher.id === item.voucher.id ? {
          ...p, detail,
          positions: itemDone
            ? positions.map(pos => ({ ...pos, status: 'accepted' as const }))
            : positions,
          customerId: custId,
          status: itemDone ? 'accepted' : 'pending',
          referencedInvoiceNumber,
        } : p))
      } catch {
        setItems(prev => prev.map(p => p.voucher.id === item.voucher.id
          ? { ...p, status: 'pending', positions: [{ index: 0, positionType: 'booking' as const, rawText: '', confidence: 'low', status: 'pending' as const }] } : p))
      }
      setDetailProgress({ done: i + 1, total: newItems.length })
    }
  }

  // ── Connect ──────────────────────────────────────────────────────────────────
  async function handleConnect() {
    setLoading(true); setError(null)
    try {
      const res  = await fetch('/api/lexoffice/test')
      const data = await res.json()
      if (!data.ok) throw new Error(data.message)
      setTotalInvoices(data.totalInvoices)
      setStep('load')
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }

  // ── Hilfsfunktion: Alle Seiten eines Belegtyps laden ──────────────────────────
  async function fetchAllPagesForType(
    voucherType: string, dateParams: string, existingIds: Set<string>
  ): Promise<LexVoucherListItem[]> {
    const collected: LexVoucherListItem[] = []
    try {
      const r = await fetch(`/api/lexoffice/vouchers?type=${voucherType}&page=0&size=100${dateParams}`)
      const d: VoucherPage = await r.json()
      collected.push(...d.items.filter(v => !existingIds.has(v.id)))
      d.items.forEach(v => existingIds.add(v.id))
      for (let p = 1; p < d.totalPages; p++) {
        if (abortRef.current) break
        await new Promise(r => setTimeout(r, 350))
        const r2 = await fetch(`/api/lexoffice/vouchers?type=${voucherType}&page=${p}&size=100${dateParams}`)
        const d2: VoucherPage = await r2.json()
        collected.push(...d2.items.filter(v => !existingIds.has(v.id)))
        d2.items.forEach(v => existingIds.add(v.id))
      }
    } catch { /* Typ-Laden fehlgeschlagen — ignorieren */ }
    return collected
  }

  // ── Load single page (paginiert, nur Rechnungen + alle anderen Belegtypen) ────
  async function loadPage(page: number) {
    setLoading(true); setError(null); abortRef.current = false
    try {
      let loadedContacts = contacts
      if (contacts.length === 0) {
        const cr = await fetch('/api/lexoffice/contacts')
        loadedContacts = await cr.json()
        setContacts(loadedContacts)
      }

      const dateParams = `&dateFrom=${dateFrom}&dateTo=${dateTo}`
      const vr   = await fetch(`/api/lexoffice/vouchers?type=invoice&page=${page}&size=${pageSize}${dateParams}`)
      const data: VoucherPage = await vr.json()
      setTotalPages(data.totalPages); setCurrentPage(data.currentPage)

      const allVouchers = [...data.items]
      const ids = new Set(allVouchers.map(v => v.id))

      // Overdue Rechnungen SEPARAT (Lexoffice-API: overdue darf nicht kombiniert werden)
      allVouchers.push(...await fetchAllPagesForType('invoice&statusFilter=overdue', dateParams, ids))

      // Alle weiteren Ausgangsbeleg-Typen laden
      for (const type of ['creditnote', 'orderconfirmation', 'downpaymentinvoice']) {
        if (abortRef.current) break
        allVouchers.push(...await fetchAllPagesForType(type, dateParams, ids))
      }

      await startDetailLoad(allVouchers, loadedContacts)
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }

  // ── Alle Ausgangsbelege laden (alle Typen, alle Seiten) ──────────────────────
  async function loadAll() {
    setLoading(true); setError(null); abortRef.current = false
    try {
      let loadedContacts = contacts
      if (contacts.length === 0) {
        const cr = await fetch('/api/lexoffice/contacts')
        loadedContacts = await cr.json()
        setContacts(loadedContacts)
      }

      const dateParams = `&dateFrom=${dateFrom}&dateTo=${dateTo}`

      // ── 1. Rechnungen (invoice) — mit Fortschrittsanzeige ──────────────────
      const first = await fetch(`/api/lexoffice/vouchers?type=invoice&page=0&size=100${dateParams}`)
      const firstData: VoucherPage = await first.json()
      const totalPgs = firstData.totalPages
      setTotalPages(totalPgs); setCurrentPage(0)
      setLoadAllProgress({ page: 1, total: totalPgs })

      let allVouchers: LexVoucherListItem[] = [...firstData.items]

      for (let p = 1; p < totalPgs; p++) {
        if (abortRef.current) break
        await new Promise(r => setTimeout(r, 350))
        const res  = await fetch(`/api/lexoffice/vouchers?type=invoice&page=${p}&size=100${dateParams}`)
        const data: VoucherPage = await res.json()
        allVouchers = [...allVouchers, ...data.items]
        setLoadAllProgress({ page: p + 1, total: totalPgs })
      }

      const ids = new Set(allVouchers.map(v => v.id))

      // ── 2. Overdue Rechnungen SEPARAT (API-Constraint: overdue nicht kombinierbar)
      if (!abortRef.current) {
        allVouchers.push(...await fetchAllPagesForType('invoice&statusFilter=overdue', dateParams, ids))
      }

      // ── 3. Alle weiteren Ausgangsbeleg-Typen ──────────────────────────────
      for (const type of ['creditnote', 'orderconfirmation', 'downpaymentinvoice']) {
        if (abortRef.current) break
        allVouchers.push(...await fetchAllPagesForType(type, dateParams, ids))
      }

      setLoadAllProgress(null)
      await startDetailLoad(allVouchers, loadedContacts)
    } catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false); setLoadAllProgress(null) }
  }

  // ── Resolve customer (shared across positions of same invoice) ────────────────
  // ASYNC: addCustomer() schreibt in Supabase → muss awaited werden!
  async function resolveCustomer(item: ParsedItem): Promise<string | undefined> {
    if (item.customerId) return item.customerId
    if (!item.detail?.address) return undefined
    const addr    = item.detail.address
    const contact = contacts.find(c => c.id === addr.contactId)
    const fullName = (addr.name ?? item.voucher.contactName ?? 'Unbekannt').trim()

    // 1. Bereits vorhandenen Kunden per Lexoffice-Kontakt-ID finden
    if (addr.contactId) {
      const byContactId = customers.find(c => c.lexofficeContactId === addr.contactId)
      if (byContactId) {
        setItems(prev => prev.map(p => p.voucher.id === item.voucher.id
          ? { ...p, customerId: byContactId.id } : p))
        return byContactId.id
      }
    }

    // 2. Bereits vorhandenen Kunden per exaktem Firmennamen finden (case-insensitive)
    const byName = customers.find(
      c => c.companyName.toLowerCase().trim() === fullName.toLowerCase()
    )
    if (byName) {
      // Lexoffice-ID nachrüsten falls noch nicht vorhanden
      if (addr.contactId && !byName.lexofficeContactId) {
        await updateCustomer(byName.id, { lexofficeContactId: addr.contactId })
      }
      setItems(prev => prev.map(p => p.voucher.id === item.voucher.id
        ? { ...p, customerId: byName.id } : p))
      return byName.id
    }

    // 3. Neuen Kunden anlegen — AWAIT ist hier entscheidend!
    const newC = await addCustomer({
      companyName: fullName,
      firstName: contact?.person?.firstName ?? '',
      lastName:  contact?.person?.lastName  ?? '',
      email:   contact?.emailAddresses?.business?.[0] ?? contact?.emailAddresses?.private?.[0] ?? '',
      phone:   contact?.phoneNumbers?.business?.[0] ?? contact?.phoneNumbers?.mobile?.[0] ?? '',
      address: contact?.addresses?.billing?.[0]?.street ?? '',
      zip:     contact?.addresses?.billing?.[0]?.zip ?? '',
      city:    contact?.addresses?.billing?.[0]?.city ?? '',
      country: contact?.addresses?.billing?.[0]?.countryCode === 'AT' ? 'Österreich'
             : contact?.addresses?.billing?.[0]?.countryCode === 'CH' ? 'Schweiz' : 'Deutschland',
      lexofficeContactId: addr.contactId,
      notes: '',
      createdAt: new Date().toISOString().slice(0, 10),
    })
    // Store custId back on item so subsequent positions reuse it
    setItems(prev => prev.map(p => p.voucher.id === item.voucher.id
      ? { ...p, customerId: newC.id } : p))
    return newC.id
  }

  // ── Accept one position ────────────────────────────────────────────────────────
  async function acceptPosition(voucherId: string, posIdx: number) {
    const item = items.find(i => i.voucher.id === voucherId)
    if (!item) return
    const pos = item.positions[posIdx]
    if (!pos) return

    // ── Endreinigung ──────────────────────────────────────────────────────────
    if (pos.positionType === 'cleaning') {
      // Muss einer Wohnung zugeordnet sein
      if (!pos.assignedPropertyId) {
        alert('Bitte die Endreinigung zuerst einer Wohnung zuordnen.')
        return
      }
      const cleanAmt = pos.lineAmount ?? 0
      // Existiert bereits eine importierte Buchung für diese Wohnung in dieser Rechnung?
      const target = bookings.find(b =>
        b.lexofficeInvoiceId === voucherId && b.propertyId === pos.assignedPropertyId
      )
      if (target) {
        // Reinigungsgebühr zur Buchung hinzufügen
        await updateBooking(target.id, {
          cleaningFee: (target.cleaningFee ?? 0) + cleanAmt,
          totalPrice:  target.totalPrice + cleanAmt,
        })
      }
      // Wenn Buchung noch nicht existiert, wird die Gebühr beim acceptPosition der Buchung eingerechnet
      setItems(prev => prev.map(p => {
        if (p.voucher.id !== voucherId) return p
        const newPositions = p.positions.map((pos2, i) =>
          i === posIdx ? { ...pos2, status: 'accepted' as const } : pos2
        )
        const allDone = newPositions.every(p2 => p2.status === 'accepted' || p2.status === 'skipped')
        return { ...p, positions: newPositions, status: allDone ? 'accepted' : p.status }
      }))
      setEditingPos(null)
      return
    }

    // ── Reguläre Buchungsposition ─────────────────────────────────────────────
    if (!pos.checkIn || !pos.checkOut) {
      setEditingPos({ voucherId, idx: posIdx }); return
    }

    // AWAIT: Kunde muss erst in Supabase gespeichert sein bevor Buchung angelegt wird
    const custId = await resolveCustomer(item)
    const nights = pos.nights ?? Math.round(
      (new Date(pos.checkOut).getTime() - new Date(pos.checkIn).getTime()) / 86400000
    )
    // Betten aus dem Objekt
    const propObj = properties.find(p => p.id === pos.propertyId)
    const bedsBooked = propObj?.beds ?? pos.bedsBooked ?? 1

    // Endreinigungen die dieser Wohnung zugeordnet sind (noch nicht accepted)
    const pendingCleanings = item.positions.filter(p =>
      p.positionType === 'cleaning' &&
      p.assignedPropertyId === pos.propertyId &&
      p.status === 'pending'
    )
    const cleaningFee = pendingCleanings.reduce((s, p) => s + (p.lineAmount ?? 0), 0)

    const bookingNet = pos.lineAmount ?? item.voucher.totalAmount ?? 0
    const totalPrice = bookingNet + cleaningFee

    // Bettenpreis = Buchungsbetrag (ohne Reinigung) ÷ (Nächte × Betten)
    const pricePerBedNight = nights > 0 && bedsBooked > 0
      ? Math.round((bookingNet / (nights * bedsBooked)) * 100) / 100
      : 0

    // Storno → abweichende Status
    const isStorno = item.isStorno
    await addBooking({
      propertyId:    pos.propertyId ?? '',
      customerId:    custId ?? '',
      checkIn:       pos.checkIn,
      checkOut:      pos.checkOut,
      nights,
      bedsBooked,
      pricePerBedNight,
      cleaningFee,
      totalPrice,
      status:        isStorno ? 'storniert'
                   : item.voucher.voucherStatus === 'voided' ? 'storniert'
                   : (item.voucher.voucherStatus === 'paidoff' || item.voucher.voucherStatus === 'paid') ? 'abgeschlossen'
                   : 'bestaetigt',
      paymentStatus: isStorno ? 'erstattet'
                   : item.voucher.voucherStatus === 'voided' ? 'erstattet'
                   : item.voucher.voucherStatus === 'paidoff' ? 'bezahlt'
                   : item.voucher.voucherStatus === 'paid' ? 'teilweise'
                   : 'offen',
      notes: pos.rawText,
      lexofficeInvoiceId: item.voucher.id,
      invoiceNumber:      item.voucher.voucherNumber,
      source: 'lexoffice_import',
    })

    setItems(prev => prev.map(p => {
      if (p.voucher.id !== voucherId) return p
      const newPositions = p.positions.map((pos2, i) => {
        if (i === posIdx) return { ...pos2, status: 'accepted' as const }
        // Miteinbezogene Endreinigungen ebenfalls als accepted markieren
        if (
          pos2.positionType === 'cleaning' &&
          pos2.assignedPropertyId === pos.propertyId &&
          pos2.status === 'pending'
        ) return { ...pos2, status: 'accepted' as const }
        return pos2
      })
      const allDone = newPositions.every(p2 => p2.status === 'accepted' || p2.status === 'skipped')
      return { ...p, positions: newPositions, status: allDone ? 'accepted' : p.status }
    }))
    setEditingPos(null)
  }

  // ── Accept all positions of an invoice ────────────────────────────────────────
  // ASYNC + sequenziell: nicht parallel, damit Date.now()-IDs nicht kollidieren
  async function acceptAll(voucherId: string) {
    const item = items.find(i => i.voucher.id === voucherId)
    if (!item) return
    for (const [idx, pos] of item.positions.entries()) {
      if (pos.status === 'pending') await acceptPosition(voucherId, idx)
    }
  }

  // ── Sonstige Buchung speichern (kein Objekt, kein Zeitraum — z.B. Renovierung) ──
  async function acceptSonstige(voucherId: string) {
    const item = items.find(i => i.voucher.id === voucherId)
    if (!item) return
    const custId = await resolveCustomer(item)
    const invoiceDate = item.voucher.voucherDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
    await addBooking({
      propertyId:    '',
      customerId:    custId ?? '',
      checkIn:       invoiceDate,
      checkOut:      invoiceDate,
      nights:        0,
      bedsBooked:    0,
      pricePerBedNight: 0,
      cleaningFee:   0,
      totalPrice:    item.voucher.totalAmount ?? 0,
      status:        item.voucher.voucherStatus === 'paidoff' || item.voucher.voucherStatus === 'paid'
                       ? 'abgeschlossen' : 'bestaetigt',
      paymentStatus: item.voucher.voucherStatus === 'paidoff' ? 'bezahlt'
                   : item.voucher.voucherStatus === 'paid'    ? 'teilweise' : 'offen',
      notes:         item.positions.map(p => p.rawText).filter(Boolean).join('\n'),
      lexofficeInvoiceId: item.voucher.id,
      invoiceNumber:      item.voucher.voucherNumber,
      source: 'lexoffice_sonstige',
    })
    setItems(prev => prev.map(p =>
      p.voucher.id !== voucherId ? p : {
        ...p,
        positions: p.positions.map(pos => ({ ...pos, status: 'accepted' as const })),
        status: 'accepted',
      }
    ))
  }

  // ── Storno akzeptieren: ursprüngliche Buchungen als storniert markieren ────────
  function acceptStorno(voucherId: string) {
    const item = items.find(i => i.voucher.id === voucherId)
    if (!item) return
    const refNum = item.referencedInvoiceNumber
    if (!refNum) {
      alert('Kein Bezug auf eine Rechnung gefunden. Import nicht möglich.')
      return
    }
    // Buchungen mit der referenzierten Rechnungsnummer finden
    const affected = bookings.filter(b => b.invoiceNumber === refNum)
    if (affected.length === 0) {
      alert(`Keine importierten Buchungen für Rechnung ${refNum} gefunden.\nBitte die Originalrechnung zuerst importieren.`)
      return
    }
    // Alle betroffenen Buchungen als storniert/erstattet markieren
    affected.forEach(b => {
      if (b.status !== 'storniert') {
        updateBooking(b.id, {
          status:        'storniert',
          paymentStatus: 'erstattet',
          notes: [(b.notes ?? '').trim(), `Storniert durch ${item.voucher.voucherNumber}`]
            .filter(Boolean).join('\n'),
        })
      }
    })
    // Storno-Item als erledigt markieren
    setItems(prev => prev.map(p =>
      p.voucher.id !== voucherId ? p : { ...p, status: 'accepted' }
    ))
  }

  function skipPosition(voucherId: string, posIdx: number) {
    setItems(prev => prev.map(p => {
      if (p.voucher.id !== voucherId) return p
      const newPositions = p.positions.map((pos, i) =>
        i === posIdx ? { ...pos, status: 'skipped' as const } : pos
      )
      const allDone = newPositions.every(p2 => p2.status === 'accepted' || p2.status === 'skipped')
      return { ...p, positions: newPositions, status: allDone ? 'skipped' : p.status }
    }))
  }

  function skipAll(voucherId: string) {
    setItems(prev => prev.map(p =>
      p.voucher.id !== voucherId ? p : {
        ...p,
        positions: p.positions.map(pos => ({ ...pos, status: 'skipped' as const })),
        status: 'skipped',
      }
    ))
  }

  function updatePosition(voucherId: string, idx: number, patch: Partial<ParsedPosition>) {
    setItems(prev => prev.map(p =>
      p.voucher.id !== voucherId ? p : {
        ...p,
        positions: p.positions.map((pos, i) => i === idx ? { ...pos, ...patch } : pos),
      }
    ))
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────
  const totalPositions = items.reduce((s, i) => s + i.positions.length, 0)
  const acceptedPos    = items.reduce((s, i) => s + i.positions.filter(p => p.status === 'accepted').length, 0)
  const pendingItems   = items.filter(i => i.status === 'pending').length
  const loadingCount   = items.filter(i => i.status === 'loading' || i.status === 'idle').length

  // Unmatched short codes from all positions
  const unmatchedCodes = (() => {
    const knownCodes = new Set(properties.flatMap(p => [
      p.shortCode?.toLowerCase(), ...(p.aliases?.map(a => a.toLowerCase()) ?? [])
    ]).filter(Boolean))
    const codePattern = /\b([A-ZÄÖÜ]{1,4}\s?\d{1,4})\b/gi
    const found = new Map<string, number>()
    for (const item of items) {
      for (const pos of item.positions) {
        if (!pos.rawText || pos.propertyId) continue
        for (const m of [...pos.rawText.matchAll(codePattern)]) {
          const code = m[1].replace(/\s/g, '').toUpperCase()
          if (code.length < 2 || /^\d+$/.test(code)) continue
          if (['MWS','UST','EUR','NR','NETTO','BRUTTO'].includes(code)) continue
          if (knownCodes.has(code.toLowerCase())) continue
          found.set(code, (found.get(code) ?? 0) + 1)
        }
      }
    }
    return [...found.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  })()

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Lexoffice Import</h1>
        <p className="text-sm text-slate-500 mt-0.5">Ausgangsbelege laden · Positionen prüfen · als Buchungen übernehmen</p>
      </div>

      <div className="mb-6 rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 via-white to-sky-50 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-violet-700">
              <Clock3 size={15} />
              Lexoffice Sync
            </div>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">Stündlicher Import mit Review-Queue</h2>
            <p className="mt-1 text-sm text-slate-600">
              Unsichere Fälle kannst du hier direkt korrigieren und danach manuell importieren.
            </p>
          </div>
          <button
            type="button"
            onClick={runSyncNow}
            disabled={syncRunning || syncOverview?.configured === false}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw size={15} className={syncRunning ? 'animate-spin' : ''} />
            {syncRunning ? 'Synchronisiert…' : 'Jetzt synchronisieren'}
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-white/70 bg-white/80 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Offene Prüfung</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{syncOverview?.counts.pendingReview ?? 0}</p>
          </div>
          <div className="rounded-xl border border-white/70 bg-white/80 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Importiert</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{syncOverview?.counts.autoImported ?? 0}</p>
          </div>
          <div className="rounded-xl border border-white/70 bg-white/80 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Duplikate</p>
            <p className="mt-1 text-2xl font-bold text-slate-700">{syncOverview?.counts.duplicates ?? 0}</p>
          </div>
          <div className="rounded-xl border border-white/70 bg-white/80 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Letzter Lauf</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">
              {syncOverview?.state.lastSuccessAt ? new Date(syncOverview.state.lastSuccessAt).toLocaleString('de-DE') : 'Noch kein erfolgreicher Lauf'}
            </p>
          </div>
        </div>

        {syncOverview?.configured === false && syncOverview.setupMessage && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {syncOverview.setupMessage}
          </div>
        )}

        {syncFeedback && (
          <div className={`mt-4 rounded-xl px-3 py-2 text-sm ${
            syncFeedback.type === 'success'
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border border-blue-200 bg-blue-50 text-blue-800'
          }`}>
            {syncFeedback.message}
          </div>
        )}

        <div className="mt-4 rounded-xl border border-slate-200 bg-white/80">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Offene Lexoffice-Fälle</p>
              <p className="text-xs text-slate-500">Direkt hier bearbeiten und importieren.</p>
            </div>
            {syncLoading && <span className="text-xs text-slate-400">Lädt…</span>}
          </div>
          <div className="divide-y divide-slate-100">
            {!syncLoading && (syncOverview?.items.length ?? 0) === 0 && (
              <div className="px-4 py-4 text-sm text-slate-500">Keine offenen Lexoffice-Fälle.</div>
            )}
            {syncOverview?.items.map(item => {
              const draftState = evaluateQueueDraft(item)
              const bookingPositions = item.positions.filter(position => position.positionType === 'booking')
              return (
                <div key={item.voucherId} className="px-4 py-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">{item.voucherNumber || item.voucherId}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${confStyle[draftState.confidence]}`}>
                          {draftState.confidence}
                        </span>
                        {item.isStorno && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Storno</span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-700">{item.contactName || 'Ohne Kontaktname'} · {formatCurrency(item.totalAmount)}</p>
                      <p className="mt-1 text-xs text-slate-500">{draftState.message || item.reviewReason}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-400">{new Date(item.lastSeenAt).toLocaleDateString('de-DE')}</span>
                      <button
                        type="button"
                        onClick={() => setExpandedQueueId(prev => prev === item.voucherId ? null : item.voucherId)}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {expandedQueueId === item.voucherId ? 'Bearbeitung schließen' : 'Bearbeiten'}
                      </button>
                      <button
                        type="button"
                        onClick={() => importQueueItem(item.voucherId)}
                        disabled={!draftState.canImport || syncImportingId === item.voucherId}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {syncImportingId === item.voucherId ? 'Importiert…' : 'Manuell importieren'}
                      </button>
                    </div>
                  </div>

                  {expandedQueueId === item.voucherId && (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                      <div className="space-y-3">
                        {item.positions.map((position, index) => (
                          <div key={`${item.voucherId}-${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-slate-900">
                                  {position.positionType === 'cleaning' ? 'Endreinigung' : `Position ${index + 1}`}
                                </p>
                                <p className="text-xs text-slate-500">{position.rawText || 'Ohne Beschreibung'}</p>
                              </div>
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${confStyle[position.confidence]}`}>
                                {confLabel[position.confidence]}
                              </span>
                            </div>

                            <div className="mt-3 grid gap-3 md:grid-cols-2">
                              {position.positionType === 'booking' ? (
                                <>
                                  <div>
                                    <label className="mb-1 block text-xs font-medium text-slate-500">Objekt</label>
                                    <PropertySearchInput
                                      properties={properties}
                                      locations={locations}
                                      value={position.propertyId ?? ''}
                                      onChange={value => updateQueuePosition(item.voucherId, index, { propertyId: value || undefined })}
                                    />
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="mb-1 block text-xs font-medium text-slate-500">Check-in</label>
                                      <input
                                        type="date"
                                        value={position.checkIn ?? ''}
                                        onChange={event => updateQueuePosition(item.voucherId, index, { checkIn: event.target.value || undefined })}
                                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      />
                                    </div>
                                    <div>
                                      <label className="mb-1 block text-xs font-medium text-slate-500">Check-out</label>
                                      <input
                                        type="date"
                                        value={position.checkOut ?? ''}
                                        onChange={event => updateQueuePosition(item.voucherId, index, { checkOut: event.target.value || undefined })}
                                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      />
                                    </div>
                                  </div>
                                </>
                              ) : (
                                <div>
                                  <label className="mb-1 block text-xs font-medium text-slate-500">Endreinigung zuordnen</label>
                                  <select
                                    value={position.assignedPropertyId ?? ''}
                                    onChange={event => updateQueuePosition(item.voucherId, index, { assignedPropertyId: event.target.value || undefined })}
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  >
                                    <option value="">Bitte wählen</option>
                                    {bookingPositions.map(bookingPosition => (
                                      <option key={`${item.voucherId}-${bookingPosition.index}`} value={bookingPosition.propertyId}>
                                        {properties.find(property => property.id === bookingPosition.propertyId)?.shortCode ?? bookingPosition.propertyId}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs text-slate-500">{draftState.message}</p>
                        <button
                          type="button"
                          onClick={() => saveQueueItem(item.voucherId)}
                          disabled={syncSavingId === item.voucherId}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Save size={15} />
                          {syncSavingId === item.voucherId ? 'Speichert…' : 'Änderungen speichern'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Steps */}
      <div className="flex items-center gap-2 mb-8">
        {['Verbinden', 'Laden', 'Prüfen & Importieren'].map((s, i) => {
          const keys = ['connect', 'load', 'review']
          const active = keys.indexOf(step) >= i
          return (
            <div key={s} className="flex items-center gap-2">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${active ? 'bg-blue-500' : 'bg-slate-200 text-slate-400'}`}>{i + 1}</span>
                {s}
              </div>
              {i < 2 && <ChevronRight size={14} className="text-slate-300" />}
            </div>
          )
        })}
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
          <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 font-mono flex-1">{error}</p>
          <button onClick={() => setError(null)}><XCircle size={16} className="text-red-400 hover:text-red-600" /></button>
        </div>
      )}

      {/* ── Step 1: Connect ─────────────────────────────────────────────────── */}
      {step === 'connect' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center">
              <Wifi size={20} className="text-violet-600" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">Lexoffice Verbindung testen</h2>
              <p className="text-sm text-slate-500">API-Key konfiguriert in <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">.env.local</code></p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-3 mb-5">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <p className="text-sm text-slate-600">API-Key: <code className="text-xs font-mono text-slate-400">ZJRH...LP</code></p>
          </div>
          <button onClick={handleConnect} disabled={loading}
            className="w-full py-2.5 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><RefreshCw size={15} className="animate-spin" />Verbinde...</> : <><Wifi size={15} />Verbindung testen</>}
          </button>
        </div>
      )}

      {/* ── Step 2: Load ────────────────────────────────────────────────────── */}
      {step === 'load' && (
        <div className="space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
            <CheckCircle size={20} className="text-emerald-600" />
            <p className="text-sm font-medium text-emerald-900">Verbindung erfolgreich!</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="font-semibold text-slate-900 mb-4">Ausgangsbelege laden</h2>
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="p-3 bg-blue-50 rounded-lg text-center">
                <p className="text-2xl font-bold text-blue-700">{totalInvoices.toLocaleString('de')}</p>
                <p className="text-xs text-slate-500 mt-0.5">Belege gesamt</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg text-center">
                <p className="text-2xl font-bold text-slate-700">{bookings.filter(b => b.lexofficeInvoiceId).length}</p>
                <p className="text-xs text-slate-500 mt-0.5">Bereits importiert</p>
              </div>
              <div className="p-3 bg-amber-50 rounded-lg text-center">
                <p className="text-2xl font-bold text-amber-700">{Math.ceil(totalInvoices / pageSize)}</p>
                <p className="text-xs text-slate-500 mt-0.5">Seiten à {pageSize}</p>
              </div>
            </div>

            {/* Zeitraum-Auswahl */}
            <div className="mb-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
              <p className="text-sm font-medium text-slate-700 mb-3">Zeitraum</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {[
                  { label: 'Akt. Jahr',    from: `${new Date().getFullYear()}-01-01`,  to: new Date().toISOString().slice(0,10) },
                  { label: 'Letztes Jahr', from: `${new Date().getFullYear()-1}-01-01`, to: `${new Date().getFullYear()-1}-12-31` },
                  { label: 'Letzte 6 Mon.',from: new Date(Date.now()-183*86400000).toISOString().slice(0,10), to: new Date().toISOString().slice(0,10) },
                  { label: 'Letzte 3 Mon.',from: new Date(Date.now()-92*86400000).toISOString().slice(0,10),  to: new Date().toISOString().slice(0,10) },
                  { label: 'Alles',        from: '2010-01-01', to: new Date().toISOString().slice(0,10) },
                ].map(q => (
                  <button
                    key={q.label}
                    onClick={() => { setDateFrom(q.from); setDateTo(q.to) }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                      dateFrom === q.from && dateTo === q.to
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >{q.label}</button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="text-xs text-slate-500 block mb-1">Von</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-slate-500 block mb-1">Bis</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Page size selector */}
            <div className="flex items-center gap-3 mb-3 p-3 bg-slate-50 rounded-lg">
              <span className="text-sm text-slate-600 font-medium">Rechnungen pro Seite:</span>
              <div className="flex gap-2">
                {[10, 25, 50, 100].map(n => (
                  <button
                    key={n}
                    onClick={() => setPageSize(n)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      pageSize === n
                        ? 'bg-blue-600 text-white'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <span className="text-xs text-slate-400 ml-auto">
                Je mehr, desto länger dauert der Ladevorgang
              </span>
            </div>

            {/* Info: Alle Belegtypen */}
            <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
              <p className="text-sm font-medium text-blue-900">Alle Ausgangsbelege werden geladen</p>
              <p className="text-xs text-blue-600 mt-0.5">Rechnungen · Gutschriften · Auftragsbestätigungen · Abschlagsrechnungen · inkl. Overdue</p>
            </div>

            {/* Ladefortschritt (alle Seiten) */}
            {loadAllProgress && (
              <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-medium text-blue-800">
                    <RefreshCw size={12} className="inline mr-1 animate-spin" />
                    Lade Seite {loadAllProgress.page} von {loadAllProgress.total}…
                  </p>
                  <button onClick={() => { abortRef.current = true }} className="text-xs text-blue-400 hover:text-red-500">Abbrechen</button>
                </div>
                <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${(loadAllProgress.page / loadAllProgress.total) * 100}%` }} />
                </div>
              </div>
            )}

            <div className="flex gap-2">
              {/* Alle laden — empfohlen */}
              <button onClick={loadAll} disabled={loading}
                className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {loading && loadAllProgress
                  ? <><RefreshCw size={15} className="animate-spin" />Alle laden…</>
                  : <><Download size={15} />Alle Ausgangsbelege laden</>}
              </button>
              {/* Nur eine Seite laden */}
              <button onClick={() => loadPage(0)} disabled={loading}
                className="py-2.5 px-4 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap">
                <Download size={15} />Neueste {pageSize}
              </button>
            </div>
            <p className="text-xs text-slate-400 text-center mt-1">
              Lädt alle Ausgangsbelege (Rechnungen, Gutschriften, AB, Abschlag) sortiert nach Nummer · dauert je nach Anzahl 1–3 Min.
            </p>
          </div>
        </div>
      )}

      {/* ── Step 3: Review ──────────────────────────────────────────────────── */}
      {step === 'review' && (
        <div className="space-y-4">
          {/* Progress: Seiten sammeln */}
          {loadAllProgress && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-blue-800">
                  <RefreshCw size={14} className="inline mr-1.5 animate-spin" />
                  Rechnungsliste wird geladen… Seite {loadAllProgress.page}/{loadAllProgress.total}
                </p>
                <button onClick={() => { abortRef.current = true }} className="text-xs text-blue-400 hover:text-red-500">Abbrechen</button>
              </div>
              <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all"
                  style={{ width: `${(loadAllProgress.page / loadAllProgress.total) * 100}%` }} />
              </div>
            </div>
          )}

          {/* Progress: Positionen laden */}
          {loadingCount > 0 && !loadAllProgress && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-slate-700">
                  <RefreshCw size={14} className="inline mr-1.5 animate-spin text-blue-500" />
                  Lade Positionen... ({detailProgress.done}/{detailProgress.total})
                </p>
                <button onClick={() => { abortRef.current = true }} className="text-xs text-slate-400 hover:text-red-500">Abbrechen</button>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all"
                  style={{ width: `${(detailProgress.done / detailProgress.total) * 100}%` }} />
              </div>
            </div>
          )}

          {/* Unmatched codes */}
          {unmatchedCodes.length > 0 && loadingCount === 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-start gap-2 mb-2">
                <AlertCircle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-900">Unbekannte Kürzel in Rechnungen</p>
                  <p className="text-xs text-amber-700 mt-0.5">Diese Kürzel konnten keinem Objekt zugeordnet werden. Trage den Kurzcode unter
                    <a href="/objekte" className="underline font-medium ml-1">Portfolio →</a> ein.</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {unmatchedCodes.map(([code, count]) => (
                  <span key={code} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-100 text-amber-800 rounded-lg text-xs font-mono font-bold">
                    {code} <span className="text-amber-500 font-normal font-sans">({count}×)</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Summary + pagination */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex gap-2 flex-wrap text-sm">
              <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full font-medium">{acceptedPos} Positionen importiert</span>
              <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full font-medium">{pendingItems} Rechnungen ausstehend</span>
              <span className="px-3 py-1 bg-slate-100 text-slate-500 rounded-full font-medium">{totalPositions} Positionen gesamt</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => loadPage(currentPage - 1)} disabled={loading || currentPage === 0}
                className="p-1.5 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 disabled:opacity-30">
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm text-slate-600">Seite {currentPage + 1} / {totalPages}</span>
              <button onClick={() => loadPage(currentPage + 1)} disabled={loading || currentPage >= totalPages - 1}
                className="p-1.5 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 disabled:opacity-30">
                <ChevronR size={16} />
              </button>
            </div>
          </div>

          {/* ── Invoice cards ── */}
          {items.map(item => {
            // Storno: "erledigt" wenn item.status === 'accepted'; regulär: alle Positionen erledigt
            const isFullyDone  = item.isStorno
              ? item.status === 'accepted'
              : item.positions.every(p => p.status === 'accepted' || p.status === 'skipped')
            const isFullySkipped = !item.isStorno && item.positions.every(p => p.status === 'skipped')
            const acceptedCount = item.positions.filter(p => p.status === 'accepted').length
            const pendingPositions = item.positions.filter(p => p.status === 'pending')
            // "Sonstige": alle Positionen haben weder Objekt noch Datum erkannt
            const allPosNoPropertyNoDate = !item.isStorno
              && item.positions.length > 0
              && item.positions.every(p => !p.propertyId && !p.checkIn && !p.checkOut)
            // Wurde diese Rechnung bereits als 'Sonstige' importiert?
            const importedAsSonstige = bookings.some(
              b => b.lexofficeInvoiceId === item.voucher.id && b.source === 'lexoffice_sonstige'
            )
            const isReady = item.status !== 'loading' && item.status !== 'idle'
            const detail = item.detail
            const lineItems = detail?.lineItems?.filter((l: LexLineItem) => l.type !== 'text') ?? []

            return (
              <div key={item.voucher.id} className={`bg-white rounded-xl border overflow-hidden transition-all ${
                isFullyDone && !isFullySkipped ? 'border-emerald-200' :
                isFullySkipped ? 'border-slate-100 opacity-50' :
                !isReady ? 'border-slate-200 animate-pulse' :
                'border-slate-200'
              }`}>

                {/* ═══ Rechnungskopf ═══ */}
                <div className="px-5 py-4 bg-slate-50 border-b border-slate-100">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    {/* Links: Rechnungsinfos */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <FileText size={16} className="text-slate-400 flex-shrink-0" />
                        <span className="text-base font-bold text-slate-900 font-mono">{item.voucher.voucherNumber}</span>
                        {item.isStorno && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">
                            {item.voucher.voucherStatus === 'voided' ? 'Storniert' : 'Gutschrift'}
                            {item.referencedInvoiceNumber && item.voucher.voucherNumber !== item.referencedInvoiceNumber
                              ? ` → ${item.referencedInvoiceNumber}` : ''}
                          </span>
                        )}
                        {item.voucher.voucherType === 'orderconfirmation' && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">Auftragsbestätigung</span>
                        )}
                        {item.voucher.voucherType === 'downpaymentinvoice' && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">Abschlagsrechnung</span>
                        )}
                        {!item.isStorno && item.voucher.voucherStatus === 'paidoff' && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">Bezahlt</span>
                        )}
                        {!item.isStorno && item.voucher.voucherStatus === 'paid' && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Teilw. bezahlt</span>
                        )}
                        {!item.isStorno && item.voucher.voucherStatus === 'open' && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">Offen</span>
                        )}
                        {!item.isStorno && item.voucher.voucherStatus === 'draft' && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">Entwurf</span>
                        )}
                        {importedAsSonstige && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">Sonstiges</span>
                        )}
                        {isFullyDone && !isFullySkipped && (
                          <CheckCircle size={15} className="text-emerald-500" />
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        <span>Datum: <span className="text-slate-700 font-medium">{item.voucher.voucherDate?.slice(0, 10)}</span></span>
                        <span>Kunde: <span className="text-slate-700 font-medium">{item.voucher.contactName}</span></span>
                        {detail?.address?.street && (
                          <span className="text-slate-400">{detail.address.street}, {detail.address.zip} {detail.address.city}</span>
                        )}
                      </div>
                    </div>
                    {/* Rechts: Betrag + Aktionen */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        {detail?.totalPrice && (
                          <p className="text-[10px] text-slate-400">
                            Netto {formatCurrency(detail.totalPrice.totalNetAmount)} + MwSt {formatCurrency(detail.totalPrice.totalTaxAmount)}
                          </p>
                        )}
                        <p className="text-lg font-bold text-slate-900">
                          {formatCurrency(detail?.totalPrice?.totalGrossAmount ?? item.voucher.totalAmount ?? 0)}
                        </p>
                      </div>
                      {!isReady && <RefreshCw size={16} className="text-slate-300 animate-spin" />}
                    </div>
                  </div>

                  {/* Aktionsleiste */}
                  {isReady && (
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-200">
                      {/* Storno */}
                      {item.isStorno && (
                        item.status === 'accepted' ? (
                          <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                            <CheckCircle size={14} /> Storniert
                          </span>
                        ) : (
                          <button
                            onClick={() => acceptStorno(item.voucher.id)}
                            disabled={!item.referencedInvoiceNumber}
                            className="text-xs px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium flex items-center gap-1 disabled:opacity-40"
                            title={item.referencedInvoiceNumber ? `Buchungen von ${item.referencedInvoiceNumber} stornieren` : 'Keine Rechnungsreferenz gefunden'}
                          >
                            <XCircle size={12} /> Buchungen stornieren
                          </button>
                        )
                      )}
                      {/* Sonstige */}
                      {allPosNoPropertyNoDate && !isFullyDone && !item.isStorno && (
                        <button
                          onClick={() => acceptSonstige(item.voucher.id)}
                          className="text-xs px-3 py-1.5 bg-slate-600 text-white rounded-lg hover:bg-slate-700 font-medium flex items-center gap-1"
                        >
                          <FileText size={12} /> Als Sonstige speichern
                        </button>
                      )}
                      {/* Alle importieren / überspringen */}
                      {!item.isStorno && pendingPositions.length > 0 && !allPosNoPropertyNoDate && (
                        <>
                          <button onClick={() => acceptAll(item.voucher.id)}
                            className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium flex items-center gap-1">
                            <CheckCircle size={12} /> {pendingPositions.length === 1 ? 'Importieren' : 'Alle importieren'}
                          </button>
                          <button onClick={() => skipAll(item.voucher.id)}
                            className="text-xs px-2.5 py-1.5 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-50 flex items-center gap-1">
                            <XCircle size={12} /> Überspringen
                          </button>
                        </>
                      )}
                      {/* Fortschritt */}
                      {!item.isStorno && item.positions.length > 0 && (
                        <span className="ml-auto text-xs text-slate-400">
                          {acceptedCount}/{item.positions.length} Pos. importiert
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* ═══ Lexoffice Positionen (Originaltabelle) ═══ */}
                {isReady && !item.isStorno && lineItems.length > 0 && (
                  <div className="border-b border-slate-100">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50/50 text-slate-400 uppercase text-[10px] tracking-wide">
                          <th className="text-left pl-5 pr-2 py-2 font-medium">Pos.</th>
                          <th className="text-left px-2 py-2 font-medium">Bezeichnung (Lexoffice)</th>
                          <th className="text-right px-2 py-2 font-medium">Menge</th>
                          <th className="text-left px-2 py-2 font-medium">Einheit</th>
                          <th className="text-right px-2 py-2 font-medium">Einzelpreis</th>
                          <th className="text-right px-2 py-2 font-medium">MwSt</th>
                          <th className="text-right pl-2 pr-5 py-2 font-medium">Netto</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {lineItems.map((li: LexLineItem, liIdx: number) => {
                          const isCleaning = CLEANING_RE.test([li.name ?? '', li.description ?? ''].join(' '))
                          return (
                            <tr key={liIdx} className={`${isCleaning ? 'bg-teal-50/30' : ''} hover:bg-slate-50/50`}>
                              <td className="pl-5 pr-2 py-2 text-slate-400 font-mono">{liIdx + 1}</td>
                              <td className="px-2 py-2">
                                <p className="text-slate-800 font-medium">{li.name || '–'}</p>
                                {li.description && (
                                  <p className="text-slate-400 mt-0.5 truncate max-w-md">{li.description}</p>
                                )}
                              </td>
                              <td className="px-2 py-2 text-right text-slate-700 font-mono">{li.quantity ?? '–'}</td>
                              <td className="px-2 py-2 text-slate-500">{li.unitName ?? '–'}</td>
                              <td className="px-2 py-2 text-right text-slate-700 font-mono">
                                {li.unitPrice?.netAmount != null ? formatCurrency(li.unitPrice.netAmount) : '–'}
                              </td>
                              <td className="px-2 py-2 text-right text-slate-400">
                                {li.unitPrice?.taxRatePercentage != null ? `${li.unitPrice.taxRatePercentage}%` : '–'}
                              </td>
                              <td className="pl-2 pr-5 py-2 text-right font-bold text-slate-900 font-mono">
                                {li.totalPrice?.totalNetAmount != null
                                  ? formatCurrency(li.totalPrice.totalNetAmount)
                                  : li.quantity != null && li.unitPrice?.netAmount != null
                                    ? formatCurrency(li.quantity * li.unitPrice.netAmount)
                                    : '–'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      {detail?.totalPrice && (
                        <tfoot>
                          <tr className="bg-slate-50 border-t border-slate-200">
                            <td colSpan={6} className="pl-5 pr-2 py-2 text-right text-slate-500 font-medium">Gesamt netto</td>
                            <td className="pl-2 pr-5 py-2 text-right font-bold text-slate-900 font-mono">
                              {formatCurrency(detail.totalPrice.totalNetAmount)}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}

                {/* ═══ Storno-Info-Banner ═══ */}
                {item.isStorno && isReady && (
                  <div className="px-5 py-4">
                    {item.referencedInvoiceNumber ? (
                      <div className={`rounded-lg border p-4 ${item.status === 'accepted' ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                        <div className="flex items-start gap-3">
                          <AlertCircle size={16} className={`flex-shrink-0 mt-0.5 ${item.status === 'accepted' ? 'text-emerald-500' : 'text-red-500'}`} />
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold ${item.status === 'accepted' ? 'text-emerald-900' : 'text-red-900'}`}>
                              Storniert Rechnung:{' '}
                              <span className="font-mono">{item.referencedInvoiceNumber}</span>
                            </p>
                            {(() => {
                              const affected = bookings.filter(b => b.invoiceNumber === item.referencedInvoiceNumber)
                              if (affected.length === 0) return (
                                <p className="text-xs text-red-700 mt-1.5">
                                  Keine importierten Buchungen gefunden. Bitte zuerst die Originalrechnung importieren.
                                </p>
                              )
                              return (
                                <div className="mt-2 space-y-1.5">
                                  <p className="text-xs text-slate-600 font-medium">Betroffene Buchungen:</p>
                                  {affected.map(b => {
                                    const bprop = properties.find(p => p.id === b.propertyId)
                                    const isAlreadyStorniert = b.status === 'storniert'
                                    return (
                                      <div key={b.id} className="flex items-center gap-2 text-xs">
                                        <span className={`px-2 py-0.5 rounded font-mono font-bold ${
                                          isAlreadyStorniert ? 'bg-red-100 text-red-700 line-through' : 'bg-slate-100 text-slate-700'
                                        }`}>
                                          {bprop?.shortCode ?? bprop?.name ?? b.propertyId}
                                        </span>
                                        <span className="text-slate-500">{b.checkIn} – {b.checkOut}</span>
                                        {isAlreadyStorniert && (
                                          <span className="text-red-600 font-medium">Bereits storniert</span>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              )
                            })()}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <AlertCircle size={15} className="text-amber-500 flex-shrink-0" />
                        <p className="text-xs text-amber-800">
                          Kein Bezug auf eine Rechnung gefunden. Bitte manuell in Lexoffice prüfen.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* ═══ Erkannte Buchungen (Zuordnung) ═══ */}
                {!item.isStorno && isReady && item.positions.length > 0 && (
                  <div>
                    <div className="px-5 py-2 bg-blue-50/50 border-t border-b border-blue-100">
                      <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide">
                        Erkannte Buchungen ({item.positions.filter(p => p.positionType === 'booking').length})
                        {item.positions.some(p => p.positionType === 'cleaning') && (
                          <span className="text-teal-600 ml-2">
                            + {item.positions.filter(p => p.positionType === 'cleaning').length} Reinigung
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {item.positions.map(pos => {
                        const prop = pos.positionType === 'cleaning'
                          ? properties.find(p => p.id === pos.assignedPropertyId)
                          : properties.find(p => p.id === pos.propertyId)
                        const loc  = locations.find(l => l.id === prop?.locationId)
                        const isEditingThis = editingPos?.voucherId === item.voucher.id && editingPos.idx === pos.index

                        return (
                          <div key={pos.index} className={`px-5 py-3 transition-all ${
                            pos.status === 'accepted' ? 'bg-emerald-50/40' :
                            pos.status === 'skipped'  ? 'opacity-40' : ''
                          }`}>
                            <div className="flex items-start gap-3 flex-wrap">

                              {/* Position number */}
                              <span className="text-xs font-bold text-slate-400 w-5 flex-shrink-0 mt-0.5 text-center">
                                {pos.index + 1}.
                              </span>

                              <div className="flex-1 min-w-0">

                                {/* ── Endreinigung ── */}
                                {pos.positionType === 'cleaning' ? (
                                  <div className="flex flex-wrap items-center gap-3">
                                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">
                                      Endreinigung
                                    </span>
                                    <span className="text-sm font-bold text-slate-900">
                                      {pos.lineAmount != null ? formatCurrency(pos.lineAmount) : '–'}
                                    </span>
                                    {/* Zuordnung anzeigen */}
                                    <div className="flex items-center gap-1.5">
                                      {pos.assignedPropertyId ? (
                                        <span className="inline-flex items-center gap-1.5 text-xs">
                                          <span className="text-slate-500">Zugeordnet:</span>
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-50 border border-teal-200 font-medium text-teal-800">
                                            {prop && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: loc?.color }} />}
                                            {prop?.shortCode ?? prop?.name ?? pos.assignedPropertyId}
                                          </span>
                                        </span>
                                      ) : (
                                        <span className="text-xs text-amber-600 flex items-center gap-1">
                                          <AlertCircle size={11} /> Nicht zugeordnet
                                        </span>
                                      )}
                                      {/* Dropdown zum Ändern (immer sichtbar bei pending) */}
                                      {pos.status === 'pending' && (
                                        <select
                                          value={pos.assignedPropertyId ?? ''}
                                          onChange={e => updatePosition(item.voucher.id, pos.index, { assignedPropertyId: e.target.value || undefined })}
                                          className="text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-500 border-slate-200 bg-white"
                                        >
                                          <option value="">– Ändern –</option>
                                          {item.positions
                                            .filter(bp => bp.positionType === 'booking' && bp.propertyId)
                                            .map(bp => {
                                              const bprop = properties.find(pr => pr.id === bp.propertyId)
                                              return (
                                                <option key={bp.index} value={bp.propertyId!}>
                                                  {bprop?.shortCode ?? bprop?.name ?? bp.propertyId}
                                                </option>
                                              )
                                            })
                                          }
                                        </select>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  /* ── Reguläre Buchungsposition ── */
                                  <div className="grid grid-cols-2 md:grid-cols-5 gap-x-4 gap-y-1 text-sm">
                                    {/* Objekt */}
                                    <div>
                                      <p className="text-xs text-slate-400 font-medium uppercase mb-0.5">Objekt</p>
                                      {prop ? (
                                        <div className="flex items-center gap-1.5">
                                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: loc?.color }} />
                                          <span className="font-medium text-slate-800 truncate text-xs">{prop.shortCode || prop.name}</span>
                                          {prop.shortCode && (
                                            <span className="text-[10px] bg-blue-100 text-blue-700 px-1 rounded font-mono font-bold flex-shrink-0">
                                              {prop.shortCode}
                                            </span>
                                          )}
                                        </div>
                                      ) : pos.status === 'pending' ? (
                                        <PropertySearchInput
                                          properties={properties}
                                          locations={locations}
                                          value={pos.propertyId ?? ''}
                                          onChange={propertyId => updatePosition(
                                            item.voucher.id, pos.index,
                                            { propertyId: propertyId || undefined }
                                          )}
                                        />
                                      ) : (
                                        <p className="text-xs text-amber-600 flex items-center gap-1">
                                          <AlertCircle size={11} /> Nicht erkannt
                                        </p>
                                      )}
                                    </div>

                                    {/* Zeitraum */}
                                    <div>
                                      <p className="text-xs text-slate-400 font-medium uppercase mb-0.5">Zeitraum</p>
                                      {pos.checkIn && pos.checkOut ? (
                                        <p className="text-xs font-medium text-slate-800">
                                          {pos.checkIn} – {pos.checkOut}
                                          {pos.nights && <span className="text-slate-400"> · {pos.nights}N</span>}
                                        </p>
                                      ) : (
                                        <p className="text-xs text-amber-600 flex items-center gap-1">
                                          <AlertCircle size={11} /> Setzen
                                        </p>
                                      )}
                                    </div>

                                    {/* Betten */}
                                    <div>
                                      <p className="text-xs text-slate-400 font-medium uppercase mb-0.5">Betten</p>
                                      <p className="text-xs font-medium text-slate-800">
                                        {pos.bedsBooked ? `${pos.bedsBooked} Betten` : '–'}
                                      </p>
                                    </div>

                                    {/* Betrag */}
                                    <div>
                                      <p className="text-xs text-slate-400 font-medium uppercase mb-0.5">Netto</p>
                                      <p className="text-sm font-bold text-slate-900">
                                        {pos.lineAmount != null ? formatCurrency(pos.lineAmount) : '–'}
                                      </p>
                                    </div>

                                    {/* Bettenpreis berechnet */}
                                    <div>
                                      <p className="text-xs text-slate-400 font-medium uppercase mb-0.5">€/Bett/N</p>
                                      {pos.lineAmount != null && pos.nights && pos.bedsBooked ? (
                                        <p className="text-xs font-semibold text-blue-700">
                                          {formatCurrency(Math.round(pos.lineAmount / (pos.nights * pos.bedsBooked) * 100) / 100)}
                                        </p>
                                      ) : (
                                        <p className="text-xs text-slate-400">–</p>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Actions */}
                              <div className="flex items-center gap-1 flex-shrink-0">
                                {pos.status === 'pending' && (
                                  <>
                                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${confStyle[pos.confidence]}`}>
                                      {confLabel[pos.confidence]}
                                    </span>
                                    {pos.positionType === 'booking' && (
                                      <button
                                        onClick={() => setEditingPos(isEditingThis ? null : { voucherId: item.voucher.id, idx: pos.index })}
                                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                                        title="Bearbeiten"
                                      >
                                        <Pencil size={14} />
                                      </button>
                                    )}
                                    <button
                                      onClick={() => skipPosition(item.voucher.id, pos.index)}
                                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                                      title="Überspringen"
                                    >
                                      <XCircle size={16} />
                                    </button>
                                    <button
                                      onClick={() => acceptPosition(item.voucher.id, pos.index)}
                                      disabled={
                                        pos.positionType === 'cleaning'
                                          ? !pos.assignedPropertyId
                                          : !pos.checkIn || !pos.checkOut
                                      }
                                      className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg disabled:opacity-30"
                                      title={pos.positionType === 'cleaning' ? 'Endreinigung importieren' : 'Als Buchung importieren'}
                                    >
                                      <CheckCircle size={16} />
                                    </button>
                                  </>
                                )}
                                {pos.status === 'accepted' && (
                                  <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                                    <CheckCircle size={14} /> Importiert
                                  </span>
                                )}
                                {pos.status === 'skipped' && (
                                  <span className="text-xs text-slate-400">Übersprungen</span>
                                )}
                              </div>
                            </div>

                            {/* Raw text */}
                            {pos.rawText && !isEditingThis && pos.status === 'pending' && (
                              <p className="text-xs text-slate-400 italic mt-1 truncate pl-8">
                                &quot;{pos.rawText}&quot;
                              </p>
                            )}

                            {/* Inline edit */}
                            {isEditingThis && pos.status === 'pending' && (
                              <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 md:grid-cols-5 gap-3 pl-8">
                                <div>
                                  <label className="block text-xs text-slate-500 mb-1">Objekt</label>
                                  <PropertySearchInput
                                    properties={properties}
                                    locations={locations}
                                    value={pos.propertyId ?? ''}
                                    onChange={propertyId => updatePosition(
                                      item.voucher.id, pos.index,
                                      { propertyId: propertyId || undefined }
                                    )}
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs text-slate-500 mb-1">Anreise</label>
                                  <input type="date" value={pos.checkIn ?? ''}
                                    onChange={e => updatePosition(item.voucher.id, pos.index, { checkIn: e.target.value })}
                                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                                </div>
                                <div>
                                  <label className="block text-xs text-slate-500 mb-1">Abreise</label>
                                  <input type="date" value={pos.checkOut ?? ''}
                                    onChange={e => updatePosition(item.voucher.id, pos.index, { checkOut: e.target.value })}
                                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                                </div>
                                <div>
                                  <label className="block text-xs text-slate-500 mb-1">Betten</label>
                                  <input type="number" min={1} value={pos.bedsBooked ?? ''}
                                    onChange={e => updatePosition(item.voucher.id, pos.index, { bedsBooked: parseInt(e.target.value) || undefined })}
                                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                                </div>
                                <div className="flex items-end">
                                  <button
                                    onClick={() => acceptPosition(item.voucher.id, pos.index)}
                                    disabled={!pos.checkIn || !pos.checkOut}
                                    className="w-full py-1.5 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-700 disabled:opacity-40 flex items-center justify-center gap-1"
                                  >
                                    <CheckCircle size={12} /> Importieren
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Footer: Fortschrittsbalken */}
                {!item.isStorno && item.positions.length > 1 && !isFullyDone && isReady && (
                  <div className="px-5 py-2 bg-slate-50 border-t border-slate-100">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all"
                          style={{ width: `${(acceptedCount / item.positions.length) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-500 flex-shrink-0">
                        {acceptedCount}/{item.positions.length} Pos.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Bottom pagination */}
          <div className="flex items-center justify-between py-2">
            <button onClick={() => loadPage(currentPage - 1)} disabled={loading || currentPage === 0}
              className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-30">
              <ChevronLeft size={16} /> Vorherige Seite
            </button>
            <span className="text-sm text-slate-500">Seite {currentPage + 1} von {totalPages}</span>
            <button onClick={() => loadPage(currentPage + 1)} disabled={loading || currentPage >= totalPages - 1}
              className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-30">
              Nächste Seite <ChevronR size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
