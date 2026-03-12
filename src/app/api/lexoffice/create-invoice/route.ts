import { NextRequest, NextResponse } from 'next/server'
import { createInvoice, createQuotation, CreateInvoicePayload } from '@/lib/lexoffice'

// POST /api/lexoffice/create-invoice
// Body: { type: 'invoice' | 'quotation', finalize?: boolean, ...payload }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { type = 'invoice', finalize = false, ...payload } = body as { type: 'invoice' | 'quotation'; finalize?: boolean } & CreateInvoicePayload

    const result = type === 'quotation'
      ? await createQuotation(payload)
      : await createInvoice(payload, finalize)

    return NextResponse.json({ ok: true, id: result.id })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
