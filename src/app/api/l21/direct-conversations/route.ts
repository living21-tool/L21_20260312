import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

type RequestBody = {
  otherProfileId?: string
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!token) {
      return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
    }

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json({ error: 'Session ist ungueltig.' }, { status: 401 })
    }

    const body = (await request.json()) as RequestBody
    const otherProfileId = body.otherProfileId?.trim()

    if (!otherProfileId) {
      return NextResponse.json({ error: 'Mitarbeiter-ID fehlt.' }, { status: 400 })
    }

    if (otherProfileId === user.id) {
      return NextResponse.json({ error: 'Kein Direktchat mit dir selbst moeglich.' }, { status: 400 })
    }

    const { data: otherProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, is_active')
      .eq('id', otherProfileId)
      .single()

    if (profileError || !otherProfile) {
      return NextResponse.json({ error: 'Mitarbeiter nicht gefunden.' }, { status: 404 })
    }

    if (!otherProfile.is_active) {
      return NextResponse.json({ error: 'Mitarbeiter ist nicht aktiv.' }, { status: 400 })
    }

    const directKey = [user.id, otherProfileId].sort().join(':')

    const { data: existingConversation } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('direct_key', directKey)
      .maybeSingle()

    let conversationId = existingConversation?.id as string | undefined

    if (!conversationId) {
      const { data: conversation, error: insertError } = await supabaseAdmin
        .from('conversations')
        .insert({
          type: 'direct',
          title: 'Direktchat',
          created_by: user.id,
          direct_key: directKey,
        })
        .select('id')
        .single()

      if (insertError || !conversation) {
        return NextResponse.json({ error: insertError?.message ?? 'Direktchat konnte nicht erstellt werden.' }, { status: 400 })
      }

      conversationId = conversation.id as string
    }

    const { error: memberError } = await supabaseAdmin.from('conversation_members').upsert([
      { conversation_id: conversationId, profile_id: user.id },
      { conversation_id: conversationId, profile_id: otherProfileId },
    ], { onConflict: 'conversation_id,profile_id' })

    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 400 })
    }

    return NextResponse.json({ conversationId })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
