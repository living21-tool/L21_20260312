import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateCleaningTasks, reconcileCleaningTasks } from '@/lib/cleaning-task-generator'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export async function POST(request: NextRequest) {
  try {
    // Auth: Bearer Token → Admin prüfen
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    if (!url || !anonKey) {
      return NextResponse.json({ error: 'Supabase nicht konfiguriert.' }, { status: 500 })
    }

    const callerClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: callerUser } = await callerClient.auth.getUser()
    if (!callerUser.user) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 })
    }

    const { data: callerProfile } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', callerUser.user.id)
      .single()

    if (callerProfile?.role !== 'admin') {
      return NextResponse.json({ error: 'Nur Admins.' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({})) as {
      propertyId?: string
      horizonDays?: number
    }

    const [generated, reconciled] = await Promise.all([
      generateCleaningTasks({
        horizonDays: body.horizonDays ?? 7,
        propertyId: body.propertyId,
      }),
      reconcileCleaningTasks(),
    ])

    return NextResponse.json({
      created: generated.created,
      skipped: generated.skipped,
      archived: reconciled.archived,
      updated: reconciled.updated,
      errors: generated.errors,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
