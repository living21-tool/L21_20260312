import { NextResponse } from 'next/server'

import { importLexofficeImportQueueItem } from '@/lib/lexoffice-sync'

type Params = {
  params: Promise<{ voucherId: string }>
}

export async function POST(_request: Request, { params }: Params) {
  try {
    const { voucherId } = await params
    const item = await importLexofficeImportQueueItem(voucherId)
    return NextResponse.json(item)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      message.includes('nicht vollständig genug')
      || message.includes('keine passende importierte Ursprungsrechnung')
      || message.includes('bereits als Buchung im System vorhanden')
    ) {
      return NextResponse.json({ ok: false, error: message })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
