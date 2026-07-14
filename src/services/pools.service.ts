import { supabase } from '@/lib/supabase'
import type { Pool } from '@/types/domain'
import type { PoolInsert } from '@/types/database'
import { fetchTeamsBySeries } from './teams.service'

// ─── Mappers ──────────────────────────────────────────────────────────────

function mapPool(
  row: {
    id: string
    tournament_id: string
    series_id: string
    name: string
    validated: boolean
  },
  teams: Pool['teams'] = [],
): Pool {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    seriesId: row.series_id,
    name: row.name,
    validated: row.validated,
    teams,
  }
}

// ─── Pools ────────────────────────────────────────────────────────────────

/** Fetches all pools for a tournament, with their team members. */
export async function fetchPools(tournamentId: string): Promise<Pool[]> {
  const { data, error } = await supabase
    .from('pools')
    .select('*, pool_teams(team_id)')
    .eq('tournament_id', tournamentId)
    .order('series_id', { ascending: true })

  if (error) throw error

  const teamIds = (data ?? []).flatMap((p) =>
    (p.pool_teams ?? []).map((pt: { team_id: string }) => pt.team_id),
  )

  if (teamIds.length === 0) return (data ?? []).map((p) => mapPool(p, []))

  const { data: teamsData, error: teamsError } = await supabase
    .from('teams')
    .select('*, team_availabilities(*)')
    .in('id', teamIds)

  if (teamsError) throw teamsError

  const teamsById = new Map(
    (teamsData ?? []).map((t) => [
      t.id,
      {
        id: t.id,
        tournamentId: t.tournament_id,
        seriesId: t.series_id,
        player1Name: t.player1_name,
        player2Name: t.player2_name,
        phone: t.phone,
        email: t.email,
        availabilities: (t.team_availabilities ?? []).map(
          (a: {
            id: string
            team_id: string
            day_of_week: number
            start_time: string
            end_time: string
          }) => ({
            id: a.id,
            teamId: a.team_id,
            dayOfWeek: a.day_of_week,
            startTime: a.start_time,
            endTime: a.end_time,
          }),
        ),
      },
    ]),
  )

  return (data ?? []).map((p) => {
    const poolTeams = (p.pool_teams ?? [])
      .map((pt: { team_id: string }) => teamsById.get(pt.team_id))
      .filter(Boolean) as Pool['teams']
    return mapPool(p, poolTeams)
  })
}

/** Fetches pools for a specific series. */
export async function fetchPoolsBySeries(
  tournamentId: string,
  seriesId: string,
): Promise<Pool[]> {
  const pools = await fetchPools(tournamentId)
  return pools.filter((p) => p.seriesId === seriesId)
}

/** Saves generated pools (delete existing unvalidated, then insert new). */
export async function savePools(
  tournamentId: string,
  seriesId: string,
  poolGroups: string[][],
): Promise<Pool[]> {
  // Remove any unvalidated pools for this series
  const { error: delError } = await supabase
    .from('pools')
    .delete()
    .eq('tournament_id', tournamentId)
    .eq('series_id', seriesId)
    .eq('validated', false)

  if (delError) throw delError

  if (poolGroups.length === 0) return []

  const poolRows: PoolInsert[] = poolGroups.map((_, i) => ({
    tournament_id: tournamentId,
    series_id: seriesId,
    name: `Poule ${String.fromCharCode(65 + i)}`,
    validated: false,
  }))

  const { data: poolsData, error: poolsError } = await supabase
    .from('pools')
    .insert(poolRows)
    .select()

  if (poolsError) throw poolsError

  const poolTeamRows = poolsData.flatMap((pool, i) =>
    (poolGroups[i] ?? []).map((teamId) => ({
      pool_id: pool.id,
      team_id: teamId,
    })),
  )

  if (poolTeamRows.length > 0) {
    const { error: ptError } = await supabase
      .from('pool_teams')
      .insert(poolTeamRows)

    if (ptError) throw ptError
  }

  const teams = await fetchTeamsBySeries(seriesId)
  const teamsById = new Map(teams.map((t) => [t.id, t]))

  return poolsData.map((pool, i) => ({
    id: pool.id,
    tournamentId: pool.tournament_id,
    seriesId: pool.series_id,
    name: pool.name,
    validated: pool.validated,
    teams: (poolGroups[i] ?? [])
      .map((id) => teamsById.get(id))
      .filter(Boolean) as Pool['teams'],
  }))
}

/** Validates pools for a series. */
export async function validatePools(
  tournamentId: string,
  seriesId: string,
): Promise<void> {
  const { error } = await supabase
    .from('pools')
    .update({ validated: true })
    .eq('tournament_id', tournamentId)
    .eq('series_id', seriesId)

  if (error) throw error
}

/** Deletes all pools for a series. */
export async function deletePools(
  tournamentId: string,
  seriesId: string,
): Promise<void> {
  const { error } = await supabase
    .from('pools')
    .delete()
    .eq('tournament_id', tournamentId)
    .eq('series_id', seriesId)

  if (error) throw error
}
