'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bot,
  Send,
  User,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Wrench,
  Sparkles,
  RotateCcw,
  Settings,
  X,
} from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import AgentSettings from '@/components/AgentSettings'

type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'proposal'; toolName: string; toolCallId: string; args: Record<string, unknown>; summary: string; label: string; status: 'pending' | 'executing' | 'confirmed' | 'rejected' }
  | { role: 'action_result'; toolName: string; success: boolean; result: string }
  | { role: 'tool_info'; toolName: string; label: string; status: 'executing' | 'done' | 'error'; summary?: string }

type StreamEvent = {
  type: 'delta' | 'proposal' | 'tool_executing' | 'tool_result' | 'done' | 'error'
  text?: string
  toolName?: string
  toolCallId?: string
  args?: Record<string, unknown>
  summary?: string
  label?: string
  message?: string
}

// Convert our ChatMessage[] to the API format (only user + assistant)
function toApiMessages(messages: ChatMessage[]) {
  const apiMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const msg of messages) {
    if (msg.role === 'user') {
      apiMessages.push({ role: 'user', content: msg.content })
    } else if (msg.role === 'assistant') {
      apiMessages.push({ role: 'assistant', content: msg.content })
    }
  }
  return apiMessages
}

export default function AgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  async function sendMessage(text: string) {
    if (!text.trim() || isStreaming) return

    const userMessage: ChatMessage = { role: 'user', content: text.trim() }
    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    setInput('')
    setIsStreaming(true)

    // Add placeholder assistant message
    const assistantIndex = updatedMessages.length
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: toApiMessages(updatedMessages) }),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Fehler beim Senden')
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let assistantText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let event: StreamEvent
          try {
            event = JSON.parse(line.slice(6))
          } catch {
            continue
          }

          switch (event.type) {
            case 'delta':
              assistantText += event.text ?? ''
              setMessages(prev => {
                const updated = [...prev]
                const msg = updated[assistantIndex]
                if (msg && msg.role === 'assistant') {
                  updated[assistantIndex] = { ...msg, content: assistantText }
                }
                return updated
              })
              break

            case 'tool_executing':
              setMessages(prev => [...prev, {
                role: 'tool_info',
                toolName: event.toolName!,
                label: event.label!,
                status: 'executing',
              }])
              break

            case 'tool_result':
              setMessages(prev => {
                const updated = [...prev]
                // Update the last tool_info for this tool
                for (let i = updated.length - 1; i >= 0; i--) {
                  const msg = updated[i]
                  if (msg.role === 'tool_info' && msg.toolName === event.toolName && msg.status === 'executing') {
                    updated[i] = { ...msg, status: 'done', summary: event.summary }
                    break
                  }
                }
                return updated
              })
              break

            case 'proposal':
              setMessages(prev => [...prev, {
                role: 'proposal',
                toolName: event.toolName!,
                toolCallId: event.toolCallId!,
                args: event.args!,
                summary: event.summary!,
                label: event.label!,
                status: 'pending',
              }])
              break

            case 'error':
              if (assistantText) {
                setMessages(prev => {
                  const updated = [...prev]
                  const msg = updated[assistantIndex]
                  if (msg && msg.role === 'assistant') {
                    updated[assistantIndex] = { ...msg, content: assistantText + `\n\n⚠️ ${event.message}` }
                  }
                  return updated
                })
              } else {
                setMessages(prev => {
                  const updated = [...prev]
                  updated[assistantIndex] = { role: 'assistant', content: `⚠️ Fehler: ${event.message}` }
                  return updated
                })
              }
              break
          }
        }
      }

      // Remove empty assistant messages
      setMessages(prev => prev.filter(msg => !(msg.role === 'assistant' && !msg.content)))
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      setMessages(prev => {
        const updated = [...prev]
        updated[assistantIndex] = { role: 'assistant', content: `⚠️ Fehler: ${errorMsg}` }
        return updated
      })
    } finally {
      setIsStreaming(false)
    }
  }

  async function executeProposal(proposalIndex: number) {
    const proposal = messages[proposalIndex]
    if (!proposal || proposal.role !== 'proposal' || proposal.status !== 'pending') return

    // Mark as executing
    setMessages(prev => {
      const updated = [...prev]
      updated[proposalIndex] = { ...proposal, status: 'executing' }
      return updated
    })

    try {
      const response = await fetch('/api/agent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: proposal.toolName, args: proposal.args }),
      })

      const data = await response.json()

      setMessages(prev => {
        const updated = [...prev]
        updated[proposalIndex] = { ...proposal, status: data.success ? 'confirmed' : 'rejected' }
        return [...updated, {
          role: 'action_result' as const,
          toolName: proposal.toolName,
          success: !!data.success,
          result: data.success
            ? `✅ ${proposal.label} erfolgreich ausgeführt.`
            : `❌ Fehler: ${data.error}`,
        }]
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      setMessages(prev => {
        const updated = [...prev]
        updated[proposalIndex] = { ...proposal, status: 'rejected' }
        return [...updated, {
          role: 'action_result' as const,
          toolName: proposal.toolName,
          success: false,
          result: `❌ Fehler: ${errorMsg}`,
        }]
      })
    }
  }

  function rejectProposal(proposalIndex: number) {
    setMessages(prev => {
      const updated = [...prev]
      const proposal = updated[proposalIndex]
      if (proposal && proposal.role === 'proposal') {
        updated[proposalIndex] = { ...proposal, status: 'rejected' }
      }
      return updated
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  function clearChat() {
    setMessages([])
    setInput('')
  }

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-violet-600 rounded-xl flex items-center justify-center">
            <Sparkles size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">L21 AI Assistent</h1>
            <p className="text-xs text-slate-500">Buchungen, Verfügbarkeit, Kunden &mdash; frag mich alles</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <RotateCcw size={14} />
              Neuer Chat
            </button>
          )}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={cn(
              'w-9 h-9 flex items-center justify-center rounded-lg transition-colors',
              showSettings
                ? 'bg-blue-100 text-blue-600'
                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100',
            )}
          >
            {showSettings ? <X size={18} /> : <Settings size={18} />}
          </button>
        </div>
      </div>

      {/* Content area: messages + optional settings panel */}
      <div className="flex-1 flex overflow-hidden">

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-100 to-violet-100 rounded-2xl flex items-center justify-center mb-4">
              <Bot size={32} className="text-blue-600" />
            </div>
            <h2 className="text-lg font-semibold text-slate-700 mb-1">Hallo! Ich bin dein L21 Assistent.</h2>
            <p className="text-sm text-slate-500 max-w-md">
              Frag mich nach Verfügbarkeiten, Buchungen, Kunden oder lass mich Aktionen für dich ausführen.
            </p>
            <div className="flex flex-wrap gap-2 mt-6 justify-center">
              {[
                'Welche Betten sind nächste Woche frei?',
                'Zeig mir alle offenen Buchungen',
                'Suche Kunde "Bau"',
              ].map(suggestion => (
                <button
                  key={suggestion}
                  onClick={() => sendMessage(suggestion)}
                  className="px-3 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          switch (msg.role) {
            case 'user':
              return (
                <div key={i} className="flex justify-end">
                  <div className="flex items-start gap-2 max-w-[75%]">
                    <div className="bg-blue-600 text-white rounded-2xl rounded-tr-md px-4 py-2.5 text-sm whitespace-pre-wrap">
                      {msg.content}
                    </div>
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <User size={16} className="text-blue-600" />
                    </div>
                  </div>
                </div>
              )

            case 'assistant':
              return (
                <div key={i} className="flex justify-start">
                  <div className="flex items-start gap-2 max-w-[75%]">
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-violet-600 rounded-full flex items-center justify-center flex-shrink-0">
                      <Bot size={16} className="text-white" />
                    </div>
                    <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-md px-4 py-2.5 text-sm text-slate-800 shadow-sm">
                      {msg.content ? (
                        <div className="prose prose-sm prose-slate max-w-none prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-headings:my-2 prose-table:my-2 prose-th:px-3 prose-th:py-1.5 prose-th:bg-slate-50 prose-th:text-left prose-th:font-semibold prose-th:text-slate-700 prose-th:border prose-th:border-slate-200 prose-td:px-3 prose-td:py-1.5 prose-td:border prose-td:border-slate-200 prose-blockquote:my-2 prose-blockquote:border-blue-300 prose-blockquote:bg-blue-50 prose-blockquote:py-1 prose-blockquote:px-3 prose-blockquote:rounded-r-lg prose-blockquote:not-italic prose-code:bg-slate-100 prose-code:px-1 prose-code:rounded prose-code:text-slate-700 prose-code:before:content-none prose-code:after:content-none">
                          <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>
                        </div>
                      ) : (
                        <span className="flex items-center gap-2 text-slate-400">
                          <Loader2 size={14} className="animate-spin" />
                          Denke nach...
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )

            case 'tool_info':
              return (
                <div key={i} className="flex justify-start pl-10">
                  <div className={cn(
                    'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium',
                    msg.status === 'executing' && 'bg-amber-50 text-amber-700 border border-amber-200',
                    msg.status === 'done' && 'bg-emerald-50 text-emerald-700 border border-emerald-200',
                    msg.status === 'error' && 'bg-red-50 text-red-700 border border-red-200',
                  )}>
                    {msg.status === 'executing' && <Loader2 size={12} className="animate-spin" />}
                    {msg.status === 'done' && <CheckCircle2 size={12} />}
                    {msg.status === 'error' && <AlertTriangle size={12} />}
                    <Wrench size={12} />
                    {msg.label}
                    {msg.summary && <span className="text-slate-500">— {msg.summary}</span>}
                  </div>
                </div>
              )

            case 'proposal':
              return (
                <div key={i} className="flex justify-start pl-10">
                  <div className="bg-white border-2 border-blue-200 rounded-xl p-4 max-w-[70%] shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center">
                        <Wrench size={14} className="text-blue-600" />
                      </div>
                      <span className="text-sm font-semibold text-slate-900">{msg.label}</span>
                    </div>
                    <p className="text-sm text-slate-600 mb-3">{msg.summary}</p>
                    {msg.status === 'pending' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => executeProposal(i)}
                          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                        >
                          <CheckCircle2 size={14} />
                          Ausführen
                        </button>
                        <button
                          onClick={() => rejectProposal(i)}
                          className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 text-slate-600 text-sm font-medium rounded-lg hover:bg-slate-200 transition-colors"
                        >
                          <XCircle size={14} />
                          Abbrechen
                        </button>
                      </div>
                    )}
                    {msg.status === 'executing' && (
                      <div className="flex items-center gap-2 text-sm text-amber-600">
                        <Loader2 size={14} className="animate-spin" />
                        Wird ausgeführt...
                      </div>
                    )}
                    {msg.status === 'confirmed' && (
                      <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
                        <CheckCircle2 size={14} />
                        Ausgeführt
                      </div>
                    )}
                    {msg.status === 'rejected' && (
                      <div className="flex items-center gap-2 text-sm text-slate-400 font-medium">
                        <XCircle size={14} />
                        Abgebrochen
                      </div>
                    )}
                  </div>
                </div>
              )

            case 'action_result':
              return (
                <div key={i} className="flex justify-start pl-10">
                  <div className={cn(
                    'px-3 py-2 rounded-lg text-sm font-medium',
                    msg.success
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-red-50 text-red-700 border border-red-200',
                  )}>
                    {msg.result}
                  </div>
                </div>
              )

            default:
              return null
          }
        })}

        {isStreaming && messages.length > 0 && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="flex justify-start">
            <div className="flex items-start gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-violet-600 rounded-full flex items-center justify-center flex-shrink-0">
                <Bot size={16} className="text-white" />
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-md px-4 py-2.5 text-sm text-slate-400 shadow-sm">
                <span className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Denke nach...
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="w-96 border-l border-slate-200 overflow-y-auto bg-slate-50 flex-shrink-0">
          <div className="p-4">
            <AgentSettings />
          </div>
        </div>
      )}

      </div>{/* end flex content area */}

      {/* Input */}
      <div className="border-t border-slate-200 bg-white p-4">
        <div className="flex items-end gap-3 max-w-3xl mx-auto">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Nachricht eingeben... (Enter zum Senden)"
              rows={1}
              disabled={isStreaming}
              className={cn(
                'w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900',
                'placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'max-h-32',
              )}
              style={{ minHeight: '44px' }}
              onInput={e => {
                const target = e.target as HTMLTextAreaElement
                target.style.height = 'auto'
                target.style.height = `${Math.min(target.scrollHeight, 128)}px`
              }}
            />
          </div>
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isStreaming}
            className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center transition-colors flex-shrink-0',
              input.trim() && !isStreaming
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-slate-100 text-slate-300 cursor-not-allowed',
            )}
          >
            {isStreaming ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
