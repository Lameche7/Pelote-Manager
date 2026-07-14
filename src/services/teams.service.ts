import { supabase } from '@/lib/supabase'
import type { Team, TeamAvailability } from '@/types/domain'
import type { TeamInsert, TeamUpdate, TeamAvailabilityInsert } from '@/types/database'

// ─── Mappers ──────────────────────────────────────────────────────────────

function mapAvailability(row: {
  id: string
  team_id: string
  day_of_week: number
  start_time: string
  end_time: string
}): TeamAvailability {
  return {
    id: row.id,
    teamId: row.team_id,
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
  }
}

function mapTeam(
  row: {
    id: string
    tournament_id: string
    series_id: string
    player1_name: string
    player2_name: string
    phone: string | null
    email: string | null
  },
  availabilities: TeamAvailability[] = [],
): Team {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    seriesId: row.series_id,
    player1Name: row.player1_name,
    player2Name: row.player2_name,
    phone: row.phone,
    email: row.email,
    availabilities,
  }
}

// ─── Teams ────────────────────────────────────────────────────────────────

/** Fetches all teams for a tournament with their availabilities. */
export async function fetchTeams(tournamentId: string): Promise<Team[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('*, team_availabilities(*)')
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: true })

  if (error) throw error

  return (data ?? []).map((row) => {
    const avail = (row.team_availabilities ?? []).map(mapAvailability)
    return mapTeam(row, avail)
  })
}

/** Fetches teams for a specific series. */
export async function fetchTeamsBySeries(seriesId: string): Promise<Team[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('*, team_availabilities(*)')
    .eq('series_id', seriesId)
    .order('created_at', { ascending: true })

  if (error) throw error

  return (data ?? []).map((row) => {
    const avail = (row.team_availabilities ?? []).map(mapAvailability)
    return mapTeam(row, avail)
  })
}

/** Creates a new team with optional availabilities. */
export async function createTeam(
  payload: TeamInsert,
  availabilities: Array<Omit<TeamAvailabilityInsert, 'team_id'>> = [],
): Promise<Team> {
  const { data: teamData, error: teamError } = await supabase
    .from('teams')
    .insert(payload)
    .select()
    .single()

  if (teamError) throw teamError

  let avail: TeamAvailability[] = []

  if (availabilities.length > 0) {
    const availRows: TeamAvailabilityInsert[] = availabilities.map((a) => ({
      ...a,
      team_id: teamData.id,
    }))

    const { data: availData, error: availError } = await supabase
      .from('team_availabilities')
      .insert(availRows)
      .select()

    if (availError) throw availError
    avail = (availData ?? []).map(mapAvailability)
  }

  return mapTeam(teamData, avail)
}

/** Updates a team. */
export async function updateTeam(
  id: string,
  payload: TeamUpdate,
  availabilities?: Array<Omit<TeamAvailabilityInsert, 'team_id'>>,
): Promise<Team> {
  const { data, error } = await supabase
    .from('teams')
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error

  let avail: TeamAvailability[] = []

  if (availabilities !== undefined) {
    const { error: delError } = await supabase
      .from('team_availabilities')
      .delete()
      .eq('team_id', id)

    if (delError) throw delError

    if (availabilities.length > 0) {
      const rows: TeamAvailabilityInsert[] = availabilities.map((a) => ({
        ...a,
        team_id: id,
      }))

      const { data: availData, error: availError } = await supabase
        .from('team_availabilities')
        .insert(rows)
        .select()

      if (availError) throw availError
      avail = (availData ?? []).map(mapAvailability)
    }
  } else {
    const { data: existingAvail, error: fetchErr } = await supabase
      .from('team_availabilities')
      .select('*')
      .eq('team_id', id)

    if (fetchErr) throw fetchErr
    avail = (existingAvail ?? []).map(mapAvailability)
  }

  return mapTeam(data, avail)
}

/** Deletes a team and its availabilities (cascade). */
export async function deleteTeam(id: string): Promise<void> {
  const { error } = await supabase.from('teams').delete().eq('id', id)
  if (error) throw error
}

/** Bulk-inserts teams (for CSV import). */
export async function importTeams(teams: TeamInsert[]): Promise<Team[]> {
  const { data, error } = await supabase
    .from('teams')
    .insert(teams)
    .select()

  if (error) throw error
  return (data ?? []).map((row) => mapTeam(row, []))
}
