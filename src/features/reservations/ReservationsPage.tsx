import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CalendarDays } from 'lucide-react'
import { toast } from 'sonner'
import { format, addDays, startOfWeek } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { useTournamentSettings } from '@/hooks/useTournament'
import { useCourts } from '@/hooks/useMatches'
import { fetchReservations, createReservation } from '@/services/reservations.service'
import { useQuery, useQueryClient } from '@tanstack/react-query'

const reservationSchema = z.object({
  user_name: z.string().min(1, 'Nom requis'),
  user_email: z.string().email('Email invalide').optional().or(z.literal('')),
  user_phone: z.string().optional(),
  court_id: z.string().min(1, 'Terrain requis'),
  date: z.string().min(1, 'Date requise'),
  start_time: z.string().min(1, 'Heure de début requise'),
})

type ReservationForm = z.infer<typeof reservationSchema>

/** Public reservations page. */
export function ReservationsPage() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<{
    courtId: string
    date: string
    time: string
  } | null>(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const qc = useQueryClient()

  const { data: settings } = useTournamentSettings()
  const { data: courts = [], isLoading: courtsLoading } = useCourts(settings?.id)

  const weekStart = startOfWeek(addDays(new Date(), weekOffset * 7), { weekStartsOn: 1 })
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const dateFrom = format(weekStart, 'yyyy-MM-dd')
  const dateTo = format(weekDates[6]!, 'yyyy-MM-dd')

  const { data: reservations = [], isLoading: reservationsLoading } = useQuery({
    queryKey: ['reservations', dateFrom, dateTo],
    queryFn: () => fetchReservations(dateFrom, dateTo),
  })

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<ReservationForm>({ resolver: zodResolver(reservationSchema) })

  function openReservation(courtId: string, date: string, time: string) {
    setSelectedSlot({ courtId, date, time })
    reset({ court_id: courtId, date, start_time: time, user_name: '', user_email: '', user_phone: '' })
    setValue('court_id', courtId)
    setValue('date', date)
    setValue('start_time', time)
    setDialogOpen(true)
  }

  async function onSubmit(data: ReservationForm) {
    const [h, m] = data.start_time.split(':').map(Number)
    const endH = (h ?? 0) + 1
    const endTime = `${String(endH).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`

    try {
      await createReservation({
        court_id: data.court_id,
        user_name: data.user_name,
        user_email: data.user_email || null,
        user_phone: data.user_phone || null,
        date: data.date,
        start_time: data.start_time,
        end_time: endTime,
      })
      await qc.invalidateQueries({ queryKey: ['reservations'] })
      toast.success('Réservation confirmée')
      setDialogOpen(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur de réservation'
      toast.error(msg)
    }
  }

  const TIME_SLOTS = ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00']

  if (courtsLoading || reservationsLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="container mx-auto space-y-8 px-4 py-12">
      <div>
        <h1 className="text-3xl font-bold">Réservations</h1>
        <p className="text-muted-foreground">Réservez un terrain de pelote basque</p>
      </div>

      {/* Week navigation */}
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => setWeekOffset((w) => w - 1)}>
          ← Semaine précédente
        </Button>
        <span className="text-sm font-medium">
          Semaine du {format(weekStart, 'dd MMMM yyyy', { locale: fr })}
        </span>
        <Button variant="outline" size="sm" onClick={() => setWeekOffset((w) => w + 1)}>
          Semaine suivante →
        </Button>
      </div>

      {courts.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Aucun terrain disponible pour les réservations.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {courts.map((court) => (
            <Card key={court.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarDays className="h-5 w-5 text-primary" />
                  {court.name}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px] text-sm">
                    <thead>
                      <tr>
                        <th className="w-20 pb-2 text-left text-xs text-muted-foreground">Heure</th>
                        {weekDates.map((d) => (
                          <th
                            key={d.toISOString()}
                            className="pb-2 text-center text-xs font-medium"
                          >
                            <span className="capitalize">
                              {format(d, 'EEE dd/MM', { locale: fr })}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {TIME_SLOTS.map((time) => (
                        <tr key={time} className="border-t">
                          <td className="py-1 pr-3 font-mono text-xs text-muted-foreground">
                            {time}
                          </td>
                          {weekDates.map((d) => {
                            const dateStr = format(d, 'yyyy-MM-dd')
                            const reserved = reservations.find(
                              (r) =>
                                r.courtId === court.id &&
                                r.date === dateStr &&
                                r.startTime.slice(0, 5) === time,
                            )
                            const isPast = d < new Date()

                            return (
                              <td key={d.toISOString()} className="px-1 py-1 text-center">
                                {reserved ? (
                                  <Badge variant="secondary" className="text-xs">
                                    {reserved.userName}
                                  </Badge>
                                ) : isPast ? (
                                  <span className="text-xs text-muted-foreground">–</span>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 text-xs text-primary hover:bg-primary/10"
                                    onClick={() => openReservation(court.id, dateStr, time)}
                                  >
                                    Libre
                                  </Button>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Reservation dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Réserver un créneau</DialogTitle>
          </DialogHeader>
          {selectedSlot && (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {courts.find((c) => c.id === selectedSlot.courtId)?.name} –{' '}
                {format(new Date(selectedSlot.date), 'EEEE dd MMMM yyyy', { locale: fr })} à{' '}
                {selectedSlot.time}
              </p>

              <div className="space-y-1">
                <Label htmlFor="user_name">Nom *</Label>
                <Input id="user_name" {...register('user_name')} />
                {errors.user_name && (
                  <p className="text-xs text-destructive">{errors.user_name.message}</p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="user_phone">Téléphone</Label>
                  <Input id="user_phone" {...register('user_phone')} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="user_email">Email</Label>
                  <Input id="user_email" type="email" {...register('user_email')} />
                  {errors.user_email && (
                    <p className="text-xs text-destructive">{errors.user_email.message}</p>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Annuler
                </Button>
                <Button type="submit">Confirmer la réservation</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
