'use client'
import { useState } from 'react'
import { useProperties, useCustomers, useLocations, useBookings } from '@/lib/store'
import { formatCurrency } from '@/lib/utils'
import { ArrowLeft, Calculator, BedDouble } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function NeueBuchungPage() {
  const router = useRouter()
  const { properties: allProperties } = useProperties()
  const { customers: allCustomers } = useCustomers()
  const { locations: allLocations } = useLocations()
  const { add: addBooking } = useBookings()

  const [form, setForm] = useState({
    propertyId: '',
    customerId: '',
    checkIn: '',
    checkOut: '',
    bedsBooked: 1,
    pricePerBedNight: '' as string | number,
    cleaningFee: '' as string | number,
    notes: '',
    status: 'bestaetigt' as const,
    paymentStatus: 'offen' as const,
  })

  const prop = allProperties.find(p => p.id === form.propertyId)

  const nights = form.checkIn && form.checkOut
    ? Math.max(0, (new Date(form.checkOut).getTime() - new Date(form.checkIn).getTime()) / 86400000)
    : 0

  const priceNum = parseFloat(String(form.pricePerBedNight).replace(',', '.')) || 0
  const cleaningNum = parseFloat(String(form.cleaningFee).replace(',', '.')) || 0
  const bedsCost = form.bedsBooked * nights * priceNum
  const total = bedsCost + cleaningNum

  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }))

  const handlePropertyChange = (propId: string) => {
    setForm(f => ({ ...f, propertyId: propId, bedsBooked: 1 }))
  }

  const handleSave = () => {
    if (!prop || !form.customerId || !form.checkIn || !form.checkOut || nights <= 0) {
      alert('Bitte alle Pflichtfelder ausfüllen.')
      return
    }
    addBooking({
      propertyId: form.propertyId,
      customerId: form.customerId,
      checkIn: form.checkIn,
      checkOut: form.checkOut,
      nights,
      bedsBooked: form.bedsBooked,
      pricePerBedNight: priceNum,
      cleaningFee: cleaningNum,
      totalPrice: total,
      status: form.status,
      paymentStatus: form.paymentStatus,
      notes: form.notes,
      source: 'manual',
    })
    router.push('/buchungen')
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/buchungen" className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft size={18} className="text-slate-600"/>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Neue Buchung</h1>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">

        {/* Objekt */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Objekt *</label>
          <select
            value={form.propertyId}
            onChange={e => handlePropertyChange(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Objekt wählen...</option>
            {allLocations.map(loc => (
              <optgroup key={loc.id} label={loc.name}>
                {allProperties.filter(p => p.locationId === loc.id && p.active).map(p => (
                  <option key={p.id} value={p.id}>
                    {p.shortCode ? `[${p.shortCode}] ` : ''}{p.name} · {p.beds} Betten
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {prop && (
            <p className="text-xs text-slate-500 mt-1">
              Kapazität: {prop.beds} Betten
            </p>
          )}
        </div>

        {/* Auftraggeber (Firma) */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Auftraggeber *</label>
          <select
            value={form.customerId}
            onChange={e => set('customerId', e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Firma wählen...</option>
            {allCustomers.map(c => (
              <option key={c.id} value={c.id}>
                {c.companyName}{(c.firstName || c.lastName) ? ` (${c.firstName} ${c.lastName})`.trim() : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Zeitraum */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Anreise *</label>
            <input
              type="date"
              value={form.checkIn}
              onChange={e => set('checkIn', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Abreise *</label>
            <input
              type="date"
              value={form.checkOut}
              onChange={e => set('checkOut', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Betten + Preis */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              <span className="flex items-center gap-1.5"><BedDouble size={15}/> Gebuchte Betten *</span>
            </label>
            <input
              type="number"
              min={1}
              max={prop?.beds ?? 999}
              value={form.bedsBooked}
              onChange={e => set('bedsBooked', Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {prop && (
              <p className="text-xs text-slate-400 mt-1">max. {prop.beds} Betten</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Preis / Bett / Nacht (€)</label>
            <div className="relative">
              <input
                type="number"
                min={0}
                step={0.5}
                value={form.pricePerBedNight}
                onChange={e => set('pricePerBedNight', e.target.value)}
                placeholder="z.B. 18.50"
                className="w-full pl-7 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">€</span>
            </div>
          </div>
        </div>

        {/* Reinigung + Status */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Reinigungspauschale (€)</label>
            <div className="relative">
              <input
                type="number"
                min={0}
                step={5}
                value={form.cleaningFee}
                onChange={e => set('cleaningFee', e.target.value)}
                placeholder="z.B. 50"
                className="w-full pl-7 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">€</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Status</label>
            <select
              value={form.status}
              onChange={e => set('status', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="anfrage">Anfrage</option>
              <option value="option">Option</option>
              <option value="bestaetigt">Bestätigt</option>
            </select>
          </div>
        </div>

        {/* Zahlungsstatus */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Zahlungsstatus</label>
          <select
            value={form.paymentStatus}
            onChange={e => set('paymentStatus', e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="offen">Offen</option>
            <option value="teilweise">Teilweise bezahlt</option>
            <option value="bezahlt">Bezahlt</option>
          </select>
        </div>

        {/* Notizen */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Notizen</label>
          <textarea
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder="Besondere Anforderungen, Bemerkungen..."
          />
        </div>

        {/* Preisübersicht */}
        {prop && nights > 0 && (
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
            <div className="flex items-center gap-2 mb-3">
              <Calculator size={16} className="text-blue-600"/>
              <p className="text-sm font-semibold text-blue-900">Preisberechnung</p>
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>
                  {form.bedsBooked} Bett{form.bedsBooked !== 1 ? 'en' : ''} × {nights} Nacht{nights !== 1 ? 'e' : ''} × {formatCurrency(priceNum)}/Bett/Nacht
                </span>
                <span>{formatCurrency(bedsCost)}</span>
              </div>
              {cleaningNum > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Endreinigung</span>
                  <span>{formatCurrency(cleaningNum)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-slate-900 pt-2 border-t border-blue-200 text-base">
                <span>Gesamt</span>
                <span>{formatCurrency(total)}</span>
              </div>
            </div>
            {prop && (
              <p className="text-xs text-blue-600 mt-2">
                {form.bedsBooked} von {prop.beds} Betten gebucht ({Math.round(form.bedsBooked / prop.beds * 100)}% Auslastung)
              </p>
            )}
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3 pt-2">
          <Link
            href="/buchungen"
            className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 text-center transition-colors"
          >
            Abbrechen
          </Link>
          <button
            onClick={handleSave}
            disabled={!form.propertyId || !form.customerId || !form.checkIn || !form.checkOut || nights <= 0}
            className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Buchung erstellen
          </button>
        </div>
      </div>
    </div>
  )
}
