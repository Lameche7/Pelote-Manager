import { useEffect } from 'react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Trophy, Clock, Monitor } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { useTournamentSettings, useSeries } from '@/hooks/useTournament'
import { useMatches } from '@/hooks/useMatches'
import { usePools } from '@/hooks/usePools'
import { computeStandings } from '../results/standings-calculator'
import { useQueryClient } from '@tanstack/react-query'

const REFRESH_INTERVAL_MS = 30_000

/** TV display mode – full-screen, no menu, auto-refresh. */
export function TVDisplayPage() {
  const qc = useQueryClient()
  const { data: settings, isLoading } = useTournamentSettings()
  const { data: seriesList = [] } = useSeries(settings?.id)
  const { data: matches = [] } = useMatches(settings?.id)
  const { data: pools = [] } = usePools(settings?.id)

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      void qc.invalidateQueries()
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [qc])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950 text-white">
        <Spinner size="lg" />
      </div>
    )
  }

  const now = new Date()
  const todayStr = format(now, 'yyyy-MM-dd')

  const liveMatches = matches.filter((m) => m.status === 'in_progress')
  const todayMatches = matches
    .filter((m) => m.scheduledDate === todayStr && m.status === 'scheduled')
    .sort((a, b) => (a.scheduledTime ?? '').localeCompare(b.scheduledTime ?? ''))
    .slice(0, 8)

  const activeSeries = seriesList.filter((s) => s.maxTeams > 0)

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Trophy className="h-8 w-8 text-yellow-400" />
            <div>
              <h1 className="text-2xl font-bold">
                {settings?.name ?? 'PCL Lourdais'}
              </h1>
              <p className="text-sm text-gray-400">
                {format(now, 'EEEE dd MMMM yyyy', { locale: fr })} – {format(now, 'HH:mm')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Monitor className="h-4 w-4" />
            Mode affichage
          </div>
        </div>
      </header>

      <div className="grid h-[calc(100vh-80px)] grid-cols-3 gap-0 divide-x divide-gray-800">
        {/* Column 1: Live matches */}
        <div className="flex flex-col overflow-hidden p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-yellow-400">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
            </span>
            En cours
          </h2>

          {liveMatches.length === 0 ? (
            <p className="text-gray-500">Aucun match en cours</p>
          ) : (
            <div className="space-y-3">
              {liveMatches.map((m) => (
                <div key={m.id} className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
                  <div className="text-sm text-gray-400">
                    Terrain –{' '}
                    {m.scheduledTime?.slice(0, 5)}
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-semibold">
                      {m.teamA.player1Name} / {m.teamA.player2Name}
                    </span>
                    <span className="mx-3 text-xl font-bold text-yellow-400">
                      {m.scoreA ?? 0} – {m.scoreB ?? 0}
                    </span>
                    <span className="font-semibold">
                      {m.teamB.player1Name} / {m.teamB.player2Name}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Column 2: Next matches today */}
        <div className="flex flex-col overflow-hidden p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-blue-400">
            <Clock className="h-5 w-5" />
            Prochains matchs
          </h2>

          {todayMatches.length === 0 ? (
            <p className="text-gray-500">Aucun match programmé aujourd'hui</p>
          ) : (
            <div className="space-y-2">
              {todayMatches.map((m) => (
                <div key={m.id} className="rounded-lg border border-gray-700 bg-gray-900 p-3">
                  <div className="flex items-center justify-between text-sm text-gray-400">
                    <span>{m.scheduledTime?.slice(0, 5)}</span>
                  </div>
                  <div className="mt-1 text-sm">
                    <span className="font-medium">
                      {m.teamA.player1Name} / {m.teamA.player2Name}
                    </span>
                    <span className="mx-2 text-gray-500">vs</span>
                    <span className="font-medium">
                      {m.teamB.player1Name} / {m.teamB.player2Name}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Column 3: Standings */}
        <div className="flex flex-col overflow-y-auto p-6">
          <h2 className="mb-4 text-lg font-bold text-green-400">
            Classements
          </h2>

          <div className="space-y-4">
            {activeSeries.map((series) => {
              const seriesPools = pools.filter((p) => p.seriesId === series.id)
              if (seriesPools.length === 0) return null

              return (
                <div key={series.id}>
                  <h3 className="mb-2 text-sm font-semibold text-gray-400">
                    {series.name}
                  </h3>
                  {seriesPools.map((pool) => {
                    const poolMatches = matches.filter((m) => m.poolId === pool.id)
                    const standings = computeStandings(poolMatches, pool.teams)

                    return (
                      <div key={pool.id} className="mb-3 rounded-lg border border-gray-800 bg-gray-900 p-3">
                        <p className="mb-2 text-xs text-gray-500">{pool.name}</p>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-500">
                              <th className="text-left">#</th>
                              <th className="text-left">Équipe</th>
                              <th className="text-right">Pts</th>
                            </tr>
                          </thead>
                          <tbody>
                            {standings.slice(0, 4).map((e, i) => (
                              <tr key={e.team.id}>
                                <td className="py-0.5 pr-2 text-gray-500">{i + 1}</td>
                                <td className="py-0.5">
                                  {e.team.player1Name} / {e.team.player2Name}
                                </td>
                                <td className="py-0.5 text-right font-bold text-green-400">
                                  {e.points}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  })}
                </div>
              )
            })}

            {activeSeries.length === 0 && (
              <p className="text-gray-500">Aucun résultat disponible</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
