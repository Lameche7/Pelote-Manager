import { supabase } from '@/lib/supabase'
import type { User, Session } from '@supabase/supabase-js'

/** Returns the current session. */
export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  return data.session
}

/** Returns the currently authenticated user. */
export async function getUser(): Promise<User | null> {
  const { data } = await supabase.auth.getUser()
  return data.user
}

/** Signs in with email and password. */
export async function signIn(email: string, password: string): Promise<User> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })
  if (error) throw error
  return data.user
}

/** Signs out the current user. */
export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

/** Subscribes to auth state changes. */
export function onAuthStateChange(
  callback: (user: User | null) => void,
): { unsubscribe: () => void } {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null)
  })
  return { unsubscribe: data.subscription.unsubscribe }
}
