'use client'

import { FormEvent, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useL21Workspace } from '@/lib/l21-workspace'
import { AssignmentRoleType, EmployeeProfile, EmployeeRole, L21Task, L21TaskPriority } from '@/lib/l21-types'
import { useProperties, useLocations } from '@/lib/store'
import { supabase } from '@/lib/supabase'
import { cn, formatDate } from '@/lib/utils'
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  Home,
  MapPin,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  StickyNote,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'

// ─── Config ──────────────────────────────────────────────────────────────────

const roleOptions: { value: EmployeeRole; label: string; color: string; bg: string; dot: string }[] = [
  { value: 'admin',       label: 'Admin',       color: 'text-violet-700', bg: 'bg-violet-50',   dot: 'bg-violet-500' },
  { value: 'verwaltung',  label: 'Verwaltung',  color: 'text-sky-700',    bg: 'bg-sky-50',      dot: 'bg-sky-500' },
  { value: 'hausmeister', label: 'Hausmeister', color: 'text-amber-700',  bg: 'bg-amber-50',    dot: 'bg-amber-500' },
  { value: 'reinigung',   label: 'Reinigung',   color: 'text-emerald-700', bg: 'bg-emerald-50', dot: 'bg-emerald-500' },
]

const roleConfig = Object.fromEntries(roleOptions.map(r => [r.value, r])) as Record<EmployeeRole, typeof roleOptions[number]>

