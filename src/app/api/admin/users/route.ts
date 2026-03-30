import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase-admin'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

function getUserScopedClient(token: string) {
  if (!url || !anonKey) {
    throw new Error('Supabase environment variables are missing.')
  }

  return createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')

    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 })
    }

    const token = authHeader.replace('Bearer ', '')
    const callerClient = getUserScopedClient(token)
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
      return NextResponse.json({ error: 'Nur Admins duerfen Mitarbeiter anlegen.' }, { status: 403 })
    }

    const body = await request.json()
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '').trim()
    const fullName = String(body.fullName ?? '').trim()
    const role = String(body.role ?? 'reinigung').trim()
    const avatarColor = String(body.avatarColor ?? '#2563eb').trim()

    if (!email || !password || !fullName) {
      return NextResponse.json({ error: 'Name, E-Mail und Passwort sind erforderlich.' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        role,
      },
    })

    if (error || !data.user) {
      return NextResponse.json({ error: error?.message ?? 'Benutzer konnte nicht erstellt werden.' }, { status: 400 })
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({
        full_name: fullName,
        email,
        role,
        avatar_color: avatarColor,
        is_active: true,
      })
      .eq('id', data.user.id)

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true, id: data.user.id })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
