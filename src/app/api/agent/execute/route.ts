import { getToolByName, executeToolByName, getAllToolDefinitions } from '@/lib/agent-tools'
import { supabaseAdmin } from '@/lib/supabase-admin'

async function loadEnabledTools(): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('agent_config')
    .select('enabled_tools')
    .eq('id', 'default')
    .maybeSingle()

  if (data?.enabled_tools) return new Set(data.enabled_tools as string[])

  return new Set(
    getAllToolDefinitions()
      .filter(t => t.category === 'query')
      .map(t => t.name),
  )
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { toolName, args } = body as { toolName: string; args: Record<string, unknown> }

    if (!toolName) {
      return Response.json({ error: 'toolName fehlt.' }, { status: 400 })
    }

    const tool = getToolByName(toolName)
    if (!tool) {
      return Response.json({ error: `Tool "${toolName}" nicht gefunden.` }, { status: 404 })
    }

    if (tool.category !== 'action') {
      return Response.json({ error: `Tool "${toolName}" ist kein Action-Tool.` }, { status: 400 })
    }

    const enabledTools = await loadEnabledTools()
    if (!enabledTools.has(toolName)) {
      return Response.json({ error: `Tool "${toolName}" ist deaktiviert.` }, { status: 403 })
    }

    const result = await executeToolByName(toolName, args ?? {})
    return Response.json({ success: true, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}
