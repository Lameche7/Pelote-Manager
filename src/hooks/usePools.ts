import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchPools,
  fetchPoolsBySeries,
  savePools,
  validatePools,
  deletePools,
} from '@/services/pools.service'

export const POOL_KEYS = {
  all: (tournamentId: string) => ['pools', tournamentId] as const,
  bySeries: (tournamentId: string, seriesId: string) =>
    ['pools', tournamentId, seriesId] as const,
}

/** Hook to fetch all pools for a tournament. */
export function usePools(tournamentId: string | undefined) {
  return useQuery({
    queryKey: POOL_KEYS.all(tournamentId ?? ''),
    queryFn: () => fetchPools(tournamentId!),
    enabled: !!tournamentId,
  })
}

/** Hook to fetch pools for a specific series. */
export function usePoolsBySeries(
  tournamentId: string | undefined,
  seriesId: string | undefined,
) {
  return useQuery({
    queryKey: POOL_KEYS.bySeries(tournamentId ?? '', seriesId ?? ''),
    queryFn: () => fetchPoolsBySeries(tournamentId!, seriesId!),
    enabled: !!tournamentId && !!seriesId,
  })
}

/** Hook to save (replace) pools for a series. */
export function useSavePools(tournamentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      seriesId,
      poolGroups,
    }: {
      seriesId: string
      poolGroups: string[][]
    }) => savePools(tournamentId, seriesId, poolGroups),
    onSuccess: () => qc.invalidateQueries({ queryKey: POOL_KEYS.all(tournamentId) }),
  })
}

/** Hook to validate pools for a series. */
export function useValidatePools(tournamentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (seriesId: string) => validatePools(tournamentId, seriesId),
    onSuccess: () => qc.invalidateQueries({ queryKey: POOL_KEYS.all(tournamentId) }),
  })
}

/** Hook to delete all pools for a series. */
export function useDeletePools(tournamentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (seriesId: string) => deletePools(tournamentId, seriesId),
    onSuccess: () => qc.invalidateQueries({ queryKey: POOL_KEYS.all(tournamentId) }),
  })
}
