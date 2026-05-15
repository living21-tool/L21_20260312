import { agentStream, type AgentMessage } from '@/lib/agent-stream'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAllToolDefinitions } from '@/lib/agent-tools'

async function loadEnabledTools(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('agent_config')
    .select('enabled_tools')
    .eq('id', 'default')
    .maybeSingle()

  if (data?.enabled_tools) return data.enabled_tools as string[]

  // Fallback: all query tools enabled
  return getAllToolDefinitions()
    .filter(t => t.category === 'query')
    .map(t => t.name)
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const messages: AgentMessage[] = body.messages ?? []

    if (messages.length === 0) {
      return Response.json({ error: 'Keine Nachrichten übergeben.' }, { status: 400 })
    }

    const enabledTools = await loadEnabledTools()

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of agentStream({ messages, enabledTools })) {
            const data = `data: ${JSON.stringify(event)}\n\n`
            controller.enqueue(encoder.encode(data))
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          const errorEvent = `data: ${JSON.stringify({ type: 'error', message })}\n\n`
          controller.enqueue(encoder.encode(errorEvent))
          const doneEvent = `data: ${JSON.stringify({ type: 'done' })}\n\n`
          controller.enqueue(encoder.encode(doneEvent))
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}
