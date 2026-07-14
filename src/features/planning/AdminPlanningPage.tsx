import { useState } from 'react'
import { CalendarDays, RefreshCw, Trash2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useTournamentSettings, useSeries } from '@/hooks/useTournament'
import type { Match, Court } from '@/types/domain'
import { usePools } from '@/hooks/usePools'
import { useMatches, useCreateMatches, useDeleteAllMatches, useCourts } from '@/hooks/useMatches'
import { generateSchedule, scheduledMatchesToInserts } from './schedule-generator'

type CalendarView = 'week' | 'day' | 'court'

/** Admin planning page: schedule generation and calendar views. */
export function AdminPlanningPage() {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [view, setView] = useState<CalendarView>('week')

  const { data: settings } = useTournamentSettings()
  const { data: seriesList = [] } = useSeries(settings?.id)
  const { data: pools = [], isLoading: poolsLoading } = usePools(settings?.id)
  const { data: matches = [], isLoading: matchesLoading } = useMatches(settings?.id)
  const { data: courts = [] } = useCourts(settings?.id)

  const createMatches = useCreateMatches(settings?.id ?? '')
  const deleteAllMatches = useDeleteAllMatches(settings?.id ?? '')

  if (!settings) {
    return (
      <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-orange-800">
        Veuillez d'abord configurer les paramètres du tournoi.
      </div>
    )
  }

  const activeSeries = seriesList.filter((s) => s.maxTeams > 0)
  const validatedPools = pools.filter((p) => p.validated)

  // Check if all active series have validated pools
  const seriesWithoutPools = activeSeries.filter(
    (s) => !validatedPools.some((p) => p.seriesId === s.id),
  )

  const hasMatches = matches.length > 0

  async function handleGenerate() {
    if (!settings || seriesWithoutPools.length > 0) return

    try {
      const scheduled = generateSchedule(validatedPools, settings, courts)
      const inserts = scheduledMatchesToInserts(scheduled, settings.id)
      await createMatches.mutateAsync(inserts)
      toast.success(`${inserts.length} matchs planifiés`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur de génération'
      toast.error(msg)
    }
  }

  async function handleDelete() {
    try {
      await deleteAllMatches.mutateAsync()
      toast.success('Planning supprimé')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur'
      toast.error(msg)
    } finally {
      setDeleteDialogOpen(false)
    }
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Planning</h1>
          <p className="text-muted-foreground">
            {hasMatches ? `${matches.length} matchs planifiés` : 'Aucun planning généré'}
          </p>
        </div>
        <div className="flex gap-2">
          {hasMatches && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Réinitialiser
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={
              createMatches.isPending ||
              seriesWithoutPools.length > 0 ||
              validatedPools.length === 0
            }
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {hasMatches ? 'Regénérer' : 'Générer le planning'}
          </Button>
        </div>
      </div>

      {/* Warnings */}
      {seriesWithoutPools.length > 0 && (
        <div className="space-y-2">
          {seriesWithoutPools.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800"
            >
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              La série «&nbsp;{s.name}&nbsp;» ne possède pas encore de poules validées.
            </div>
          ))}
        </div>
      )}

      {hasMatches && (
        <Tabs value={view} onValueChange={(v) => setView(v as CalendarView)}>
          <TabsList>
            <TabsTrigger value="week">
              <CalendarDays className="mr-2 h-4 w-4" />
              Semaine
            </TabsTrigger>
            <TabsTrigger value="day">Jour</TabsTrigger>
            <TabsTrigger value="court">Terrain</TabsTrigger>
          </TabsList>

          <TabsContent value="week">
            <WeekView matches={matches} />
          </TabsContent>
          <TabsContent value="day">
            <DayView matches={matches} />
          </TabsContent>
          <TabsContent value="court">
            <CourtView matches={matches} courts={courts} />
          </TabsContent>
        </Tabs>
      )}

      {!hasMatches && validatedPools.length > 0 && seriesWithoutPools.length === 0 && (
        <div className="rounded-lg border-2 border-dashed p-8 text-center text-muted-foreground">
          Cliquez sur «&nbsp;Générer le planning&nbsp;» pour planifier tous les matchs.
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Réinitialiser le planning ?</AlertDialogTitle>
            <AlertDialogDescription>
              Tous les matchs planifiés seront supprimés définitivement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Réinitialiser
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Calendar Views ────────────────────────────────────────────────────────

interface ViewProps {
  matches: Match[]
}

function WeekView({ matches }: ViewProps) {
  const byDate = groupByDate(matches)
  const dates = Object.keys(byDate).sort()

  if (dates.length === 0) return null

  // Group dates by week
  const weeks: string[][] = []
  let current: string[] = []

  for (const date of dates) {
    if (current.length === 0) {
      current.push(date)
    } else {
      const prev = parseISO(current[current.length - 1]!)
      const curr = parseISO(date)
      const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86400000)
      if (diffDays <= 7) {
        current.push(date)
      } else {
        weeks.push(current)
        current = [date]
      }
    }
  }
  if (current.length > 0) weeks.push(current)

  return (
    <div className="space-y-6 pt-4">
      {weeks.map((weekDates, wi) => (
        <Card key={wi}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Semaine {wi + 1}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {weekDates.map((date) => (
                <DayColumn key={date} date={date} matches={byDate[date] ?? []} />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function DayView({ matches }: ViewProps) {
  const byDate = groupByDate(matches)
  const dates = Object.keys(byDate).sort()

  return (
    <div className="space-y-4 pt-4">
      {dates.map((date) => (
        <DayColumn key={date} date={date} matches={byDate[date] ?? []} expanded />
      ))}
    </div>
  )
}

function CourtView({ matches, courts }: ViewProps & { courts: Court[] }) {
  return (
    <div className="grid gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-3">
      {courts.map((court) => {
        const courtMatches = matches
          .filter((m) => m.courtId === court.id)
          .sort((a, b) => {
            const d = (a.scheduledDate ?? '').localeCompare(b.scheduledDate ?? '')
            if (d !== 0) return d
            return (a.scheduledTime ?? '').localeCompare(b.scheduledTime ?? '')
          })

        return (
          <Card key={court.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{court.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-2 text-xs text-muted-foreground">{courtMatches.length} matchs</p>
              <ul className="space-y-1 text-xs">
                {courtMatches.slice(0, 10).map((m) => (
                  <li key={m.id} className="flex items-center gap-1">
                    <span className="text-muted-foreground">
                      {m.scheduledDate ? format(parseISO(m.scheduledDate), 'dd/MM') : '–'}{' '}
                      {m.scheduledTime?.slice(0, 5)}
                    </span>
                    <span className="truncate">
                      {m.teamA.player1Name} vs {m.teamB.player1Name}
                    </span>
                    <StatusBadge status={m.status} />
                  </li>
                ))}
                {courtMatches.length > 10 && (
                  <li className="text-muted-foreground">
                    +{courtMatches.length - 10} matchs…
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────

type MatchItem = Match

function groupByDate(matches: MatchItem[]): Record<string, MatchItem[]> {
  return matches.reduce<Record<string, MatchItem[]>>((acc, m) => {
    const key = m.scheduledDate ?? 'non-planifié'
    ;(acc[key] ??= []).push(m)
    return acc
  }, {})
}

interface DayColumnProps {
  date: string
  matches: MatchItem[]
  expanded?: boolean
}

function DayColumn({ date, matches, expanded }: DayColumnProps) {
  const label = format(parseISO(date), 'EEEE dd/MM', { locale: fr })
  const sorted = [...matches].sort((a, b) =>
    (a.scheduledTime ?? '').localeCompare(b.scheduledTime ?? ''),
  )

  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-xs font-semibold capitalize text-muted-foreground">{label}</p>
      <ul className="space-y-1 text-xs">
        {sorted.slice(0, expanded ? undefined : 5).map((m) => (
          <li key={m.id} className="flex items-center gap-1">
            <span className="font-mono text-muted-foreground">{m.scheduledTime?.slice(0, 5)}</span>
            <span className="truncate">
              {m.teamA.player1Name} / {m.teamB.player1Name}
            </span>
            <StatusBadge status={m.status} />
          </li>
        ))}
        {!expanded && sorted.length > 5 && (
          <li className="text-muted-foreground">+{sorted.length - 5}…</li>
        )}
      </ul>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    scheduled: 'bg-blue-100 text-blue-700',
    in_progress: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-700',
  }
  return (
    <span
      className={`rounded px-1 py-0.5 text-[10px] font-medium ${variants[status] ?? variants.scheduled}`}
    />
  )
}
