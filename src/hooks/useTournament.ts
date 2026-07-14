import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchTournamentSettings,
  createTournamentSettings,
  updateTournamentSettings,
  fetchSeries,
  replaceSeries,
} from '@/services/tournament.service'
import type { TournamentSettingsInsert, TournamentSettingsUpdate, SeriesInsert } from '@/types/database'

export const TOURNAMENT_KEYS = {
  settings: ['tournament', 'settings'] as const,
  series: (tournamentId: string) => ['tournament', 'series', tournamentId] as const,
}

/** Hook to fetch tournament settings. */
export function useTournamentSettings() {
  return useQuery({
    queryKey: TOURNAMENT_KEYS.settings,
    queryFn: fetchTournamentSettings,
  })
}

/** Hook to create tournament settings. */
export function useCreateTournamentSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: TournamentSettingsInsert) => createTournamentSettings(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: TOURNAMENT_KEYS.settings }),
  })
}

/** Hook to update tournament settings. */
export function useUpdateTournamentSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: TournamentSettingsUpdate }) =>
      updateTournamentSettings(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: TOURNAMENT_KEYS.settings }),
  })
}

/** Hook to fetch series for a tournament. */
export function useSeries(tournamentId: string | undefined) {
  return useQuery({
    queryKey: TOURNAMENT_KEYS.series(tournamentId ?? ''),
    queryFn: () => fetchSeries(tournamentId!),
    enabled: !!tournamentId,
  })
}

/** Hook to replace all series for a tournament. */
export function useReplaceSeries() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      tournamentId,
      series,
    }: {
      tournamentId: string
      series: Array<Omit<SeriesInsert, 'tournament_id'>>
    }) => replaceSeries(tournamentId, series),
    onSuccess: (_data, variables) =>
      qc.invalidateQueries({ queryKey: TOURNAMENT_KEYS.series(variables.tournamentId) }),
  })
}
