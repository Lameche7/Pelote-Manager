import { format, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'
import { CalendarDays, MapPin, Trophy } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTournamentSettings, useSeries } from '@/hooks/useTournament'
import { usePools } from '@/hooks/usePools'
import { useMatches } from '@/hooks/useMatches'
import { computeStandings } from '../results/standings-calculator'
import { formatDate } from '@/lib/utils'
import type { Match } from '@/types/domain'

/** Public tournament page: teams, schedule and results. */
export function PublicTournamentPage() {
  const { data: settings, isLoading } = useTournamentSettings()
  const { data: seriesList = [] } = useSeries(settings?.id)
  const { data: pools = [] } = usePools(settings?.id)
  const { data: matches = [] } = useMatches(settings?.id)

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="container mx-auto px-4 py-12 text-center text-muted-foreground">
        Aucun tournoi configuré pour le moment.
      </div>
    )
  }

  const activeSeries = seriesList.filter((s) => s.maxTeams > 0)
  const hasSchedule = matches.some((m) => m.scheduledDate !== null)
  const hasResults = matches.some((m) => m.status === 'completed')

  return (
    <div className="container mx-auto space-y-8 px-4 py-12">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">{settings.name}</h1>
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <MapPin className="h-4 w-4" />
            {settings.location}
          </span>
          <span className="flex items-center gap-1">
            <CalendarDays className="h-4 w-4" />
            Du {formatDate(settings.startDate)} au {formatDate(settings.endDate)}
          </span>
          <PhaseLabel phase={settings.phase} />
        </div>
      </div>

      <Tabs defaultValue="classements">
        <TabsList>
          <TabsTrigger value="classements">
            <Trophy className="mr-2 h-4 w-4" />
            Classements
          </TabsTrigger>
          {hasSchedule && (
            <TabsTrigger value="planning">
              <CalendarDays className="mr-2 h-4 w-4" />
              Planning
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="classements">
          <div className="space-y-6 pt-4">
            {activeSeries.map((series) => {
              const seriesPools = pools.filter((p) => p.seriesId === series.id)
              if (seriesPools.length === 0) return null

              return (
                <div key={series.id}>
                  <h2 className="mb-3 text-lg font-semibold">{series.name}</h2>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {seriesPools.map((pool) => {
                      const poolMatches = matches.filter((m) => m.poolId === pool.id)
                      const standings = computeStandings(poolMatches, pool.teams)

                      return (
                        <Card key={pool.id}>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-base">{pool.name}</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b text-xs text-muted-foreground">
                                  <th className="pb-1 text-left">#</th>
                                  <th className="pb-1 text-left">Équipe</th>
                                  <th className="pb-1 text-center">Pts</th>
                                  <th className="pb-1 text-center">J</th>
                                </tr>
                              </thead>
                              <tbody>
                                {standings.map((e, i) => (
                                  <tr key={e.team.id} className="border-b last:border-0">
                                    <td className="py-1 pr-2 font-bold text-muted-foreground">
                                      {i + 1}
                                    </td>
                                    <td className="py-1">
                                      {e.team.player1Name} / {e.team.player2Name}
                                    </td>
                                    <td className="py-1 text-center font-bold">{e.points}</td>
                                    <td className="py-1 text-center text-muted-foreground">
                                      {e.played}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {!hasResults && (
              <p className="text-center text-muted-foreground">
                Les résultats seront affichés ici dès le début du tournoi.
              </p>
            )}
          </div>
        </TabsContent>

        {hasSchedule && (
          <TabsContent value="planning">
            <PublicScheduleView matches={matches} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function PhaseLabel({ phase }: { phase: string }) {
  const labels: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
    registration: { label: 'Inscriptions', variant: 'default' },
    pools: { label: 'Poules', variant: 'secondary' },
    planning: { label: 'Planification', variant: 'secondary' },
    in_progress: { label: 'En cours', variant: 'default' },
    finished: { label: 'Terminé', variant: 'outline' },
  }
  const { label, variant } = labels[phase] ?? { label: phase, variant: 'outline' }
  return <Badge variant={variant}>{label}</Badge>
}

type MatchItem = Match

function PublicScheduleView({ matches }: { matches: MatchItem[] }) {
  const byDate = matches.reduce<Record<string, MatchItem[]>>((acc, m) => {
    const key = m.scheduledDate ?? 'non-planifié'
    ;(acc[key] ??= []).push(m)
    return acc
  }, {})

  const dates = Object.keys(byDate).sort()

  return (
    <div className="space-y-4 pt-4">
      {dates.map((date) => (
        <div key={date} className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 font-semibold capitalize">
            {format(parseISO(date), 'EEEE dd MMMM yyyy', { locale: fr })}
          </h3>
          <ul className="space-y-2 text-sm">
            {(byDate[date] ?? [])
              .sort((a, b) => (a.scheduledTime ?? '').localeCompare(b.scheduledTime ?? ''))
              .map((m) => (
                <li key={m.id} className="flex items-center gap-3">
                  <span className="w-12 font-mono text-muted-foreground">
                    {m.scheduledTime?.slice(0, 5)}
                  </span>
                  <span>
                    {m.teamA.player1Name} / {m.teamA.player2Name}
                    <span className="mx-2 text-muted-foreground">vs</span>
                    {m.teamB.player1Name} / {m.teamB.player2Name}
                  </span>
                  {m.status === 'completed' && (
                    <Badge variant="secondary" className="ml-auto">
                      {m.scoreA} – {m.scoreB}
                    </Badge>
                  )}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
