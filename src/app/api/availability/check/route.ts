import { NextRequest, NextResponse } from 'next/server'

import { parseAvailabilityMessage } from '@/lib/availability-message-parser'
import { createAvailabilitySummary } from '@/lib/availability-response'
import { checkAvailability, loadLocations, type AvailabilityLookupInput } from '@/lib/availability-service'

type AvailabilityCheckRequest =
  | AvailabilityLookupInput
  | {
      text: string
    }

async function resolveRequest(body: AvailabilityCheckRequest): Promise<AvailabilityLookupInput> {
  if ('text' in body && typeof body.text === 'string') {
    const locations = await loadLocations()
    return parseAvailabilityMessage(body.text, locations)
  }

  return body as AvailabilityLookupInput
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as AvailabilityCheckRequest
    const input = await resolveRequest(body)
    const result = await checkAvailability(input)

    return NextResponse.json({
      ok: true,
      request: input,
      summary: createAvailabilitySummary(result),
      ...result,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
