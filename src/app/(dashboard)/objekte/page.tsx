'use client'
import { useState, useMemo } from 'react'
import { useProperties, useLocations, useBookings } from '@/lib/store'
import { useL21Workspace } from '@/lib/l21-workspace'
import { formatCurrency } from '@/lib/utils'
import { Property, Location } from '@/lib/types'
import { Bed, MapPin, Plus, Pencil, Trash2, Settings2, ChevronDown, ChevronUp, Search } from 'lucide-react'
import PropertyModal from '@/components/PropertyModal'
import LocationModal from '@/components/LocationModal'
import PropertyDetailsModal from '@/components/PropertyDetailsModal'

const typeLabel: Record<string, string> = {
  wohnung: 'Wohnung', haus: 'Haus', studio: 'Studio', villa: 'Villa', zimmer: 'Zimmer'
}

export default function ObjektePage() {
  const { properties, loading: loadingProps, add: addProp, update: updateProp, remove: removeProp } = useProperties()
  const { locations, loading: loadingLocs, add: addLoc, update: updateLoc, remove: removeLoc } = useLocations()
  const { bookings } = useBookings()
  const { tasks, profiles } = useL21Workspace()
  const loading = loadingProps || loadingLocs

  const [propModal, setPropModal] = useState<{ open: boolean; initial: Property | null }>({ open: false, initial: null })
  const [locModal, setLocModal] = useState<{ open: boolean; initial: Location | null }>({ open: false, initial: null })
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'prop' | 'loc'; id: string; name: string } | null>(null)
  const [collapsedLocs, setCollapsedLocs] = useState<Set<string>>(new Set())
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const openNewProp = () => setPropModal({ open: true, initial: null })
  const openEditProp = (p: Property) => setPropModal({ open: true, initial: p })
  const openNewLoc = () => setLocModal({ open: true, initial: null })
  const openEditLoc = (l: Location) => setLocModal({ open: true, initial: l })

  const toggleCollapse = (locId: string) => {
    setCollapsedLocs(prev => {
      const next = new Set(prev)
      if (next.has(locId)) {
        next.delete(locId)
      } else {
        next.add(locId)
      }
      return next
    })
  }

  const handleDeleteProp = (id: string) => { removeProp(id); setDeleteConfirm(null) }
  const handleDeleteLoc = (id: string) => { removeLoc(id); setDeleteConfirm(null) }

  const locationsWithProps = locations.filter(l => properties.some(p => p.locationId === l.id))
  const locationsWithoutProps = locations.filter(l => !properties.some(p => p.locationId === l.id))
  const selectedProperty = properties.find(prop => prop.id === selectedPropertyId) ?? null
  const normalizedSearch = search.trim().toLowerCase()

  const totalBeds = properties.reduce((s, p) => s + p.beds, 0)

  const locStats = useMemo(() => {
    const m: Record<string, { count: number; beds: number; revenue: number }> = {}
    locations.forEach(loc => {
      const lp = properties.filter(p => p.locationId === loc.id)
      const lb = bookings.filter(b => lp.some(p => p.id === b.propertyId) && b.status !== 'storniert')
      m[loc.id] = {
        count: lp.length,
        beds: lp.reduce((s, p) => s + p.beds, 0),
        revenue: lb.reduce((s, b) => s + b.totalPrice, 0),
      }
    })
    return m
  }, [locations, properties, bookings])

  const matchesProperty = (property: Property) => {
    if (!normalizedSearch) {
      return true
    }

    const location = locations.find(item => item.id === property.locationId)
    const haystack = [
      property.name,
      property.shortCode,
      property.type,
      property.description,
      property.locationId,
      location?.name,
      location?.city,
      ...(property.aliases ?? []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return haystack.includes(normalizedSearch)
  }

  const hasMatchingProperties = properties.some(matchesProperty)

  const propertyDetail = useMemo(() => {
    if (!selectedProperty) {
      return null
    }

    const propertyBookings = bookings.filter(b => b.propertyId === selectedProperty.id && b.status !== 'storniert')
    const openTasks = tasks.filter(task => task.propertyId === selectedProperty.id && !task.archivedAt)
    const activeBookings = propertyBookings.filter(booking => booking.status === 'bestaetigt' || booking.status === 'abgeschlossen')
    const totalRevenue = propertyBookings.reduce((sum, booking) => sum + booking.totalPrice, 0)
    const totalBookedBeds = propertyBookings.reduce((sum, booking) => sum + booking.bedsBooked, 0)
    const avgBookedBeds = propertyBookings.length > 0 ? Math.round((totalBookedBeds / propertyBookings.length) * 10) / 10 : 0
    const location = locations.find(item => item.id === selectedProperty.locationId)

    return {
      propertyBookings,
      openTasks,
      activeBookings,
      totalRevenue,
      avgBookedBeds,
      location,
    }
  }, [bookings, locations, selectedProperty, tasks])

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Portfolio</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {properties.length} Portfolio · {properties.filter(p => p.active).length} aktiv · {totalBeds} Betten · {locations.length} Standorte
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openNewLoc}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            <MapPin size={15} /> Standort anlegen
          </button>
          <button
            onClick={openNewProp}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus size={15} /> Objekt anlegen
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <Search size={16} className="text-slate-400" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Nach Objekt, Wohnung, Kurzcode, Alias oder Standort suchen"
            className="w-full border-0 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
          />
        </label>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          <span className="ml-3 text-slate-500 text-sm">Portfolio wird geladen…</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && properties.length === 0 && (
        <div className="bg-white rounded-xl border-2 border-dashed border-slate-200 p-12 text-center">
          <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Settings2 size={28} className="text-blue-500" />
          </div>
          <h3 className="font-semibold text-slate-900 mb-1">Noch kein Portfolio angelegt</h3>
          <p className="text-sm text-slate-500 mb-4">
            Besuche einmalig <code className="bg-slate-100 px-1 rounded">/seed</code> um das Portfolio zu laden,
            oder lege Standort + Portfolio manuell an.
          </p>
          <div className="flex gap-3 justify-center">
            <button onClick={openNewLoc} className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50">
              + Standort anlegen
            </button>
            <button onClick={openNewProp} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              + Objekt anlegen
            </button>
          </div>
        </div>
      )}

      {/* Properties grouped by location */}
      {locationsWithProps.map(loc => {
        const stats = locStats[loc.id] || { count: 0, beds: 0, revenue: 0 }
        const props = properties.filter(p => p.locationId === loc.id && matchesProperty(p))
        const collapsed = collapsedLocs.has(loc.id)

        if (props.length === 0) {
          return null
        }

        return (
          <div key={loc.id} className="mb-6">
            {/* Location header */}
            <div className="flex items-center justify-between mb-2 bg-white border border-slate-200 rounded-xl px-4 py-3">
              <button
                onClick={() => toggleCollapse(loc.id)}
                className="flex items-center gap-2 flex-1 text-left"
              >
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: loc.color }} />
                <h2 className="font-semibold text-slate-900">{loc.name}</h2>
                {loc.name !== loc.city && <span className="text-sm text-slate-500">{loc.city}</span>}
                <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                  {stats.count} Obj. · {stats.beds} Betten
                </span>
                {stats.revenue > 0 && (
                  <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                    {formatCurrency(stats.revenue)} Umsatz
                  </span>
                )}
                <span className="ml-auto text-slate-400">
                  {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                </span>
              </button>
              <div className="flex gap-1 ml-3">
                <button
                  onClick={() => openEditLoc(loc)}
                  className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  title="Standort bearbeiten"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => setDeleteConfirm({ type: 'loc', id: loc.id, name: loc.name })}
                  className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  title="Standort löschen"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {/* Properties grid (collapsible) */}
            {!collapsed && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pl-2">
                {props.map(prop => {
                  const propBookings = bookings.filter(b => b.propertyId === prop.id && b.status !== 'storniert')
                  const propTasks = tasks.filter(task => task.propertyId === prop.id && !task.archivedAt)
                  const revenue = propBookings.reduce((s, b) => s + b.totalPrice, 0)
                  return (
                    <div
                      key={prop.id}
                      onClick={() => setSelectedPropertyId(prop.id)}
                      className={`bg-white rounded-xl border p-4 hover:shadow-md transition-all cursor-pointer ${prop.active ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            {prop.shortCode && (
                              <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-mono font-bold flex-shrink-0">
                                {prop.shortCode}
                              </span>
                            )}
                            <h3 className="font-medium text-slate-900 truncate text-sm">{prop.name}</h3>
                          </div>
                          <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">
                            {typeLabel[prop.type]}
                          </span>
                        </div>
                        <button
                          onClick={() => updateProp(prop.id, { active: !prop.active })}
                          onMouseDown={event => event.stopPropagation()}
                          className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors ml-2 flex-shrink-0 ${prop.active ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                        >
                          {prop.active ? 'Aktiv' : 'Inaktiv'}
                        </button>
                      </div>

                      <div className="flex justify-between items-center mt-3 pt-2 border-t border-slate-100">
                        <span className="flex items-center gap-1 text-sm text-slate-600">
                          <Bed size={13} className="text-slate-400" />
                          {prop.beds} Betten
                        </span>
                        <div className="text-right">
                          <p className="text-xs text-slate-400">{propBookings.length} Buchg.</p>
                          {revenue > 0 && <p className="text-xs font-medium text-slate-700">{formatCurrency(revenue)}</p>}
                        </div>
                      </div>

                      <div className="mt-3 space-y-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Aufgaben</p>
                        {propTasks.slice(0, 3).map(task => {
                          const assignee = profiles.find(profile => profile.id === task.assigneeId)
                          return (
                            <div key={task.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="truncate text-xs font-semibold text-slate-800">{task.title}</p>
                                <span className="text-[10px] text-slate-400">{task.status}</span>
                              </div>
                              <p className="mt-1 truncate text-[11px] text-slate-500">
                                {task.unitLabel ? `${task.unitLabel} - ` : ''}{assignee?.fullName ?? 'Nicht zugewiesen'}
                              </p>
                            </div>
                          )
                        })}
                        {propTasks.length === 0 && (
                          <div className="rounded-xl border border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-400">
                            Keine offenen Aufgaben
                          </div>
                        )}
                        {propTasks.length > 3 && (
                          <div className="text-[11px] text-slate-400">+ {propTasks.length - 3} weitere Aufgaben</div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 mt-2 pt-2 border-t border-slate-100">
                        <button
                          onClick={event => { event.stopPropagation(); openEditProp(prop) }}
                          className="flex-1 flex items-center justify-center gap-1.5 py-1 text-xs font-medium text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <Pencil size={12} /> Bearbeiten
                        </button>
                        <button
                          onClick={event => { event.stopPropagation(); setDeleteConfirm({ type: 'prop', id: prop.id, name: prop.name }) }}
                          className="flex items-center justify-center px-2 py-1 text-xs text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  )
                })}

                {/* Add property card */}
                <button
                  onClick={openNewProp}
                  className="border-2 border-dashed border-slate-200 rounded-xl p-4 flex flex-col items-center justify-center gap-2 text-slate-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50/50 transition-all min-h-[140px]"
                >
                  <Plus size={20} />
                  <span className="text-xs font-medium">Objekt hinzufügen</span>
                </button>
              </div>
            )}
          </div>
        )
      })}

      {!loading && properties.length > 0 && normalizedSearch && !hasMatchingProperties && (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-10 text-center">
          <h3 className="text-lg font-semibold text-slate-900">Keine passenden Objekte gefunden</h3>
          <p className="mt-2 text-sm text-slate-500">
            Suche nach Objektname, Wohnung, Kurzcode, Alias oder Standort und passe den Begriff bei Bedarf an.
          </p>
        </div>
      )}

      {/* Locations without properties */}
      {locationsWithoutProps.length > 0 && !normalizedSearch && (
        <div className="mb-6">
          <h2 className="font-semibold text-slate-500 mb-2 text-xs uppercase tracking-wide">Standorte ohne Portfolio</h2>
          <div className="flex gap-3 flex-wrap">
            {locationsWithoutProps.map(loc => (
              <div key={loc.id} className="bg-white rounded-xl border border-dashed border-slate-200 p-4 flex items-center gap-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: loc.color }} />
                <div>
                  <p className="text-sm font-medium text-slate-700">{loc.name}</p>
                  {loc.name !== loc.city && <p className="text-xs text-slate-400">{loc.city}</p>}
                </div>
                <button
                  onClick={() => setPropModal({ open: true, initial: null })}
                  className="ml-2 text-xs text-blue-600 hover:underline"
                >
                  + Objekt
                </button>
                <button onClick={() => openEditLoc(loc)} className="p-1 text-slate-300 hover:text-blue-500">
                  <Pencil size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Property Modal */}
      <PropertyModal
        open={propModal.open}
        onClose={() => setPropModal({ open: false, initial: null })}
        onSave={data => propModal.initial ? updateProp(propModal.initial.id, data) : addProp(data)}
        locations={locations}
        initial={propModal.initial}
      />

      {/* Location Modal */}
      <LocationModal
        open={locModal.open}
        onClose={() => setLocModal({ open: false, initial: null })}
        onSave={data => locModal.initial ? updateLoc(locModal.initial.id, data) : addLoc(data)}
        initial={locModal.initial}
      />

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
          <div className="relative bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="font-semibold text-slate-900 mb-2">
              {deleteConfirm.type === 'prop' ? 'Objekt löschen?' : 'Standort löschen?'}
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              <strong>&quot;{deleteConfirm.name}&quot;</strong> wird dauerhaft gelöscht.
              {deleteConfirm.type === 'loc' && ' Portfolio des Standorts bleibt erhalten, verliert aber die Standortzuordnung.'}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50">
                Abbrechen
              </button>
              <button
                onClick={() => deleteConfirm.type === 'prop' ? handleDeleteProp(deleteConfirm.id) : handleDeleteLoc(deleteConfirm.id)}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
              >
                Löschen
              </button>
            </div>
          </div>
        </div>
      )}

      <PropertyDetailsModal
        open={Boolean(selectedProperty && propertyDetail)}
        property={selectedProperty}
        detail={propertyDetail}
        profiles={profiles}
        onClose={() => setSelectedPropertyId(null)}
        onEdit={openEditProp}
        onUpdateProperty={updateProp}
      />
    </div>
  )
}
