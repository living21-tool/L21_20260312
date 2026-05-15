import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const { data } = await supabaseAdmin
    .from('agent_config')
    .select('enabled_tools')
    .eq('id', 'default')
    .maybeSingle()

  return Response.json({ enabledTools: data?.enabled_tools ?? [] })
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const enabledTools: string[] = body.enabledTools ?? []

    const { error } = await supabaseAdmin
      .from('agent_config')
      .upsert({
        id: 'default',
        enabled_tools: enabledTools,
        updated_at: new Date().toISOString(),
      })

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ success: true, enabledTools })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}
