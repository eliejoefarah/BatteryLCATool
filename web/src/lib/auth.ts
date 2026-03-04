import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Database } from '../types/database.types'

type AppUserRole = Database['public']['Tables']['app_user']['Row']['role']

export interface AuthUser {
  user: User
  role: AppUserRole | null
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

async function fetchRole(userId: string): Promise<AppUserRole | null> {
  const { data } = await supabase
    .from('app_user')
    .select('role')
    .eq('user_id', userId)
    .single()
  return data?.role ?? null
}

export function onAuthStateChange(callback: (authUser: AuthUser | null) => void) {
  return supabase.auth.onAuthStateChange(async (_event, session) => {
    if (!session?.user) {
      callback(null)
      return
    }
    const role = await fetchRole(session.user.id)
    callback({ user: session.user, role })
  })
}
