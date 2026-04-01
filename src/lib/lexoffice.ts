// ─── Lexoffice API Client (server-side only) ──────────────────────────────────

const BASE_URL = process.env.LEXOFFICE_API_URL ?? 'https://api.lexoffice.io/v1'
const API_KEY  = process.env.LEXOFFICE_API_KEY ?? ''

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

async function lexFetch(path: string, options?: RequestInit, retries = 3): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options?.headers ?? {}),
    },
    cache: 'no-store',
  })

  // Rate limit — wait and retry
  if (res.status === 429 && retries > 0) {
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '2', 10)
    await delay((retryAfter || 2) * 1000)
    return lexFetch(path, options, retries - 1)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    const message = text || res.statusText
    const error = new Error(`Lexoffice API ${res.status}: ${message}`) as Error & { status?: number }
    error.status = res.status
    throw error
  }

  return res.json()
}

async function lexFetchBinary(path: string, options?: RequestInit, retries = 3): Promise<{ buffer: ArrayBuffer; contentType: string | null }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/pdf, application/octet-stream, */*',
      ...(options?.headers ?? {}),
    },
    cache: 'no-store',
  })

  if (res.status === 429 && retries > 0) {
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '2', 10)
    await delay((retryAfter || 2) * 1000)
    return lexFetchBinary(path, options, retries - 1)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    const message = text || res.statusText
    const error = new Error(`Lexoffice API ${res.status}: ${message}`) as Error & { status?: number }
    error.status = res.status
    throw error
  }

  return {
    buffer: await res.arrayBuffer(),
    contentType: res.headers.get('Content-Type'),
  }
}

// Small pause between sequential API calls to stay under rate limit
export async function rateLimitedDelay() {
  await delay(300)
}

// ─── Voucher List ─────────────────────────────────────────────────────────────

export interface LexVoucherListItem {
  id: string
  voucherType: string
  voucherStatus: string
  voucherNumber: string
  voucherDate: string
  createdDate?: string
  updatedDate?: string
  dueDate?: string
  contactId?: string
  contactName: string
  totalAmount: number       // actual field from API
  openAmount?: number
  currency: string
  archived: boolean
  // legacy alias used internally
  totalGrossAmount?: number
}

export interface LexVoucherListResponse {
  content: LexVoucherListItem[]
  totalPages: number
  totalElements: number
  number: number  // current page (0-based)
  size: number
}

// All possible statuses per voucher type
// NOTE: 'overdue' CANNOT be combined with other statuses (Lexoffice API constraint!)
// → fetch overdue invoices in a separate call using statusOverride='overdue'
const INVOICE_STATUSES            = 'draft,open,paid,paidoff,voided,accepted'
const CREDITNOTE_STATUSES         = 'draft,open,paid,paidoff,voided'
const ORDER_CONFIRMATION_STATUSES = 'draft,open,accepted,rejected,voided'
const DOWN_PAYMENT_STATUSES       = 'draft,open,paid,paidoff,voided'
const QUOTATION_STATUSES          = 'draft,open,accepted,rejected,expired,voided'

// All supported outgoing voucher types
export type LexVoucherType = 'invoice' | 'creditnote' | 'orderconfirmation' | 'downpaymentinvoice' | 'quotation'

function statusesForType(voucherType: LexVoucherType): string {
  switch (voucherType) {
    case 'creditnote':         return CREDITNOTE_STATUSES
    case 'orderconfirmation':  return ORDER_CONFIRMATION_STATUSES
    case 'downpaymentinvoice': return DOWN_PAYMENT_STATUSES
    case 'quotation':          return QUOTATION_STATUSES
    default:                   return INVOICE_STATUSES
  }
}

export async function getVoucherList(
  voucherType: LexVoucherType,
  page = 0,
  size = 50,
  statusOverride?: string,  // pass 'overdue' to fetch overdue invoices separately
  dateFrom?: string,        // ISO date YYYY-MM-DD (voucherDateFrom)
  dateTo?: string,          // ISO date YYYY-MM-DD (voucherDateTo)
): Promise<LexVoucherListResponse> {
  const statuses = statusOverride ?? statusesForType(voucherType)
  let url = `/voucherlist?voucherType=${voucherType}&voucherStatus=${statuses}&page=${page}&size=${size}&sort=voucherDate%2CDESC`
  if (dateFrom) url += `&voucherDateFrom=${dateFrom}`
  if (dateTo)   url += `&voucherDateTo=${dateTo}`
  // voucherStatus accepts comma-separated values (but NOT overdue + others combined!)
  return lexFetch(url) as Promise<LexVoucherListResponse>
}

export async function getAllVouchers(
  voucherType: LexVoucherType
): Promise<LexVoucherListItem[]> {
  const first = await getVoucherList(voucherType, 0, 100)
  const all = [...first.content]

  for (let p = 1; p < first.totalPages; p++) {
    const page = await getVoucherList(voucherType, p, 100)
    all.push(...page.content)
  }

  return all
}

// ─── Invoice Detail ───────────────────────────────────────────────────────────

export interface LexAddress {
  contactId?: string
  name?: string
  street?: string
  zip?: string
  city?: string
  countryCode?: string
}

export interface LexUnitPrice {
  currency: string
  netAmount: number
  grossAmount: number
  taxRatePercentage: number
}

export interface LexTotalPrice {
  currency: string
  totalNetAmount: number
  totalTaxAmount: number
  totalGrossAmount: number
}

export interface LexLineItem {
  id?: string
  type: 'custom' | 'service' | 'material' | 'text'
  name?: string
  description?: string
  quantity?: number
  unitName?: string
  unitPrice?: LexUnitPrice
  discountPercentage?: number
  totalPrice?: LexTotalPrice
}

export interface LexInvoice {
  id: string
  organizationId?: string
  createdDate?: string
  updatedDate?: string
  version?: number
  voucherStatus: string
  voucherNumber?: string
  voucherDate: string
  address: LexAddress
  lineItems: LexLineItem[]
  totalPrice: LexTotalPrice
  taxAmounts?: Array<{ taxRatePercentage: number; taxAmount: number; netAmount: number }>
  paymentConditions?: { paymentTermLabel: string; paymentTermDuration: number }
  files?: { documentFileId: string }
  // Nur bei Gutschriften: Referenz auf die stornierte Rechnung
  relatedVouchers?: Array<{ id?: string; voucherNumber?: string; voucherType?: string }>
}

export async function getInvoice(id: string): Promise<LexInvoice> {
  return lexFetch(`/invoices/${id}`) as Promise<LexInvoice>
}

export async function getQuotation(id: string): Promise<LexInvoice> {
  return lexFetch(`/quotations/${id}`) as Promise<LexInvoice>
}

export async function getCreditNote(id: string): Promise<LexInvoice> {
  return lexFetch(`/credit-notes/${id}`) as Promise<LexInvoice>
}

export async function getOrderConfirmation(id: string): Promise<LexInvoice> {
  return lexFetch(`/order-confirmations/${id}`) as Promise<LexInvoice>
}

export async function getDownPaymentInvoice(id: string): Promise<LexInvoice> {
  return lexFetch(`/down-payment-invoices/${id}`) as Promise<LexInvoice>
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

export interface LexContact {
  id: string
  version: number
  roles: { customer?: object; vendor?: object }
  company?: { name: string; taxNumber?: string; vatRegistrationId?: string }
  person?: { salutation?: string; firstName?: string; lastName?: string }
  addresses?: {
    billing?: Array<{ street?: string; zip?: string; city?: string; countryCode?: string }>
  }
  emailAddresses?: { business?: string[]; private?: string[] }
  phoneNumbers?: { business?: string[]; mobile?: string[]; private?: string[] }
}

export interface LexContactsResponse {
  content: LexContact[]
  totalPages: number
  totalElements: number
  number: number
  size: number
}

export async function getContacts(page = 0, size = 100): Promise<LexContactsResponse> {
  return lexFetch(`/contacts?page=${page}&size=${size}&direction=ASC&property=name`) as Promise<LexContactsResponse>
}

export async function getAllContacts(): Promise<LexContact[]> {
  const first = await getContacts(0, 100)
  const all = [...first.content]
  for (let p = 1; p < first.totalPages; p++) {
    const page = await getContacts(p, 100)
    all.push(...page.content)
  }
  return all
}

// ─── Create Invoice ───────────────────────────────────────────────────────────

export interface CreateInvoicePayload {
  voucherDate: string
  address: {
    contactId?: string
    name: string
    supplement?: string
    street?: string
    zip?: string
    city?: string
    countryCode?: string
  }
  lineItems: Array<{
    type: 'custom' | 'text'
    name?: string
    description?: string
    quantity?: number
    unitName?: string
    unitPrice?: { currency: 'EUR'; netAmount: number; taxRatePercentage: number }
    discountPercentage?: number
  }>
  totalPrice: { currency: 'EUR'; totalDiscountPercentage?: number }
  taxConditions: { taxType: 'net' | 'gross' | 'vatfree' }
  shippingConditions: (
    | { shippingType: 'none' }
    | { shippingType: 'service'; shippingDate: string }
    | { shippingType: 'serviceperiod'; shippingDate: string; shippingEndDate: string }
  )
  paymentConditions?: { paymentTermLabel: string; paymentTermDuration: number }
  title?: string
  introduction?: string
  remark?: string
}

export async function createInvoice(payload: CreateInvoicePayload, finalize = false): Promise<{ id: string }> {
  return lexFetch(`/invoices${finalize ? '?finalize=true' : ''}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }) as Promise<{ id: string }>
}

export async function createQuotation(payload: CreateInvoicePayload): Promise<{ id: string }> {
  return lexFetch('/quotations', {
    method: 'POST',
    body: JSON.stringify(payload),
  }) as Promise<{ id: string }>
}

async function tryRenderInvoiceDocument(invoiceId: string): Promise<string | null> {
  const candidates = [
    `/invoices/${invoiceId}/document`,
    `/invoices/${invoiceId}/files`,
  ]

  for (const path of candidates) {
    try {
      const result = await lexFetch(path, { method: 'POST' }) as { documentFileId?: string }
      if (result?.documentFileId) return result.documentFileId
    } catch {
      // try next inferred endpoint
    }
  }

  return null
}

async function tryDownloadFile(fileId: string): Promise<{ buffer: ArrayBuffer; contentType: string | null } | null> {
  const candidates = [
    `/files/${fileId}`,
    `/files/${fileId}?accept=application/pdf`,
  ]

  for (const path of candidates) {
    try {
      return await lexFetchBinary(path)
    } catch {
      // try next inferred endpoint
    }
  }

  return null
}

export async function downloadInvoicePdf(invoiceId: string): Promise<{ buffer: ArrayBuffer; fileName: string; contentType: string }> {
  const detail = await getInvoice(invoiceId)
  let documentFileId = detail.files?.documentFileId

  if (!documentFileId) {
    documentFileId = await tryRenderInvoiceDocument(invoiceId) ?? undefined
  }

  if (!documentFileId) {
    throw new Error('Für diesen Lexoffice-Beleg konnte keine PDF-Datei ermittelt werden.')
  }

  const file = await tryDownloadFile(documentFileId)
  if (!file) {
    throw new Error('Die PDF-Datei konnte aus Lexoffice nicht heruntergeladen werden.')
  }

  const fileName = `${detail.voucherNumber ?? invoiceId}.pdf`
  return {
    buffer: file.buffer,
    fileName,
    contentType: file.contentType ?? 'application/pdf',
  }
}

// ─── Helper: contact display name ────────────────────────────────────────────
export function contactDisplayName(c: LexContact): string {
  if (c.company?.name) return c.company.name
  if (c.person) return `${c.person.firstName ?? ''} ${c.person.lastName ?? ''}`.trim()
  return c.id
}
