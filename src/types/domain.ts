/** Application-level domain types (mapped from database rows). */

export interface TournamentSettings {
  id: string
  name: string
  location: string
  startDate: string
  endDate: string
  numberOfWeeks: number
  timeSlots: string[]
  numberOfCourts: number
  matchDurationMinutes: number
  dayStartTime: string
  dayEndTime: string
  playableDays: number[]
  registrationOpen: boolean
  registrationDeadline: string | null
  phase: 'registration' | 'pools' | 'planning' | 'in_progress' | 'finished'
}

export interface Series {
  id: string
  tournamentId: string
  name: string
  order: number
  maxTeams: number
}

export interface Team {
  id: string
  tournamentId: string
  seriesId: string
  player1Name: string
  player2Name: string
  phone: string | null
  email: string | null
  availabilities: TeamAvailability[]
}

export interface TeamAvailability {
  id: string
  teamId: string
  dayOfWeek: number
  startTime: string
  endTime: string
}

export interface Pool {
  id: string
  tournamentId: string
  seriesId: string
  name: string
  validated: boolean
  teams: Team[]
}

export interface Match {
  id: string
  tournamentId: string
  poolId: string
  teamA: Team
  teamB: Team
  courtId: string | null
  scheduledDate: string | null
  scheduledTime: string | null
  scoreA: number | null
  scoreB: number | null
  setsA: number | null
  setsB: number | null
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
}

export interface Court {
  id: string
  tournamentId: string
  name: string
  number: number
}

export interface Reservation {
  id: string
  courtId: string
  userName: string
  userEmail: string | null
  userPhone: string | null
  date: string
  startTime: string
  endTime: string
}

/** Standings entry for a team in a pool. */
export interface StandingsEntry {
  team: Team
  points: number
  played: number
  won: number
  lost: number
  setsFor: number
  setsAgainst: number
  setsDiff: number
}

/** Days of the week (0 = Sunday, 1 = Monday, ..., 6 = Saturday). */
export const DAY_NAMES_FR: Record<number, string> = {
  0: 'Dimanche',
  1: 'Lundi',
  2: 'Mardi',
  3: 'Mercredi',
  4: 'Jeudi',
  5: 'Vendredi',
  6: 'Samedi',
}

export const DEFAULT_SERIES_NAMES = [
  '1ère Série',
  '2ème Série',
  '3ème Série',
  '4ème Série',
  'Féminine',
  'Mixte',
] as const
