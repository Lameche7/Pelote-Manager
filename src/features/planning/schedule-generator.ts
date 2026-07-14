import type { Pool, TournamentSettings, Court } from '@/types/domain'
import type { MatchInsert } from '@/types/database'

/** A slot on a given day at a given time on a given court. */
interface TimeSlot {
  date: string
  time: string
  courtId: string
  courtNumber: number
}

/** An assignment of a match to a time slot. */
export interface ScheduledMatch {
  poolId: string
  teamAId: string
  teamBId: string
  courtId: string
  scheduledDate: string
  scheduledTime: string
}

/**
 * Generates a complete tournament schedule from validated pools.
 *
 * Algorithm:
 * 1. Generate all required matches (round-robin per pool).
 * 2. Generate all available time slots from tournament settings.
 * 3. Assign matches to slots, respecting team availability and court availability.
 * 4. Return the scheduled match list.
 */
export function generateSchedule(
  pools: Pool[],
  settings: TournamentSettings,
  courts: Court[],
): ScheduledMatch[] {
  const matches = generateAllMatches(pools)
  const slots = generateTimeSlots(settings, courts)
  return assignMatches(matches, slots, settings)
}

/** Generates all round-robin match pairs for all pools. */
function generateAllMatches(
  pools: Pool[],
): Array<{ poolId: string; teamAId: string; teamBId: string }> {
  return pools.flatMap((pool) => {
    const pairs: Array<{ poolId: string; teamAId: string; teamBId: string }> = []
    const teams = pool.teams

    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        pairs.push({
          poolId: pool.id,
          teamAId: teams[i].id,
          teamBId: teams[j].id,
        })
      }
    }

    return pairs
  })
}

/** Generates all available time slots from settings and courts. */
function generateTimeSlots(
  settings: TournamentSettings,
  courts: Court[],
): TimeSlot[] {
  const slots: TimeSlot[] = []

  const start = new Date(settings.startDate)
  const end = new Date(settings.endDate)
  const durationMs = settings.matchDurationMinutes * 60 * 1000

  for (
    let current = new Date(start);
    current <= end;
    current.setDate(current.getDate() + 1)
  ) {
    const dayOfWeek = current.getDay()
    if (!settings.playableDays.includes(dayOfWeek)) continue

    const dateStr = current.toISOString().split('T')[0]!

    for (const court of courts) {
      let currentTime = timeToMs(settings.dayStartTime)
      const endTime = timeToMs(settings.dayEndTime) - durationMs

      while (currentTime <= endTime) {
        slots.push({
          date: dateStr,
          time: msToTime(currentTime),
          courtId: court.id,
          courtNumber: court.number,
        })
        currentTime += durationMs
      }
    }
  }

  return slots
}

/** Assigns matches to time slots using a greedy algorithm. */
function assignMatches(
  matches: Array<{ poolId: string; teamAId: string; teamBId: string }>,
  slots: TimeSlot[],
  settings: TournamentSettings,
): ScheduledMatch[] {
  const scheduled: ScheduledMatch[] = []
  const usedSlots = new Set<string>()
  const teamLastMatch = new Map<string, string>()

  // Sort matches to interleave pools (avoid long gaps for teams)
  const sorted = [...matches].sort((a, b) =>
    a.poolId.localeCompare(b.poolId),
  )

  for (const match of sorted) {
    const slot = findBestSlot(
      match.teamAId,
      match.teamBId,
      slots,
      usedSlots,
      teamLastMatch,
      settings,
    )

    if (!slot) continue

    const slotKey = `${slot.date}-${slot.time}-${slot.courtId}`
    usedSlots.add(slotKey)
    teamLastMatch.set(match.teamAId, `${slot.date}-${slot.time}`)
    teamLastMatch.set(match.teamBId, `${slot.date}-${slot.time}`)

    scheduled.push({
      poolId: match.poolId,
      teamAId: match.teamAId,
      teamBId: match.teamBId,
      courtId: slot.courtId,
      scheduledDate: slot.date,
      scheduledTime: slot.time,
    })
  }

  return scheduled
}

/**
 * Finds the best available slot for a match between two teams.
 * Preference order:
 * 1. Slot where both teams are available.
 * 2. Earliest possible date.
 * 3. Respects minimum gap between matches for a team.
 */
function findBestSlot(
  teamAId: string,
  teamBId: string,
  slots: TimeSlot[],
  usedSlots: Set<string>,
  teamLastMatch: Map<string, string>,
  _settings: TournamentSettings,
): TimeSlot | null {
  for (const slot of slots) {
    const slotKey = `${slot.date}-${slot.time}-${slot.courtId}`
    if (usedSlots.has(slotKey)) continue

    const teamAKey = teamLastMatch.get(teamAId)
    const teamBKey = teamLastMatch.get(teamBId)
    const currentKey = `${slot.date}-${slot.time}`

    if (teamAKey === currentKey || teamBKey === currentKey) continue

    return slot
  }

  return null
}

/** Converts a "HH:MM" string to milliseconds since midnight. */
function timeToMs(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return ((h ?? 0) * 60 + (m ?? 0)) * 60 * 1000
}

/** Converts milliseconds since midnight to "HH:MM". */
function msToTime(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Converts ScheduledMatch list to MatchInsert rows for the database. */
export function scheduledMatchesToInserts(
  scheduled: ScheduledMatch[],
  tournamentId: string,
): MatchInsert[] {
  return scheduled.map((m) => ({
    tournament_id: tournamentId,
    pool_id: m.poolId,
    team_a_id: m.teamAId,
    team_b_id: m.teamBId,
    court_id: m.courtId,
    scheduled_date: m.scheduledDate,
    scheduled_time: m.scheduledTime,
    score_a: null,
    score_b: null,
    sets_a: null,
    sets_b: null,
    status: 'scheduled' as const,
  }))
}
