import { supabase } from '@/lib/supabase'
import type {
  TournamentSettings,
  Series,
} from '@/types/domain'
import type {
  TournamentSettingsInsert,
  TournamentSettingsUpdate,
  SeriesInsert,
  SeriesUpdate,
} from '@/types/database'

// ─── Mappers ──────────────────────────────────────────────────────────────

function mapTournamentSettings(row: {
  id: string
  name: string
  location: string
  start_date: string
  end_date: string
  number_of_weeks: number
  time_slots: string[]
  number_of_courts: number
  match_duration_minutes: number
  day_start_time: string
  day_end_time: string
  playable_days: number[]
  registration_open: boolean
  registration_deadline: string | null
  phase: TournamentSettings['phase']
}): TournamentSettings {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    startDate: row.start_date,
    endDate: row.end_date,
    numberOfWeeks: row.number_of_weeks,
    timeSlots: row.time_slots,
    numberOfCourts: row.number_of_courts,
    matchDurationMinutes: row.match_duration_minutes,
    dayStartTime: row.day_start_time,
    dayEndTime: row.day_end_time,
    playableDays: row.playable_days,
    registrationOpen: row.registration_open,
    registrationDeadline: row.registration_deadline,
    phase: row.phase,
  }
}

function mapSeries(row: {
  id: string
  tournament_id: string
  name: string
  order: number
  max_teams: number
}): Series {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    name: row.name,
    order: row.order,
    maxTeams: row.max_teams,
  }
}

// ─── Tournament Settings ───────────────────────────────────────────────────

/** Fetches the first (and only) tournament settings record. */
export async function fetchTournamentSettings(): Promise<TournamentSettings | null> {
  const { data, error } = await supabase
    .from('tournament_settings')
    .select('*')
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data ? mapTournamentSettings(data) : null
}

/** Creates new tournament settings. */
export async function createTournamentSettings(
  payload: TournamentSettingsInsert,
): Promise<TournamentSettings> {
  const { data, error } = await supabase
    .from('tournament_settings')
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return mapTournamentSettings(data)
}

/** Updates existing tournament settings. */
export async function updateTournamentSettings(
  id: string,
  payload: TournamentSettingsUpdate,
): Promise<TournamentSettings> {
  const { data, error } = await supabase
    .from('tournament_settings')
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return mapTournamentSettings(data)
}

// ─── Series ───────────────────────────────────────────────────────────────

/** Fetches all series for a tournament, ordered by their display order. */
export async function fetchSeries(tournamentId: string): Promise<Series[]> {
  const { data, error } = await supabase
    .from('series')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('order', { ascending: true })

  if (error) throw error
  return (data ?? []).map(mapSeries)
}

/** Replaces all series for a tournament (delete + re-insert). */
export async function replaceSeries(
  tournamentId: string,
  series: Array<Omit<SeriesInsert, 'tournament_id'>>,
): Promise<Series[]> {
  const { error: delError } = await supabase
    .from('series')
    .delete()
    .eq('tournament_id', tournamentId)

  if (delError) throw delError

  if (series.length === 0) return []

  const rows: SeriesInsert[] = series.map((s) => ({
    ...s,
    tournament_id: tournamentId,
  }))

  const { data, error } = await supabase
    .from('series')
    .insert(rows)
    .select()

  if (error) throw error
  return (data ?? []).map(mapSeries)
}

/** Updates a single series entry. */
export async function updateSeries(
  id: string,
  payload: SeriesUpdate,
): Promise<Series> {
  const { data, error } = await supabase
    .from('series')
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return mapSeries(data)
}