const statusMeta: Record<L21Task['status'], { label: string; cls: string; dot: string }> = {
  offen:          { label: 'Offen',          cls: 'bg-rose-50 text-rose-700',       dot: 'bg-rose-500' },
  in_bearbeitung: { label: 'In Bearbeitung', cls: 'bg-amber-50 text-amber-700',     dot: 'bg-amber-500' },
  wartet:         { label: 'Wartet',         cls: 'bg-slate-100 text-slate-600',    dot: 'bg-slate-400' },
  erledigt:       { label: 'Erledigt',       cls: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
}

const priorityMeta: Record<L21TaskPriority, { label: string; cls: string }> = {
  niedrig: { label: 'Niedrig', cls: 'text-slate-400' },
  mittel:  { label: 'Mittel',  cls: 'text-amber-500' },
  hoch:    { label: 'Hoch',    cls: 'text-rose-500 font-semibold' },
}

const assignmentRoleOptions: { value: AssignmentRoleType; label: string; color: string; bg: string }[] = [
  { value: 'hausmeister', label: 'Hausmeister', color: 'text-amber-700', bg: 'bg-amber-50' },
  { value: 'reinigung',   label: 'Reinigung',   color: 'text-emerald-700', bg: 'bg-emerald-50' },
  { value: 'verwaltung',  label: 'Verwaltung',  color: 'text-sky-700', bg: 'bg-sky-50' },
]

const assignmentRoleConfig = Object.fromEntries(assignmentRoleOptions.map(r => [r.value, r])) as Record<AssignmentRoleType, typeof assignmentRoleOptions[number]>

const colorOptions = ['#2563eb', '#0f766e', '#9333ea', '#c2410c', '#be123c', '#0891b2']

// ─── Page ────────────────────────────────────────────────────────────────────

export default function MitarbeiterPage() {
  const router = useRouter()
  const {
    ready, session, profile, isAdmin, profiles, tasks,
    updateTask, reload, createDirectConversation,
    getAssignmentsForProfile, addAssignment, removeAssignment,
  } = useL21Workspace()
  const { properties } = useProperties()
  const { locations } = useLocations()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [showNewTask, setShowNewTask] = useState(false)
  const [search, setSearch] = useState('')

  // Create employee
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newRole, setNewRole] = useState<EmployeeRole>('reinigung')
  const [avatarColor, setAvatarColor] = useState(colorOptions[0])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState('')

  // Profile edit
  const [editPhone, setEditPhone] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  // Assignment
  const [showAssignForm, setShowAssignForm] = useState(false)
  const [assignPropertyId, setAssignPropertyId] = useState('')
  const [assignRoleType, setAssignRoleType] = useState<AssignmentRoleType>('reinigung')
  const [assignNotes, setAssignNotes] = useState('')
  const [savingAssignment, setSavingAssignment] = useState(false)
  const [assignError, setAssignError] = useState('')

  // Create task
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDesc, setTaskDesc] = useState('')
  const [taskDue, setTaskDue] = useState(new Date().toISOString().slice(0, 10))
  const [taskPropId, setTaskPropId] = useState('')
  const [taskPrio, setTaskPrio] = useState<L21TaskPriority>('mittel')
  const [savingTask, setSavingTask] = useState(false)
  const [taskError, setTaskError] = useState('')

  // ─── Derived ─────────────────────────────────────────────────────────────

  const filtered = useMemo(() =>
    [...profiles]
      .filter(p => {
        if (!search) return true
        const q = search.toLowerCase()
        return p.fullName.toLowerCase().includes(q) || p.email.toLowerCase().includes(q) || p.role.includes(q)
      })
      .sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
        return a.fullName.localeCompare(b.fullName, 'de')
      }),
    [profiles, search],
  )

  const tasksByAssignee = useMemo(() => {
    const map = new Map<string, L21Task[]>()
    for (const t of tasks) {
      if (t.archivedAt) continue
      const list = map.get(t.assigneeId) ?? []
      list.push(t)
      map.set(t.assigneeId, list)
    }
    return map
  }, [tasks])

  const sel = profiles.find(p => p.id === selectedId) ?? null

  const selTasks = useMemo(() => {
    if (!selectedId) return []
    return (tasksByAssignee.get(selectedId) ?? []).sort((a, b) => {
      const order: Record<string, number> = { offen: 0, in_bearbeitung: 1, wartet: 2, erledigt: 3 }
      const d = (order[a.status] ?? 9) - (order[b.status] ?? 9)
      if (d !== 0) return d
      return (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity)
    })
  }, [selectedId, tasksByAssignee])

  const totalActive = profiles.filter(p => p.isActive).length
  const totalOpen = tasks.filter(t => !t.archivedAt && t.status !== 'erledigt').length

  // ─── Handlers ────────────────────────────────────────────────────────────

  async function handleCreateUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!session?.access_token) { setFormError('Nicht eingeloggt.'); return }
    setSaving(true); setFormError(''); setFormSuccess('')
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ fullName, email, password, role: newRole, avatarColor }),
    })
    const raw = await res.text()
    const data = (() => { try { return JSON.parse(raw) as { error?: string } } catch { return { error: raw.slice(0, 300) } } })()
    if (!res.ok) { setFormError(data.error ?? 'Fehler.'); setSaving(false); return }
    setFullName(''); setEmail(''); setPassword(''); setNewRole('reinigung'); setAvatarColor(colorOptions[0])
    setFormSuccess('Mitarbeiter angelegt!'); setSaving(false)
    await reload()
  }

  async function handleCreateTask() {
    if (!profile || !selectedId || !taskTitle.trim()) { setTaskError('Bitte Titel eingeben.'); return }
    setSavingTask(true); setTaskError('')
    const { error } = await supabase.from('tasks').insert({
      title: taskTitle.trim(), description: taskDesc, assignee_id: selectedId,
      created_by: profile.id, priority: taskPrio,
      due_at: new Date(`${taskDue}T10:00:00`).toISOString(),
      property_id: taskPropId || null,
    })
    if (error) { setTaskError(error.message); setSavingTask(false); return }
    setTaskTitle(''); setTaskDesc(''); setTaskDue(new Date().toISOString().slice(0, 10))
    setTaskPropId(''); setTaskPrio('mittel'); setSavingTask(false); setShowNewTask(false)
    await reload()
  }

  function selectEmployee(id: string | null) {
    if (!id || selectedId === id) {
      setSelectedId(null)
      setShowNewTask(false)
      setShowAssignForm(false)
      return
    }
    const emp = profiles.find(p => p.id === id)
    if (emp) {
      setEditPhone(emp.phone)
      setEditNotes(emp.notes)
    }
    setSelectedId(id)
    setShowNewTask(false)
    setShowAssignForm(false)
    setAssignError('')
  }

  async function handleSaveProfile() {
    if (!selectedId) return
    setSavingProfile(true)
    await supabase.from('profiles').update({ phone: editPhone, notes: editNotes }).eq('id', selectedId)
    await reload()
    setSavingProfile(false)
  }

  async function handleAddAssignment() {
    if (!selectedId || !assignPropertyId) { setAssignError('Bitte Objekt waehlen.'); return }
    setSavingAssignment(true); setAssignError('')
    try {
      await addAssignment(selectedId, assignPropertyId, assignRoleType, assignNotes)
      setAssignPropertyId(''); setAssignNotes(''); setShowAssignForm(false)
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : 'Fehler beim Zuweisen.')
    } finally {
      setSavingAssignment(false)
    }
  }

  async function handleRemoveAssignment(assignmentId: string) {
    await removeAssignment(assignmentId)
  }

  function getPropName(id?: string) { return id ? properties.find(p => p.id === id)?.name ?? null : null }
  function getLocName(propId?: string) {
    if (!propId) return null
    const p = properties.find(x => x.id === propId)
    return p ? locations.find(l => l.id === p.locationId)?.name ?? null : null
  }

  // ─── Guards ──────────────────────────────────────────────────────────────

  if (!ready) return <div className="flex h-[60vh] items-center justify-center"><span className="text-sm text-slate-400">Wird geladen...</span></div>

  if (!profile) return (
    <div className="p-6"><div className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <Users size={36} className="mx-auto text-slate-300" />
      <h1 className="mt-3 text-xl font-semibold text-slate-900">Profil nicht gefunden</h1>
      <p className="mt-2 text-sm text-slate-500">Dein Benutzerkonto hat noch kein Mitarbeiterprofil.</p>
    </div></div>
  )

  if (!isAdmin) return (
    <div className="p-6"><div className="mx-auto max-w-md rounded-3xl border border-amber-200 bg-amber-50 p-8 text-center shadow-sm">
      <ShieldCheck size={36} className="mx-auto text-amber-400" />
      <h1 className="mt-3 text-xl font-semibold text-slate-900">Kein Zugriff</h1>
      <p className="mt-2 text-sm text-slate-600">Nur fuer Admins.</p>
      <Link href="/mein-l21" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-amber-700 hover:underline">Mein L21 <ArrowRight size={14} /></Link>
    </div></div>
  )

  // ─── Main ────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="p-6">
        <div className="mx-auto max-w-5xl space-y-5">

          {/* Header */}
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Mitarbeiter</h1>
              <p className="text-sm text-slate-500">Team verwalten und Aufgaben zuweisen.</p>
            </div>
            <button onClick={() => setShowCreateForm(v => !v)}
              className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-700">
              <UserPlus size={15} /> Neuer Mitarbeiter
            </button>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            <KpiCard label="Aktiv" value={totalActive} />
            <KpiCard label="Offene Aufgaben" value={totalOpen} valueColor="text-rose-600" />
            {roleOptions.map(r => (
              <KpiCard key={r.value} label={r.label} value={profiles.filter(p => p.isActive && p.role === r.value).length} dot={r.dot} />
            ))}
          </div>

          {/* Create form */}
          {showCreateForm && (
            <div className="rounded-2xl border border-sky-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Neues Mitarbeiterkonto</h2>
                <button onClick={() => setShowCreateForm(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={16} /></button>
              </div>
              <form onSubmit={handleCreateUser} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Input label="Name" value={fullName} onChange={setFullName} required placeholder="Max Mustermann" />
                <Input label="E-Mail" value={email} onChange={setEmail} required placeholder="max@firma.de" type="email" />
                <Input label="Passwort" value={password} onChange={setPassword} required type="password" />
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Rolle</label>
                  <select value={newRole} onChange={e => setNewRole(e.target.value as EmployeeRole)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-300">
                    {roleOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Farbe</label>
                  <div className="flex gap-1.5 rounded-xl border border-slate-200 px-3 py-2">
                    {colorOptions.map(c => (
                      <button key={c} type="button" onClick={() => setAvatarColor(c)}
                        className={cn('h-6 w-6 rounded-full border-2', avatarColor === c ? 'border-slate-900 scale-110' : 'border-transparent')}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
                <div className="flex items-end">
                  <button type="submit" disabled={saving}
                    className="w-full rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:bg-sky-300">
                    {saving ? 'Wird angelegt...' : 'Anlegen'}
                  </button>
                </div>
                {formError && <p className="col-span-full text-sm text-rose-600">{formError}</p>}
                {formSuccess && <p className="col-span-full text-sm text-emerald-600">{formSuccess}</p>}
              </form>
            </div>
          )}

          {/* Search */}
          <div className="relative max-w-xs">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Suchen..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100" />
          </div>

          {/* Employee List */}
          <div className="space-y-2">
            {filtered.map(emp => {
              const empTasks = tasksByAssignee.get(emp.id) ?? []
              const openCnt = empTasks.filter(t => t.status !== 'erledigt').length
              const doneCnt = empTasks.filter(t => t.status === 'erledigt').length
              const rc = roleConfig[emp.role]
              const active = selectedId === emp.id

              return (
                <button key={emp.id} onClick={() => selectEmployee(active ? null : emp.id)}
                  className={cn(
                    'flex w-full items-center gap-4 rounded-2xl border bg-white px-4 py-3 text-left transition-all hover:shadow-sm',
                    active ? 'border-sky-400 ring-2 ring-sky-100 shadow-sm' : 'border-slate-200 hover:border-slate-300',
                    !emp.isActive && 'opacity-50',
                  )}>
                  {/* Avatar */}
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white"
                    style={{ backgroundColor: emp.avatarColor ?? '#475569' }}>
                    {emp.initials ?? emp.fullName.slice(0, 2).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">{emp.fullName}</span>
                      {!emp.isActive && <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">Inaktiv</span>}
                    </div>
                    <span className="text-xs text-slate-500">{emp.email}</span>
                  </div>

                  {/* Role badge */}
                  <span className={cn('hidden shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold sm:inline-flex', rc.bg, rc.color)}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', rc.dot)} />
                    {rc.label}
                  </span>

                  {/* Task stats */}
                  <div className="hidden shrink-0 items-center gap-3 text-xs text-slate-500 md:flex">
                    <span className="flex items-center gap-1"><Clock size={12} className="text-slate-400" />{openCnt} offen</span>
                    <span className="flex items-center gap-1"><CheckCircle2 size={12} className="text-emerald-400" />{doneCnt} erledigt</span>
                  </div>

                  {/* Open count badge (mobile) */}
                  {openCnt > 0 && (
                    <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-rose-100 px-1.5 text-[11px] font-bold text-rose-700 md:hidden">
                      {openCnt}
                    </span>
                  )}
                </button>
              )
            })}

            {filtered.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-10 text-center">
                <Users size={28} className="mx-auto text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">Keine Mitarbeiter gefunden.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Detail Modal ─────────────────────────────────────────────── */}
      {sel && (() => {
        const selAssignments = getAssignmentsForProfile(sel.id)
        const assignedPropertyIds = new Set(selAssignments.map(a => a.propertyId))
        const availableProperties = properties.filter(p => p.active && !assignedPropertyIds.has(p.id))

        return (
          <>
            <div className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px]" onClick={() => selectEmployee(null)} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="relative max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">

                {/* ─── Header: Kompakt mit Kontaktinfos ─── */}
                <div className="border-b border-slate-100 px-6 py-4">
                  <div className="flex items-center justify-between gap-4">
                    {/* Links: Avatar + Name + Badges */}
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-white"
                        style={{ backgroundColor: sel.avatarColor ?? '#475569' }}>
                        {sel.initials ?? sel.fullName.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-slate-900">{sel.fullName}</h2>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold', roleConfig[sel.role].bg, roleConfig[sel.role].color)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', roleConfig[sel.role].dot)} />
                            {roleConfig[sel.role].label}
                          </span>
                          <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-semibold', sel.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                            {sel.isActive ? 'Aktiv' : 'Inaktiv'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Mitte: Kontakt-Inline */}
                    <div className="hidden flex-1 items-center gap-4 px-4 xl:flex">
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <Mail size={12} className="text-slate-400" />
                        <span>{sel.email}</span>
                      </div>
                      {sel.phone && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <Phone size={12} className="text-slate-400" />
                          <span>{sel.phone}</span>
                        </div>
                      )}
                    </div>

                    {/* Rechts: Actions */}
                    <div className="flex shrink-0 items-center gap-2">
                      <select value={sel.role}
                        onChange={async e => { await supabase.from('profiles').update({ role: e.target.value }).eq('id', sel.id); await reload() }}
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-sky-300">
                        {roleOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <button onClick={async () => { await supabase.from('profiles').update({ is_active: !sel.isActive }).eq('id', sel.id); await reload() }}
                        className={cn('rounded-lg px-2.5 py-1.5 text-xs font-semibold', sel.isActive ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                        {sel.isActive ? 'Deaktivieren' : 'Aktivieren'}
                      </button>
                      {sel.id !== profile.id && (
                        <button onClick={async () => { const id = await createDirectConversation(sel.id); router.push(`/mein-l21?conversation=${id}`) }}
                          className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
                          <MessageSquare size={11} /> Chat
                        </button>
                      )}
                      <button onClick={() => selectEmployee(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X size={16} /></button>
                    </div>
                  </div>
                </div>

                {/* ─── Scrollbarer Inhalt ─── */}
                <div className="max-h-[calc(92vh-80px)] overflow-y-auto">

                  {/* ─── Kontakt + Notizen (kompakte Zeile) ─── */}
                  <div className="border-b border-slate-100 px-6 py-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr]">
                      <div>
                        <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Telefon</label>
                        <input value={editPhone} onChange={e => setEditPhone(e.target.value)}
                          placeholder="+49 170 ..."
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-sky-300" />
                      </div>
                      <div className="flex items-end">
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 xl:hidden">
                          <Mail size={12} className="text-slate-400" /> {sel.email}
                        </div>
                      </div>
                      <div>
                        <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Notizen</label>
                        <input value={editNotes} onChange={e => setEditNotes(e.target.value)}
                          placeholder="z.B. Arbeitet nur Di-Fr, hat Schluessel fuer BBS6"
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-sky-300" />
                      </div>
                    </div>
                    {(editPhone !== sel.phone || editNotes !== sel.notes) && (
                      <div className="mt-2 flex justify-end">
                        <button onClick={() => void handleSaveProfile()} disabled={savingProfile}
                          className="rounded-lg bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-sky-700 disabled:bg-sky-300">
                          {savingProfile ? 'Speichert...' : 'Speichern'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* ─── Zugewiesene Objekte (Karten-Grid) ─── */}
                  <div className="border-b border-slate-100 px-6 py-4">
                    <div className="flex items-center justify-between">
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <Home size={14} className="text-slate-400" />
                        Zugewiesene Objekte
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{selAssignments.length}</span>
                      </h3>
                      <button onClick={() => setShowAssignForm(v => !v)}
                        className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-700">
                        <Plus size={12} /> Zuweisen
                      </button>
                    </div>

                    {showAssignForm && (
                      <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/40 p-3.5">
                        <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
                          <select value={assignPropertyId} onChange={e => setAssignPropertyId(e.target.value)}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-sky-300">
                            <option value="">Objekt waehlen...</option>
                            {availableProperties.map(p => (
                              <option key={p.id} value={p.id}>{p.name} ({locations.find(l => l.id === p.locationId)?.name ?? ''})</option>
                            ))}
                          </select>
                          <div className="flex gap-1">
                            {assignmentRoleOptions.map(r => (
                              <button key={r.value} type="button" onClick={() => setAssignRoleType(r.value)}
                                className={cn('rounded-md border px-2 py-1.5 text-[11px] font-semibold',
                                  assignRoleType === r.value ? 'border-sky-400 bg-sky-100 text-sky-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50')}>
                                {r.label}
                              </button>
                            ))}
                          </div>
                          <input value={assignNotes} onChange={e => setAssignNotes(e.target.value)}
                            placeholder="Notiz (optional)"
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-sky-300" />
                          <div className="flex gap-1.5">
                            <button onClick={() => void handleAddAssignment()} disabled={savingAssignment}
                              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:bg-sky-300">
                              {savingAssignment ? '...' : 'Speichern'}
                            </button>
                            <button onClick={() => { setShowAssignForm(false); setAssignError('') }}
                              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50">
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                        {assignError && <p className="mt-2 text-xs text-rose-600">{assignError}</p>}
                      </div>
                    )}

                    {selAssignments.length === 0 && !showAssignForm ? (
                      <div className="mt-3 rounded-xl border border-dashed border-slate-200 py-6 text-center">
                        <Home size={18} className="mx-auto text-slate-300" />
                        <p className="mt-1.5 text-xs text-slate-400">Noch keinem Objekt zugewiesen.</p>
                      </div>
                    ) : (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {selAssignments.map(a => {
                          const prop = properties.find(p => p.id === a.propertyId)
                          const loc = prop ? locations.find(l => l.id === prop.locationId) : null
                          const rc = assignmentRoleConfig[a.roleType]
                          return (
                            <div key={a.id} className="group relative rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 transition-colors hover:border-slate-300">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-slate-900">{prop?.name ?? 'Unbekannt'}</p>
                                  <div className="mt-1 flex items-center gap-1.5">
                                    <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold', rc.bg, rc.color)}>
                                      {rc.label}
                                    </span>
                                    {loc && (
                                      <span className="flex items-center gap-0.5 text-[10px] text-slate-400">
                                        <MapPin size={9} />{loc.name}
                                      </span>
                                    )}
                                  </div>
                                  {a.notes && <p className="mt-1 truncate text-[10px] text-slate-400">{a.notes}</p>}
                                </div>
                                <button onClick={() => void handleRemoveAssignment(a.id)}
                                  className="shrink-0 rounded-md p-1 text-slate-300 opacity-0 transition-all hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100">
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* ─── Aufgaben (volle Breite) ─── */}
                  <div className="px-6 py-4">
                    <div className="flex items-center justify-between">
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <Clock size={14} className="text-slate-400" />
                        Aufgaben
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{selTasks.length}</span>
                        {selTasks.filter(t => t.status !== 'erledigt').length > 0 && (
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-600">
                            {selTasks.filter(t => t.status !== 'erledigt').length} offen
                          </span>
                        )}
                      </h3>
                      <button onClick={() => setShowNewTask(v => !v)}
                        className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-700">
                        <Plus size={12} /> Neue Aufgabe
                      </button>
                    </div>

                    {showNewTask && (
                      <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/40 p-3.5">
                        <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
                          <input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="z.B. Reinigung nach Abreise" autoFocus
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-300" />
                          <div className="grid grid-cols-2 gap-2">
                            <select value={taskPropId} onChange={e => setTaskPropId(e.target.value)}
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-sky-300">
                              <option value="">Kein Objekt</option>
                              {properties.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                            <input type="date" value={taskDue} onChange={e => setTaskDue(e.target.value)}
                              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-sky-300" />
                          </div>
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                          <textarea value={taskDesc} onChange={e => setTaskDesc(e.target.value)} placeholder="Beschreibung (optional)" rows={1}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-300" />
                          <div className="flex gap-1">
                            {(['niedrig', 'mittel', 'hoch'] as L21TaskPriority[]).map(p => (
                              <button key={p} type="button" onClick={() => setTaskPrio(p)}
                                className={cn('rounded-md border px-2.5 py-1.5 text-[11px] font-semibold',
                                  taskPrio === p ? 'border-sky-400 bg-sky-100 text-sky-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50')}>
                                {priorityMeta[p].label}
                              </button>
                            ))}
                          </div>
                          <div className="flex gap-1.5">
                            <button onClick={() => void handleCreateTask()} disabled={savingTask}
                              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:bg-sky-300">
                              {savingTask ? '...' : 'Zuweisen'}
                            </button>
                            <button onClick={() => { setShowNewTask(false); setTaskError('') }}
                              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50">
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                        {taskError && <p className="mt-2 text-xs text-rose-600">{taskError}</p>}
                      </div>
                    )}

                    <div className="mt-3 space-y-2">
                      {selTasks.length === 0 && !showNewTask && (
                        <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center">
                          <Sparkles size={18} className="mx-auto text-slate-300" />
                          <p className="mt-1.5 text-xs text-slate-400">Keine Aufgaben zugewiesen.</p>
                        </div>
                      )}
                      {selTasks.map(task => {
                        const st = statusMeta[task.status]
                        const propName = getPropName(task.propertyId)
                        const locName = getLocName(task.propertyId)

                        return (
                          <div key={task.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
                            {/* Status-Dot */}
                            <span className={cn('h-2 w-2 shrink-0 rounded-full', st.dot)} />
                            {/* Title + Meta */}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-slate-900">
                                {task.title}
                                {task.bookingId && <span className="ml-1.5 inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600">Auto</span>}
                              </p>
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                                {task.dueDate && <span className="flex items-center gap-1"><Calendar size={10} />{formatDate(task.dueDate)}</span>}
                                {propName && <span className="flex items-center gap-1"><Home size={10} />{propName}</span>}
                                {locName && <span className="flex items-center gap-1"><MapPin size={10} />{locName}</span>}
                              </div>
                            </div>
                            {/* Priority */}
                            <span className={cn('shrink-0 text-[10px] font-semibold', priorityMeta[task.priority].cls)}>
                              {priorityMeta[task.priority].label}
                            </span>
                            {/* Quick Status */}
                            <div className="flex shrink-0 gap-0.5">
                              {(['offen', 'in_bearbeitung', 'erledigt'] as L21Task['status'][]).map(s => (
                                <button key={s} onClick={() => void updateTask(task.id, { status: s })}
                                  className={cn('rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors',
                                    task.status === s ? statusMeta[s].cls : 'bg-slate-50 text-slate-400 hover:bg-slate-100')}>
                                  {statusMeta[s].label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </>
        )
      })()}
    </>
  )
}

// ─── Small Components ────────────────────────────────────────────────────────

function KpiCard({ label, value, valueColor, dot }: { label: string; value: number; valueColor?: string; dot?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <div className="mt-0.5 flex items-center gap-1.5">
        {dot && <span className={cn('h-2 w-2 rounded-full', dot)} />}
        <span className={cn('text-xl font-bold', valueColor ?? 'text-slate-900')}>{value}</span>
      </div>
    </div>
  )
}

function Input({ label, value, onChange, type, placeholder, required }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; required?: boolean
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      <input type={type ?? 'text'} value={value} onChange={e => onChange(e.target.value)} required={required} placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100" />
    </div>
  )
}
