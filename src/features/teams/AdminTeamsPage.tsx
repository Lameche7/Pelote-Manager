import { useState, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Pencil, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTournamentSettings, useSeries } from '@/hooks/useTournament'
import { useTeams, useCreateTeam, useUpdateTeam, useDeleteTeam, useImportTeams } from '@/hooks/useTeams'
import type { Team } from '@/types/domain'
import { parseTeamsCsv } from './teams-csv-parser'

const teamSchema = z.object({
  player1_name: z.string().min(1, 'Joueur 1 requis'),
  player2_name: z.string().min(1, 'Joueur 2 requis'),
  series_id: z.string().min(1, 'Série requise'),
  phone: z.string().optional(),
  email: z.string().email('Email invalide').optional().or(z.literal('')),
})

type TeamForm = z.infer<typeof teamSchema>

/** Admin teams management page. */
export function AdminTeamsPage() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Team | null>(null)
  const [editTarget, setEditTarget] = useState<Team | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: settings } = useTournamentSettings()
  const { data: seriesList = [] } = useSeries(settings?.id)
  const { data: teams = [], isLoading } = useTeams(settings?.id)

  const createTeam = useCreateTeam(settings?.id ?? '')
  const updateTeam = useUpdateTeam(settings?.id ?? '')
  const deleteTeam = useDeleteTeam(settings?.id ?? '')
  const importTeams = useImportTeams(settings?.id ?? '')

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<TeamForm>({ resolver: zodResolver(teamSchema) })

  const selectedSeriesId = watch('series_id')

  function openCreate() {
    setEditTarget(null)
    reset({ player1_name: '', player2_name: '', series_id: '', phone: '', email: '' })
    setDialogOpen(true)
  }

  function openEdit(team: Team) {
    setEditTarget(team)
    reset({
      player1_name: team.player1Name,
      player2_name: team.player2Name,
      series_id: team.seriesId,
      phone: team.phone ?? '',
      email: team.email ?? '',
    })
    setDialogOpen(true)
  }

  async function onSubmit(data: TeamForm) {
    if (!settings) return

    const payload = {
      tournament_id: settings.id,
      series_id: data.series_id,
      player1_name: data.player1_name,
      player2_name: data.player2_name,
      phone: data.phone || null,
      email: data.email || null,
    }

    try {
      if (editTarget) {
        await updateTeam.mutateAsync({ id: editTarget.id, payload })
        toast.success('Équipe mise à jour')
      } else {
        await createTeam.mutateAsync({ payload })
        toast.success('Équipe ajoutée')
      }
      setDialogOpen(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur'
      toast.error(msg)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteTeam.mutateAsync(deleteTarget.id)
      toast.success('Équipe supprimée')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur'
      toast.error(msg)
    } finally {
      setDeleteTarget(null)
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !settings) return

    try {
      const text = await file.text()
      const rows = parseTeamsCsv(text, settings.id)
      await importTeams.mutateAsync(rows)
      toast.success(`${rows.length} équipes importées`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur import'
      toast.error(msg)
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  if (!settings) {
    return (
      <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-orange-800">
        Veuillez d'abord configurer les paramètres du tournoi.
      </div>
    )
  }

  const activeSeries = seriesList.filter((s) => s.maxTeams > 0)

  const groupedTeams = activeSeries.map((series) => ({
    series,
    teams: teams.filter((t) => t.seriesId === series.id),
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Équipes</h1>
          <p className="text-muted-foreground">Gestion des inscriptions ({teams.length} équipes)</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            Importer CSV
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleImport}
          />
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Ajouter une équipe
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : (
        groupedTeams.map(({ series, teams: seriesTeams }) => (
          <div key={series.id} className="rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="font-semibold">{series.name}</h2>
              <Badge variant={seriesTeams.length >= series.maxTeams ? 'destructive' : 'secondary'}>
                {seriesTeams.length} / {series.maxTeams}
              </Badge>
            </div>

            {seriesTeams.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Aucune équipe inscrite dans cette série
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Joueur 1</TableHead>
                    <TableHead>Joueur 2</TableHead>
                    <TableHead>Téléphone</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {seriesTeams.map((team) => (
                    <TableRow key={team.id}>
                      <TableCell className="font-medium">{team.player1Name}</TableCell>
                      <TableCell>{team.player2Name}</TableCell>
                      <TableCell className="text-muted-foreground">{team.phone ?? '–'}</TableCell>
                      <TableCell className="text-muted-foreground">{team.email ?? '–'}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(team)}
                            aria-label="Modifier"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteTarget(team)}
                            aria-label="Supprimer"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        ))
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTarget ? "Modifier l'équipe" : 'Nouvelle équipe'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1">
              <Label>Série</Label>
              <Select value={selectedSeriesId} onValueChange={(v) => setValue('series_id', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Choisir une série" />
                </SelectTrigger>
                <SelectContent>
                  {activeSeries.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.series_id && (
                <p className="text-xs text-destructive">{errors.series_id.message}</p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="p1">Joueur 1</Label>
                <Input id="p1" {...register('player1_name')} />
                {errors.player1_name && (
                  <p className="text-xs text-destructive">{errors.player1_name.message}</p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="p2">Joueur 2</Label>
                <Input id="p2" {...register('player2_name')} />
                {errors.player2_name && (
                  <p className="text-xs text-destructive">{errors.player2_name.message}</p>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="phone">Téléphone</Label>
                <Input id="phone" {...register('phone')} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...register('email')} />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={createTeam.isPending || updateTeam.isPending}>
                {editTarget ? 'Enregistrer' : 'Ajouter'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer l'équipe ?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `${deleteTarget.player1Name} / ${deleteTarget.player2Name} sera supprimée définitivement.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
