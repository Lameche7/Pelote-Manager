import { useEffect } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import {
  useTournamentSettings,
  useCreateTournamentSettings,
  useUpdateTournamentSettings,
  useSeries,
  useReplaceSeries,
} from '@/hooks/useTournament'
import { DEFAULT_SERIES_NAMES, DAY_NAMES_FR } from '@/types/domain'

const seriesSchema = z.object({
  name: z.string().min(1, 'Nom requis'),
  order: z.number().int().min(0),
  max_teams: z.number().int().min(0),
})

const settingsSchema = z.object({
  name: z.string().min(1, 'Nom du tournoi requis'),
  location: z.string().min(1, 'Lieu requis'),
  start_date: z.string().min(1, 'Date de début requise'),
  end_date: z.string().min(1, 'Date de fin requise'),
  number_of_weeks: z.number().int().min(1),
  number_of_courts: z.number().int().min(1),
  match_duration_minutes: z.number().int().min(15),
  day_start_time: z.string().min(1),
  day_end_time: z.string().min(1),
  playable_days: z.array(z.number()),
  series: z.array(seriesSchema),
})

type SettingsForm = z.infer<typeof settingsSchema>

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 0] as const

/** Admin settings page: tournament configuration + series management. */
export function AdminSettingsPage() {
  const { data: settings, isLoading: settingsLoading } = useTournamentSettings()
  const { data: seriesList, isLoading: seriesLoading } = useSeries(settings?.id)
  const createSettings = useCreateTournamentSettings()
  const updateSettings = useUpdateTournamentSettings()
  const replaceSeries = useReplaceSeries()

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: '',
      location: '',
      start_date: '',
      end_date: '',
      number_of_weeks: 4,
      number_of_courts: 2,
      match_duration_minutes: 45,
      day_start_time: '09:00',
      day_end_time: '20:00',
      playable_days: [1, 2, 3, 4, 5, 6],
      series: DEFAULT_SERIES_NAMES.map((name, i) => ({
        name,
        order: i,
        max_teams: 8,
      })),
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'series' })
  const playableDays = watch('playable_days')

  useEffect(() => {
    if (settings) {
      reset({
        name: settings.name,
        location: settings.location,
        start_date: settings.startDate,
        end_date: settings.endDate,
        number_of_weeks: settings.numberOfWeeks,
        number_of_courts: settings.numberOfCourts,
        match_duration_minutes: settings.matchDurationMinutes,
        day_start_time: settings.dayStartTime.slice(0, 5),
        day_end_time: settings.dayEndTime.slice(0, 5),
        playable_days: settings.playableDays,
        series:
          seriesList?.map((s) => ({
            name: s.name,
            order: s.order,
            max_teams: s.maxTeams,
          })) ??
          DEFAULT_SERIES_NAMES.map((name, i) => ({
            name,
            order: i,
            max_teams: 8,
          })),
      })
    }
  }, [settings, seriesList, reset])

  function toggleDay(day: number) {
    const current = playableDays ?? []
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day]
    setValue('playable_days', next, { shouldDirty: true })
  }

  async function onSubmit(data: SettingsForm) {
    try {
      let tournamentId: string

      const payload = {
        name: data.name,
        location: data.location,
        start_date: data.start_date,
        end_date: data.end_date,
        number_of_weeks: data.number_of_weeks,
        number_of_courts: data.number_of_courts,
        match_duration_minutes: data.match_duration_minutes,
        day_start_time: data.day_start_time,
        day_end_time: data.day_end_time,
        playable_days: data.playable_days,
        time_slots: [],
        registration_open: settings?.registrationOpen ?? false,
        registration_deadline: settings?.registrationDeadline ?? null,
        phase: settings?.phase ?? 'registration' as const,
      }

      if (settings) {
        await updateSettings.mutateAsync({ id: settings.id, payload })
        tournamentId = settings.id
      } else {
        const created = await createSettings.mutateAsync(payload)
        tournamentId = created.id
      }

      await replaceSeries.mutateAsync({
        tournamentId,
        series: data.series.map((s, i) => ({
          name: s.name,
          order: i,
          max_teams: s.max_teams,
        })),
      })

      toast.success('Paramètres sauvegardés')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la sauvegarde'
      toast.error(msg)
    }
  }

  if (settingsLoading || seriesLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Paramètres du tournoi</h1>
        <p className="text-muted-foreground">Configuration générale du tournoi de pelote basque</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* General info */}
        <Card>
          <CardHeader>
            <CardTitle>Informations générales</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="name">Nom du tournoi</Label>
                <Input id="name" {...register('name')} />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="location">Lieu</Label>
                <Input id="location" {...register('location')} />
                {errors.location && (
                  <p className="text-xs text-destructive">{errors.location.message}</p>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="start_date">Date de début</Label>
                <Input id="start_date" type="date" {...register('start_date')} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="end_date">Date de fin</Label>
                <Input id="end_date" type="date" {...register('end_date')} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="number_of_weeks">Nombre de semaines</Label>
                <Input id="number_of_weeks" type="number" min="1" {...register('number_of_weeks', { valueAsNumber: true })} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Courts & timing */}
        <Card>
          <CardHeader>
            <CardTitle>Terrains et créneaux</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="number_of_courts">Nombre de terrains</Label>
                <Input
                  id="number_of_courts"
                  type="number"
                  min="1"
                  {...register('number_of_courts', { valueAsNumber: true })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="match_duration_minutes">Durée d'un match (min)</Label>
                <Input
                  id="match_duration_minutes"
                  type="number"
                  min="15"
                  {...register('match_duration_minutes', { valueAsNumber: true })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="day_start_time">Heure début</Label>
                <Input id="day_start_time" type="time" {...register('day_start_time')} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="day_end_time">Heure fin</Label>
                <Input id="day_end_time" type="time" {...register('day_end_time')} />
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Jours jouables</Label>
              <div className="flex flex-wrap gap-3">
                {ALL_DAYS.map((day) => (
                  <label key={day} className="flex cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={playableDays?.includes(day) ?? false}
                      onCheckedChange={() => toggleDay(day)}
                    />
                    <span className="text-sm">{DAY_NAMES_FR[day]}</span>
                  </label>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Series */}
        <Card>
          <CardHeader>
            <CardTitle>Séries disponibles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Définissez les séries du tournoi. Une série avec capacité maximale = 0 est désactivée.
            </p>

            <div className="space-y-3">
              {fields.map((field, index) => (
                <div key={field.id} className="flex items-center gap-3">
                  <div className="flex-1">
                    <Input
                      placeholder="Nom de la série"
                      {...register(`series.${index}.name`)}
                    />
                  </div>
                  <div className="w-32">
                    <Input
                      type="number"
                      min="0"
                      placeholder="Max équipes"
                      title="Capacité maximale (0 = désactivée)"
                      {...register(`series.${index}.max_teams`, { valueAsNumber: true })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(index)}
                    aria-label="Supprimer la série"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ name: '', order: fields.length, max_teams: 8 })}
            >
              <Plus className="mr-2 h-4 w-4" />
              Ajouter une série
            </Button>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!isDirty || createSettings.isPending || updateSettings.isPending}
          >
            <Save className="mr-2 h-4 w-4" />
            Enregistrer les paramètres
          </Button>
        </div>
      </form>
    </div>
  )
}
