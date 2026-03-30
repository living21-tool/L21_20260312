'use client'

import { FormEvent, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useL21Workspace } from '@/lib/l21-workspace'
import { EmployeeRole } from '@/lib/l21-types'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { ArrowRight, ShieldCheck, UserPlus, Users } from 'lucide-react'

const roleOptions: { value: EmployeeRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'verwaltung', label: 'Verwaltung' },
  { value: 'hausmeister', label: 'Hausmeister' },
  { value: 'reinigung', label: 'Reinigung' },
]

const colorOptions = ['#2563eb', '#0f766e', '#9333ea', '#c2410c', '#be123c', '#0891b2']

export default function MitarbeiterPage() {
  const router = useRouter()
  const { ready, session, profile, isAdmin, profiles, createDirectConversation, reload } = useL21Workspace()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<EmployeeRole>('reinigung')
  const [avatarColor, setAvatarColor] = useState(colorOptions[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const sortedProfiles = useMemo(
    () => [...profiles].sort((a, b) => a.fullName.localeCompare(b.fullName, 'de')),
    [profiles],
  )

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!session?.access_token) {
      setError('Keine aktive Admin-Session gefunden.')
      return
    }

    setSaving(true)
    setError('')
    setSuccess('')

    const response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ fullName, email, password, role, avatarColor }),
    })

    const raw = await response.text()
    const data = (() => {
      try {
        return JSON.parse(raw) as { error?: string }
      } catch {
        return { error: raw.slice(0, 300) || 'Serverfehler ohne JSON-Antwort.' }
      }
    })()

    if (!response.ok) {
      setError(data.error ?? 'Mitarbeiter konnte nicht erstellt werden.')
      setSaving(false)
      return
    }

    setFullName('')
    setEmail('')
    setPassword('')
    setRole('reinigung')
    setAvatarColor(colorOptions[0])
    setSuccess('Mitarbeiterkonto wurde angelegt.')
    setSaving(false)
    await reload()
  }

  async function updateRole(profileId: string, nextRole: EmployeeRole) {
    await supabase.from('profiles').update({ role: nextRole }).eq('id', profileId)
    await reload()
  }

  async function toggleActive(profileId: string, isActive: boolean) {
    await supabase.from('profiles').update({ is_active: !isActive }).eq('id', profileId)
    await reload()
  }

  if (!ready) {
    return <div className="p-6 text-sm text-slate-500">Mitarbeiterverwaltung wird geladen...</div>
  }

  if (!profile) {
    return (
      <div className="p-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Mitarbeiterverwaltung</h1>
          <p className="mt-3 text-sm text-slate-500">Du musst angemeldet sein, um Mitarbeiter und Berechtigungen zu verwalten.</p>
          <Link href="/login" className="mt-5 inline-flex rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700">
            Zum Login
          </Link>
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Kein Zugriff</h1>
          <p className="mt-3 text-sm text-slate-600">Diese Verwaltung ist nur fuer Admins freigeschaltet.</p>
          <Link href="/mein-l21" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-amber-700 hover:underline">
            Zurueck zu Mein L21 <ArrowRight size={14} />
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
            <h1 className="text-2xl font-semibold text-slate-900">Mitarbeiterverwaltung</h1>
            <p className="mt-1 text-sm text-slate-500">Profile, Rollen und direkte Kommunikation zentral verwalten.</p>
          </div>
          <Link href="/mein-l21" className="inline-flex items-center gap-2 text-sm font-semibold text-sky-600 hover:underline">
            Mein L21 <ArrowRight size={14} />
          </Link>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
          <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                <UserPlus size={20} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Neues Mitarbeiterkonto</h2>
                <p className="text-sm text-slate-500">Legt gleichzeitig `auth.users` und `profiles` sauber an.</p>
              </div>
            </div>

            <form onSubmit={handleCreateUser} className="mt-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Vollstaendiger Name</label>
                <input value={fullName} onChange={event => setFullName(event.target.value)} required className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">E-Mail</label>
                <input type="email" value={email} onChange={event => setEmail(event.target.value)} required className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Startpasswort</label>
                <input type="password" value={password} onChange={event => setPassword(event.target.value)} required className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100" />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Rolle</label>
                  <select value={role} onChange={event => setRole(event.target.value as EmployeeRole)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100">
                    {roleOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Farbe</label>
                  <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 px-3 py-3">
                    {colorOptions.map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setAvatarColor(color)}
                        className={cn('h-8 w-8 rounded-full border-2 transition-transform hover:scale-105', avatarColor === color ? 'border-slate-900' : 'border-transparent')}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
              {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

              <button type="submit" disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:bg-sky-300">
                <ShieldCheck size={16} />
                {saving ? 'Lege Konto an...' : 'Mitarbeiter anlegen'}
              </button>
            </form>
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                <Users size={20} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Bestehende Mitarbeiter</h2>
                <p className="text-sm text-slate-500">Rollen pflegen, Konten aktivieren und Direktchats starten.</p>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {sortedProfiles.map(item => (
                <div key={item.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-bold text-white"
                        style={{ backgroundColor: item.avatarColor ?? '#475569' }}
                      >
                        {item.initials ?? item.fullName.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{item.fullName}</p>
                        <p className="text-xs text-slate-500">{item.email}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={item.role}
                        onChange={event => void updateRole(item.id, event.target.value as EmployeeRole)}
                        className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                      >
                        {roleOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={() => void toggleActive(item.id, item.isActive)}
                        className={cn(
                          'rounded-xl px-3 py-2 text-xs font-semibold transition-colors',
                          item.isActive ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-200 text-slate-700 hover:bg-slate-300',
                        )}
                      >
                        {item.isActive ? 'Aktiv' : 'Inaktiv'}
                      </button>
                      {item.id !== profile.id && (
                        <button
                          type="button"
                          onClick={async () => {
                            const conversationId = await createDirectConversation(item.id)
                            router.push(`/mein-l21?conversation=${conversationId}`)
                          }}
                          className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-sky-700"
                        >
                          Chat starten
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
