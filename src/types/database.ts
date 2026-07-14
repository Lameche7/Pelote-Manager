/** Auto-generated types for the Supabase database schema. */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      tournament_settings: {
        Row: TournamentSettingsRow
        Insert: TournamentSettingsInsert
        Update: TournamentSettingsUpdate
        Relationships: []
      }
      series: {
        Row: SeriesRow
        Insert: SeriesInsert
        Update: SeriesUpdate
        Relationships: []
      }
      teams: {
        Row: TeamRow
        Insert: TeamInsert
        Update: TeamUpdate
        Relationships: []
      }
      team_availabilities: {
        Row: TeamAvailabilityRow
        Insert: TeamAvailabilityInsert
        Update: TeamAvailabilityUpdate
        Relationships: []
      }
      pools: {
        Row: PoolRow
        Insert: PoolInsert
        Update: PoolUpdate
        Relationships: []
      }
      pool_teams: {
        Row: PoolTeamRow
        Insert: PoolTeamInsert
        Update: PoolTeamUpdate
        Relationships: []
      }
      matches: {
        Row: MatchRow
        Insert: MatchInsert
        Update: MatchUpdate
        Relationships: []
      }
      courts: {
        Row: CourtRow
        Insert: CourtInsert
        Update: CourtUpdate
        Relationships: []
      }
      reservations: {
        Row: ReservationRow
        Insert: ReservationInsert
        Update: ReservationUpdate
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      match_status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
      tournament_phase: 'registration' | 'pools' | 'planning' | 'in_progress' | 'finished'
    }
    CompositeTypes: Record<string, never>
  }
}

// ─── Tournament Settings ───────────────────────────────────────────────────

export interface TournamentSettingsRow {
  id: string
  name: string
  location: string
  start_date: string
  end_date: string
  number_of_weeks: number
  time_slots: string[]
  number_of_courts: number
  match_duration_minutes: number
  day_start_time: string
  day_end_time: string
  playable_days: number[]
  registration_open: boolean
  registration_deadline: string | null
  phase: 'registration' | 'pools' | 'planning' | 'in_progress' | 'finished'
  created_at: string
  updated_at: string
}

export type TournamentSettingsInsert = Omit<TournamentSettingsRow, 'id' | 'created_at' | 'updated_at'>
export type TournamentSettingsUpdate = Partial<TournamentSettingsInsert>

// ─── Series ───────────────────────────────────────────────────────────────

export interface SeriesRow {
  id: string
  tournament_id: string
  name: string
  order: number
  max_teams: number
  created_at: string
  updated_at: string
}

export type SeriesInsert = Omit<SeriesRow, 'id' | 'created_at' | 'updated_at'>
export type SeriesUpdate = Partial<SeriesInsert>

// ─── Teams ────────────────────────────────────────────────────────────────

export interface TeamRow {
  id: string
  tournament_id: string
  series_id: string
  player1_name: string
  player2_name: string
  phone: string | null
  email: string | null
  created_at: string
  updated_at: string
}

export type TeamInsert = Omit<TeamRow, 'id' | 'created_at' | 'updated_at'>
export type TeamUpdate = Partial<TeamInsert>

// ─── Team Availabilities ──────────────────────────────────────────────────

export interface TeamAvailabilityRow {
  id: string
  team_id: string
  day_of_week: number
  start_time: string
  end_time: string
}

export type TeamAvailabilityInsert = Omit<TeamAvailabilityRow, 'id'>
export type TeamAvailabilityUpdate = Partial<TeamAvailabilityInsert>

// ─── Pools ────────────────────────────────────────────────────────────────

export interface PoolRow {
  id: string
  tournament_id: string
  series_id: string
  name: string
  validated: boolean
  created_at: string
  updated_at: string
}

export type PoolInsert = Omit<PoolRow, 'id' | 'created_at' | 'updated_at'>
export type PoolUpdate = Partial<PoolInsert>

// ─── Pool Teams ───────────────────────────────────────────────────────────

export interface PoolTeamRow {
  id: string
  pool_id: string
  team_id: string
}

export type PoolTeamInsert = Omit<PoolTeamRow, 'id'>
export type PoolTeamUpdate = Partial<PoolTeamInsert>

// ─── Matches ──────────────────────────────────────────────────────────────

export interface MatchRow {
  id: string
  tournament_id: string
  pool_id: string
  team_a_id: string
  team_b_id: string
  court_id: string | null
  scheduled_date: string | null
  scheduled_time: string | null
  score_a: number | null
  score_b: number | null
  sets_a: number | null
  sets_b: number | null
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
  created_at: string
  updated_at: string
}

export type MatchInsert = Omit<MatchRow, 'id' | 'created_at' | 'updated_at'>
export type MatchUpdate = Partial<MatchInsert>

// ─── Courts ───────────────────────────────────────────────────────────────

export interface CourtRow {
  id: string
  tournament_id: string
  name: string
  number: number
}

export type CourtInsert = Omit<CourtRow, 'id'>
export type CourtUpdate = Partial<CourtInsert>

// ─── Reservations ─────────────────────────────────────────────────────────

export interface ReservationRow {
  id: string
  court_id: string
  user_name: string
  user_email: string | null
  user_phone: string | null
  date: string
  start_time: string
  end_time: string
  created_at: string
}

export type ReservationInsert = Omit<ReservationRow, 'id' | 'created_at'>
export type ReservationUpdate = Partial<ReservationInsert>
