import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import { PASSWORD_SETUP_KEY, supabase } from '../lib/supabase'

export type PasswordSetup = 'invite' | 'recovery' | null

interface AuthState {
  user: User | null
  role: string | null
  loading: boolean
  /** Set when the user arrived from an invite or password-reset link. */
  passwordSetup: PasswordSetup
}

function initialPasswordSetup(): PasswordSetup {
  try {
    const v = window.sessionStorage.getItem(PASSWORD_SETUP_KEY)
    return v === 'invite' || v === 'recovery' ? v : null
  } catch {
    return null
  }
}

export const useAuthStore = create<AuthState>()(() => ({
  user: null,
  role: null,
  loading: true,
  passwordSetup: initialPasswordSetup(),
}))

/** Close the "choose a password" step (saved, skipped or cancelled). */
export function finishPasswordSetup() {
  try {
    window.sessionStorage.removeItem(PASSWORD_SETUP_KEY)
  } catch {
    // storage unavailable: the in-memory state below is enough
  }
  useAuthStore.setState({ passwordSetup: null })
}

async function fetchRole(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('app_user')
    .select('role')
    .eq('user_id', userId)
    .single()
  return data?.role ?? null
}

// Subscribe to Supabase auth state changes — call once at app startup.
// Relies solely on onAuthStateChange; the INITIAL_SESSION event is the
// definitive first state (includes sessions detected from magic-link URL hash).
export function initAuthListener() {
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      const { id } = session.user
      // Defer the data fetch so it runs after the auth lock is released.
      // Calling supabase.from() inside onAuthStateChange deadlocks because
      // the callback holds the session lock while getSession() tries to acquire it.
      setTimeout(async () => {
        const role = await fetchRole(id)
        useAuthStore.setState({ user: session.user!, role, loading: false })
      }, 0)
    } else {
      useAuthStore.setState({ user: null, role: null, loading: false })
    }
  })
}
