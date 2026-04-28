import { NextRequest, NextResponse } from 'next/server'

import { updateLexofficeImportQueueItem } from '@/lib/lexoffice-sync'
import type { LexofficeImportPosition } from '@/lib/types'

type Params = {
  params: Promise<{ voucherId: string }>
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { voucherId } = await params
    const body = await request.json()
    const positions = ((body.positions ?? []) as LexofficeImportPosition[])
    const item = await updateLexofficeImportQueueItem({ voucherId, positions })
    return NextResponse.json(item)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('Queue-Eintrag wurde nicht gefunden')) {
      return NextResponse.json({ ok: false, error: message })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
