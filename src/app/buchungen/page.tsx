'use client'
import { useState, useMemo } from 'react'
import { useBookings, useProperties, useCustomers, useLocations } from '@/lib/store'
import { formatCurrency, formatDate, statusConfig, paymentConfig } from '@/lib/utils'
import { Search, Plus, ArrowRight, Trash2, CheckSquare, Square, AlertTriangle } from 'lucide-react'
import Link from 'next/link'

export default function BuchungenPage() {
  const { bookings: allBookings, loading, remove: removeBooking } = useBookings()
  const { properties: allProperties } = useProperties()
  const { customers: allCustomers } = useCustomers()
  const { locations: allLocations } = useLocations()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [locationFilter, setLocationFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'invoiceDesc' | 'createdDesc'>('invoiceDesc')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const filtered = useMemo(() => allBookings.filter(b => {
    const prop = allProperties.find(p => p.id === b.propertyId)
    const cust = allCustomers.find(c => c.id === b.customerId)
    const sl = search.toLowerCase()
    const matchSearch = !search ||
      b.bookingNumber.toLowerCase().includes(sl) ||
      (prop?.name ?? '').toLowerCase().includes(sl) ||
      (prop?.shortCode ?? '').toLowerCase().includes(sl) ||
      (cust?.companyName ?? '').toLowerCase().includes(sl) ||
      `${cust?.firstName} ${cust?.lastName}`.toLowerCase().includes(sl) ||
      (b.invoiceNumber ?? '').toLowerCase().includes(sl)
    const matchStatus = statusFilter === 'all' || b.status === statusFilter
    const matchLocation = locationFilter === 'all' || prop?.locationId === locationFilter
    return matchSearch && matchStatus && matchLocation
  }).sort((a, b) => {
    if (sortBy === 'invoiceDesc') {
      if (a.invoiceNumber && b.invoiceNumber) {
        return b.invoiceNumber.localeCompare(a.invoiceNumber, undefined, { numeric: true, sensitivity: 'base' })
      }
      if (a.invoiceNumber) return -1
      if (b.invoiceNumber) return 1
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  }),
  [allBookings, allProperties, allCustomers, search, statusFilter, locationFilter, sortBy])

  const totalRevenue = filtered.filter(b => b.status !== 'storniert').reduce((s, b) => s + b.totalPrice, 0)

  // Selection helpers
  const allSelected   = filtered.length > 0 && filtered.every(b => selected.has(b.id))
  const someSelected  = filtered.some(b => selected.has(b.id))
  const selectedCount = [...selected].filter(id => filtered.some(b => b.id === id)).length

  const toggleAll = () => {
    if (allSelected) {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(b => n.delete(b.id)); return n })
    } else {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(b => n.add(b.id)); return n })
    }
  }

  const toggleOne = (id: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const handleDeleteSelected = () => {
    const toDelete = [...selected].filter(id => filtered.some(b => b.id === id))
    toDelete.forEach(id => removeBooking(id))
    setSelected(new Set())
    setDeleteConfirm(false)
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Buchungen</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {filtered.length} Einträge · {formatCurrency(totalRevenue)} Gesamt
          </p>
        </div>
        <Link
          href="/buchungen/neu"
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus size={16}/> Neue Buchung
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text" placeholder="Suche..." value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">Alle Status</option>
          <option value="anfrage">Anfrage</option>
          <option value="option">Option</option>
          <option value="bestaetigt">Bestätigt</option>
          <option value="abgeschlossen">Abgeschlossen</option>
          <option value="storniert">Storniert</option>
        </select>
        <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">Alle Standorte</option>
          {allLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="invoiceDesc">Nach Rechnungs-Nr.</option>
          <option value="createdDesc">Nach Erstellungsdatum</option>
        </select>
      </div>

      {/* Bulk action bar — visible when items are selected */}
      {someSelected && (
        <div className="mb-3 flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5">
          <span className="text-sm font-semibold text-blue-900">
            {selectedCount} Buchung{selectedCount !== 1 ? 'en' : ''} ausgewählt
          </span>
          <button
            onClick={toggleAll}
            className="text-xs text-blue-600 hover:underline"
          >
            {allSelected ? 'Auswahl aufheben' : 'Alle auswählen'}
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setDeleteConfirm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 transition-colors"
          >
            <Trash2 size={13} /> {selectedCount} löschen
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
              {/* Checkbox column */}
              <th className="px-3 py-3 w-10">
                <button onClick={toggleAll} className="flex items-center justify-center text-slate-400 hover:text-blue-600 transition-colors">
                  {allSelected
                    ? <CheckSquare size={16} className="text-blue-600" />
                    : someSelected
                      ? <CheckSquare size={16} className="text-blue-400" />
                      : <Square size={16} />
                  }
                </button>
              </th>
              <th className="text-left px-4 py-3">Nr.</th>
              <th className="text-left px-4 py-3">Objekt</th>
              <th className="text-left px-4 py-3">Auftraggeber</th>
              <th className="text-left px-4 py-3">Zeitraum</th>
              <th className="text-right px-4 py-3">€/Bett/N</th>
              <th className="text-right px-4 py-3">Betrag</th>
              <th className="text-center px-4 py-3">Status</th>
              <th className="text-center px-4 py-3">Zahlung</th>
              <th className="text-center px-4 py-3">Quelle</th>
              <th className="px-3 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(b => {
              const prop = allProperties.find(p => p.id === b.propertyId)
              const cust = allCustomers.find(c => c.id === b.customerId)
              const loc  = allLocations.find(l => l.id === prop?.locationId)
              const sc   = statusConfig[b.status]
              const pc   = paymentConfig[b.paymentStatus]
              const isChecked = selected.has(b.id)

              return (
                <tr
                  key={b.id}
                  className={`border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer ${isChecked ? 'bg-blue-50/50' : ''}`}
                  onClick={() => toggleOne(b.id)}
                >
                  {/* Checkbox */}
                  <td className="px-3 py-3 text-center" onClick={e => { e.stopPropagation(); toggleOne(b.id) }}>
                    {isChecked
                      ? <CheckSquare size={16} className="text-blue-600 mx-auto" />
                      : <Square size={16} className="text-slate-300 mx-auto" />
                    }
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <Link href={`/buchungen/${b.id}`} className="hover:underline">
                      <p className="font-medium text-slate-900 text-xs">{b.bookingNumber}</p>
                      {b.invoiceNumber && <p className="text-xs text-slate-400">{b.invoiceNumber}</p>}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: loc?.color }} />
                      <div>
                        <p className="font-medium text-slate-800 text-xs">
                          {prop?.shortCode
                            ? <span className="font-mono font-bold text-blue-700">[{prop.shortCode}]</span>
                            : null
                          }{' '}
                          {prop?.name ?? '–'}
                        </p>
                        <p className="text-xs text-slate-400">{loc?.name}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800 text-xs">{cust?.companyName ?? '–'}</p>
                    {(cust?.firstName || cust?.lastName) && (
                      <p className="text-xs text-slate-400">{cust.firstName} {cust.lastName}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-slate-700 text-xs">{formatDate(b.checkIn)} – {formatDate(b.checkOut)}</p>
                    <p className="text-xs text-slate-400">{b.nights} Nächte · {b.bedsBooked} Betten</p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {b.pricePerBedNight > 0 ? (
                      <p className="text-sm font-semibold text-blue-700">{formatCurrency(b.pricePerBedNight)}</p>
                    ) : (
                      <p className="text-xs text-slate-400">–</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                    {formatCurrency(b.totalPrice)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.color}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`}/>
                      {sc.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${pc.bg} ${pc.color}`}>
                      {pc.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      b.source === 'lexoffice_sonstige' ? 'bg-orange-100 text-orange-700'
                      : b.source === 'lexoffice_import' ? 'bg-violet-100 text-violet-700'
                      : 'bg-slate-100 text-slate-600'
                    }`}>
                      {b.source === 'lexoffice_sonstige' ? 'Sonstiges'
                       : b.source === 'lexoffice_import' ? 'Lexoffice'
                       : 'Manuell'}
                    </span>
                  </td>
                  <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                    <Link
                      href={`/buchungen/${b.id}`}
                      className="text-slate-400 hover:text-blue-600 transition-colors flex items-center justify-center"
                    >
                      <ArrowRight size={16}/>
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            <span className="ml-3 text-slate-400 text-sm">Buchungen werden geladen…</span>
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-12 text-slate-400 text-sm">Keine Buchungen gefunden</div>
        )}
      </div>

      {/* Footer selection hint */}
      {filtered.length > 0 && (
        <div className="mt-2 flex items-center justify-between text-xs text-slate-400 px-1">
          <span>Zeile anklicken zum Auswählen · Checkbox-Spalte für Einzelauswahl</span>
          {someSelected && (
            <button onClick={() => setSelected(new Set())} className="hover:text-slate-600 underline">
              Auswahl aufheben
            </button>
          )}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setDeleteConfirm(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900">
                  {selectedCount} Buchung{selectedCount !== 1 ? 'en' : ''} löschen?
                </h3>
                <p className="text-sm text-slate-500 mt-0.5">Diese Aktion kann nicht rückgängig gemacht werden.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(false)}
                className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={handleDeleteSelected}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 size={14} /> Löschen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
