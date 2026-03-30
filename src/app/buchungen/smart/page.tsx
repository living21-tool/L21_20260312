'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { differenceInDays, format } from 'date-fns'
import {
  AlertTriangle,
  ArrowLeft,
  BedDouble,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Plus,
  Search,
  Trash2,
  Zap,
} from 'lucide-react'

import {
  allocateBeds,
  calcAvailableBedsPerProperty,
  type AllocationEntry,
  type AllocationStrategy,
  type PropertyAvailability,
} from '@/lib/availability'
import { useBookings, useCustomers, useLocations, useProperties } from '@/lib/store'
import type { Booking } from '@/lib/types'
import { formatCurrency } from '@/lib/utils'

type RequestItemState = {
  id: string
  locationId: string
  checkIn: string
  checkOut: string
  bedsNeeded: number
  strategy: AllocationStrategy
  manualAllocations: Record<string, number>
  manualPrices: Record<string, number>
  manualCleaning: Record<string, number>
}

type ComputedRequestItem = RequestItemState & {
  locationName: string
  locationColor: string
  nights: number
  valid: boolean
  availabilities: PropertyAvailability[]
  effectiveAllocations: AllocationEntry[]
  activeAllocations: AllocationEntry[]
  totalAllocated: number
  totalFreeBeds: number
  subtotalBeforeDiscount: number
  shortfall: number
}

type InvoiceLineItem = AllocationEntry & {
  requestId: string
  positionNumber: number
  locationName: string
  checkIn: string
  checkOut: string
}

type CreatedBookingItem = {
  id: string
  bookingNumber: string
  propertyName: string
  beds: number
  positionNumber: number
}

function createRequestItem(
  seed?: Partial<Pick<RequestItemState, 'locationId' | 'checkIn' | 'checkOut'>>,
): RequestItemState {
  return {
    id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    locationId: seed?.locationId ?? '',
    checkIn: seed?.checkIn ?? '',
    checkOut: seed?.checkOut ?? '',
    bedsNeeded: 1,
    strategy: 'fewest-properties',
    manualAllocations: {},
    manualPrices: {},
    manualCleaning: {},
  }
}

function isValidRequestItem(item: RequestItemState) {
  if (!item.locationId || !item.checkIn || !item.checkOut) return false
  return differenceInDays(new Date(item.checkOut), new Date(item.checkIn)) > 0 && item.bedsNeeded > 0
}

function formatRange(checkIn: string, checkOut: string) {
  return `${format(new Date(checkIn), 'dd.MM.yyyy')} - ${format(new Date(checkOut), 'dd.MM.yyyy')}`
}

function buildPlannedBooking(item: ComputedRequestItem, alloc: AllocationEntry): Booking {
  return {
    id: `planned-${item.id}-${alloc.propertyId}`,
    bookingNumber: 'PLANNED',
    propertyId: alloc.propertyId,
    customerId: '',
    checkIn: item.checkIn,
    checkOut: item.checkOut,
    nights: item.nights,
    bedsBooked: alloc.bedsAllocated,
    pricePerBedNight: alloc.pricePerBedNight,
    cleaningFee: alloc.cleaningFee,
    totalPrice: alloc.subtotal,
    status: 'bestaetigt',
    paymentStatus: 'offen',
    notes: '',
    createdAt: item.checkIn,
    updatedAt: item.checkOut,
    source: 'manual',
  }
}

