'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { EmployeeProfile } from './l21-types'

type AuthState = {
  loading: boolean
  session: Session | null
  profile: EmployeeProfile | null
}

function mapProfile(row: Record<string, unknown>): EmployeeProfile {
  const fullName = (row.full_name as string | null) ?? ''

  return {
    id: row.id as string,
    fullName,
    email: (row.email as string | null) ?? '',
    role: row.role as EmployeeProfile['role'],
    avatarColor: (row.avatar_color as string | null) ?? undefined,
    initials: fullName
      .split(' ')
      .map(part => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase(),
    isActive: Boolean(row.is_active),
    createdAt: (row.created_at as string | null) ?? undefined,
  }
}

export function useAuthProfile() {
  const [state, setState] = useState<AuthState>({
    loading: true,
    session: null,
    profile: null,
  })

  const loadProfile = useCallback(async (session: Session | null) => {
    if (!session?.user) {
      setState({ loading: false, session: null, profile: null })
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()

    if (error || !data) {
      setState({ loading: false, session, profile: null })
      return
    }

    setState({
      loading: false,
      session,
      profile: mapProfile(data),
    })
  }, [])

  useEffect(() => {
    let mounted = true

    async function bootstrap() {
      const { data } = await supabase.auth.getSession()
      if (mounted) {
        await loadProfile(data.session)
      }
    }

    void bootstrap()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void loadProfile(session)
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [loadProfile])

  const isAdmin = useMemo(() => state.profile?.role === 'admin', [state.profile?.role])

  return {
    ...state,
    isAdmin,
    signOut: () => supabase.auth.signOut(),
  }
}
