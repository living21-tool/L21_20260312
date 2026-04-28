'use client'

import { useEffect, useMemo, useState } from 'react'
import { useProperties, useCustomers, useLocations } from '@/lib/store'
import { formatCurrency, formatDate, paymentConfig, statusConfig } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import type { Booking } from '@/lib/types'
import type { BookingInvoiceGroup, BookingListPageResult } from '@/lib/booking-data-service'
import { Search, Plus, ArrowRight, Trash2, CheckSquare, Square, AlertTriangle, ChevronDown, ChevronRight, FileText, RefreshCw, Clock3 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface InvoiceGroup extends BookingInvoiceGroup {}
type BookingType = Booking

const syncOverview: {
  configured?: boolean
  setupMessage?: string
  state: { lastSuccessAt?: string }
  counts: {
    pendingReview: number
    autoImported: number
    duplicates: number
  }
  items: Array<{
    voucherId: string
    voucherNumber?: string
    confidence: 'high' | 'medium' | 'low'
    isStorno?: boolean
    contactName?: string
    totalAmount: number
    reviewReason?: string
    lastSeenAt: string
  }>
} | null = null
const syncLoading = false
const syncRunning = false
const syncError: string | null = null
const setSyncOverview: (_value: unknown) => void = () => {}
const setSyncLoading: (_value: boolean) => void = () => {}
const setSyncError: (_value: string | null) => void = () => {}

export default function BuchungenPage() {
  const router = useRouter()
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
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [pageData, setPageData] = useState<BookingListPageResult | null>(null)

  const propertiesById = useMemo(() => new Map(allProperties.map(property => [property.id, property])), [allProperties])
  const customersById = useMemo(() => new Map(allCustomers.map(customer => [customer.id, customer])), [allCustomers])
  const locationsById = useMemo(() => new Map(allLocations.map(location => [location.id, location])), [allLocations])

  async function loadSyncOverview() {
    try {
      setSyncError(null)
      const response = await fetch('/api/lexoffice/sync', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Sync-Übersicht konnte nicht geladen werden.')
      setSyncOverview(data)
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error))
    } finally {
      setSyncLoading(false)
    }
  }

  async function loadPageData(currentPage = page, currentPageSize = pageSize, currentViewMode = viewMode) {
    try {
      setLoading(true)
      setPageError(null)
      const params = new URLSearchParams({
        search,
        statusFilter,
        locationFilter,
        sortBy,
        viewMode: currentViewMode,
        page: String(currentPage),
        pageSize: String(currentPageSize),
      })
      const response = await fetch(`/api/bookings?${params.toString()}`, { cache: 'no-store' })
      const data = await response.json() as BookingListPageResult | { error?: string }
      if (!response.ok) {
        throw new Error('error' in data ? data.error ?? 'Buchungen konnten nicht geladen werden.' : 'Buchungen konnten nicht geladen werden.')
      }
      const nextData = data as BookingListPageResult
      setPageData(nextData)
      setPage(nextData.page)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : String(error))
      setPageData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSyncOverview()
  }, [])

  useEffect(() => {
    void loadPageData(page, pageSize, viewMode)
  }, [search, statusFilter, locationFilter, sortBy, viewMode, page, pageSize])

  async function runSyncNow() {
    return
  }

  const filtered = useMemo(() => pageData?.bookings ?? [], [pageData])
  const invoiceGroups = useMemo(() => pageData?.invoiceGroups ?? [], [pageData])
  const totalRevenue = pageData?.totalRevenue ?? 0
  const totalBookings = pageData?.totalBookings ?? 0
  const totalInvoices = pageData?.totalInvoices ?? 0
  const totalPages = pageData?.totalPages ?? 1
  const filteredIds = useMemo(() => new Set(filtered.map(booking => booking.id)), [filtered])

  const allSelected = filtered.length > 0 && filtered.every(booking => selected.has(booking.id))
  const someSelected = filtered.some(booking => selected.has(booking.id))
  const selectedCount = [...selected].filter(id => filteredIds.has(id)).length

  const toggleAll = () => {
    if (allSelected) {
      setSelected(prev => {
        const next = new Set(prev)
        filtered.forEach(booking => next.delete(booking.id))
        return next
      })
      return
    }

    setSelected(prev => {
      const next = new Set(prev)
      filtered.forEach(booking => next.add(booking.id))
      return next
    })
  }

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDeleteSelected = () => {
    const toDelete = [...selected].filter(id => filteredIds.has(id))
    void (async () => {
      for (const id of toDelete) {
        const { error } = await supabase.from('bookings').delete().eq('id', id)
        if (error) throw error
      }
      setSelected(new Set())
      setDeleteConfirm(false)
      await loadPageData(page, pageSize, viewMode)
    })()
  }

  const toggleInvoice = (invoiceNumber: string) => {
    setExpandedInvoices(prev => {
      const next = new Set(prev)
      if (next.has(invoiceNumber)) next.delete(invoiceNumber)
      else next.add(invoiceNumber)
      return next
    })
  }

  const renderBookingRow = (booking: BookingType, indent = false) => {
    const property = propertiesById.get(booking.propertyId)
    const customer = customersById.get(booking.customerId)
    const location = property ? locationsById.get(property.locationId) : undefined
    const status = statusConfig[booking.status]
    const payment = paymentConfig[booking.paymentStatus]
    const isChecked = selected.has(booking.id)

    return (
      <tr
        key={booking.id}
        className={`border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer ${isChecked ? 'bg-blue-50/50' : ''} ${indent ? 'bg-slate-50/30' : ''}`}
        onClick={() => router.push(`/buchungen/${booking.id}`)}
      >
        <td className="px-3 py-3 text-center" onClick={event => { event.stopPropagation(); toggleOne(booking.id) }}>
          {isChecked
            ? <CheckSquare size={16} className="text-blue-600 mx-auto" />
            : <Square size={16} className="text-slate-300 mx-auto" />
          }
        </td>
        <td className="px-4 py-3" onClick={event => event.stopPropagation()}>
          <Link href={`/buchungen/${booking.id}`} className="hover:underline">
            <p className="font-medium text-slate-900 text-xs">{booking.bookingNumber}</p>
            {!indent && booking.invoiceNumber && <p className="text-xs text-slate-400">{booking.invoiceNumber}</p>}
          </Link>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: location?.color }} />
            <div>
              <p className="font-medium text-slate-800 text-xs">
                {property?.shortCode ? <span className="font-mono font-bold text-blue-700">[{property.shortCode}]</span> : null} {property?.name ?? '–'}
              </p>
              <p className="text-xs text-slate-400">{location?.name}</p>
            </div>
          </div>
        </td>
        <td className="px-4 py-3">
          <p className="font-medium text-slate-800 text-xs">{customer?.companyName ?? '–'}</p>
        </td>
        <td className="px-4 py-3">
          <p className="text-slate-700 text-xs">{formatDate(booking.checkIn)} – {formatDate(booking.checkOut)}</p>
          <p className="text-xs text-slate-400">{booking.nights} Nächte · {booking.bedsBooked} Betten</p>
        </td>
        <td className="px-4 py-3 text-right">
          {booking.pricePerBedNight > 0
            ? <p className="text-sm font-semibold text-blue-700">{formatCurrency(booking.pricePerBedNight)}</p>
            : <p className="text-xs text-slate-400">–</p>}
        </td>
        <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatCurrency(booking.totalPrice)}</td>
        <td className="px-4 py-3 text-center">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.bg} ${status.color}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>
        </td>
        <td className="px-4 py-3 text-center">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${payment.bg} ${payment.color}`}>
            {payment.label}
          </span>
        </td>
        <td className="px-3 py-3" onClick={event => event.stopPropagation()}>
          <Link href={`/buchungen/${booking.id}`} className="text-slate-400 hover:text-blue-600 transition-colors flex items-center justify-center">
            <ArrowRight size={16} />
          </Link>
        </td>
      </tr>
    )
  }

  return (
    <div className="p-6">
      {false && (
        <div className="mb-5 rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 via-white to-sky-50 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-violet-700">
                <Clock3 size={15} />
                Lexoffice Sync
              </div>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">Stündlicher Import mit Review-Queue</h2>
              <p className="mt-1 text-sm text-slate-600">
                Rechnungen mit hoher Sicherheit werden automatisch gebucht. Unsichere Fälle bleiben sichtbar in der Queue und gehen nicht verloren.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/import" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Import prüfen
              </Link>
              <button
                type="button"
                onClick={runSyncNow}
                disabled={syncRunning || syncOverview?.configured === false}
                className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw size={15} className={syncRunning ? 'animate-spin' : ''} />
                {syncRunning ? 'Synchronisiert…' : 'Jetzt synchronisieren'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Buchungen</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {viewMode === 'invoices'
              ? <>{totalInvoices} Rechnungen · {totalBookings} Buchungen · {formatCurrency(totalRevenue)} Gesamt</>
              : <>{totalBookings} Buchungen · {formatCurrency(totalRevenue)} Gesamt</>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => { setViewMode('invoices'); setPage(1) }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${viewMode === 'invoices' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <FileText size={13} /> Rechnungen
            </button>
            <button
              onClick={() => { setViewMode('bookings'); setPage(1) }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${viewMode === 'bookings' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Alle Buchungen
            </button>
          </div>
          <Link href="/buchungen/neu" className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
            <Plus size={16} /> Neue Buchung
          </Link>
        </div>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Suche..."
            value={search}
            onChange={event => { setSearch(event.target.value); setPage(1) }}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setPage(1) }} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">Alle Status</option>
          <option value="anfrage">Anfrage</option>
          <option value="option">Option</option>
          <option value="bestaetigt">Bestätigt</option>
          <option value="abgeschlossen">Abgeschlossen</option>
          <option value="storniert">Storniert</option>
        </select>
        <select value={locationFilter} onChange={event => { setLocationFilter(event.target.value); setPage(1) }} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">Alle Standorte</option>
          {allLocations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
        <select value={sortBy} onChange={event => { setSortBy(event.target.value as 'invoiceDesc' | 'createdDesc'); setPage(1) }} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="invoiceDesc">Nach Rechnungs-Nr.</option>
          <option value="createdDesc">Nach Erstellungsdatum</option>
        </select>
        <select value={pageSize} onChange={event => { setPageSize(parseInt(event.target.value, 10)); setPage(1) }} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value={25}>25 pro Seite</option>
          <option value={50}>50 pro Seite</option>
          <option value={100}>100 pro Seite</option>
        </select>
      </div>

      {pageError && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {pageError}
        </div>
      )}

      {someSelected && (
        <div className="mb-3 flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5">
          <span className="text-sm font-semibold text-blue-900">
            {selectedCount} Buchung{selectedCount !== 1 ? 'en' : ''} ausgewählt
          </span>
          <button onClick={toggleAll} className="text-xs text-blue-600 hover:underline">
            {allSelected ? 'Auswahl aufheben' : 'Alle auswählen'}
          </button>
          <div className="flex-1" />
          <button onClick={() => setDeleteConfirm(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 transition-colors">
            <Trash2 size={13} /> {selectedCount} löschen
          </button>
        </div>
      )}

      {viewMode === 'invoices' && (
        <div className="space-y-2">
          {invoiceGroups.map(group => {
            const groupKey = group.invoiceNumber || group.bookings[0].id
            const isExpanded = expandedInvoices.has(groupKey)
            const status = statusConfig[group.status as keyof typeof statusConfig]
            const payment = paymentConfig[group.paymentStatus as keyof typeof paymentConfig]
            const propSummary = group.bookings.map(booking => {
              const property = propertiesById.get(booking.propertyId)
              const location = property ? locationsById.get(property.locationId) : undefined
              return { property, location }
            }).filter(entry => entry.property)
            const uniqueProps = [...new Map(propSummary.map(entry => [entry.property!.id, entry])).values()]

            return (
              <div key={groupKey} className={`bg-white rounded-xl border overflow-hidden transition-all ${group.isStorniert ? 'border-red-200 opacity-60' : isExpanded ? 'border-blue-200 shadow-sm' : 'border-slate-200'}`}>
                <div className={`px-5 py-3.5 flex items-center gap-4 cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50/50' : 'hover:bg-slate-50'}`} onClick={() => toggleInvoice(groupKey)}>
                  <div className="flex-shrink-0 text-slate-400">
                    {group.bookingCount > 1 ? (isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : <FileText size={16} className="text-slate-300" />}
                  </div>
                  <div className="w-32 flex-shrink-0">
                    {group.invoiceNumber ? <p className="text-sm font-bold text-slate-900 font-mono">{group.invoiceNumber}</p> : <p className="text-xs text-slate-400 italic">Ohne Rechnung</p>}
                    <p className="text-[10px] text-slate-400 mt-0.5">{group.bookingCount} {group.bookingCount === 1 ? 'Buchung' : 'Buchungen'}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {uniqueProps.slice(0, 4).map(({ property, location }) => (
                        <span key={property!.id} className="inline-flex items-center gap-1 text-xs">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: location?.color }} />
                          <span className="font-mono font-bold text-blue-700">{property!.shortCode}</span>
                        </span>
                      ))}
                      {uniqueProps.length > 4 && <span className="text-xs text-slate-400">+{uniqueProps.length - 4}</span>}
                      {uniqueProps.length === 0 && <span className="text-xs text-slate-400">Sonstige</span>}
                    </div>
                  </div>
                  <div className="w-44 flex-shrink-0">
                    <p className="text-xs font-medium text-slate-700 truncate">{group.contactName}</p>
                  </div>
                  <div className="w-40 flex-shrink-0 text-xs text-slate-600">
                    <p>{formatDate(group.checkInMin)} – {formatDate(group.checkOutMax)}</p>
                    <p className="text-slate-400">{group.nightsTotal} Nächte</p>
                  </div>
                  <div className="w-28 flex-shrink-0 text-right">
                    <p className={`text-sm font-bold ${group.isStorniert ? 'text-red-500 line-through' : 'text-slate-900'}`}>{formatCurrency(group.totalAmount)}</p>
                  </div>
                  <div className="w-24 flex-shrink-0 text-center">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.bg} ${status.color}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                      {status.label}
                    </span>
                  </div>
                  <div className="w-20 flex-shrink-0 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${payment.bg} ${payment.color}`}>{payment.label}</span>
                  </div>
                  <div className="w-20 flex-shrink-0 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${group.source === 'lexoffice_sonstige' ? 'bg-orange-100 text-orange-700' : group.source === 'lexoffice_import' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>
                      {group.source === 'lexoffice_sonstige' ? 'Sonstiges' : group.source === 'lexoffice_import' ? 'Lexoffice' : 'Manuell'}
                    </span>
                  </div>
                </div>
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
                      <tbody>{group.bookings.map(booking => renderBookingRow(booking, true))}</tbody>
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

      {viewMode === 'bookings' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="px-3 py-3 w-10">
                  <button onClick={toggleAll} className="flex items-center justify-center text-slate-400 hover:text-blue-600 transition-colors">
                    {allSelected ? <CheckSquare size={16} className="text-blue-600" /> : someSelected ? <CheckSquare size={16} className="text-blue-400" /> : <Square size={16} />}
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
            <tbody>{filtered.map(booking => renderBookingRow(booking))}</tbody>
          </table>
          {!loading && filtered.length === 0 && <div className="text-center py-12 text-slate-400 text-sm">Keine Buchungen gefunden</div>}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          <span className="ml-3 text-slate-400 text-sm">Wird geladen…</span>
        </div>
      )}

      {(filtered.length > 0 || invoiceGroups.length > 0) && (
        <div className="mt-2 space-y-3 px-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{viewMode === 'invoices' ? 'Rechnung anklicken zum Aufklappen' : 'Zeile anklicken für Details'}</span>
            {someSelected && (
              <button onClick={() => setSelected(new Set())} className="hover:text-slate-600 underline">
                Auswahl aufheben
              </button>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <button onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page <= 1 || loading} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
              Zurück
            </button>
            <span className="text-sm text-slate-500">Seite {page} von {totalPages}</span>
            <button onClick={() => setPage(current => Math.min(totalPages, current + 1))} disabled={page >= totalPages || loading} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
              Weiter
            </button>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setDeleteConfirm(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} className="text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900">{selectedCount} Buchung{selectedCount !== 1 ? 'en' : ''} löschen?</h3>
                <p className="text-sm text-slate-500 mt-0.5">Diese Aktion kann nicht rückgängig gemacht werden.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(false)} className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                Abbrechen
              </button>
              <button onClick={handleDeleteSelected} className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors flex items-center justify-center gap-2">
                <Trash2 size={14} /> Löschen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
