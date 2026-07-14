import { supabase } from '@/lib/supabase'
import type { Match, Court } from '@/types/domain'
import type { MatchInsert, MatchUpdate, TeamRow, TeamAvailabilityRow } from '@/types/database'

// ─── Internal helpers ──────────────────────────────────────────────────────

function mapTeamRow(
  row: TeamRow,
  availabilities: TeamAvailabilityRow[],
): Match['teamA'] {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    seriesId: row.series_id,
    player1Name: row.player1_name,
    player2Name: row.player2_name,
    phone: row.phone,
    email: row.email,
    availabilities: availabilities
      .filter((a) => a.team_id === row.id)
      .map((a) => ({
        id: a.id,
        teamId: a.team_id,
        dayOfWeek: a.day_of_week,
        startTime: a.start_time,
        endTime: a.end_time,
      })),
  }
}

function mapCourt(row: {
  id: string
  tournament_id: string
  name: string
  number: number
}): Court {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    name: row.name,
    number: row.number,
  }
}

// ─── Matches ──────────────────────────────────────────────────────────────

/** Fetches all matches for a tournament. */
export async function fetchMatches(tournamentId: string): Promise<Match[]> {
  const { data: matchRows, error: matchErr } = await supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('scheduled_date', { ascending: true })
    .order('scheduled_time', { ascending: true })

  if (matchErr) throw matchErr
  if (!matchRows || matchRows.length === 0) return []

  // Collect unique team IDs
  const teamIds = [
    ...new Set(matchRows.flatMap((m) => [m.team_a_id, m.team_b_id])),
  ]

  const { data: teamRows, error: teamErr } = await supabase
    .from('teams')
    .select('*')
    .in('id', teamIds)

  if (teamErr) throw teamErr

  const { data: availRows, error: availErr } = await supabase
    .from('team_availabilities')
    .select('*')
    .in('team_id', teamIds)

  if (availErr) throw availErr

  const teamsById = new Map(
    (teamRows ?? []).map((t) => [
      t.id,
      mapTeamRow(t, availRows ?? []),
    ]),
  )

  return matchRows.map((m): Match => ({
    id: m.id,
    tournamentId: m.tournament_id,
    poolId: m.pool_id,
    teamA: teamsById.get(m.team_a_id)!,
    teamB: teamsById.get(m.team_b_id)!,
    courtId: m.court_id,
    scheduledDate: m.scheduled_date,
    scheduledTime: m.scheduled_time,
    scoreA: m.score_a,
    scoreB: m.score_b,
    setsA: m.sets_a,
    setsB: m.sets_b,
    status: m.status,
  }))
}

/** Bulk-inserts matches (for planning generation). */
export async function createMatches(matches: MatchInsert[]): Promise<void> {
  const { error } = await supabase.from('matches').insert(matches)
  if (error) throw error
}

/** Updates a match (score, time, court, status). */
export async function updateMatch(
  id: string,
  payload: MatchUpdate,
): Promise<void> {
  const { error } = await supabase
    .from('matches')
    .update(payload)
    .eq('id', id)

  if (error) throw error
}

/** Deletes all matches for a tournament (planning reset). */
export async function deleteAllMatches(tournamentId: string): Promise<void> {
  const { error } = await supabase
    .from('matches')
    .delete()
    .eq('tournament_id', tournamentId)

  if (error) throw error
}

// ─── Courts ───────────────────────────────────────────────────────────────

/** Fetches courts for a tournament. */
export async function fetchCourts(tournamentId: string): Promise<Court[]> {
  const { data, error } = await supabase
    .from('courts')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('number', { ascending: true })

  if (error) throw error
  return (data ?? []).map(mapCourt)
}

/** Creates courts for a tournament (replaces existing). */
export async function replaceCourts(
  tournamentId: string,
  count: number,
): Promise<Court[]> {
  const { error: delError } = await supabase
    .from('courts')
    .delete()
    .eq('tournament_id', tournamentId)

  if (delError) throw delError

  const rows = Array.from({ length: count }, (_, i) => ({
    tournament_id: tournamentId,
    name: `Terrain ${i + 1}`,
    number: i + 1,
  }))

  const { data, error } = await supabase
    .from('courts')
    .insert(rows)
    .select()

  if (error) throw error
  return (data ?? []).map(mapCourt)
}
