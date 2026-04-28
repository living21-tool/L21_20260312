import { NextRequest, NextResponse } from 'next/server'

import { getLexofficeImportOverview, runLexofficeSync } from '@/lib/lexoffice-sync'
import { hasSupabaseAdminConfig } from '@/lib/supabase-admin'

function isAuthorized(request: NextRequest) {
  const configuredSecret = process.env.LEXOFFICE_SYNC_SECRET ?? process.env.CRON_SECRET
  if (!configuredSecret) return true

  const authorization = request.headers.get('authorization') ?? ''
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  const explicitToken = request.headers.get('x-sync-token') ?? ''
  return bearer === configuredSecret || explicitToken === configuredSecret
}

export async function GET(request: NextRequest) {
  if (!hasSupabaseAdminConfig()) {
    return NextResponse.json({
      configured: false,
      setupMessage: 'SUPABASE_SERVICE_ROLE_KEY fehlt. Der Lexoffice-Sync braucht den Service-Role-Key auf dem Server.',
      state: {},
      counts: {
        pendingReview: 0,
        autoImported: 0,
        duplicates: 0,
        errors: 0,
      },
      items: [],
    })
  }

  const runRequested = new URL(request.url).searchParams.get('run') === '1'
  if (runRequested) {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
    }

    try {
      const result = await runLexofficeSync()
      return NextResponse.json(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  try {
    const limit = Number.parseInt(new URL(request.url).searchParams.get('limit') ?? '12', 10)
    const overview = await getLexofficeImportOverview(Number.isFinite(limit) && limit > 0 ? limit : 12)
    return NextResponse.json(overview)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST() {
  if (!hasSupabaseAdminConfig()) {
    return NextResponse.json({
      error: 'SUPABASE_SERVICE_ROLE_KEY fehlt. Der Lexoffice-Sync kann lokal erst nach Hinterlegung des Service-Role-Keys laufen.',
      configured: false,
    }, { status: 503 })
  }

  try {
    const result = await runLexofficeSync()
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
