import { Link } from '@tanstack/react-router'
import { CalendarDays, Trophy, MapPin, Users, ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { useTournamentSettings, useSeries } from '@/hooks/useTournament'
import { useTeams } from '@/hooks/useTeams'
import { formatDate } from '@/lib/utils'

/** Public home page. */
export function PublicHomePage() {
  const { data: settings, isLoading } = useTournamentSettings()
  const { data: seriesList = [] } = useSeries(settings?.id)
  const { data: teams = [] } = useTeams(settings?.id)

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  const activeSeries = seriesList.filter((s) => s.maxTeams > 0)

  return (
    <div className="container mx-auto space-y-16 px-4 py-12">
      {/* Hero */}
      <section className="space-y-4 text-center">
        <div className="flex justify-center">
          <Trophy className="h-16 w-16 text-primary" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight">PCL Lourdais</h1>
        <p className="mx-auto max-w-xl text-lg text-muted-foreground">
          Pala Club Lourdais – Gestion des tournois de pelote basque
        </p>
      </section>

      {/* Registration card (if open) */}
      {settings?.registrationOpen && (
        <section>
          <Card className="border-primary shadow-md">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-primary">
                  <ClipboardList className="h-5 w-5" />
                  INSCRIPTIONS OUVERTES
                </CardTitle>
                <Badge>Ouvert</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex items-center gap-2 text-sm">
                  <Trophy className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{settings.name}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{settings.location}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CalendarDays className="h-4 w-4 text-muted-foreground" />
                  <span>
                    Du {formatDate(settings.startDate)} au {formatDate(settings.endDate)}
                  </span>
                </div>
              </div>

              {settings.registrationDeadline && (
                <p className="text-sm text-muted-foreground">
                  Date limite d'inscription : {formatDate(settings.registrationDeadline)}
                </p>
              )}

              <Link to="/tournoi">
                <Button size="lg" className="w-full sm:w-auto">
                  S'inscrire
                </Button>
              </Link>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Teams by series */}
      {activeSeries.length > 0 && teams.length > 0 && (
        <section className="space-y-6">
          <h2 className="text-2xl font-bold">Équipes inscrites</h2>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {activeSeries.map((series) => {
              const seriesTeams = teams.filter((t) => t.seriesId === series.id)
              if (seriesTeams.length === 0) return null

              return (
                <Card key={series.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-base">
                      {series.name}
                      <Badge variant="secondary">
                        <Users className="mr-1 h-3 w-3" />
                        {seriesTeams.length}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1 text-sm">
                      {seriesTeams.map((team) => (
                        <li key={team.id} className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                          {team.player1Name} / {team.player2Name}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </section>
      )}

      {/* Info cards */}
      <section className="grid gap-6 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-5 w-5 text-primary" />
              Calendrier
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Consultez le planning des matchs et les résultats en temps réel.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-5 w-5 text-primary" />
              Résultats
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Suivez les classements par poule et par série tout au long du tournoi.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-5 w-5 text-primary" />
              Réservations
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Réservez un terrain en dehors des périodes de tournoi.
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
