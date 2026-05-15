'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bot, Loader2, CheckCircle, Shield, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

type ToolInfo = {
  name: string
  label: string
  category: 'query' | 'action'
  description: string
}

const ALL_TOOLS: ToolInfo[] = [
  // Query tools
  { name: 'check_availability', label: 'Verfügbarkeit prüfen', category: 'query', description: 'Prüft freie Betten für Standort/Zeitraum' },
  { name: 'search_bookings', label: 'Buchungen suchen', category: 'query', description: 'Sucht und filtert Buchungen' },
  { name: 'search_customers', label: 'Kunden suchen', category: 'query', description: 'Sucht Auftraggeber nach Name/E-Mail' },
  { name: 'get_customer', label: 'Kunde abrufen', category: 'query', description: 'Ruft Kundendetails ab' },
  { name: 'get_sync_state', label: 'Lexoffice Sync-Status', category: 'query', description: 'Zeigt Synchronisationsstatus' },
  { name: 'list_import_queue', label: 'Import-Warteschlange', category: 'query', description: 'Listet ausstehende Lexoffice-Imports' },
  // Action tools
  { name: 'create_booking', label: 'Buchung erstellen', category: 'action', description: 'Erstellt eine neue Buchung' },
  { name: 'update_booking', label: 'Buchung aktualisieren', category: 'action', description: 'Ändert Status, Daten oder Preise einer Buchung' },
  { name: 'create_customer', label: 'Kunde erstellen', category: 'action', description: 'Legt einen neuen Auftraggeber an' },
  { name: 'update_customer', label: 'Kunde aktualisieren', category: 'action', description: 'Aktualisiert Kundendaten' },
  { name: 'sync_lexoffice', label: 'Lexoffice synchronisieren', category: 'action', description: 'Startet Lexoffice-Sync' },
]

export default function AgentSettings() {
  const [enabledTools, setEnabledTools] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/config')
      if (res.ok) {
        const data = await res.json()
        setEnabledTools(new Set(data.enabledTools ?? []))
      } else {
        // Fallback: enable all query tools
        setEnabledTools(new Set(ALL_TOOLS.filter(t => t.category === 'query').map(t => t.name)))
      }
    } catch {
      setEnabledTools(new Set(ALL_TOOLS.filter(t => t.category === 'query').map(t => t.name)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  function toggleTool(name: string) {
    setEnabledTools(prev => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
    setSaved(false)
  }

  async function saveConfig() {
    setSaving(true)
    try {
      const res = await fetch('/api/agent/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledTools: [...enabledTools] }),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } finally {
      setSaving(false)
    }
  }

  const queryTools = ALL_TOOLS.filter(t => t.category === 'query')
  const actionTools = ALL_TOOLS.filter(t => t.category === 'action')

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-3">
          <Loader2 size={18} className="animate-spin text-slate-400" />
          <span className="text-sm text-slate-500">Lade Konfiguration...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 bg-gradient-to-br from-blue-100 to-violet-100 rounded-lg flex items-center justify-center">
          <Bot size={18} className="text-blue-600" />
        </div>
        <div>
          <h2 className="font-semibold text-slate-900">KI-Assistent</h2>
          <p className="text-xs text-slate-500">Konfiguriere welche Tools der L21 AI Agent nutzen darf</p>
        </div>
      </div>

      {/* Query Tools */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Search size={14} className="text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-700">Abfragen</h3>
          <span className="text-xs text-slate-400">(werden automatisch ausgeführt)</span>
        </div>
        <div className="space-y-1">
          {queryTools.map(tool => (
            <label
              key={tool.name}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                checked={enabledTools.has(tool.name)}
                onChange={() => toggleTool(tool.name)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700">{tool.label}</p>
                <p className="text-xs text-slate-400">{tool.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Action Tools */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Shield size={14} className="text-amber-500" />
          <h3 className="text-sm font-semibold text-slate-700">Aktionen</h3>
          <span className="text-xs text-amber-500 font-medium">erfordert Bestätigung</span>
        </div>
        <div className="space-y-1">
          {actionTools.map(tool => (
            <label
              key={tool.name}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                checked={enabledTools.has(tool.name)}
                onChange={() => toggleTool(tool.name)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-700">{tool.label}</p>
                <p className="text-xs text-slate-400">{tool.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
        <button
          onClick={saveConfig}
          disabled={saving}
          className={cn(
            'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
            saving
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700',
          )}
        >
          {saving ? (
            <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Speichern...</span>
          ) : 'Speichern'}
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
            <CheckCircle size={14} />
            Gespeichert
          </span>
        )}
      </div>
    </div>
  )
}
