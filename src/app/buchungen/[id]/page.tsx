'use client'
import { useBookings, useProperties, useLocations, useCustomers } from '@/lib/store'
import { formatCurrency, formatDate, statusConfig, paymentConfig } from '@/lib/utils'
import { ArrowLeft, FileText, Building2, Calendar, CreditCard, ExternalLink, BedDouble, Briefcase } from 'lucide-react'
import Link from 'next/link'
import { use } from 'react'

export default function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { bookings: allBookings } = useBookings()
  const { properties: allProperties } = useProperties()
  const { locations: allLocations } = useLocations()
  const { customers: allCustomers } = useCustomers()

  const booking = allBookings.find(b => b.id === id)

  if (!booking) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500">Buchung nicht gefunden</p>
        <Link href="/buchungen" className="text-blue-600 text-sm hover:underline mt-2 inline-block">Zurück zur Liste</Link>
      </div>
    )
  }

  const prop = allProperties.find(p => p.id === booking.propertyId)
  const cust = allCustomers.find(c => c.id === booking.customerId)
  const loc = allLocations.find(l => l.id === prop?.locationId)
  const sc = statusConfig[booking.status]
  const pc = paymentConfig[booking.paymentStatus]

  const bedUtilization = prop ? Math.round((booking.bedsBooked / prop.beds) * 100) : 0

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/buchungen" className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
          <ArrowLeft size={18} className="text-slate-600" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900">{booking.bookingNumber}</h1>
          <p className="text-sm text-slate-500">{booking.invoiceNumber && `Rechnung: ${booking.invoiceNumber} · `}Erstellt: {formatDate(booking.createdAt)}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${sc.bg} ${sc.color}`}>{sc.label}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">

        {/* Objekt */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Building2 size={16} className="text-slate-500" />
            <h2 className="font-semibold text-slate-900 text-sm uppercase tracking-wide">Objekt</h2>
          </div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: loc?.color }} />
            <p className="font-medium text-slate-900">{prop?.name}</p>
            {prop?.shortCode && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-mono">{prop.shortCode}</span>}
          </div>
          <p className="text-sm text-slate-500 mb-3">{loc?.name} · {loc?.city}</p>
          <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg">
            <BedDouble size={16} className="text-slate-500" />
            <span className="text-sm font-semibold text-slate-900">{booking.bedsBooked} von {prop?.beds} Betten</span>
            <span className="text-xs text-slate-400">({bedUtilization}% Auslastung)</span>
          </div>
        </div>

        {/* Auftraggeber */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Briefcase size={16} className="text-slate-500" />
            <h2 className="font-semibold text-slate-900 text-sm uppercase tracking-wide">Auftraggeber</h2>
          </div>
          <p className="font-semibold text-slate-900 mb-0.5">{cust?.companyName}</p>
          {(cust?.firstName || cust?.lastName) && (
            <p className="text-sm text-slate-600 mb-0.5">Ansprechpartner: {cust.firstName} {cust.lastName}</p>
          )}
          <p className="text-sm text-slate-500">{cust?.email}</p>
          <p className="text-sm text-slate-500">{cust?.phone}</p>
          {cust?.taxId && <p className="text-xs text-slate-400 mt-1">St.-Nr.: {cust.taxId}</p>}
          {cust?.lexofficeContactId && (
            <p className="text-xs text-violet-600 mt-2">Lexoffice: {cust.lexofficeContactId}</p>
          )}
        </div>

        {/* Zeitraum */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Calendar size={16} className="text-slate-500" />
            <h2 className="font-semibold text-slate-900 text-sm uppercase tracking-wide">Zeitraum</h2>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-400 uppercase">Anreise</p>
              <p className="font-semibold text-slate-900 text-lg">{formatDate(booking.checkIn)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase">Abreise</p>
              <p className="font-semibold text-slate-900 text-lg">{formatDate(booking.checkOut)}</p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex gap-4 text-sm text-slate-600">
            <span><strong>{booking.nights}</strong> Nächte</span>
            <span><strong>{booking.bedsBooked}</strong> Betten gebucht</span>
          </div>
        </div>

        {/* Finanzen */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <CreditCard size={16} className="text-slate-500" />
            <h2 className="font-semibold text-slate-900 text-sm uppercase tracking-wide">Finanzen</h2>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">{booking.bedsBooked} Betten × {booking.nights} Nächte</span>
              <span>{booking.bedsBooked * booking.nights}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">× {formatCurrency(booking.pricePerBedNight)}/Bett/Nacht</span>
              <span>{formatCurrency(booking.bedsBooked * booking.nights * booking.pricePerBedNight)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Endreinigung</span>
              <span>{formatCurrency(booking.cleaningFee)}</span>
            </div>
            <div className="flex justify-between font-bold text-base pt-2 border-t border-slate-200">
              <span>Gesamt</span><span>{formatCurrency(booking.totalPrice)}</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${pc.bg} ${pc.color}`}>{pc.label}</span>
            <span className="text-xs text-slate-400">{formatCurrency(booking.pricePerBedNight)}/Bett/Nacht</span>
          </div>
        </div>
      </div>

      {/* Lexoffice */}
      {(booking.lexofficeInvoiceId || booking.lexofficeQuotationId) && (
        <div className="bg-violet-50 rounded-xl border border-violet-200 p-4 flex items-center gap-3">
          <FileText size={18} className="text-violet-600" />
          <div className="flex-1">
            <p className="text-sm font-medium text-violet-900">Lexoffice Dokument verknüpft</p>
            <p className="text-xs text-violet-600">{booking.invoiceNumber} · ID: {booking.lexofficeInvoiceId ?? booking.lexofficeQuotationId}</p>
          </div>
          <button className="flex items-center gap-1 text-xs text-violet-700 hover:text-violet-900 font-medium">
            <ExternalLink size={13}/> In Lexoffice öffnen
          </button>
        </div>
      )}

      {booking.notes && (
        <div className="mt-4 bg-amber-50 rounded-xl border border-amber-200 p-4">
          <p className="text-sm font-medium text-amber-900 mb-1">Notizen</p>
          <p className="text-sm text-amber-700">{booking.notes}</p>
        </div>
      )}
    </div>
  )
}
