import 'server-only'

import {
  getToolByName,
  getToolsForClaude,
  executeToolByName,
  loadAgentContext,
} from '@/lib/agent-tools'

const AGENT_MODEL = process.env.ANTHROPIC_AGENT_MODEL || 'claude-sonnet-4-6'
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const MAX_TOOL_ROUNDS = 6

export type AgentMessage = {
  role: 'user' | 'assistant'
  content: string | AgentContentBlock[]
}

type AgentContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

export type AgentStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'proposal'; toolName: string; toolCallId: string; args: Record<string, unknown>; summary: string; label: string }
  | { type: 'tool_executing'; toolName: string; label: string }
  | { type: 'tool_result'; toolName: string; summary: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

async function buildSystemPrompt(): Promise<string> {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
  const context = await loadAgentContext()

  return [
    'Du bist der L21 KI-Assistent, ein intelligenter Buchungsassistent für ein Monteurzimmer-/Ferienwohnungs-Verwaltungssystem.',
    '',
    'Deine Aufgaben:',
    '- Beantworte Fragen zu Buchungen, Verfügbarkeit, Kunden und Rechnungen.',
    '- Nutze die verfügbaren Tools, um aktuelle Daten aus dem System abzurufen.',
    '- Wenn eine Aktion nötig ist (z.B. Buchung erstellen, Kunde anlegen), schlage sie vor und nutze das passende Tool.',
    '- Antworte immer auf Deutsch.',
    '- Sei präzise und hilfreich. Fasse Ergebnisse verständlich zusammen.',
    '- Wenn du Daten abfragst, zeige die relevanten Informationen übersichtlich an.',
    '- Bei Preisen: verwende immer € und nenne ob netto oder brutto.',
    '- Formatiere Antworten mit Markdown: nutze **fett** für wichtige Zahlen, Tabellen für Listen mit mehreren Spalten, und > Blockquotes für Zusammenfassungen.',
    '- Tabellen immer mit korrekter Markdown-Syntax: | Header | Header | gefolgt von |---|---| und dann Datenzeilen.',
    '- Halte Antworten kompakt und übersichtlich. Keine unnötigen Einleitungen.',
    '',
    `Heute ist ${today} (Europe/Berlin).`,
    '',
    'Bekannte Standorte:',
    JSON.stringify(context.locations, null, 2),
    '',
    'Bekannte Objekte/Unterkünfte:',
    JSON.stringify(context.properties, null, 2),
    '',
    'Bekannte Auftraggeber/Kunden (Auszug):',
    JSON.stringify(context.customers, null, 2),
  ].join('\n')
}

type AnthropicStreamEvent = {
  type: string
  index?: number
  delta?: { type?: string; text?: string; partial_json?: string }
  content_block?: { type?: string; id?: string; name?: string }
  message?: { content?: AnthropicContentBlock[] }
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

async function callAnthropicStream(
  systemPrompt: string,
  messages: AgentMessage[],
  tools: ReturnType<typeof getToolsForClaude>,
): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY nicht konfiguriert.')

  const body: Record<string, unknown> = {
    model: AGENT_MODEL,
    max_tokens: 4096,
    stream: true,
    system: systemPrompt,
    messages,
  }

  if (tools.length > 0) {
    body.tools = tools
  }

  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Anthropic API Fehler: ${response.status} ${text}`)
  }

  return response
}

function parseSSELine(line: string): AnthropicStreamEvent | null {
  if (!line.startsWith('data: ')) return null
  const data = line.slice(6)
  if (data === '[DONE]') return null
  try {
    return JSON.parse(data) as AnthropicStreamEvent
  } catch {
    return null
  }
}

type StreamedResponse = {
  contentBlocks: AnthropicContentBlock[]
  stopReason: string | null
}

async function consumeAnthropicStream(
  response: Response,
  onTextDelta: (text: string) => void,
): Promise<StreamedResponse> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const contentBlocks: AnthropicContentBlock[] = []
  const blockStates: Array<{ type: string; id?: string; name?: string; textParts: string[]; jsonParts: string[] }> = []
  let stopReason: string | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const event = parseSSELine(line.trim())
      if (!event) continue

      switch (event.type) {
        case 'content_block_start': {
          const block = event.content_block
          blockStates[event.index!] = {
            type: block?.type ?? 'text',
            id: block?.id,
            name: block?.name,
            textParts: [],
            jsonParts: [],
          }
          break
        }

        case 'content_block_delta': {
          const state = blockStates[event.index!]
          if (!state) break
          if (event.delta?.text) {
            state.textParts.push(event.delta.text)
            onTextDelta(event.delta.text)
          }
          if (event.delta?.partial_json) {
            state.jsonParts.push(event.delta.partial_json)
          }
          break
        }

        case 'content_block_stop': {
          const state = blockStates[event.index!]
          if (!state) break
          if (state.type === 'text') {
            contentBlocks.push({ type: 'text', text: state.textParts.join('') })
          } else if (state.type === 'tool_use') {
            let input: Record<string, unknown> = {}
            const jsonStr = state.jsonParts.join('')
            if (jsonStr) {
              try { input = JSON.parse(jsonStr) } catch { /* ignore */ }
            }
            contentBlocks.push({
              type: 'tool_use',
              id: state.id!,
              name: state.name!,
              input,
            })
          }
          break
        }

        case 'message_delta': {
          const delta = event.delta as Record<string, unknown> | undefined
          if (delta?.stop_reason) {
            stopReason = delta.stop_reason as string
          }
          break
        }
      }
    }
  }

  return { contentBlocks, stopReason }
}

export async function* agentStream(params: {
  messages: AgentMessage[]
  enabledTools: string[]
}): AsyncGenerator<AgentStreamEvent> {
  const systemPrompt = await buildSystemPrompt()
  const tools = getToolsForClaude(params.enabledTools)
  const messages = [...params.messages]

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callAnthropicStream(systemPrompt, messages, tools)

    const textParts: string[] = []
    const { contentBlocks, stopReason } = await consumeAnthropicStream(response, (text) => {
      textParts.push(text)
    })

    // Emit text deltas
    for (const text of textParts) {
      yield { type: 'delta', text }
    }

    // Check for tool use blocks
    const toolUseBlocks = contentBlocks.filter(
      (block): block is Extract<AnthropicContentBlock, { type: 'tool_use' }> => block.type === 'tool_use'
    )

    if (toolUseBlocks.length === 0 || stopReason !== 'tool_use') {
      yield { type: 'done' }
      return
    }

    // Process tool calls
    const assistantContent = contentBlocks
    const toolResults: AgentContentBlock[] = []
    let hasActionProposal = false

    for (const toolUse of toolUseBlocks) {
      const tool = getToolByName(toolUse.name)

      if (!tool) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify({ error: `Tool "${toolUse.name}" nicht gefunden.` }),
        })
        continue
      }

      if (tool.category === 'action') {
        // Action tool → emit proposal, don't execute
        const summary = tool.formatProposal?.(toolUse.input) ?? `${tool.label} ausführen`
        yield {
          type: 'proposal',
          toolName: tool.name,
          toolCallId: toolUse.id,
          args: toolUse.input,
          summary,
          label: tool.label,
        }
        hasActionProposal = true
        // Don't add tool result — the client will handle execution after confirmation
      } else {
        // Query tool → execute immediately
        yield { type: 'tool_executing', toolName: tool.name, label: tool.label }
        try {
          const result = await executeToolByName(tool.name, toolUse.input)
          const resultStr = JSON.stringify(result, null, 2)
          // Truncate large results
          const truncated = resultStr.length > 8000
            ? resultStr.slice(0, 8000) + '\n... (gekürzt)'
            : resultStr
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: truncated,
          })
          yield { type: 'tool_result', toolName: tool.name, summary: `${tool.label} abgeschlossen` }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: msg }),
          })
          yield { type: 'tool_result', toolName: tool.name, summary: `Fehler: ${msg}` }
        }
      }
    }

    if (hasActionProposal) {
      // Stop the loop — client will handle the proposal
      yield { type: 'done' }
      return
    }

    // Continue the agentic loop with tool results
    messages.push({ role: 'assistant', content: assistantContent as AgentContentBlock[] })
    messages.push({ role: 'user', content: toolResults })
  }

  yield { type: 'error', message: 'Maximale Anzahl an Tool-Runden erreicht.' }
  yield { type: 'done' }
}
