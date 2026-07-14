import { supabase } from '@/lib/supabase'
import type { Reservation } from '@/types/domain'
import type { ReservationInsert } from '@/types/database'

function mapReservation(row: {
  id: string
  court_id: string
  user_name: string
  user_email: string | null
  user_phone: string | null
  date: string
  start_time: string
  end_time: string
}): Reservation {
  return {
    id: row.id,
    courtId: row.court_id,
    userName: row.user_name,
    userEmail: row.user_email,
    userPhone: row.user_phone,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
  }
}

/** Fetches reservations for a given date range. */
export async function fetchReservations(
  startDate: string,
  endDate: string,
): Promise<Reservation[]> {
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })
    .order('start_time', { ascending: true })

  if (error) throw error
  return (data ?? []).map(mapReservation)
}

/** Creates a new reservation. */
export async function createReservation(
  payload: ReservationInsert,
): Promise<Reservation> {
  const { data, error } = await supabase
    .from('reservations')
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return mapReservation(data)
}

/** Deletes a reservation. */
export async function deleteReservation(id: string): Promise<void> {
  const { error } = await supabase.from('reservations').delete().eq('id', id)
  if (error) throw error
}
