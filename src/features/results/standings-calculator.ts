import type { Match, StandingsEntry, Team } from '@/types/domain'

/**
 * Computes the standings for all teams in a pool based on completed matches.
 */
export function computeStandings(
  matches: Match[],
  teams: Team[],
): StandingsEntry[] {
  const map = new Map<string, StandingsEntry>()

  for (const team of teams) {
    map.set(team.id, {
      team,
      points: 0,
      played: 0,
      won: 0,
      lost: 0,
      setsFor: 0,
      setsAgainst: 0,
      setsDiff: 0,
    })
  }

  for (const match of matches) {
    if (match.status !== 'completed') continue
    if (match.scoreA === null || match.scoreB === null) continue

    const entryA = map.get(match.teamA.id)
    const entryB = map.get(match.teamB.id)

    if (!entryA || !entryB) continue

    const setsA = match.setsA ?? match.scoreA
    const setsB = match.setsB ?? match.scoreB

    entryA.played++
    entryB.played++
    entryA.setsFor += setsA
    entryA.setsAgainst += setsB
    entryB.setsFor += setsB
    entryB.setsAgainst += setsA

    if (setsA > setsB) {
      entryA.won++
      entryA.points += 2
      entryB.lost++
    } else if (setsB > setsA) {
      entryB.won++
      entryB.points += 2
      entryA.lost++
    } else {
      entryA.points += 1
      entryB.points += 1
    }
  }

  for (const entry of map.values()) {
    entry.setsDiff = entry.setsFor - entry.setsAgainst
  }

  return Array.from(map.values()).sort(compareStandings)
}

/**
 * Comparator for standings: points desc, then set diff desc, then sets for desc.
 */
function compareStandings(a: StandingsEntry, b: StandingsEntry): number {
  if (b.points !== a.points) return b.points - a.points
  if (b.setsDiff !== a.setsDiff) return b.setsDiff - a.setsDiff
  return b.setsFor - a.setsFor
}
