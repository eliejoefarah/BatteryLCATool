import { createClient, Session } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'

export const PASSWORD_SETUP_KEY = 'password_setup'

// supabase-js reads the session from the URL fragment and then clears it when
// the client starts, so note invite and password-reset links before creating
// it. The app then asks these users to choose a password (SetPasswordDialog).
const linkType = new URLSearchParams(window.location.hash.slice(1)).get('type')
if (linkType === 'invite' || linkType === 'recovery') {
  window.sessionStorage.setItem(PASSWORD_SETUP_KEY, linkType)
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: window.sessionStorage,  // clears when browser/tab is closed
  },
})

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  return data.session
}
