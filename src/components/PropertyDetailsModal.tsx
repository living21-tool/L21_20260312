'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ClipboardList,
  FileText,
  ImagePlus,
  Images,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatCurrency, formatDate, formatLocationLabel } from '@/lib/utils'
import { Property, Booking, Location } from '@/lib/types'
import { EmployeeProfile, L21Task } from '@/lib/l21-types'
import {
  isRemoteMediaUrl,
  PROPERTY_IMAGE_LIMIT,
  PROPERTY_IMAGE_MAX_SIZE_BYTES,
  PROPERTY_MEDIA_BUCKET,
} from '@/lib/property-media'

type PropertyModalTab = 'details' | 'bookings' | 'tasks' | 'documents'

type PropertyDetailData = {
  propertyBookings: Booking[]
  openTasks: L21Task[]
  activeBookings: Booking[]
  totalRevenue: number
  avgBookedBeds: number
  location?: Location | null
}

type Props = {
  open: boolean
  property: Property | null
  detail: PropertyDetailData | null
  profiles: EmployeeProfile[]
  onClose: () => void
  onEdit: (property: Property) => void
  onUpdateProperty: (id: string, data: Partial<Property>) => Promise<void>
}

const typeLabel: Record<Property['type'], string> = {
  wohnung: 'Wohnung',
  haus: 'Haus',
  studio: 'Studio',
  villa: 'Villa',
  zimmer: 'Zimmer',
}

function resolveImageUrl(value: string): string {
  if (isRemoteMediaUrl(value)) {
    return value
  }

  return supabase.storage.from(PROPERTY_MEDIA_BUCKET).getPublicUrl(value).data.publicUrl
}

