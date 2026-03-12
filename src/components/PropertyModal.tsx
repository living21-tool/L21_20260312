'use client'
import { useState, useEffect } from 'react'
import { Property, Location, ObjectType } from '@/lib/types'
import { X, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const objectTypes: { value: ObjectType; label: string }[] = [
  { value: 'wohnung', label: 'Wohnung' },
  { value: 'haus', label: 'Haus' },
  { value: 'studio', label: 'Studio' },
  { value: 'villa', label: 'Villa' },
  { value: 'zimmer', label: 'Zimmer' },
]

const commonAmenities = [
  'WLAN', 'Parkplatz', 'Balkon', 'Terrasse', 'Garten', 'Küche', 'Geschirrspüler',
  'Waschmaschine', 'Kamin', 'Sauna', 'Pool', 'Klimaanlage', 'Haustiere erlaubt',
  'Tiefgarage', 'Fahrräder', 'Spielplatz', 'Schreibtisch', 'Kitchenette',
]

interface Props {
  open: boolean
  onClose: () => void
  onSave: (data: Omit<Property, 'id'>) => void
  locations: Location[]
  initial?: Property | null
}

const empty: Omit<Property, 'id'> = {
  name: '', shortCode: '', aliases: [], type: 'wohnung', locationId: '', beds: 1,
  pricePerBedNight: 0, cleaningFee: 0, description: '', amenities: [], images: [], active: true,
}

export default function PropertyModal({ open, onClose, onSave, locations, initial }: Props) {
  const [form, setForm] = useState<Omit<Property, 'id'>>(empty)
  const [customAmenity, setCustomAmenity] = useState('')
  const [aliasInput, setAliasInput] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (open) {
      const init = initial
        ? { ...initial, aliases: initial.aliases ?? [], shortCode: initial.shortCode ?? '' }
        : { ...empty, locationId: locations[0]?.id ?? '' }

      setForm(init)
      setErrors({})
      setAliasInput('')
    }
  }, [open, initial, locations])

  const set = (k: keyof Omit<Property, 'id'>, v: unknown) =>
    setForm(f => ({ ...f, [k]: v }))

  const toggleAmenity = (a: string) =>
    set('amenities', form.amenities.includes(a)
      ? form.amenities.filter(x => x !== a)
      : [...form.amenities, a])

  const addAlias = () => {
    const trimmed = aliasInput.trim()
    if (trimmed && !form.aliases.includes(trimmed)) {
      set('aliases', [...form.aliases, trimmed])
      setAliasInput('')
    }
  }

  const removeAlias = (a: string) => {
    set('aliases', form.aliases.filter(x => x !== a))
  }

  const addCustomAmenity = () => {
    const trimmed = customAmenity.trim()
    if (trimmed && !form.amenities.includes(trimmed)) {
      set('amenities', [...form.amenities, trimmed])
      setCustomAmenity('')
    }
  }

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = 'Name ist erforderlich'
    if (!form.locationId) e.locationId = 'Standort ist erforderlich'
    if (form.pricePerBedNight < 0) e.pricePerBedNight = 'Preis darf nicht negativ sein'
    if (form.beds < 1) e.beds = 'Mindestens 1 Bett'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSave = () => {
    if (validate()) {
      onSave(form)
      onClose()
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">
            {initial ? 'Objekt bearbeiten' : 'Neues Objekt anlegen'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={18} className="text-slate-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Name + Typ */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Name / Bezeichnung *
              </label>
              <input
                type="text"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="z.B. Apt. Seeblick A"
                className={cn(
                  'w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                  errors.name ? 'border-red-400' : 'border-slate-200'
                )}
              />
              {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Typ</label>
              <select
                value={form.type}
                onChange={e => set('type', e.target.value as ObjectType)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {objectTypes.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Kurzcode + Aliase */}
          <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-blue-900 mb-1">
                Kurzcode (wie in Lexoffice-Rechnungen)
              </label>
              <p className="text-xs text-blue-600 mb-2">
                z.B. „WS22" wenn in Rechnungen „WS22" oder „Wohnung Seeblick 22" steht
              </p>
              <input
                type="text"
                value={form.shortCode}
                onChange={e => set('shortCode', e.target.value.toUpperCase())}
                placeholder="z.B. WS22, WE8, APT3..."
                className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-blue-800 mb-1.5">
                Weitere Bezeichnungen (Aliase)
              </label>
              {form.aliases.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {form.aliases.map(a => (
                    <span key={a} className="flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                      {a}
                      <button onClick={() => removeAlias(a)} className="hover:text-red-500"><X size={11} /></button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aliasInput}
                  onChange={e => setAliasInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addAlias())}
                  placeholder="z.B. Wohnung Seeblick 22, WS 22..."
                  className="flex-1 px-3 py-1.5 border border-blue-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
                <button type="button" onClick={addAlias}
                  className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-sm hover:bg-blue-200 transition-colors">
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* Standort */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Standort *</label>
            <select
              value={form.locationId}
              onChange={e => set('locationId', e.target.value)}
              className={cn(
                'w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                errors.locationId ? 'border-red-400' : 'border-slate-200'
              )}
            >
              <option value="">Standort wählen...</option>
              {locations.map(l => (
                <option key={l.id} value={l.id}>{l.name} ({l.city})</option>
              ))}
            </select>
            {errors.locationId && <p className="text-xs text-red-500 mt-1">{errors.locationId}</p>}
          </div>

          {/* Betten */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Anzahl Betten (Gesamtkapazität) *</label>
            <input
              type="number" min={1} max={50}
              value={form.beds}
              onChange={e => set('beds', parseInt(e.target.value) || 1)}
              className={cn(
                'w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                errors.beds ? 'border-red-400' : 'border-slate-200'
              )}
            />
            {errors.beds && <p className="text-xs text-red-500 mt-1">{errors.beds}</p>}
            <p className="text-xs text-slate-400 mt-1">Maximale buchbare Betten pro Buchung</p>
          </div>

          {/* Preise */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Preis pro Bett / Nacht (€)</label>
              <input
                type="number" min={0} step={0.5}
                value={form.pricePerBedNight || ''}
                onChange={e => set('pricePerBedNight', parseFloat(e.target.value) || 0)}
                placeholder="z.B. 18.50"
                className={cn(
                  'w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                  errors.pricePerBedNight ? 'border-red-400' : 'border-slate-200'
                )}
              />
              {errors.pricePerBedNight && <p className="text-xs text-red-500 mt-1">{errors.pricePerBedNight}</p>}
              {form.pricePerBedNight > 0 && form.beds > 0 && (
                <p className="text-xs text-slate-400 mt-1">Vollauslastung: {(form.pricePerBedNight * form.beds).toFixed(2)} €/Nacht</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Endreinigung (€)</label>
              <input
                type="number" min={0} step={5}
                value={form.cleaningFee || ''}
                onChange={e => set('cleaningFee', parseFloat(e.target.value) || 0)}
                placeholder="0"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Beschreibung */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Beschreibung</label>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              rows={2}
              placeholder="Kurze Beschreibung des Objekts..."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Ausstattung */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Ausstattung</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {commonAmenities.map(a => (
                <button
                  key={a}
                  type="button"
                  onClick={() => toggleAmenity(a)}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-medium border transition-all',
                    form.amenities.includes(a)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
            {/* Custom amenity */}
            <div className="flex gap-2">
              <input
                type="text"
                value={customAmenity}
                onChange={e => setCustomAmenity(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addCustomAmenity())}
                placeholder="Eigene Ausstattung hinzufügen..."
                className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={addCustomAmenity}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200 transition-colors"
              >
                <Plus size={16} />
              </button>
            </div>
            {/* Custom amenities chips */}
            {form.amenities.filter(a => !commonAmenities.includes(a)).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {form.amenities.filter(a => !commonAmenities.includes(a)).map(a => (
                  <span key={a} className="flex items-center gap-1 px-2.5 py-0.5 bg-violet-100 text-violet-700 rounded-full text-xs font-medium">
                    {a}
                    <button onClick={() => toggleAmenity(a)} className="hover:text-red-500">
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Status */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => set('active', !form.active)}
              className={cn(
                'relative w-11 h-6 rounded-full transition-colors',
                form.active ? 'bg-emerald-500' : 'bg-slate-300'
              )}
            >
              <span className={cn(
                'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',
                form.active ? 'left-5' : 'left-0.5'
              )} />
            </button>
            <span className="text-sm text-slate-700 font-medium">
              Objekt ist {form.active ? 'aktiv (buchbar)' : 'deaktiviert'}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            {initial ? 'Änderungen speichern' : 'Objekt anlegen'}
          </button>
        </div>
      </div>
    </div>
  )
}
