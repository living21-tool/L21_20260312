import { NextRequest, NextResponse } from 'next/server'
import {
  getVoucherList, getInvoice, getQuotation, getCreditNote,
  getOrderConfirmation, getDownPaymentInvoice,
  type LexVoucherType,
} from '@/lib/lexoffice'

// GET /api/lexoffice/vouchers?type=invoice&page=0&size=50  → one page of vouchers
// GET /api/lexoffice/vouchers?type=invoice&id=xxx          → single voucher detail
// Supported types: invoice, creditnote, orderconfirmation, downpaymentinvoice, quotation
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = (searchParams.get('type') ?? 'invoice') as LexVoucherType
  const id   = searchParams.get('id')
  const page = parseInt(searchParams.get('page') ?? '0')
  const size = Math.min(parseInt(searchParams.get('size') ?? '50'), 100) // max 100
  // Optional: pass statusFilter=overdue to fetch overdue invoices separately
  const statusFilter = searchParams.get('statusFilter') ?? undefined
  const dateFrom = searchParams.get('dateFrom') ?? undefined
  const dateTo   = searchParams.get('dateTo')   ?? undefined

  try {
    if (id) {
      let detail
      switch (type) {
        case 'creditnote':         detail = await getCreditNote(id); break
        case 'orderconfirmation':  detail = await getOrderConfirmation(id); break
        case 'downpaymentinvoice': detail = await getDownPaymentInvoice(id); break
        case 'quotation':          detail = await getQuotation(id); break
        default:                   detail = await getInvoice(id); break
      }
      return NextResponse.json(detail)
    }

    // Only fetch ONE page — never all pages at once to avoid rate limiting
    const result = await getVoucherList(type, page, size, statusFilter, dateFrom, dateTo)
    return NextResponse.json({
      items: result.content,
      totalElements: result.totalElements,
      totalPages: result.totalPages,
      currentPage: result.number,
      pageSize: result.size,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
