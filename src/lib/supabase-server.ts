import 'server-only'

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error('Supabase environment variables are missing for server-side availability checks.')
}

export const supabaseServer = createClient(url, key, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})
