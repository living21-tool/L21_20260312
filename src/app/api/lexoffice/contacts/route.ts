import { NextResponse } from 'next/server'
import { getAllContacts } from '@/lib/lexoffice'

export async function GET() {
  try {
    const contacts = await getAllContacts()
    return NextResponse.json(contacts)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
