import { NextResponse } from 'next/server'
import { getVoucherList } from '@/lib/lexoffice'

export async function GET() {
  try {
    const result = await getVoucherList('invoice', 0, 1)
    return NextResponse.json({
      ok: true,
      message: `Verbindung erfolgreich! ${result.totalElements} Rechnungen gefunden.`,
      totalInvoices: result.totalElements,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, message }, { status: 500 })
  }
}
