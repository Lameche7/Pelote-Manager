import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchTeams,
  fetchTeamsBySeries,
  createTeam,
  updateTeam,
  deleteTeam,
  importTeams,
} from '@/services/teams.service'
import type { TeamInsert, TeamUpdate, TeamAvailabilityInsert } from '@/types/database'

export const TEAM_KEYS = {
  all: (tournamentId: string) => ['teams', tournamentId] as const,
  bySeries: (seriesId: string) => ['teams', 'series', seriesId] as const,
}

/** Hook to fetch all teams for a tournament. */
export function useTeams(tournamentId: string | undefined) {
  return useQuery({
    queryKey: TEAM_KEYS.all(tournamentId ?? ''),
    queryFn: () => fetchTeams(tournamentId!),
    enabled: !!tournamentId,
  })
}

/** Hook to fetch teams for a specific series. */
export function useTeamsBySeries(seriesId: string | undefined) {
  return useQuery({
    queryKey: TEAM_KEYS.bySeries(seriesId ?? ''),
    queryFn: () => fetchTeamsBySeries(seriesId!),
    enabled: !!seriesId,
  })
}

/** Hook to create a team. */
export function useCreateTeam(tournamentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      payload,
      availabilities,
    }: {
      payload: TeamInsert
      availabilities?: Array<Omit<TeamAvailabilityInsert, 'team_id'>>
    }) => createTeam(payload, availabilities),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEAM_KEYS.all(tournamentId) }),
  })
}

/** Hook to update a team. */
export function useUpdateTeam(tournamentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      payload,
      availabilities,
    }: {
      id: string
      payload: TeamUpdate
      availabilities?: Array<Omit<TeamAvailabilityInsert, 'team_id'>>
    }) => updateTeam(id, payload, availabilities),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEAM_KEYS.all(tournamentId) }),
  })
}

/** Hook to delete a team. */
export function useDeleteTeam(tournamentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteTeam(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEAM_KEYS.all(tournamentId) }),
  })
}

/** Hook to bulk-import teams. */
export function useImportTeams(tournamentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (teams: TeamInsert[]) => importTeams(teams),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEAM_KEYS.all(tournamentId) }),
  })
}
