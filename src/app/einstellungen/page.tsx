'use client'
import { useState } from 'react'
import { Settings, Key, Building2, Bell, CheckCircle, Trash2, AlertTriangle } from 'lucide-react'
import { clearAllData } from '@/lib/store'

export default function EinstellungenPage() {
  const [saved, setSaved] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  function handleSave() {
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Einstellungen</h1>
        <p className="text-sm text-slate-500 mt-0.5">System- und Integrationskonfiguration</p>
      </div>

      <div className="space-y-4">
        {/* Lexoffice */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 bg-violet-100 rounded-lg flex items-center justify-center">
              <Key size={18} className="text-violet-600"/>
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">Lexoffice API</h2>
              <p className="text-xs text-slate-500">Verbindung zu deinem Lexoffice-Konto</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500"/>
            <p className="text-sm font-medium text-emerald-800">API-Key aktiv (konfiguriert in <code className="text-xs bg-emerald-100 px-1 rounded">.env.local</code>)</p>
          </div>
        </div>

        {/* Unternehmen */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center">
              <Building2 size={18} className="text-blue-600"/>
            </div>
            <h2 className="font-semibold text-slate-900">Unternehmen</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Firmenname</label>
              <input defaultValue="" type="text" placeholder="Dein Unternehmen" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">MwSt-Satz (%)</label>
              <input defaultValue="19" type="number" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">E-Mail</label>
              <input defaultValue="" type="email" placeholder="info@deine-domain.de" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Währung</label>
              <select defaultValue="EUR" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="EUR">Euro (€)</option>
                <option value="CHF">Schweizer Franken (CHF)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 bg-amber-100 rounded-lg flex items-center justify-center">
              <Bell size={18} className="text-amber-600"/>
            </div>
            <h2 className="font-semibold text-slate-900">Benachrichtigungen</h2>
          </div>
          <div className="space-y-3">
            {[
              { label: 'Neue Buchungsanfrage', desc: 'E-Mail bei eingehender Anfrage' },
              { label: 'Anreise-Erinnerung', desc: '24h vor Check-In benachrichtigen' },
              { label: 'Offene Rechnungen', desc: 'Wöchentliche Zusammenfassung' },
            ].map(item => (
              <label key={item.label} className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-slate-800">{item.label}</p>
                  <p className="text-xs text-slate-500">{item.desc}</p>
                </div>
                <div className="relative">
                  <input type="checkbox" defaultChecked className="sr-only peer"/>
                  <div className="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:bg-blue-600 transition-colors cursor-pointer"/>
                  <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-5"/>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button onClick={handleSave} className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
            {saved ? <><CheckCircle size={16}/>Gespeichert!</> : 'Einstellungen speichern'}
          </button>
        </div>

        {/* Danger Zone */}
        <div className="bg-white rounded-xl border border-red-200 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 bg-red-100 rounded-lg flex items-center justify-center">
              <Trash2 size={18} className="text-red-600"/>
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">Alle Daten löschen</h2>
              <p className="text-xs text-slate-500">Standorte, Objekte, Kunden und Buchungen dauerhaft entfernen</p>
            </div>
          </div>

          {!confirmClear ? (
            <button
              onClick={() => setConfirmClear(true)}
              className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
            >
              <Trash2 size={14}/> Alle lokalen Daten löschen
            </button>
          ) : (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-2 mb-3">
                <AlertTriangle size={16} className="text-red-600 flex-shrink-0 mt-0.5"/>
                <p className="text-sm text-red-800 font-medium">
                  Wirklich alle Daten löschen? Diese Aktion kann nicht rückgängig gemacht werden.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmClear(false)}
                  className="px-4 py-1.5 border border-slate-200 text-slate-700 rounded-lg text-sm hover:bg-slate-50"
                >
                  Abbrechen
                </button>
                <button
                  onClick={clearAllData}
                  className="px-4 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
                >
                  Ja, alles löschen &amp; neu starten
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
