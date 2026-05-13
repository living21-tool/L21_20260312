'use client'

import { FormEvent, useMemo, useState } from 'react'
import Link from 'next/link'
import { useL21Workspace } from '@/lib/l21-workspace'
import { L21TaskPriority, L21TaskStatus } from '@/lib/l21-types'
import { useLocations, useProperties } from '@/lib/store'
import { supabase } from '@/lib/supabase'
import { cn, formatDate } from '@/lib/utils'
import { ArrowRight, ClipboardList, PlusSquare } from 'lucide-react'

const priorities: { value: L21TaskPriority; label: string }[] = [
  { value: 'niedrig', label: 'Niedrig' },
  { value: 'mittel', label: 'Mittel' },
  { value: 'hoch', label: 'Hoch' },
]

const statuses: Record<L21TaskStatus, string> = {
  offen: 'bg-rose-100 text-rose-700',
  in_bearbeitung: 'bg-amber-100 text-amber-700',
  wartet: 'bg-slate-200 text-slate-700',
  erledigt: 'bg-emerald-100 text-emerald-700',
}

export default function AufgabenPage() {
  const { ready, profile, isAdmin, tasks, profiles, reload } = useL21Workspace()
  const { properties } = useProperties()
  const { locations } = useLocations()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [priority, setPriority] = useState<L21TaskPriority>('mittel')
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10))
  const [propertyId, setPropertyId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [unitLabel, setUnitLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const visibleTasks = useMemo(
    () => isAdmin ? tasks : tasks.filter(task => task.assigneeId === profile?.id),
    [isAdmin, profile?.id, tasks],
  )

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!profile) {
      return
    }

    setSaving(true)
    setError('')

    const { error: insertError } = await supabase.from('tasks').insert({
      title,
      description,
      assignee_id: assigneeId,
      created_by: profile.id,
      priority,
      due_at: new Date(`${dueDate}T10:00:00`).toISOString(),
      property_id: propertyId || null,
      location_id: locationId || null,
      unit_label: unitLabel || null,
    })

    if (insertError) {
      setError(insertError.message)
      setSaving(false)
      return
    }

    setTitle('')
    setDescription('')
    setAssigneeId('')
    setPriority('mittel')
    setDueDate(new Date().toISOString().slice(0, 10))
    setPropertyId('')
    setLocationId('')
    setUnitLabel('')
    setSaving(false)
    await reload()
  }

  if (!ready) {
    return <div className="p-6 text-sm text-slate-500">Aufgaben werden geladen...</div>
  }

  if (!profile) {
    return (
      <div className="p-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Aufgaben</h1>
          <p className="mt-3 text-sm text-slate-500">Bitte melde dich an, um Aufgaben zu sehen oder zu erstellen.</p>
          <Link href="/login" className="mt-5 inline-flex rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700">
            Zum Login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Aufgaben</h1>
            <p className="mt-1 text-sm text-slate-500">Zentrale Aufgabensteuerung fuer Verwaltung, Hausmeister und Reinigung.</p>
          </div>
          <Link href="/mein-l21" className="inline-flex items-center gap-2 text-sm font-semibold text-sky-600 hover:underline">
            Mein L21 <ArrowRight size={14} />
          </Link>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.84fr_1.16fr]">
          {isAdmin && (
            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                  <PlusSquare size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Neue Aufgabe</h2>
                  <p className="text-sm text-slate-500">Beim Erstellen wird automatisch ein Aufgabenchat in Supabase erzeugt.</p>
                </div>
              </div>

              <form onSubmit={createTask} className="mt-6 space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Titel</label>
                  <input value={title} onChange={event => setTitle(event.target.value)} required className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Beschreibung</label>
                  <textarea value={description} onChange={event => setDescription(event.target.value)} rows={4} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100" />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Mitarbeiter</label>
                    <select value={assigneeId} onChange={event => setAssigneeId(event.target.value)} required className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100">
                      <option value="">Bitte waehlen</option>
                      {profiles.filter(item => item.isActive).map(item => <option key={item.id} value={item.id}>{item.fullName} · {item.role}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Prioritaet</label>
                    <select value={priority} onChange={event => setPriority(event.target.value as L21TaskPriority)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100">
                      {priorities.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Faellig am</label>
                    <input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} required className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Standort</label>
                    <select value={locationId} onChange={event => setLocationId(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100">
                      <option value="">Optional</option>
                      {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">Objekt</label>
                    <select value={propertyId} onChange={event => setPropertyId(event.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100">
                      <option value="">Optional</option>
                      {properties.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Einheit / Wohnung</label>
                  <input value={unitLabel} onChange={event => setUnitLabel(event.target.value)} placeholder="z. B. Wohnung 3" className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100" />
                </div>

                {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

                <button type="submit" disabled={saving} className="inline-flex w-full items-center justify-center rounded-2xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:bg-sky-300">
                  {saving ? 'Speichere Aufgabe...' : 'Aufgabe erstellen'}
                </button>
              </form>
            </section>
          )}

          <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                <ClipboardList size={20} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{isAdmin ? 'Alle Aufgaben' : 'Meine Aufgaben'}</h2>
                <p className="text-sm text-slate-500">Live-Daten aus Supabase, sortiert nach Erstellungszeit.</p>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {visibleTasks.map(task => {
                const assignee = profiles.find(item => item.id === task.assigneeId)
                const property = properties.find(item => item.id === task.propertyId)
                const location = locations.find(item => item.id === (task.locationId ?? property?.locationId))

                return (
                  <div key={task.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-slate-900">{task.title}</h3>
                          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', statuses[task.status])}>
                            {task.status}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">{task.description}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                          {location && <span>{location.name}</span>}
                          {property && <span>· {property.name}</span>}
                          {task.unitLabel && <span>· {task.unitLabel}</span>}
                          <span>· Faellig {formatDate(task.dueDate)}</span>
                          {assignee && <span>· {assignee.fullName}</span>}
                        </div>
                      </div>
                      {task.conversationId && (
                        <Link href={`/mein-l21?conversation=${task.conversationId}`} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-sky-200 hover:text-sky-700">
                          Im Chat oeffnen
                        </Link>
                      )}
                    </div>
                  </div>
                )
              })}
              {visibleTasks.length === 0 && <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">Noch keine Aufgaben vorhanden.</div>}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