export default function PropertyDetailsModal({
  open,
  property,
  detail,
  profiles,
  onClose,
  onEdit,
  onUpdateProperty,
}: Props) {
  const [activeTab, setActiveTab] = useState<PropertyModalTab>('details')
  const [uploading, setUploading] = useState(false)
  const [removingPath, setRemovingPath] = useState<string | null>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) {
      setActiveTab('details')
      setMediaError(null)
      setUploading(false)
      setRemovingPath(null)
      setPreviewImage(null)
    }
  }, [open, property?.id])

  const imageCount = property?.images.length ?? 0
  const maxFileSizeMb = Math.round(PROPERTY_IMAGE_MAX_SIZE_BYTES / (1024 * 1024))
  const tabs = useMemo(() => {
    if (!property || !detail) {
      return []
    }

    return [
      { id: 'details' as const, label: 'Objektdetails' },
      { id: 'bookings' as const, label: `Buchungen (${detail.propertyBookings.length})` },
      { id: 'tasks' as const, label: `Aufgaben (${detail.openTasks.length})` },
      { id: 'documents' as const, label: `Dokumente (${imageCount})` },
    ]
  }, [detail, imageCount, property])

  if (!open || !property || !detail) {
    return null
  }

  const currentProperty = property

  async function uploadFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return
    }

    const files = Array.from(fileList)
    const remainingSlots = PROPERTY_IMAGE_LIMIT - currentProperty.images.length

    if (remainingSlots <= 0) {
      setMediaError(`Maximal ${PROPERTY_IMAGE_LIMIT} Bilder pro Objekt.`)
      return
    }

    if (files.length > remainingSlots) {
      setMediaError(`Es koennen noch ${remainingSlots} Bilder hochgeladen werden.`)
      return
    }

    const invalidFile = files.find(file => !file.type.startsWith('image/') || file.size > PROPERTY_IMAGE_MAX_SIZE_BYTES)
    if (invalidFile) {
      setMediaError(`Nur Bilder bis ${maxFileSizeMb} MB sind erlaubt.`)
      return
    }

    setUploading(true)
    setMediaError(null)

    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token

      if (!token) {
        throw new Error('Bitte neu anmelden, bevor Bilder hochgeladen werden.')
      }

      const uploadedPaths: string[] = []

      for (const file of files) {
        const formData = new FormData()
        formData.append('propertyId', currentProperty.id)
        formData.append('file', file)

        const response = await fetch('/api/properties/images', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        })

        const result = await response.json() as { error?: string; path?: string }

        if (!response.ok || !result.path) {
          throw new Error(result.error ?? 'Bild konnte nicht hochgeladen werden.')
        }

        uploadedPaths.push(result.path)
      }

      await onUpdateProperty(currentProperty.id, {
        images: [...currentProperty.images, ...uploadedPaths],
      })
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : 'Bild konnte nicht hochgeladen werden.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  async function removeImage(path: string) {
    setRemovingPath(path)
    setMediaError(null)

    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token

      if (!token) {
        throw new Error('Bitte neu anmelden, bevor Bilder geloescht werden.')
      }

      if (!isRemoteMediaUrl(path)) {
        const response = await fetch('/api/properties/images', {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ paths: [path] }),
        })

        const result = await response.json() as { error?: string }
        if (!response.ok) {
          throw new Error(result.error ?? 'Bild konnte nicht geloescht werden.')
        }
      }

      await onUpdateProperty(currentProperty.id, {
        images: currentProperty.images.filter(image => image !== path),
      })
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : 'Bild konnte nicht geloescht werden.')
    } finally {
      setRemovingPath(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pb-4 pt-6">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative h-[88vh] w-full max-w-6xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              {property.shortCode && (
                <span className="rounded-lg bg-blue-100 px-2 py-1 text-xs font-bold text-blue-700">
                  {property.shortCode}
                </span>
              )}
              <h2 className="text-2xl font-semibold text-slate-900">{property.name}</h2>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {typeLabel[property.type]} · {formatLocationLabel(detail.location?.name, detail.location?.city) || 'Kein Standort'} · {property.beds} Betten
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onEdit(property)}
              className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <span className="inline-flex items-center gap-2">
                <Pencil size={15} /> Bearbeiten
              </span>
            </button>
            <button
              onClick={onClose}
              className="rounded-2xl border border-slate-200 p-2.5 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="h-[calc(88vh-92px)] overflow-y-auto p-6">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Buchungen</p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">{detail.propertyBookings.length}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Aktive Aufgaben</p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">{detail.openTasks.length}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Umsatz</p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">{formatCurrency(detail.totalRevenue)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ø belegte Betten</p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">{detail.avgBookedBeds}</p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                  activeTab === tab.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:bg-white/70 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'details' && (
            <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
              <section className="rounded-[24px] border border-slate-200 p-5">
                <h3 className="text-lg font-semibold text-slate-900">Objektdetails</h3>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Standort</p>
                    <p className="mt-1 text-sm text-slate-800">{detail.location?.name ?? 'Nicht gesetzt'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stadt</p>
                    <p className="mt-1 text-sm text-slate-800">{detail.location?.city ?? '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kurzcode</p>
                    <p className="mt-1 text-sm text-slate-800">{property.shortCode || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Kapazitaet</p>
                    <p className="mt-1 text-sm text-slate-800">{property.beds} Betten</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Preis / Bett / Nacht</p>
                    <p className="mt-1 text-sm text-slate-800">{formatCurrency(property.pricePerBedNight)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reinigung</p>
                    <p className="mt-1 text-sm text-slate-800">{formatCurrency(property.cleaningFee)}</p>
                  </div>
                </div>
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Beschreibung</p>
                  <p className="mt-1 text-sm leading-6 text-slate-700">{property.description || 'Keine Beschreibung hinterlegt.'}</p>
                </div>
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aliase</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(property.aliases ?? []).length > 0 ? property.aliases.map(alias => (
                      <span key={alias} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                        {alias}
                      </span>
                    )) : <span className="text-sm text-slate-500">Keine Aliase gepflegt.</span>}
                  </div>
                </div>
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ausstattung</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {property.amenities.length > 0 ? property.amenities.map(item => (
                      <span key={item} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                        {item}
                      </span>
                    )) : <span className="text-sm text-slate-500">Keine Ausstattung gepflegt.</span>}
                  </div>
                </div>
              </section>

              <section className="space-y-6">
                <div className="rounded-[24px] border border-slate-200 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-slate-900">Bilduebersicht</h3>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                      {imageCount} / {PROPERTY_IMAGE_LIMIT} Bilder
                    </span>
                  </div>
                  {property.images.length > 0 ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {property.images.slice(0, 4).map(image => (
                        <button
                          key={image}
                          type="button"
                          onClick={() => setPreviewImage(image)}
                          className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 text-left transition-transform hover:scale-[1.01]"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={resolveImageUrl(image)}
                            alt={property.name}
                            className="h-44 w-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                      Noch keine Bilder hinterlegt. Im Tab Dokumente koennen Bilder direkt hochgeladen werden.
                    </div>
                  )}
                </div>

                <div className="rounded-[24px] border border-slate-200 p-5">
                  <div className="flex items-center gap-2">
                    <ClipboardList size={18} className="text-slate-400" />
                    <h3 className="text-lg font-semibold text-slate-900">Kurzuebersicht</h3>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aktive Buchungen</p>
                      <p className="mt-2 text-2xl font-semibold text-slate-900">{detail.activeBookings.length}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Offene Aufgaben</p>
                      <p className="mt-2 text-2xl font-semibold text-slate-900">{detail.openTasks.length}</p>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'bookings' && (
            <section className="mt-6 rounded-[24px] border border-slate-200 p-5">
              <h3 className="text-lg font-semibold text-slate-900">Buchungen fuer dieses Objekt</h3>
              <div className="mt-4 space-y-3">
                {detail.propertyBookings.map(booking => (
                  <div key={booking.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{booking.bookingNumber}</p>
                        <p className="mt-1 text-sm text-slate-600">
                          {formatDate(booking.checkIn)} bis {formatDate(booking.checkOut)} · {booking.bedsBooked} Betten · {booking.nights} Naechte
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{booking.status}</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{formatCurrency(booking.totalPrice)}</p>
                      </div>
                    </div>
                    {booking.notes && <p className="mt-2 text-sm text-slate-500">{booking.notes}</p>}
                  </div>
                ))}
                {detail.propertyBookings.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                    Fuer dieses Objekt liegen noch keine Buchungen vor.
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === 'tasks' && (
            <section className="mt-6 rounded-[24px] border border-slate-200 p-5">
              <h3 className="text-lg font-semibold text-slate-900">Aufgaben an diesem Objekt</h3>
              <div className="mt-4 space-y-3">
                {detail.openTasks.map(task => {
                  const assignee = profiles.find(profileItem => profileItem.id === task.assigneeId)
                  return (
                    <div key={task.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{task.title}</p>
                          <p className="mt-1 text-sm text-slate-600">{task.description || 'Keine Beschreibung'}</p>
                        </div>
                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-600">
                          {task.status}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        {task.unitLabel ? `${task.unitLabel} · ` : ''}{assignee?.fullName ?? 'Nicht zugewiesen'} · Faellig {task.dueDate}
                      </p>
                    </div>
                  )
                })}
                {detail.openTasks.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                    Keine offenen Aufgaben fuer dieses Objekt.
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === 'documents' && (
            <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <section className="rounded-[24px] border border-slate-200 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Images size={18} className="text-slate-400" />
                      <h3 className="text-lg font-semibold text-slate-900">Bilder zum Objekt</h3>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      Upload laeuft bewusst sequentiell, damit viele grosse Bilder die App nicht unnoetig belasten.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={event => void uploadFiles(event.target.files)}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading || property.images.length >= PROPERTY_IMAGE_LIMIT}
                      className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <ImagePlus size={16} />
                      {uploading ? 'Upload laeuft...' : 'Bilder hochladen'}
                    </button>
                  </div>
                </div>

                {mediaError && (
                  <div className="mt-4 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                    <span>{mediaError}</span>
                  </div>
                )}

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {property.images.map(image => (
                    <div key={image} className="overflow-hidden rounded-[20px] border border-slate-200 bg-slate-50">
                      <button
                        type="button"
                        onClick={() => setPreviewImage(image)}
                        className="block w-full text-left transition-opacity hover:opacity-95"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={resolveImageUrl(image)}
                          alt={property.name}
                          className="h-52 w-full object-cover"
                        />
                      </button>
                      <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
                        <p className="truncate text-xs text-slate-500">
                          {image.split('/').pop()}
                        </p>
                        <button
                          onClick={() => void removeImage(image)}
                          disabled={removingPath === image}
                          className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400"
                        >
                          <Trash2 size={13} />
                          {removingPath === image ? 'Loeschen...' : 'Entfernen'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {property.images.length === 0 && (
                  <div className="mt-4 rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                    Noch keine Bilder vorhanden. Empfohlen: pro Objekt nur die wichtigsten Ansichten pflegen, damit der Detailbereich schnell bleibt.
                  </div>
                )}
              </section>

              <section className="rounded-[24px] border border-slate-200 p-5">
                <div className="flex items-center gap-2">
                  <FileText size={18} className="text-slate-400" />
                  <h3 className="text-lg font-semibold text-slate-900">Dokumente</h3>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Dieser Tab ist fuer objektbezogene Unterlagen vorbereitet, zum Beispiel Grundrisse, Hausregeln, Reinigungsplaene oder Schluesselhinweise.
                  Die Struktur ist jetzt getrennt von den Kerndaten, damit das Objektprofil nicht ueberladen wird.
                </p>
                <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  Naechster Schritt: eigenes Dokumenten-Array oder Tabelle mit Dateityp, Titel und Sichtbarkeit pro Objekt.
                </div>
              </section>
            </div>
          )}
        </div>
      </div>

      {previewImage && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/80 p-6" onClick={() => setPreviewImage(null)}>
          <div className="relative max-h-full max-w-5xl" onClick={event => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute right-3 top-3 z-10 rounded-full bg-white/90 p-2 text-slate-700 shadow-sm transition-colors hover:bg-white"
            >
              <X size={18} />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={resolveImageUrl(previewImage)}
              alt={property.name}
              className="max-h-[78vh] w-auto max-w-full rounded-3xl object-contain shadow-2xl"
            />
          </div>
        </div>
      )}
    </div>
  )
}
