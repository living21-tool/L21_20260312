'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { LockKeyhole, Mail } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }

    router.push('/mein-l21')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),linear-gradient(180deg,#eff6ff_0%,#f8fafc_100%)] p-6">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_32px_90px_rgba(15,23,42,0.12)] lg:grid-cols-[1fr_0.9fr]">
        <div className="bg-slate-950 px-8 py-10 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-300">L21 Workspace</p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight">Ein Login fuer Verwaltung, Aufgaben und Teamkommunikation.</h1>
          <p className="mt-5 max-w-lg text-sm leading-7 text-slate-300">
            Melde dich mit deinem Mitarbeiterkonto an, um Aufgaben zu sehen, im Chat zu kommunizieren und als Admin Mitarbeiter sowie Rechte zu verwalten.
          </p>
          <div className="mt-10 grid gap-4 text-sm text-slate-300">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">Aufgaben mit Verantwortlichen, Status und Faelligkeit</div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">Direktchats und Aufgabenkommunikation in Echtzeit</div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">Admin-Verwaltung fuer Profile, Rollen und Mitarbeiterzugriffe</div>
          </div>
        </div>

        <div className="px-8 py-10">
          <div className="mx-auto max-w-md">
            <h2 className="text-2xl font-semibold text-slate-900">Anmelden</h2>
            <p className="mt-2 text-sm text-slate-500">Verwende dein von einem Admin angelegtes Mitarbeiterkonto.</p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">E-Mail</span>
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 focus-within:border-sky-300 focus-within:ring-2 focus-within:ring-sky-100">
                  <Mail size={18} className="text-slate-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                    className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                    placeholder="name@l21.de"
                    required
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Passwort</span>
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 focus-within:border-sky-300 focus-within:ring-2 focus-within:ring-sky-100">
                  <LockKeyhole size={18} className="text-slate-400" />
                  <input
                    type="password"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                    placeholder="••••••••"
                    required
                  />
                </div>
              </label>

              {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

              <button
                type="submit"
                disabled={loading}
                className="inline-flex w-full items-center justify-center rounded-2xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-300"
              >
                {loading ? 'Melde an...' : 'Anmelden'}
              </button>
            </form>

            <p className="mt-6 text-sm text-slate-500">
              Noch kein Konto? Ein Admin muss es zuerst in der Mitarbeiterverwaltung anlegen. Bis dahin bleiben die bisherigen Bereiche der App unveraendert erreichbar.
            </p>

            <Link href="/" className="mt-8 inline-flex text-sm font-semibold text-slate-600 hover:text-slate-900">
              Zurueck zum Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
