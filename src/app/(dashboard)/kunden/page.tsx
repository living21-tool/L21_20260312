'use client'
import { useState } from 'react'
import { useCustomers, useBookings, useProperties } from '@/lib/store'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  Search, Mail, Phone, MapPin, Briefcase,
  X, AlertTriangle, ChevronRight, BedDouble, Euro, TrendingUp, FileText,
} from 'lucide-react'
import { Booking } from '@/lib/types'

export default function KundenPage() {
  const { customers, update: updateCustomer, remove: removeCustomer } = useCustomers()
  const { bookings: allBookings, update: updateBooking } = useBookings()
  const { properties } = useProperties()

  const [search, setSearch]         = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // ── Duplikat-Erkennung ────────────────────────────────────────────────────────
  const dupGroups = Object.values(
    customers.reduce((acc, c) => {
      const key = c.companyName.toLowerCase().trim()
      if (!acc[key]) acc[key] = []
      acc[key].push(c)
      return acc
    }, {} as Record<string, typeof customers>)
  ).filter(g => g.length > 1)

  const dupIds = new Set(dupGroups.flatMap(g => g.map(c => c.id)))

  function mergeAll() {
    if (!confirm(`${dupGroups.length} Duplikat-Gruppe(n) bereinigen?\nBuchungen werden auf den jeweils besten Eintrag (mit Lexoffice-ID bevorzugt) zusammengeführt.`)) return
    let merged = 0
    for (const group of dupGroups) {
      const sorted = [...group].sort((a, b) => {
        if (a.lexofficeContactId && !b.lexofficeContactId) return -1
        if (!a.lexofficeContactId && b.lexofficeContactId) return 1
        return allBookings.filter(bk => bk.customerId === b.id).length
             - allBookings.filter(bk => bk.customerId === a.id).length
      })
      const [keeper, ...dupes] = sorted
      for (const dup of dupes) {
        allBookings.filter(bk => bk.customerId === dup.id)
          .forEach(bk => updateBooking(bk.id, { customerId: keeper.id }))
        if (!keeper.lexofficeContactId && dup.lexofficeContactId)
          updateCustomer(keeper.id, { lexofficeContactId: dup.lexofficeContactId })
        removeCustomer(dup.id)
        merged++
      }
    }
    setSelectedId(null)
    alert(`✓ ${merged} Duplikat${merged !== 1 ? 'e' : ''} entfernt.`)
  }

  // ── Filterung ─────────────────────────────────────────────────────────────────
  const filtered = customers.filter(c => {
    const s = search.toLowerCase()
    return !search
      || c.companyName.toLowerCase().includes(s)
      || `${c.firstName} ${c.lastName}`.toLowerCase().includes(s)
      || c.email.toLowerCase().includes(s)
      || c.city.toLowerCase().includes(s)
  })

  // ── Ausgewählter Kunde ────────────────────────────────────────────────────────
  const sel = customers.find(c => c.id === selectedId) ?? null

  const selBookings: Booking[] = sel
    ? [...allBookings]
        .filter(b => b.customerId === sel.id)
        .sort((a, b) => new Date(b.checkIn).getTime() - new Date(a.checkIn).getTime())
    : []

  const selRevenue    = selBookings.filter(b => b.status !== 'storniert').reduce((s, b) => s + b.totalPrice, 0)
  const selBedNights  = selBookings.filter(b => b.status !== 'storniert').reduce((s, b) => s + b.bedsBooked * b.nights, 0)
  const selAvgBedPrice = selBedNights > 0 ? selRevenue / selBedNights : 0
  const selInitials   = sel
    ? sel.companyName.split(' ').filter(w => w.length > 0).slice(0, 2).map(w => w[0].toUpperCase()).join('')
    : ''

  // ── Buchungen nach Rechnung gruppieren ────────────────────────────────────────
  type InvoiceGroup = {
    invoiceNumber: string | null
    bookings: Booking[]
    totalAmount: number
    paymentStatus: string
  }

  const invoiceGroups: InvoiceGroup[] = Object.values(
    selBookings.reduce((acc, b) => {
      const key = b.invoiceNumber ?? '__manual__'
      if (!acc[key]) acc[key] = {
        invoiceNumber: b.invoiceNumber ?? null,
        bookings: [],
        totalAmount: 0,
        paymentStatus: b.paymentStatus,
      }
      acc[key].bookings.push(b)
      acc[key].totalAmount += b.status !== 'storniert' ? b.totalPrice : 0
      // Wenn mind. eine Buchung offen → offen
      if (b.paymentStatus === 'offen') acc[key].paymentStatus = 'offen'
      else if (b.paymentStatus === 'teilweise' && acc[key].paymentStatus !== 'offen')
        acc[key].paymentStatus = 'teilweise'
      return acc
    }, {} as Record<string, InvoiceGroup>)
  ).sort((a, b) => {
    if (!a.invoiceNumber) return 1
    if (!b.invoiceNumber) return -1
    return b.invoiceNumber.localeCompare(a.invoiceNumber)
  })

  const payStyle: Record<string, string> = {
    bezahlt:   'bg-green-100 text-green-700',
    offen:     'bg-red-100 text-red-600',
    teilweise: 'bg-amber-100 text-amber-700',
    erstattet: 'bg-slate-100 text-slate-500',
  }
  const payLabel: Record<string, string> = {
    bezahlt: 'Bezahlt', offen: 'Offen', teilweise: 'Teilzahlung', erstattet: 'Erstattet',
  }
  const statusStyle: Record<string, string> = {
    abgeschlossen: 'bg-green-100 text-green-700',
    bestaetigt:    'bg-blue-100 text-blue-700',
    anfrage:       'bg-amber-100 text-amber-700',
    option:        'bg-purple-100 text-purple-700',
    storniert:     'bg-red-100 text-red-600',
  }
  const statusLabel: Record<string, string> = {
    abgeschlossen: 'Abgeschl.', bestaetigt: 'Bestätigt',
    anfrage: 'Anfrage', option: 'Option', storniert: 'Storniert',
  }

  return (
    <div className="p-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Auftraggeber</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {customers.length} Firmen · {customers.filter(c => c.lexofficeContactId).length} mit Lexoffice
            {dupGroups.length > 0 && (
              <span className="ml-2 text-amber-600 font-medium">
                · ⚠ {dupGroups.length} Duplikat-Gruppe{dupGroups.length !== 1 ? 'n' : ''}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {dupGroups.length > 0 && (
            <button onClick={mergeAll}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-100 text-amber-700 rounded-lg text-sm font-medium hover:bg-amber-200 transition-colors">
              <AlertTriangle size={14}/>
              {dupGroups.reduce((s, g) => s + g.length - 1, 0)} Duplikate bereinigen
            </button>
          )}
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            + Firma hinzufügen
          </button>
        </div>
      </div>

      {/* ── Suche ───────────────────────────────────────────────────────────── */}
      <div className="relative max-w-sm mb-5">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
        <input
          type="text"
          placeholder="Firma, Ansprechpartner, Stadt..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* ── Kunden-Grid (immer volle Breite) ────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.length === 0 && (
          <div className="col-span-3 text-center py-12 text-slate-400 text-sm">
            Noch keine Auftraggeber angelegt
          </div>
        )}
        {filtered.map(c => {
          const bkgs    = allBookings.filter(b => b.customerId === c.id && b.status !== 'storniert')
          const revenue = bkgs.reduce((s, b) => s + b.totalPrice, 0)
          const beds    = bkgs.reduce((s, b) => s + b.bedsBooked * b.nights, 0)
          const lastB   = [...bkgs].sort((a, b) => new Date(b.checkIn).getTime() - new Date(a.checkIn).getTime())[0]
          const isDup   = dupIds.has(c.id)
          const isSelected = selectedId === c.id
          const initials = c.companyName.split(' ').filter(w => w.length > 0).slice(0, 2).map(w => w[0].toUpperCase()).join('')

          return (
            <div
              key={c.id}
              onClick={() => setSelectedId(isSelected ? null : c.id)}
              className={`bg-white rounded-xl border p-5 cursor-pointer transition-all ${
                isSelected
                  ? 'border-blue-500 ring-2 ring-blue-200 shadow-md'
                  : isDup
                    ? 'border-amber-300 hover:shadow-md'
                    : 'border-slate-200 hover:shadow-md hover:border-slate-300'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-violet-600 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    {initials || <Briefcase size={16}/>}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900 leading-tight">{c.companyName}</p>
                    {(c.firstName || c.lastName) && (
                      <p className="text-xs text-slate-500">Ansp.: {c.firstName} {c.lastName}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {isDup && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">Duplikat</span>}
                  {c.lexofficeContactId && <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-medium">Lexoffice</span>}
                </div>
              </div>
              <div className="space-y-1 mb-3 text-sm text-slate-600">
                {c.email && <p className="flex items-center gap-2"><Mail size={13} className="text-slate-400 flex-shrink-0"/><span className="truncate">{c.email}</span></p>}
                {c.phone && <p className="flex items-center gap-2"><Phone size={13} className="text-slate-400 flex-shrink-0"/>{c.phone}</p>}
                {c.city  && <p className="flex items-center gap-2"><MapPin size={13} className="text-slate-400 flex-shrink-0"/>{c.zip ? `${c.zip} ` : ''}{c.city}</p>}
              </div>
              <div className="flex justify-between items-center pt-3 border-t border-slate-100 text-sm">
                <div>
                  <p className="text-xs text-slate-400">{bkgs.length} Buchungen · {beds.toLocaleString('de')} Bettnächte</p>
                  <p className="font-semibold text-slate-900">{formatCurrency(revenue)}</p>
                </div>
                <div className="flex items-center gap-1 text-slate-400">
                  {lastB && (
                    <div className="text-right">
                      <p className="text-xs text-slate-400">Letzte Buchung</p>
                      <p className="text-xs text-slate-600">{formatDate(lastB.checkIn)}</p>
                    </div>
                  )}
                  <ChevronRight size={14}/>
                </div>
              </div>
              {c.notes && <p className="text-xs text-slate-500 mt-2 italic border-t border-slate-100 pt-2">{c.notes}</p>}
            </div>
          )
        })}
      </div>

      {/* ── Overlay-Backdrop ────────────────────────────────────────────────── */}
      {sel && (
        <div
          className="fixed inset-0 bg-black/25 z-40"
          onClick={() => setSelectedId(null)}
        />
      )}

      {/* ── Detail-Panel (Overlay von rechts) ───────────────────────────────── */}
      <div className={`fixed top-0 right-0 h-full w-[500px] bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ${sel ? 'translate-x-0' : 'translate-x-full'}`}>
        {sel && (
          <>
            {/* Panel-Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-blue-50 to-violet-50 flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 bg-gradient-to-br from-blue-500 to-violet-600 rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0">
                  {selInitials || <Briefcase size={18}/>}
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 text-base leading-tight truncate">{sel.companyName}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {sel.lexofficeContactId && <span className="text-xs text-violet-600 font-medium">Lexoffice</span>}
                    {(sel.firstName || sel.lastName) && (
                      <span className="text-xs text-slate-500">Ansp.: {sel.firstName} {sel.lastName}</span>
                    )}
                  </div>
                </div>
              </div>
              <button onClick={() => setSelectedId(null)} className="text-slate-400 hover:text-slate-700 flex-shrink-0 ml-3 p-1 rounded-lg hover:bg-slate-100">
                <X size={20}/>
              </button>
            </div>

            {/* KPI-Kacheln */}
            <div className="grid grid-cols-4 gap-2 px-6 py-4 border-b border-slate-100 flex-shrink-0">
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <Euro size={14} className="text-blue-400 mx-auto mb-1"/>
                <p className="text-xs text-slate-500 leading-tight">Umsatz</p>
                <p className="font-bold text-blue-700 text-sm mt-0.5">{formatCurrency(selRevenue)}</p>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <TrendingUp size={14} className="text-green-400 mx-auto mb-1"/>
                <p className="text-xs text-slate-500 leading-tight">Buchungen</p>
                <p className="font-bold text-green-700 text-sm mt-0.5">{selBookings.filter(b => b.status !== 'storniert').length}</p>
              </div>
              <div className="bg-purple-50 rounded-xl p-3 text-center">
                <BedDouble size={14} className="text-purple-400 mx-auto mb-1"/>
                <p className="text-xs text-slate-500 leading-tight">Bettnächte</p>
                <p className="font-bold text-purple-700 text-sm mt-0.5">{selBedNights.toLocaleString('de')}</p>
              </div>
              <div className="bg-amber-50 rounded-xl p-3 text-center">
                <BedDouble size={14} className="text-amber-400 mx-auto mb-1"/>
                <p className="text-xs text-slate-500 leading-tight">Ø €/B/N</p>
                <p className="font-bold text-amber-700 text-sm mt-0.5">{selAvgBedPrice > 0 ? formatCurrency(selAvgBedPrice) : '—'}</p>
              </div>
            </div>

            {/* Kontaktdaten */}
            <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap gap-x-5 gap-y-1 flex-shrink-0">
              {sel.email && <a href={`mailto:${sel.email}`} className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-blue-600"><Mail size={13} className="text-slate-400"/>{sel.email}</a>}
              {sel.phone && <p className="flex items-center gap-1.5 text-sm text-slate-600"><Phone size={13} className="text-slate-400"/>{sel.phone}</p>}
              {sel.city  && <p className="flex items-center gap-1.5 text-sm text-slate-600"><MapPin size={13} className="text-slate-400"/>{sel.zip ? `${sel.zip} ` : ''}{sel.city}</p>}
              {sel.taxId && <p className="text-xs text-slate-400">St.-Nr.: {sel.taxId}</p>}
              {sel.notes && <p className="w-full text-xs text-slate-500 italic">{sel.notes}</p>}
            </div>

            {/* Rechnungen & Buchungen */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">
                Rechnungen &amp; Buchungen ({invoiceGroups.length} Rechnungen · {selBookings.length} Buchungen)
              </p>

              {invoiceGroups.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">Noch keine Buchungen</p>
              ) : (
                <div className="space-y-4">
                  {invoiceGroups.map(group => (
                    <div key={group.invoiceNumber ?? '__manual__'} className="rounded-xl border border-slate-200 overflow-hidden">

                      {/* Rechnungs-Header */}
                      <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
                        <div className="flex items-center gap-2">
                          <FileText size={15} className="text-slate-400 flex-shrink-0"/>
                          <span className="font-semibold text-slate-800 text-sm">
                            {group.invoiceNumber ?? 'Ohne Rechnung / Manuell'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-700">
                            {formatCurrency(group.totalAmount)}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${payStyle[group.paymentStatus] ?? 'bg-slate-100 text-slate-500'}`}>
                            {payLabel[group.paymentStatus] ?? group.paymentStatus}
                          </span>
                        </div>
                      </div>

                      {/* Buchungen unter dieser Rechnung */}
                      <div className="divide-y divide-slate-100">
                        {group.bookings.map(b => {
                          const prop = properties.find(p => p.id === b.propertyId)
                          return (
                            <div key={b.id} className={`px-4 py-3 ${b.status === 'storniert' ? 'opacity-50 bg-red-50/30' : 'bg-white'}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-slate-900 truncate">
                                    {prop?.shortCode ?? '?'}{prop?.name ? ` · ${prop.name}` : ''}
                                  </p>
                                  <p className="text-xs text-slate-500 mt-0.5">
                                    {formatDate(b.checkIn)} – {formatDate(b.checkOut)} &nbsp;·&nbsp; {b.nights} Nächte &nbsp;·&nbsp; {b.bedsBooked} Betten
                                  </p>
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <p className="text-sm font-semibold text-slate-800">{formatCurrency(b.totalPrice)}</p>
                                  {b.pricePerBedNight > 0 && (
                                    <p className="text-xs text-slate-400">{formatCurrency(b.pricePerBedNight)}/B/N</p>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 mt-1.5">
                                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${statusStyle[b.status] ?? 'bg-slate-100 text-slate-600'}`}>
                                  {statusLabel[b.status] ?? b.status}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>

                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

    </div>
  )
}
