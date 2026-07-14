import { useState } from 'react'
import { RefreshCw, CheckCircle, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { useTeamsBySeries } from '@/hooks/useTeams'
import { usePools, useSavePools, useValidatePools, useDeletePools } from '@/hooks/usePools'
import { generatePools } from './pool-generator'
import type { Series, Team, Pool } from '@/types/domain'

/** Admin pools page with per-series pool generation. */
export function AdminPoolsPage() {
  const { data: settings } = useTournamentSettings()
  const { data: seriesList = [], isLoading: seriesLoading } = useSeries(settings?.id)
  const { data: allPools = [], isLoading: poolsLoading } = usePools(settings?.id)

  const activeSeries = seriesList.filter((s) => s.maxTeams > 0)

  if (!settings) {
    return (
      <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-orange-800">
        Veuillez d'abord configurer les paramètres du tournoi.
      </div>
    )
  }

  if (seriesLoading || poolsLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Poules</h1>
        <p className="text-muted-foreground">
          Génération et gestion des poules par série
        </p>
      </div>

      {activeSeries.length === 0 ? (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-orange-800">
          Aucune série active. Configurez les séries dans les paramètres.
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

          {activeSeries.map((s) => (
            <TabsContent key={s.id} value={s.id}>
              <SeriesPoolsTab
                tournamentId={settings.id}
                series={s}
                existingPools={allPools.filter((p) => p.seriesId === s.id)}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  )
}

// ─── Per-series pool tab ───────────────────────────────────────────────────

interface SeriesPoolsTabProps {
  tournamentId: string
  series: Series
  existingPools: Pool[]
}

function SeriesPoolsTab({ tournamentId, series, existingPools }: SeriesPoolsTabProps) {
  const { data: teams = [] } = useTeamsBySeries(series.id)
  const savePools = useSavePools(tournamentId)
  const validatePools = useValidatePools(tournamentId)
  const deletePools = useDeletePools(tournamentId)

  const [preview, setPreview] = useState<Team[][]| null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const validated = existingPools.some((p) => p.validated)
  const hasPools = existingPools.length > 0

  function generatePreview() {
    const proposal = generatePools(teams)
    setPreview(proposal.pools)
  }

  async function saveGenerated() {
    if (!preview) return
    try {
      await savePools.mutateAsync({
        seriesId: series.id,
        poolGroups: preview.map((pool) => pool.map((t) => t.id)),
      })
      setPreview(null)
      toast.success('Poules enregistrées')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur'
      toast.error(msg)
    }
  }

  async function handleValidate() {
    try {
      await validatePools.mutateAsync(series.id)
      toast.success('Poules validées')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur'
      toast.error(msg)
    }
  }

  async function handleDelete() {
    try {
      await deletePools.mutateAsync(series.id)
      setPreview(null)
      toast.success('Poules supprimées')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur'
      toast.error(msg)
    } finally {
      setDeleteDialogOpen(false)
    }
  }

  const displayPools = preview ?? (hasPools ? existingPools.map((p) => p.teams) : null)

  return (
    <div className="space-y-4 pt-4">
      {/* Status */}
      <div className="flex items-center gap-2 text-sm">
        <Users className="h-4 w-4 text-muted-foreground" />
        <span className="text-muted-foreground">
          {teams.length} équipes inscrites
        </span>
        {validated && (
          <Badge variant="default" className="ml-2">
            <CheckCircle className="mr-1 h-3 w-3" />
            Validées
          </Badge>
        )}
      </div>

      {/* Actions */}
      {!validated && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={generatePreview}
            disabled={teams.length < 2}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {hasPools || preview ? 'Regénérer' : 'Générer les poules'}
          </Button>

          {preview && (
            <Button size="sm" onClick={saveGenerated} disabled={savePools.isPending}>
              Enregistrer cette génération
            </Button>
          )}

          {hasPools && !preview && (
            <>
              <Button size="sm" onClick={handleValidate} disabled={validatePools.isPending}>
                <CheckCircle className="mr-2 h-4 w-4" />
                Valider les poules
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Supprimer
              </Button>
            </>
          )}
        </div>
      )}

      {/* Pools display */}
      {displayPools && displayPools.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {displayPools.map((poolTeams, i) => (
            <PoolCard
              key={i}
              name={`Poule ${String.fromCharCode(65 + i)}`}
              teams={poolTeams}
              isPreview={!!preview}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border-2 border-dashed p-8 text-center text-muted-foreground">
          {teams.length < 2
            ? 'Il faut au moins 2 équipes pour générer des poules.'
            : 'Cliquez sur "Générer les poules" pour commencer.'}
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer toutes les poules ?</AlertDialogTitle>
            <AlertDialogDescription>
              Toutes les poules de la série « {series.name} » seront supprimées définitivement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Pool Card ────────────────────────────────────────────────────────────

interface PoolCardProps {
  name: string
  teams: Team[]
  isPreview: boolean
}

function PoolCard({ name, teams, isPreview }: PoolCardProps) {
  return (
    <Card className={isPreview ? 'border-dashed opacity-80' : ''}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {name}
          {isPreview && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">(aperçu)</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-sm">
          {teams.map((team) => (
            <li key={team.id} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {team.player1Name} / {team.player2Name}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
