import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchMatches,
  createMatches,
  updateMatch,
  deleteAllMatches,
  fetchCourts,
  replaceCourts,
} from '@/services/matches.service'
import type { MatchInsert, MatchUpdate } from '@/types/database'

export const MATCH_KEYS = {
  all: (tournamentId: string) => ['matches', tournamentId] as const,
  courts: (tournamentId: string) => ['courts', tournamentId] as const,
}

/** Hook to fetch all matches for a tournament. */
export function useMatches(tournamentId: string | undefined) {
  return useQuery({
    queryKey: MATCH_KEYS.all(tournamentId ?? ''),
    queryFn: () => fetchMatches(tournamentId!),
    enabled: !!tournamentId,
  })
}

/** Hook to create matches (planning generation). */
export function useCreateMatches(tournamentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (matches: MatchInsert[]) => createMatches(matches),
    onSuccess: () => qc.invalidateQueries({ queryKey: MATCH_KEYS.all(tournamentId) }),
  })
}

/** Hook to update a match. */
export function useUpdateMatch(tournamentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: MatchUpdate }) =>
      updateMatch(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: MATCH_KEYS.all(tournamentId) }),
  })
}

/** Hook to delete all matches (reset planning). */
export function useDeleteAllMatches(tournamentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => deleteAllMatches(tournamentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: MATCH_KEYS.all(tournamentId) }),
  })
}

/** Hook to fetch courts. */
export function useCourts(tournamentId: string | undefined) {
  return useQuery({
    queryKey: MATCH_KEYS.courts(tournamentId ?? ''),
    queryFn: () => fetchCourts(tournamentId!),
    enabled: !!tournamentId,
  })
}

/** Hook to replace courts. */
export function useReplaceCourts(tournamentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (count: number) => replaceCourts(tournamentId, count),
    onSuccess: () => qc.invalidateQueries({ queryKey: MATCH_KEYS.courts(tournamentId) }),
  })
}
