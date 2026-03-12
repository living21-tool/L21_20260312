'use client'
import { useState, useEffect } from 'react'
import { Location } from '@/lib/types'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1',
]

interface Props {
  open: boolean
  onClose: () => void
  onSave: (data: Omit<Location, 'id'>) => void
  initial?: Location | null
}

export default function LocationModal({ open, onClose, onSave, initial }: Props) {
  const [form, setForm] = useState({ name: '', city: '', country: 'Deutschland', color: COLORS[0] })
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (open) {
      setForm(initial
        ? { name: initial.name, city: initial.city, country: initial.country, color: initial.color }
        : { name: '', city: '', country: 'Deutschland', color: COLORS[0] }
      )
      setErrors({})
    }
  }, [open, initial])

  const validate = () => {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = 'Name ist erforderlich'
    if (!form.city.trim()) e.city = 'Stadt ist erforderlich'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSave = () => {
    if (validate()) { onSave(form); onClose() }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">
            {initial ? 'Standort bearbeiten' : 'Neuen Standort anlegen'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg">
            <X size={18} className="text-slate-500" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Name des Standorts *
            </label>
            <input
              type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="z.B. Seeblick Resort"
              className={cn('w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                errors.name ? 'border-red-400' : 'border-slate-200')}
            />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Stadt *</label>
              <input
                type="text" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                placeholder="z.B. Starnberg"
                className={cn('w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                  errors.city ? 'border-red-400' : 'border-slate-200')}
              />
              {errors.city && <p className="text-xs text-red-500 mt-1">{errors.city}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Land</label>
              <input
                type="text" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Farbe</label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, color: c }))}
                  className={cn(
                    'w-8 h-8 rounded-full transition-all border-2',
                    form.color === c ? 'border-slate-900 scale-110' : 'border-transparent hover:scale-105'
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <div className="w-5 h-5 rounded-full border border-slate-200" style={{ backgroundColor: form.color }} />
              <span className="text-xs text-slate-500">Gewählte Farbe erscheint im Kalender</span>
            </div>
          </div>
        </div>

        <div className="flex justify-between px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">Abbrechen</button>
          <button onClick={handleSave} className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            {initial ? 'Speichern' : 'Standort anlegen'}
          </button>
        </div>
      </div>
    </div>
  )
}
