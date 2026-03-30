'use client'
import { useState, useMemo } from 'react'
import { useBookings, useProperties, useCustomers, useLocations } from '@/lib/store'
import { formatCurrency, formatDate, statusConfig, paymentConfig } from '@/lib/utils'
import { Search, Plus, ArrowRight, Trash2, CheckSquare, Square, AlertTriangle, ChevronDown, ChevronRight, FileText } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface InvoiceGroup {
  invoiceNumber: string
  voucherId?: string
  contactName: string
  totalAmount: number
  bookingCount: number
  bookings: typeof allBookingsType
  checkInMin: string
  checkOutMax: string
  nightsTotal: number
  bedsMax: number
  source: string
  paymentStatus: string
  status: string
  isStorniert: boolean
}

// Type helper — wird unten durch den echten Typ ersetzt
type BookingType = ReturnType<typeof useBookings>['bookings'][number]
const allBookingsType: BookingType[] = []

export default function BuchungenPage() {
  const router = useRouter()
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
  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'invoices' | 'bookings'>('invoices')

  // Alle Buchungen filtern
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

  // Nach Rechnungsnummer gruppieren
  const invoiceGroups = useMemo(() => {
    const groups = new Map<string, BookingType[]>()
    for (const b of filtered) {
      const key = b.invoiceNumber || `_single_${b.id}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(b)
    }

    const result: InvoiceGroup[] = []
    for (const [invoiceNumber, bookings] of groups) {
      const isSingle = invoiceNumber.startsWith('_single_')
      const firstBooking = bookings[0]
      const cust = allCustomers.find(c => c.id === firstBooking.customerId)

      const totalAmount = bookings.reduce((s, b) => s + b.totalPrice, 0)
      const checkInMin = bookings.reduce((min, b) => b.checkIn < min ? b.checkIn : min, bookings[0].checkIn)
      const checkOutMax = bookings.reduce((max, b) => b.checkOut > max ? b.checkOut : max, bookings[0].checkOut)
      const nightsTotal = bookings.reduce((s, b) => s + b.nights, 0)
      const bedsMax = Math.max(...bookings.map(b => b.bedsBooked))
      const isStorniert = bookings.every(b => b.status === 'storniert')

      // Dominanter Status/Payment
      const statusPriority = ['bestaetigt', 'abgeschlossen', 'option', 'anfrage', 'storniert']
      const dominantStatus = statusPriority.find(s => bookings.some(b => b.status === s)) ?? bookings[0].status
      const payPriority = ['offen', 'teilweise', 'bezahlt', 'erstattet']
      const dominantPay = payPriority.find(p => bookings.some(b => b.paymentStatus === p)) ?? bookings[0].paymentStatus

      result.push({
        invoiceNumber: isSingle ? '' : invoiceNumber,
        voucherId: firstBooking.lexofficeInvoiceId,
        contactName: cust?.companyName ?? '–',
        totalAmount,
        bookingCount: bookings.length,
        bookings,
        checkInMin,
        checkOutMax,
        nightsTotal,
        bedsMax,
        source: firstBooking.source ?? 'manual',
        paymentStatus: dominantPay,
        status: dominantStatus,
        isStorniert,
      })
    }
    return result
  }, [filtered, allCustomers])

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

  const toggleInvoice = (invoiceNumber: string) => {
    setExpandedInvoices(prev => {
      const n = new Set(prev)
      n.has(invoiceNumber) ? n.delete(invoiceNumber) : n.add(invoiceNumber)
      return n
    })
  }

  // Booking row renderer (shared between both views)
  const renderBookingRow = (b: BookingType, indent = false) => {
    const prop = allProperties.find(p => p.id === b.propertyId)
    const cust = allCustomers.find(c => c.id === b.customerId)
    const loc  = allLocations.find(l => l.id === prop?.locationId)
    const sc   = statusConfig[b.status]
    const pc   = paymentConfig[b.paymentStatus]
    const isChecked = selected.has(b.id)

    return (
      <tr
        key={b.id}
        className={`border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer ${isChecked ? 'bg-blue-50/50' : ''} ${indent ? 'bg-slate-50/30' : ''}`}
        onClick={() => router.push(`/buchungen/${b.id}`)}
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
            {!indent && b.invoiceNumber && <p className="text-xs text-slate-400">{b.invoiceNumber}</p>}
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
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Buchungen</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {viewMode === 'invoices'
              ? <>{invoiceGroups.length} Rechnungen · {filtered.length} Buchungen · {formatCurrency(totalRevenue)} Gesamt</>
              : <>{filtered.length} Buchungen · {formatCurrency(totalRevenue)} Gesamt</>
            }
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* View mode toggle */}
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('invoices')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                viewMode === 'invoices' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <FileText size={13} /> Rechnungen
            </button>
            <button
              onClick={() => setViewMode('bookings')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                viewMode === 'bookings' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Alle Buchungen
            </button>
          </div>
          <Link
            href="/buchungen/neu"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus size={16}/> Neue Buchung
          </Link>
        </div>
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
        <select value={sortBy} onChange={e => setSortBy(e.target.value as 'invoiceDesc' | 'createdDesc')}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="invoiceDesc">Nach Rechnungs-Nr.</option>
          <option value="createdDesc">Nach Erstellungsdatum</option>
        </select>
      </div>

      {/* Bulk action bar */}
      {someSelected && (
        <div className="mb-3 flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5">
          <span className="text-sm font-semibold text-blue-900">
            {selectedCount} Buchung{selectedCount !== 1 ? 'en' : ''} ausgewählt
          </span>
          <button onClick={toggleAll} className="text-xs text-blue-600 hover:underline">
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

      {/* ═══ Rechnungsansicht ═══ */}
      {viewMode === 'invoices' && (
        <div className="space-y-2">
          {invoiceGroups.map(group => {
            const isExpanded = expandedInvoices.has(group.invoiceNumber || group.bookings[0].id)
            const groupKey = group.invoiceNumber || group.bookings[0].id
            const sc = statusConfig[group.status as keyof typeof statusConfig]
            const pc = paymentConfig[group.paymentStatus as keyof typeof paymentConfig]
            const hasMultiple = group.bookingCount > 1

            // Objekte in dieser Rechnung
            const propSummary = group.bookings.map(b => {
              const prop = allProperties.find(p => p.id === b.propertyId)
              const loc = allLocations.find(l => l.id === prop?.locationId)
              return { prop, loc }
            }).filter(x => x.prop)

            // Unique properties
            const uniqueProps = [...new Map(propSummary.map(x => [x.prop!.id, x])).values()]

            return (
              <div key={groupKey} className={`bg-white rounded-xl border overflow-hidden transition-all ${
                group.isStorniert ? 'border-red-200 opacity-60' :
                isExpanded ? 'border-blue-200 shadow-sm' : 'border-slate-200'
              }`}>
                {/* ── Rechnungszeile (klickbar) ── */}
                <div
                  className={`px-5 py-3.5 flex items-center gap-4 cursor-pointer transition-colors ${
                    isExpanded ? 'bg-blue-50/50' : 'hover:bg-slate-50'
                  }`}
                  onClick={() => toggleInvoice(groupKey)}
                >
                  {/* Expand icon */}
                  <div className="flex-shrink-0 text-slate-400">
                    {hasMultiple ? (
                      isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
                    ) : (
                      <FileText size={16} className="text-slate-300" />
                    )}
                  </div>

                  {/* Rechnungsnummer + Typ */}
                  <div className="w-32 flex-shrink-0">
                    {group.invoiceNumber ? (
                      <p className="text-sm font-bold text-slate-900 font-mono">{group.invoiceNumber}</p>
                    ) : (
                      <p className="text-xs text-slate-400 italic">Ohne Rechnung</p>
                    )}
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {group.bookingCount} {group.bookingCount === 1 ? 'Buchung' : 'Buchungen'}
                    </p>
                  </div>

                  {/* Objekte */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {uniqueProps.slice(0, 4).map(({ prop, loc }) => (
                        <span key={prop!.id} className="inline-flex items-center gap-1 text-xs">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: loc?.color }} />
                          <span className="font-mono font-bold text-blue-700">{prop!.shortCode}</span>
                        </span>
                      ))}
                      {uniqueProps.length > 4 && (
                        <span className="text-xs text-slate-400">+{uniqueProps.length - 4}</span>
                      )}
                      {uniqueProps.length === 0 && (
                        <span className="text-xs text-slate-400">Sonstige</span>
                      )}
                    </div>
                  </div>

                  {/* Kunde */}
                  <div className="w-44 flex-shrink-0">
                    <p className="text-xs font-medium text-slate-700 truncate">{group.contactName}</p>
                  </div>

                  {/* Zeitraum */}
                  <div className="w-40 flex-shrink-0 text-xs text-slate-600">
                    <p>{formatDate(group.checkInMin)} – {formatDate(group.checkOutMax)}</p>
                    <p className="text-slate-400">{group.nightsTotal} Nächte</p>
                  </div>

                  {/* Betrag */}
                  <div className="w-28 flex-shrink-0 text-right">
                    <p className={`text-sm font-bold ${group.isStorniert ? 'text-red-500 line-through' : 'text-slate-900'}`}>
                      {formatCurrency(group.totalAmount)}
                    </p>
                  </div>

                  {/* Status */}
                  <div className="w-24 flex-shrink-0 text-center">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${sc.bg} ${sc.color}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`}/>
                      {sc.label}
                    </span>
                  </div>

                  {/* Zahlung */}
                  <div className="w-20 flex-shrink-0 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${pc.bg} ${pc.color}`}>
                      {pc.label}
                    </span>
                  </div>

                  {/* Quelle */}
                  <div className="w-20 flex-shrink-0 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      group.source === 'lexoffice_sonstige' ? 'bg-orange-100 text-orange-700'
                      : group.source === 'lexoffice_import' ? 'bg-violet-100 text-violet-700'
                      : 'bg-slate-100 text-slate-600'
                    }`}>
                      {group.source === 'lexoffice_sonstige' ? 'Sonstiges'
                       : group.source === 'lexoffice_import' ? 'Lexoffice'
                       : 'Manuell'}
                    </span>
                  </div>
                </div>

                {/* ── Aufgeklappte Buchungen ── */}
                {isExpanded && (
                  <div className="border-t border-slate-200">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                          <th className="px-3 py-2 w-10"></th>
                          <th className="text-left px-4 py-2">Buchungs-Nr.</th>
                          <th className="text-left px-4 py-2">Objekt</th>
                          <th className="text-left px-4 py-2">Auftraggeber</th>
                          <th className="text-left px-4 py-2">Zeitraum</th>
                          <th className="text-right px-4 py-2">€/Bett/N</th>
                          <th className="text-right px-4 py-2">Betrag</th>
                          <th className="text-center px-4 py-2">Status</th>
                          <th className="text-center px-4 py-2">Zahlung</th>
                          <th className="px-3 py-2 w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.bookings.map(b => renderBookingRow(b, true))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}

          {!loading && invoiceGroups.length === 0 && (
            <div className="text-center py-12 text-slate-400 text-sm bg-white rounded-xl border border-slate-200">
              Keine Rechnungen gefunden
            </div>
          )}
        </div>
      )}

      {/* ═══ Klassische Buchungsansicht ═══ */}
      {viewMode === 'bookings' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
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
                <th className="px-3 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(b => renderBookingRow(b))}
            </tbody>
          </table>

          {!loading && filtered.length === 0 && (
            <div className="text-center py-12 text-slate-400 text-sm">Keine Buchungen gefunden</div>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          <span className="ml-3 text-slate-400 text-sm">Wird geladen…</span>
        </div>
      )}

      {/* Footer */}
      {filtered.length > 0 && (
        <div className="mt-2 flex items-center justify-between text-xs text-slate-400 px-1">
          <span>
            {viewMode === 'invoices'
              ? 'Rechnung anklicken zum Aufklappen'
              : 'Zeile anklicken für Details'}
          </span>
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
