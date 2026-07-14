import type { Team } from '@/types/domain'

/** A proposed grouping of teams into pools. */
export interface PoolProposal {
  pools: Team[][]
}

/**
 * Generates balanced pool groupings for a set of teams.
 *
 * Rules:
 * - Pools should have sizes as equal as possible.
 * - Preferred pool sizes are 4 or 3 teams.
 * - Teams with more common availability slots are grouped together.
 */
export function generatePools(teams: Team[]): PoolProposal {
  if (teams.length === 0) return { pools: [] }

  const sorted = sortByAvailabilityCompatibility(teams)
  const poolSizes = computePoolSizes(sorted.length)
  const pools = distributeTeams(sorted, poolSizes)

  return { pools }
}

/**
 * Computes optimal pool sizes for a given number of teams.
 * Prefers pools of 4; uses 3 for remainders.
 */
function computePoolSizes(count: number): number[] {
  if (count === 0) return []

  const sizes: number[] = []
  let remaining = count

  // Fill with groups of 4
  while (remaining >= 4) {
    // If we'd be left with 1, use groups of 3 instead
    if (remaining === 5) {
      sizes.push(3)
      sizes.push(2)
      remaining = 0
    } else if (remaining === 7) {
      sizes.push(4)
      sizes.push(3)
      remaining = 0
    } else {
      sizes.push(4)
      remaining -= 4
    }
  }

  if (remaining > 0) sizes.push(remaining)

  return sizes
}

/**
 * Sorts teams so that those with more availability overlap are adjacent.
 * Uses a greedy nearest-neighbour heuristic.
 */
function sortByAvailabilityCompatibility(teams: Team[]): Team[] {
  if (teams.length <= 1) return [...teams]

  const used = new Set<string>()
  const result: Team[] = []

  result.push(teams[0])
  used.add(teams[0].id)

  while (result.length < teams.length) {
    const last = result[result.length - 1]
    let bestScore = -1
    let bestTeam: Team = teams.find((t) => !used.has(t.id))!

    for (const team of teams) {
      if (used.has(team.id)) continue
      const score = availabilityOverlap(last, team)
      if (score > bestScore) {
        bestScore = score
        bestTeam = team
      }
    }

    result.push(bestTeam)
    used.add(bestTeam.id)
  }

  return result
}

/**
 * Counts the number of overlapping availability slots between two teams.
 */
function availabilityOverlap(a: Team, b: Team): number {
  let overlap = 0

  for (const slotA of a.availabilities) {
    for (const slotB of b.availabilities) {
      if (slotA.dayOfWeek !== slotB.dayOfWeek) continue

      const startA = timeToMinutes(slotA.startTime)
      const endA = timeToMinutes(slotA.endTime)
      const startB = timeToMinutes(slotB.startTime)
      const endB = timeToMinutes(slotB.endTime)

      const overlapStart = Math.max(startA, startB)
      const overlapEnd = Math.min(endA, endB)

      if (overlapEnd > overlapStart) {
        overlap += overlapEnd - overlapStart
      }
    }
  }

  return overlap
}

/** Converts "HH:MM" to total minutes. */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/** Distributes teams into pools according to size specifications. */
function distributeTeams(teams: Team[], sizes: number[]): Team[][] {
  const pools: Team[][] = []
  let offset = 0

  for (const size of sizes) {
    pools.push(teams.slice(offset, offset + size))
    offset += size
  }

  return pools
}
