import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useTournamentSettings, useSeries } from '@/hooks/useTournament'
import { useMatches, useUpdateMatch } from '@/hooks/useMatches'
import { usePools } from '@/hooks/usePools'
import { computeStandings } from './standings-calculator'
import type { Match, Pool } from '@/types/domain'

const scoreSchema = z.object({
  score_a: z.number().int().min(0),
  score_b: z.number().int().min(0),
  sets_a: z.number().int().min(0),
  sets_b: z.number().int().min(0),
})

type ScoreForm = z.infer<typeof scoreSchema>

/** Admin results page: score entry and standings. */
export function AdminResultsPage() {
  const { data: settings } = useTournamentSettings()
  const { data: seriesList = [] } = useSeries(settings?.id)
  const { data: pools = [], isLoading: poolsLoading } = usePools(settings?.id)
  const { data: matches = [], isLoading: matchesLoading } = useMatches(settings?.id)

  const activeSeries = seriesList.filter((s) => s.maxTeams > 0)

  if (!settings) {
    return (
      <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-orange-800">
        Veuillez d'abord configurer les paramètres du tournoi.
      </div>
    )
  }

  if (poolsLoading || matchesLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Résultats</h1>
        <p className="text-muted-foreground">Saisie des scores et classements</p>
      </div>

      {activeSeries.length === 0 ? (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-orange-800">
          Aucune série active.
        </div>
      ) : (
        <Tabs defaultValue={activeSeries[0]?.id}>
          <TabsList className="flex-wrap h-auto gap-1">
            {activeSeries.map((s) => (
              <TabsTrigger key={s.id} value={s.id}>
                {s.name}
              </TabsTrigger>
            ))}
          </TabsList>

          {activeSeries.map((series) => {
            const seriesPools = pools.filter((p) => p.seriesId === series.id)
            const seriesMatches = matches.filter((m) =>
              seriesPools.some((p) => p.id === m.poolId),
            )
            return (
              <TabsContent key={series.id} value={series.id}>
                <SeriesResultsTab
                  tournamentId={settings.id}
                  pools={seriesPools}
                  matches={seriesMatches}
                />
              </TabsContent>
            )
          })}
        </Tabs>
      )}
    </div>
  )
}

// ─── Per-series results tab ────────────────────────────────────────────────

interface SeriesResultsTabProps {
  tournamentId: string
  pools: Pool[]
  matches: Match[]
}

function SeriesResultsTab({ tournamentId, pools, matches }: SeriesResultsTabProps) {
  const [scoreTarget, setScoreTarget] = useState<Match | null>(null)
  const updateMatch = useUpdateMatch(tournamentId)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ScoreForm>({ resolver: zodResolver(scoreSchema) })

  function openScore(match: Match) {
    setScoreTarget(match)
    reset({
      score_a: match.scoreA ?? 0,
      score_b: match.scoreB ?? 0,
      sets_a: match.setsA ?? 0,
      sets_b: match.setsB ?? 0,
    })
  }

  async function onSubmit(data: ScoreForm) {
    if (!scoreTarget) return
    try {
      await updateMatch.mutateAsync({
        id: scoreTarget.id,
        payload: {
          score_a: data.score_a,
          score_b: data.score_b,
          sets_a: data.sets_a,
          sets_b: data.sets_b,
          status: 'completed',
        },
      })
      toast.success('Score enregistré')
      setScoreTarget(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur'
      toast.error(msg)
    }
  }

  if (pools.length === 0) {
    return (
      <div className="pt-4 text-center text-sm text-muted-foreground">
        Aucune poule pour cette série.
      </div>
    )
  }

  return (
    <div className="space-y-6 pt-4">
      {pools.map((pool) => {
        const poolMatches = matches.filter((m) => m.poolId === pool.id)
        const standings = computeStandings(poolMatches, pool.teams)

        return (
          <Card key={pool.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{pool.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Standings */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Équipe</TableHead>
                    <TableHead className="text-center">Pts</TableHead>
                    <TableHead className="text-center">J</TableHead>
                    <TableHead className="text-center">G</TableHead>
                    <TableHead className="text-center">P</TableHead>
                    <TableHead className="text-center">Diff</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {standings.map((entry, i) => (
                    <TableRow key={entry.team.id}>
                      <TableCell className="font-bold text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium">
                        {entry.team.player1Name} / {entry.team.player2Name}
                      </TableCell>
                      <TableCell className="text-center font-bold">{entry.points}</TableCell>
                      <TableCell className="text-center">{entry.played}</TableCell>
                      <TableCell className="text-center text-green-600">{entry.won}</TableCell>
                      <TableCell className="text-center text-red-600">{entry.lost}</TableCell>
                      <TableCell className="text-center">
                        {entry.setsDiff > 0 ? `+${entry.setsDiff}` : entry.setsDiff}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Matches */}
              <div className="space-y-1">
                {poolMatches.map((match) => (
                  <div
                    key={match.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="text-muted-foreground">
                      {match.scheduledDate ?? '–'} {match.scheduledTime?.slice(0, 5)}
                    </span>
                    <span className="flex-1 text-center">
                      {match.teamA.player1Name} vs {match.teamB.player1Name}
                    </span>
                    {match.status === 'completed' ? (
                      <Badge variant="secondary">
                        {match.scoreA} – {match.scoreB}
                      </Badge>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openScore(match)}
                      >
                        Saisir score
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )
      })}

      {/* Score entry dialog */}
      <Dialog open={!!scoreTarget} onOpenChange={(open) => !open && setScoreTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Saisir le score</DialogTitle>
          </DialogHeader>
          {scoreTarget && (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <p className="text-sm font-medium">
                {scoreTarget.teamA.player1Name} / {scoreTarget.teamA.player2Name}
                <span className="mx-2 text-muted-foreground">vs</span>
                {scoreTarget.teamB.player1Name} / {scoreTarget.teamB.player2Name}
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <Label className="font-semibold">
                    {scoreTarget.teamA.player1Name}
                  </Label>
                  <div className="space-y-1">
                    <Label htmlFor="score_a">Score</Label>
                    <Input id="score_a" type="number" min="0" {...register('score_a')} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="sets_a">Sets</Label>
                    <Input id="sets_a" type="number" min="0" {...register('sets_a')} />
                  </div>
                </div>
                <div className="space-y-3">
                  <Label className="font-semibold">
                    {scoreTarget.teamB.player1Name}
                  </Label>
                  <div className="space-y-1">
                    <Label htmlFor="score_b">Score</Label>
                    <Input id="score_b" type="number" min="0" {...register('score_b')} />
                    {errors.score_b && (
                      <p className="text-xs text-destructive">{errors.score_b.message}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="sets_b">Sets</Label>
                    <Input id="sets_b" type="number" min="0" {...register('sets_b')} />
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setScoreTarget(null)}>
                  Annuler
                </Button>
                <Button type="submit" disabled={updateMatch.isPending}>
                  Enregistrer
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
