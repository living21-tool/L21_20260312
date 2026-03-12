'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Property, Location } from '@/lib/types'
import { AlertCircle } from 'lucide-react'

interface Props {
  properties: Property[]
  locations:  Location[]
  value:      string        // propertyId (leer = kein Objekt)
  onChange:   (propertyId: string) => void
  placeholder?: string
  className?: string
}

export function PropertySearchInput({
  properties, locations, value, onChange,
  placeholder = 'Kürzel eingeben…',
  className = '',
}: Props) {
  const selectedProp = properties.find(p => p.id === value)

  // Anzeige-Text: ShortCode wenn vorhanden, sonst Name
  const displayText = (p: Property | undefined) =>
    p ? (p.shortCode ? `${p.shortCode}` : p.name) : ''

  const [query, setQuery]   = useState(displayText(selectedProp))
  const [open,  setOpen]    = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Wenn value sich von außen ändert → Eingabefeld aktualisieren
  useEffect(() => {
    const p = properties.find(p => p.id === value)
    setQuery(displayText(p))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // Außerhalb klicken → schließen + auf alten Wert zurücksetzen
  const handleOutside = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setOpen(false)
      const p = properties.find(p => p.id === value)
      setQuery(displayText(p))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, properties])

  useEffect(() => {
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [handleOutside])

  // Filtern: shortCode, Name, Aliases — Groß-/Kleinschreibung egal, Teilstring
  const filtered = properties.filter(p => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      p.shortCode?.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      p.aliases?.some(a => a.toLowerCase().includes(q)) ||
      // Standortname auch durchsuchen
      locations.find(l => l.id === p.locationId)?.name.toLowerCase().includes(q)
    )
  })

  const hasValue = !!value && !!selectedProp

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={`w-full text-xs border rounded px-2 py-1.5 pr-6 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
            hasValue
              ? 'border-blue-300 bg-blue-50 text-blue-900 font-medium'
              : 'border-amber-300 bg-amber-50 text-slate-700'
          }`}
        />
        {/* Indikator: Objekt zugewiesen oder nicht */}
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none">
          {hasValue
            ? <span className="text-blue-500 text-[10px]">✓</span>
            : <AlertCircle size={10} className="text-amber-500" />
          }
        </span>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-lg shadow-xl max-h-52 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-400 italic">Kein Objekt gefunden</p>
          ) : (
            <>
              {/* Kein Objekt Option */}
              {value && (
                <button
                  type="button"
                  onMouseDown={e => { e.preventDefault(); onChange(''); setQuery(''); setOpen(false) }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-50 border-b border-slate-100"
                >
                  – kein Objekt –
                </button>
              )}

              {/* Gruppiert nach Standort */}
              {locations.map(loc => {
                const locProps = filtered.filter(p => p.locationId === loc.id)
                if (locProps.length === 0) return null
                return (
                  <div key={loc.id}>
                    <p className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide bg-slate-50 sticky top-0">
                      <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: loc.color }} />
                      {loc.name}
                    </p>
                    {locProps.map(p => {
                      const isSelected = p.id === value
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onMouseDown={e => {
                            e.preventDefault()
                            onChange(p.id)
                            setQuery(displayText(p))
                            setOpen(false)
                          }}
                          className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-blue-50 ${
                            isSelected ? 'bg-blue-50' : ''
                          }`}
                        >
                          <span className={`font-mono font-bold flex-shrink-0 ${isSelected ? 'text-blue-700' : 'text-slate-700'}`}>
                            {p.shortCode || '–'}
                          </span>
                          <span className="text-slate-500 truncate">{p.name}</span>
                          {isSelected && <span className="ml-auto text-blue-500 text-[10px]">✓</span>}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}