export default function SmartBookingPage() {
  const { properties } = useProperties()
  const { customers } = useCustomers()
  const { locations } = useLocations()
  const { bookings, add: addBooking } = useBookings()

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1)
  const [requestItems, setRequestItems] = useState<RequestItemState[]>([createRequestItem()])
  const [customerId, setCustomerId] = useState('')
  const [bookingStatus, setBookingStatus] = useState<'anfrage' | 'option' | 'bestaetigt'>('bestaetigt')
  const [notes, setNotes] = useState('')
  const [discountPercent, setDiscountPercent] = useState(0)
  const [vatRate, setVatRate] = useState<0 | 7 | 19>(0)
  const [creating, setCreating] = useState(false)
  const [createdBookings, setCreatedBookings] = useState<CreatedBookingItem[]>([])
  const [createError, setCreateError] = useState('')

  const computedRequests = useMemo(() => {
    const plannedBookings: Booking[] = []

    return requestItems.map(item => {
      const location = locations.find(entry => entry.id === item.locationId)
      const locationProps = properties.filter(prop => prop.locationId === item.locationId && prop.active)
      const nights = item.checkIn && item.checkOut
        ? Math.max(0, differenceInDays(new Date(item.checkOut), new Date(item.checkIn)))
        : 0
      const valid = isValidRequestItem(item)
      const availabilities = valid
        ? calcAvailableBedsPerProperty(
            new Date(item.checkIn),
            new Date(item.checkOut),
            locationProps,
            [...bookings, ...plannedBookings],
          )
        : []
      const autoResult = valid ? allocateBeds(item.bedsNeeded, availabilities, nights, item.strategy) : null

      const effectiveAllocations = availabilities.map(availability => {
        const autoAllocation = autoResult?.allocations.find(entry => entry.propertyId === availability.propertyId)
        const manualBeds = item.manualAllocations[availability.propertyId]
        const bedsAllocated = Math.max(
          0,
          Math.min(
            availability.minFreeBeds,
            manualBeds !== undefined ? manualBeds : (autoAllocation?.bedsAllocated ?? 0),
          ),
        )
        const pricePerBedNight = item.manualPrices[availability.propertyId] ?? availability.pricePerBedNight
        const cleaningFee = item.manualCleaning[availability.propertyId] ?? availability.cleaningFee
        const subtotal = bedsAllocated * nights * pricePerBedNight + (bedsAllocated > 0 ? cleaningFee : 0)

        return {
          propertyId: availability.propertyId,
          propertyName: availability.propertyName,
          shortCode: availability.shortCode,
          bedsAllocated,
          totalBeds: availability.totalBeds,
          minFreeBeds: availability.minFreeBeds,
          pricePerBedNight,
          cleaningFee,
          nights,
          subtotal,
        } satisfies AllocationEntry
      })

      const activeAllocations = effectiveAllocations.filter(entry => entry.bedsAllocated > 0)
      const totalAllocated = activeAllocations.reduce((sum, entry) => sum + entry.bedsAllocated, 0)
      const subtotalBeforeDiscount = activeAllocations.reduce((sum, entry) => sum + entry.subtotal, 0)
      const computedItem: ComputedRequestItem = {
        ...item,
        locationName: location?.name ?? 'Standort unbekannt',
        locationColor: location?.color ?? '#94a3b8',
        nights,
        valid,
        availabilities,
        effectiveAllocations,
        activeAllocations,
        totalAllocated,
        totalFreeBeds: availabilities.reduce((sum, entry) => sum + entry.minFreeBeds, 0),
        subtotalBeforeDiscount,
        shortfall: Math.max(item.bedsNeeded - totalAllocated, 0),
      }

      activeAllocations.forEach(entry => {
        plannedBookings.push(buildPlannedBooking(computedItem, entry))
      })

      return computedItem
    })
  }, [bookings, locations, properties, requestItems])

  const invoiceLines = useMemo<InvoiceLineItem[]>(
    () =>
      computedRequests
        .flatMap(item =>
          item.activeAllocations.map(entry => ({
            ...entry,
            requestId: item.id,
            locationName: item.locationName,
            checkIn: item.checkIn,
            checkOut: item.checkOut,
          })),
        )
        .map((entry, index) => ({
          ...entry,
          positionNumber: index + 1,
        })),
    [computedRequests],
  )

  const totalAllocated = invoiceLines.reduce((sum, entry) => sum + entry.bedsAllocated, 0)
  const subtotalBeforeDiscount = invoiceLines.reduce((sum, entry) => sum + entry.subtotal, 0)
  const discountAmount = Math.round(subtotalBeforeDiscount * discountPercent) / 100
  const netTotal = subtotalBeforeDiscount - discountAmount
  const vatAmount = Math.round(netTotal * vatRate) / 100
  const totalPrice = netTotal + vatAmount
  const currentCustomer = customers.find(customer => customer.id === customerId)
  const requestDataValid = requestItems.every(item => isValidRequestItem(item))
  const canCreateBookings = Boolean(customerId) && invoiceLines.length > 0 && !creating
  const canContinueToCustomer = invoiceLines.length > 0
  const canContinueToInvoice = Boolean(customerId) && invoiceLines.length > 0

  const updateRequestItem = (requestId: string, updater: (item: RequestItemState) => RequestItemState) => {
    setRequestItems(prev => prev.map(item => (item.id === requestId ? updater(item) : item)))
  }

  const updateRequestField = (
    requestId: string,
    field: 'locationId' | 'checkIn' | 'checkOut' | 'bedsNeeded' | 'strategy',
    value: string | number,
  ) => {
    updateRequestItem(requestId, item => {
      if (field === 'bedsNeeded') {
        return { ...item, bedsNeeded: Math.max(1, Number(value) || 1) }
      }
      if (field === 'strategy') {
        return { ...item, strategy: value as AllocationStrategy, manualAllocations: {} }
      }
      return { ...item, [field]: value }
    })
  }

  const updateManualValue = (
    requestId: string,
    field: 'manualAllocations' | 'manualPrices' | 'manualCleaning',
    propertyId: string,
    value: number,
  ) => {
    updateRequestItem(requestId, item => ({
      ...item,
      [field]: {
        ...item[field],
        [propertyId]: value,
      },
    }))
  }

  const handleAddRequestItem = (returnToStep1 = false) => {
    setRequestItems(prev => {
      const last = prev.at(-1)
      return [
        ...prev,
        createRequestItem({
          locationId: last?.locationId,
        }),
      ]
    })

    if (returnToStep1) {
      setStep(1)
    }
  }

  const handleRemoveRequestItem = (requestId: string) => {
    setRequestItems(prev => (prev.length === 1 ? prev : prev.filter(item => item.id !== requestId)))
  }

  const handleCheckAvailability = () => {
    if (!requestDataValid) return
    setStep(2)
  }

  const handleOpenCustomerStep = () => {
    if (!canContinueToCustomer) return
    setStep(3)
  }

  const handleOpenInvoiceStep = () => {
    if (!canContinueToInvoice) return
    setStep(4)
  }

  const handleCreateBookings = async () => {
    if (!customerId || invoiceLines.length === 0) return
    setCreating(true)
    setCreateError('')
    const created: CreatedBookingItem[] = []
    const positionSummary = computedRequests
      .map((item, index) => `Pos. ${index + 1}: ${item.locationName}, ${formatRange(item.checkIn, item.checkOut)}, ${item.bedsNeeded} Betten`)
      .join('\n')
    const sharedNotes = [
      'Sammelbuchung',
      positionSummary,
      discountPercent > 0 ? `Rabatt: ${discountPercent}%` : '',
      vatRate > 0 ? `USt: ${vatRate}%` : 'USt: 0%',
      notes.trim(),
    ]
      .filter(Boolean)
      .join('\n')

    try {
      for (const line of invoiceLines) {
        const lineDiscount = subtotalBeforeDiscount > 0
          ? Math.round((line.subtotal / subtotalBeforeDiscount) * discountAmount * 100) / 100
          : 0
        const netLinePrice = line.subtotal - lineDiscount
        const lineVat = Math.round(netLinePrice * vatRate) / 100
        const finalPrice = netLinePrice + lineVat
        const booking = await addBooking({
          propertyId: line.propertyId,
          customerId,
          checkIn: line.checkIn,
          checkOut: line.checkOut,
          nights: line.nights,
          bedsBooked: line.bedsAllocated,
          pricePerBedNight: line.pricePerBedNight,
          cleaningFee: line.cleaningFee,
          totalPrice: finalPrice,
          status: bookingStatus,
          paymentStatus: 'offen',
          notes: `${sharedNotes}\nRechnungsposition ${line.positionNumber}: ${line.locationName}, ${formatRange(line.checkIn, line.checkOut)}`,
          source: 'manual',
        })

        created.push({
          id: booking.id,
          bookingNumber: booking.bookingNumber,
          propertyName: line.propertyName,
          beds: line.bedsAllocated,
          positionNumber: line.positionNumber,
        })
      }

      setCreatedBookings(created)
      setStep(5)
    } catch (error) {
      setCreateError(
        `Fehler beim Erstellen: ${error instanceof Error ? error.message : String(error)}. ${created.length} von ${invoiceLines.length} Buchungen wurden erstellt.`,
      )
      if (created.length > 0) {
        setCreatedBookings(created)
        setStep(5)
      }
    } finally {
      setCreating(false)
    }
  }

  const handleReset = () => {
    setStep(1)
    setRequestItems([createRequestItem()])
    setCustomerId('')
    setBookingStatus('bestaetigt')
    setNotes('')
    setDiscountPercent(0)
    setVatRate(0)
    setCreating(false)
    setCreatedBookings([])
    setCreateError('')
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/buchungen" className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft size={18} className="text-slate-600" />
        </Link>
        <div className="flex items-center gap-2">
          <Zap size={20} className="text-amber-500" />
          <h1 className="text-2xl font-bold text-slate-900">Leerstand</h1>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-6">
        {[
          { n: 1, label: 'Bedarf' },
          { n: 2, label: 'Verfuegbarkeit' },
          { n: 3, label: 'Auftraggeber' },
          { n: 4, label: 'Rechnung' },
          { n: 5, label: 'Fertig' },
        ].map(({ n, label }, index) => (
          <div key={n} className="flex items-center gap-2">
            {index > 0 && <div className={`w-8 h-px ${step >= n ? 'bg-blue-400' : 'bg-slate-200'}`} />}
            <div
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                step === n
                  ? 'bg-blue-600 text-white'
                  : step > n
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-slate-100 text-slate-400'
              }`}
            >
              {step > n ? <Check size={12} /> : <span>{n}</span>}
              <span>{label}</span>
            </div>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
            <div>
              <h2 className="font-semibold text-slate-900 mb-1">Verfuegbarkeit pruefen</h2>
              <p className="text-sm text-slate-500">
                Pruefe zuerst nur Standort, Zeitraum und Bettenbedarf. Auftraggeber und Rechnungsdaten kannst du spaeter eintragen.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-900">Positionen</h2>
              <p className="text-sm text-slate-500">Fuege beliebig viele Zeitraeume oder Standorte in einer Sammelrechnung hinzu.</p>
            </div>
            <button
              onClick={() => handleAddRequestItem(false)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Plus size={16} />
              Position
            </button>
          </div>

          {requestItems.map((item, index) => {
            const selectedLocation = locations.find(location => location.id === item.locationId)
            const locationProps = properties.filter(property => property.locationId === item.locationId && property.active)
            const locationBeds = locationProps.reduce((sum, property) => sum + property.beds, 0)
            const nights = item.checkIn && item.checkOut
              ? Math.max(0, differenceInDays(new Date(item.checkOut), new Date(item.checkIn)))
              : 0

            return (
              <div key={item.id} className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Position {index + 1}</p>
                    <p className="text-sm text-slate-500">Standort, Zeitraum und Bettenbedarf fuer diese Rechnungsposition.</p>
                  </div>
                  {requestItems.length > 1 && (
                    <button
                      onClick={() => handleRemoveRequestItem(item.id)}
                      className="inline-flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      <Trash2 size={15} />
                      Entfernen
                    </button>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Standort *</label>
                  <select
                    value={item.locationId}
                    onChange={event => updateRequestField(item.id, 'locationId', event.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Standort waehlen...</option>
                    {locations.map(location => {
                      const propsAtLocation = properties.filter(property => property.locationId === location.id && property.active)
                      const bedsAtLocation = propsAtLocation.reduce((sum, property) => sum + property.beds, 0)
                      return (
                        <option key={location.id} value={location.id}>
                          {location.name} - {propsAtLocation.length} Portfolio, {bedsAtLocation} Betten
                        </option>
                      )
                    })}
                  </select>
                  {selectedLocation && (
                    <p className="text-xs text-slate-500 mt-1">
                      {locationProps.length} Portfolio - {locationBeds} Betten gesamt am Standort {selectedLocation.name}
                    </p>
                  )}
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Anreise *</label>
                    <input
                      type="date"
                      value={item.checkIn}
                      onChange={event => updateRequestField(item.id, 'checkIn', event.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Abreise *</label>
                    <input
                      type="date"
                      value={item.checkOut}
                      min={item.checkIn || undefined}
                      onChange={event => updateRequestField(item.id, 'checkOut', event.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      <span className="flex items-center gap-1.5"><BedDouble size={15} /> Betten benoetigt *</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={item.bedsNeeded}
                      onChange={event => updateRequestField(item.id, 'bedsNeeded', event.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {nights > 0 && (
                  <p className="text-xs text-slate-500 -mt-2">
                    {nights} Naechte fuer Position {index + 1}
                  </p>
                )}
              </div>
            )
          })}

          <button
            onClick={handleCheckAvailability}
            disabled={!requestDataValid}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Search size={16} />
            Verfuegbarkeit pruefen
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold text-slate-900">Verfuegbarkeit und Zuteilung</h2>
              <p className="text-sm text-slate-500">
                {requestItems.length} Position{requestItems.length !== 1 ? 'en' : ''} geprueft. Hier kannst du die Verteilung pruefen und bei Bedarf weitere Positionen hinzufuegen.
              </p>
            </div>
            <button
              onClick={() => handleAddRequestItem(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Plus size={16} />
              Weitere Position
            </button>
          </div>

          {computedRequests.map((item, index) => {
            const canFulfill = item.totalAllocated >= item.bedsNeeded
            const partial = item.totalAllocated > 0 && !canFulfill

            return (
              <div key={item.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Position {index + 1}</p>
                      <h3 className="text-base font-semibold text-slate-900">{item.locationName}</h3>
                      <p className="text-sm text-slate-500">
                        {formatRange(item.checkIn, item.checkOut)} - {item.nights} Naechte - {item.bedsNeeded} Betten gesucht
                      </p>
                    </div>
                    <span
                      className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                        canFulfill
                          ? 'bg-emerald-100 text-emerald-700'
                          : partial
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {item.totalAllocated} von {item.bedsNeeded} Betten zugewiesen
                    </span>
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Strategie:</span>
                    <div className="flex bg-slate-100 rounded-full p-0.5">
                      <button
                        onClick={() => updateRequestField(item.id, 'strategy', 'fewest-properties')}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          item.strategy === 'fewest-properties' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                        }`}
                      >
                        Wenig Portfolio
                      </button>
                      <button
                        onClick={() => updateRequestField(item.id, 'strategy', 'cheapest-first')}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          item.strategy === 'cheapest-first' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                        }`}
                      >
                        Guenstigster Preis
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-600">
                          <th className="text-left px-4 py-2.5 font-medium">Objekt</th>
                          <th className="text-center px-3 py-2.5 font-medium w-20">Kap.</th>
                          <th className="text-center px-3 py-2.5 font-medium w-16">Frei</th>
                          <th className="text-center px-3 py-2.5 font-medium w-28">Zugewiesen</th>
                          <th className="text-right px-3 py-2.5 font-medium w-28">EUR/Bett/N</th>
                          <th className="text-right px-3 py-2.5 font-medium w-28">Reinigung</th>
                          <th className="text-right px-4 py-2.5 font-medium w-28">Summe</th>
                        </tr>
                      </thead>
                      <tbody>
                        {item.effectiveAllocations.map(allocation => {
                          const isFull = allocation.minFreeBeds === 0
                          const isAssigned = allocation.bedsAllocated > 0

                          return (
                            <tr
                              key={allocation.propertyId}
                              className={`border-b border-slate-100 transition-colors ${
                                isAssigned
                                  ? 'bg-emerald-50/80 shadow-[inset_4px_0_0_0_rgb(16_185_129)]'
                                  : isFull
                                    ? 'opacity-40'
                                    : 'hover:bg-slate-50'
                              }`}
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.locationColor }} />
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <p className="font-medium text-slate-800 truncate max-w-[240px]">{allocation.propertyName}</p>
                                      {isAssigned && (
                                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                                          {allocation.bedsAllocated} Bett{allocation.bedsAllocated !== 1 ? 'en' : ''} zugewiesen
                                        </span>
                                      )}
                                    </div>
                                    {allocation.shortCode && (
                                      <span className={`text-xs font-mono ${isAssigned ? 'text-emerald-700/80' : 'text-slate-400'}`}>
                                        {allocation.shortCode}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="text-center px-3 py-3 text-slate-600">{allocation.totalBeds}</td>
                              <td className="text-center px-3 py-3">
                                <span
                                  className={`font-medium ${
                                    allocation.minFreeBeds === 0
                                      ? 'text-red-500'
                                      : allocation.minFreeBeds <= 2
                                        ? 'text-amber-600'
                                        : 'text-emerald-600'
                                  }`}
                                >
                                  {allocation.minFreeBeds}
                                </span>
                              </td>
                              <td className="text-center px-3 py-3">
                                {isFull ? (
                                  <span className="text-xs text-slate-400">belegt</span>
                                ) : (
                                  <input
                                    type="number"
                                    min={0}
                                    max={allocation.minFreeBeds}
                                    value={allocation.bedsAllocated}
                                    onChange={event =>
                                      updateManualValue(
                                        item.id,
                                        'manualAllocations',
                                        allocation.propertyId,
                                        Math.max(0, Math.min(allocation.minFreeBeds, Number(event.target.value) || 0)),
                                      )
                                    }
                                    className={`w-16 mx-auto px-2 py-1 border rounded text-center text-sm focus:outline-none focus:ring-2 ${
                                      isAssigned
                                        ? 'border-emerald-300 bg-white font-semibold text-emerald-700 focus:ring-emerald-300'
                                        : 'border-slate-200 focus:ring-blue-500'
                                    }`}
                                  />
                                )}
                              </td>
                              <td className="text-right px-3 py-3">
                                {isFull ? (
                                  <span className="text-slate-400">-</span>
                                ) : (
                                  <div className="relative inline-block">
                                    <input
                                      type="number"
                                      min={0}
                                      step={0.5}
                                      value={allocation.pricePerBedNight || ''}
                                      onChange={event =>
                                        updateManualValue(
                                          item.id,
                                          'manualPrices',
                                          allocation.propertyId,
                                          Math.max(0, Number(event.target.value) || 0),
                                        )
                                      }
                                      placeholder="0"
                                      className="w-24 pl-5 pr-2 py-1 border border-slate-200 rounded text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                    <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">EUR</span>
                                  </div>
                                )}
                              </td>
                              <td className="text-right px-3 py-3">
                                {isFull ? (
                                  <span className="text-slate-400">-</span>
                                ) : (
                                  <div className="relative inline-block">
                                    <input
                                      type="number"
                                      min={0}
                                      step={5}
                                      value={allocation.cleaningFee || ''}
                                      onChange={event =>
                                        updateManualValue(
                                          item.id,
                                          'manualCleaning',
                                          allocation.propertyId,
                                          Math.max(0, Number(event.target.value) || 0),
                                        )
                                      }
                                      placeholder="0"
                                      className="w-24 pl-5 pr-2 py-1 border border-slate-200 rounded text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                    <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">EUR</span>
                                  </div>
                                )}
                              </td>
                              <td className="text-right px-4 py-3 font-medium text-slate-800">
                                {allocation.bedsAllocated > 0 ? formatCurrency(allocation.subtotal) : '-'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {item.shortfall > 0 && (
                    <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
                      <p className="text-sm text-amber-800">
                        Fuer Position {index + 1} fehlen noch {item.shortfall} Bett{item.shortfall !== 1 ? 'en' : ''}.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          <div className="flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <ChevronLeft size={16} />
              Zurueck
            </button>
            <button
              onClick={handleOpenCustomerStep}
              disabled={!canContinueToCustomer}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={16} />
              Kunden anlegen
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
            <div>
              <h2 className="font-semibold text-slate-900 mb-1">Auftraggeber und Buchungsdaten</h2>
              <p className="text-sm text-slate-500">
                Waehle jetzt den Auftraggeber und die gemeinsamen Angaben fuer alle geplanten Buchungen.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Auftraggeber *</label>
                <select
                  value={customerId}
                  onChange={event => setCustomerId(event.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Firma waehlen...</option>
                  {customers.map(customer => (
                    <option key={customer.id} value={customer.id}>
                      {customer.companyName}
                      {(customer.firstName || customer.lastName) ? ` (${customer.firstName} ${customer.lastName})`.trim() : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Status</label>
                <select
                  value={bookingStatus}
                  onChange={event => setBookingStatus(event.target.value as typeof bookingStatus)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="anfrage">Anfrage</option>
                  <option value="option">Option</option>
                  <option value="bestaetigt">Bestaetigt</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Notiz fuer alle Positionen</label>
              <textarea
                value={notes}
                onChange={event => setNotes(event.target.value)}
                rows={3}
                placeholder="Optional..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            {!customerId && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
                <p className="text-sm text-amber-800">
                  Bitte waehle einen Auftraggeber aus, bevor du mit der Rechnungsfinalisierung weitermachst.
                </p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-sm font-semibold text-slate-900">Zwischenstand</p>
            <p className="mt-1 text-sm text-slate-500">
              {invoiceLines.length} geplante Buchung{invoiceLines.length !== 1 ? 'en' : ''} fuer {totalAllocated} Betten.
            </p>
            <p className="text-sm text-slate-500">
              Auftraggeber: {currentCustomer?.companyName ?? 'noch nicht ausgewaehlt'}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(2)}
              className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <ChevronLeft size={16} />
              Zur Verfuegbarkeit
            </button>
            <button
              onClick={handleOpenInvoiceStep}
              disabled={!canContinueToInvoice}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileText size={16} />
              Rechnung finalisieren
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold text-slate-900">Rechnung finalisieren</h2>
              <p className="text-sm text-slate-500">
                Rechnungsuebersicht, Rabatt und finale Kontrolle vor dem Erstellen der Buchungen.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
              Auftraggeber: <span className="font-semibold text-slate-900">{currentCustomer?.companyName ?? '-'}</span>
            </div>
          </div>

          {invoiceLines.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-4">
                  <label className="text-sm font-medium text-slate-700 whitespace-nowrap">Rabatt</label>
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={discountPercent || ''}
                      onChange={event => setDiscountPercent(Math.max(0, Math.min(100, Number(event.target.value) || 0)))}
                      placeholder="0"
                      className="w-24 pr-7 pl-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">%</span>
                  </div>
                  {discountPercent > 0 && (
                    <span className="text-sm text-emerald-600 font-medium">- {formatCurrency(discountAmount)}</span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-slate-700 whitespace-nowrap">USt</label>
                  <select
                    value={vatRate}
                    onChange={event => setVatRate(Number(event.target.value) as 0 | 7 | 19)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value={0}>0%</option>
                    <option value={7}>7%</option>
                    <option value={19}>19%</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {invoiceLines.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-200 bg-slate-50">
                <FileText size={18} className="text-slate-500" />
                <div>
                  <p className="font-semibold text-slate-900">Rechnungsuebersicht</p>
                  <p className="text-sm text-slate-500">Uebersicht aller Positionen wie in einer Rechnung.</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white">
                    <tr className="border-b border-slate-200 text-slate-600">
                      <th className="text-left px-4 py-3 font-medium w-16">Pos.</th>
                      <th className="text-left px-4 py-3 font-medium">Bezeichnung</th>
                      <th className="text-left px-4 py-3 font-medium w-32">Menge</th>
                      <th className="text-right px-4 py-3 font-medium w-40">Einzelpreis</th>
                      <th className="text-right px-4 py-3 font-medium w-32">Reinigung</th>
                      <th className="text-right px-4 py-3 font-medium w-36">Gesamt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceLines.map(line => (
                      <tr key={`${line.requestId}-${line.propertyId}`} className="border-b border-slate-100 align-top">
                        <td className="px-4 py-4 text-slate-600">{line.positionNumber}</td>
                        <td className="px-4 py-4">
                          <p className="font-semibold text-slate-900">{line.shortCode || line.propertyName}</p>
                          <p className="text-slate-700">{line.propertyName}</p>
                          <p className="text-xs text-slate-500 mt-1">
                            {line.locationName} - {formatRange(line.checkIn, line.checkOut)} - {line.bedsAllocated} Betten
                          </p>
                        </td>
                        <td className="px-4 py-4 text-slate-700">
                          {line.nights} Nacht{line.nights !== 1 ? 'e' : ''}
                        </td>
                        <td className="px-4 py-4 text-right text-slate-700">
                          {formatCurrency(line.pricePerBedNight * line.bedsAllocated)}
                        </td>
                        <td className="px-4 py-4 text-right text-slate-700">
                          {line.cleaningFee > 0 ? formatCurrency(line.cleaningFee) : '-'}
                        </td>
                        <td className="px-4 py-4 text-right font-semibold text-slate-900">
                          {formatCurrency(line.subtotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50">
                    <tr className="border-t border-slate-200">
                      <td colSpan={5} className="px-4 py-3 text-right text-slate-600">Zwischensumme (netto)</td>
                      <td className="px-4 py-3 text-right text-slate-900">{formatCurrency(netTotal)}</td>
                    </tr>
                    {vatRate > 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-3 text-right text-slate-600">
                          Umsatzsteuer ({vatRate}%)
                        </td>
                        <td className="px-4 py-3 text-right text-slate-900">{formatCurrency(vatAmount)}</td>
                      </tr>
                    )}
                    <tr className="border-t border-slate-200">
                      <td colSpan={5} className="px-4 py-4 text-right text-base font-semibold text-slate-900">Gesamtbetrag</td>
                      <td className="px-4 py-4 text-right text-base font-semibold text-slate-900">{formatCurrency(totalPrice)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm text-slate-300">Gesamtumfang</p>
                  <p className="text-lg font-semibold">
                    {totalAllocated} Betten in {invoiceLines.length} Buchung{invoiceLines.length !== 1 ? 'en' : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-slate-300">Auftraggeber</p>
                  <p className="text-lg font-semibold">{currentCustomer?.companyName ?? '-'}</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep(3)}
              className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <ChevronLeft size={16} />
              Zum Auftraggeber
            </button>
            <button
              onClick={handleCreateBookings}
              disabled={!canCreateBookings}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? (
                <span>Erstelle...</span>
              ) : (
                <>
                  <Plus size={16} />
                  {invoiceLines.length} Buchung{invoiceLines.length !== 1 ? 'en' : ''} erstellen
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Check size={24} className="text-emerald-600" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900 mb-1">
              {createdBookings.length} Buchung{createdBookings.length !== 1 ? 'en' : ''} erstellt
            </h2>
            <p className="text-sm text-slate-500">
              {requestItems.length} Position{requestItems.length !== 1 ? 'en' : ''} fuer {currentCustomer?.companyName ?? 'den Auftraggeber'} - {formatCurrency(totalPrice)}
            </p>
          </div>

          {createError && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {createError}
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {createdBookings.map(booking => (
              <Link
                key={booking.id}
                href={`/buchungen/${booking.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors group"
              >
                <div>
                  <p className="font-medium text-slate-800 group-hover:text-blue-700 transition-colors">
                    {booking.bookingNumber}
                  </p>
                  <p className="text-xs text-slate-500">
                    Position {booking.positionNumber} - {booking.propertyName} - {booking.beds} Betten
                  </p>
                </div>
                <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-400" />
              </Link>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleReset}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              <Zap size={16} />
              Weiteren Leerstand anlegen
            </button>
            <Link
              href="/buchungen"
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Zur Buchungsliste
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
