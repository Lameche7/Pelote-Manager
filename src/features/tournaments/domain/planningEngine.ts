export type PlanningPoolInput = {
  id: string;
  seriesId: string;
  displayOrder: number;
  teamIds: string[];
};

export type PlanningMatch = {
  id: string;
  poolId: string;
  seriesId: string;
  teamAId: string;
  teamBId: string;
  displayOrder: number;
};

export type PlanningSlot = {
  id: string;
  resourceId: string;
  resourceName: string;
  date: string;
  startsAt: string;
  endsAt: string;
};

export type TeamPlanningAvailability = {
  teamId: string;
  slots: Array<{
    date: string;
    startsAt: string;
    endsAt: string;
  }>;
};

export type PlanningAssignment = {
  matchId: string;
  slotId: string;
};

export type PlanningDiagnostic = {
  severity: "info" | "warning" | "error";
  code:
    | "complete"
    | "no_common_availability"
    | "capacity_conflict"
    | "invalid_assignment";
  message: string;
  matchId?: string;
};

export type PlanningQuality = {
  score: number;
  completionRate: number;
  availabilityRate: number;
  restRate: number;
  distributionRate: number;
  scheduledMatches: number;
  totalMatches: number;
};

export type PlanningProposal = {
  assignments: PlanningAssignment[];
  unscheduledMatchIds: string[];
  diagnostics: PlanningDiagnostic[];
  quality: PlanningQuality;
};

export type GeneratePlanningOptions = {
  matches: PlanningMatch[];
  slots: PlanningSlot[];
  availability: TeamPlanningAvailability[];
  minimumRestMinutes?: number;
  iterations?: number;
  random?: () => number;
};

export type PlanningValidation = {
  valid: boolean;
  diagnostics: PlanningDiagnostic[];
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

const availabilityKey = (slot: {
  date: string;
  startsAt: string;
  endsAt: string;
}) => `${slot.date}|${slot.startsAt}|${slot.endsAt}`;

const timeToMinutes = (value: string) => {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
};

const dateOrdinal = (date: string) => {
  const [year = "0", month = "1", day = "1"] = date.split("-");
  return Math.floor(
    Date.UTC(Number(year), Number(month) - 1, Number(day)) / 86_400_000,
  );
};

const slotRange = (slot: PlanningSlot) => {
  const day = dateOrdinal(slot.date) * 1_440;
  return {
    start: day + timeToMinutes(slot.startsAt),
    end: day + timeToMinutes(slot.endsAt),
  };
};

const matchTeams = (match: PlanningMatch) => [match.teamAId, match.teamBId];

const sameMatchPair = (left: PlanningMatch, right: PlanningMatch) =>
  left.poolId === right.poolId &&
  ((left.teamAId === right.teamAId && left.teamBId === right.teamBId) ||
    (left.teamAId === right.teamBId && left.teamBId === right.teamAId));

export const buildRoundRobinMatches = (
  pools: PlanningPoolInput[],
): PlanningMatch[] => {
  const matches: PlanningMatch[] = [];

  for (const pool of pools) {
    let displayOrder = 0;
    for (let left = 0; left < pool.teamIds.length; left += 1) {
      for (let right = left + 1; right < pool.teamIds.length; right += 1) {
        const teamAId = pool.teamIds[left];
        const teamBId = pool.teamIds[right];
        if (!teamAId || !teamBId || teamAId === teamBId) continue;
        matches.push({
          id: `${pool.id}:${teamAId}:${teamBId}`,
          poolId: pool.id,
          seriesId: pool.seriesId,
          teamAId,
          teamBId,
          displayOrder,
        });
        displayOrder += 1;
      }
    }
  }

  return matches;
};

const buildAvailabilityMap = (availability: TeamPlanningAvailability[]) =>
  new Map(
    availability.map((team) => [
      team.teamId,
      new Set(team.slots.map(availabilityKey)),
    ]),
  );

const compatibleSlotsForMatch = (
  match: PlanningMatch,
  slots: PlanningSlot[],
  availabilityMap: Map<string, Set<string>>,
) => {
  const teamA = availabilityMap.get(match.teamAId) ?? new Set<string>();
  const teamB = availabilityMap.get(match.teamBId) ?? new Set<string>();
  return slots.filter((slot) => {
    const key = availabilityKey(slot);
    return teamA.has(key) && teamB.has(key);
  });
};

const hasSufficientRest = (
  match: PlanningMatch,
  slot: PlanningSlot,
  assignments: PlanningAssignment[],
  matchById: Map<string, PlanningMatch>,
  slotById: Map<string, PlanningSlot>,
  minimumRestMinutes: number,
) => {
  const candidate = slotRange(slot);
  const teams = new Set(matchTeams(match));

  for (const assignment of assignments) {
    const otherMatch = matchById.get(assignment.matchId);
    const otherSlot = slotById.get(assignment.slotId);
    if (!otherMatch || !otherSlot) continue;
    if (!matchTeams(otherMatch).some((teamId) => teams.has(teamId))) continue;

    const other = slotRange(otherSlot);
    const gap =
      candidate.start >= other.end
        ? candidate.start - other.end
        : other.start >= candidate.end
          ? other.start - candidate.end
          : -1;
    if (gap < minimumRestMinutes) return false;
  }

  return true;
};

const teamDayLoads = (
  assignments: PlanningAssignment[],
  matchById: Map<string, PlanningMatch>,
  slotById: Map<string, PlanningSlot>,
) => {
  const loads = new Map<string, number>();
  for (const assignment of assignments) {
    const match = matchById.get(assignment.matchId);
    const slot = slotById.get(assignment.slotId);
    if (!match || !slot) continue;
    for (const teamId of matchTeams(match)) {
      const key = `${teamId}|${slot.date}`;
      loads.set(key, (loads.get(key) ?? 0) + 1);
    }
  }
  return loads;
};

const candidateLoadScore = (
  match: PlanningMatch,
  slot: PlanningSlot,
  assignments: PlanningAssignment[],
  matchById: Map<string, PlanningMatch>,
  slotById: Map<string, PlanningSlot>,
) => {
  const loads = teamDayLoads(assignments, matchById, slotById);
  const teamLoad = matchTeams(match).reduce(
    (sum, teamId) => sum + (loads.get(`${teamId}|${slot.date}`) ?? 0),
    0,
  );
  const globalDayLoad = assignments.reduce((count, assignment) => {
    const assignedSlot = slotById.get(assignment.slotId);
    return count + (assignedSlot?.date === slot.date ? 1 : 0);
  }, 0);
  return teamLoad * 10_000 + globalDayLoad * 100 + timeToMinutes(slot.startsAt);
};

const distributionRate = (
  assignments: PlanningAssignment[],
  matchById: Map<string, PlanningMatch>,
  slotById: Map<string, PlanningSlot>,
) => {
  const loads = [...teamDayLoads(assignments, matchById, slotById).values()];
  if (loads.length === 0) return 100;
  const penalty = loads.reduce(
    (sum, load) => sum + Math.max(0, load - 1) * 12,
    0,
  );
  return clamp(Math.round(100 - penalty / loads.length), 0, 100);
};

const qualityFor = (
  matches: PlanningMatch[],
  assignments: PlanningAssignment[],
  matchById: Map<string, PlanningMatch>,
  slotById: Map<string, PlanningSlot>,
): PlanningQuality => {
  const totalMatches = matches.length;
  const scheduledMatches = assignments.length;
  const completionRate =
    totalMatches === 0 ? 100 : Math.round((scheduledMatches / totalMatches) * 100);
  const distribution = distributionRate(assignments, matchById, slotById);
  const score = Math.round(completionRate * 0.8 + distribution * 0.2);
  return {
    score,
    completionRate,
    availabilityRate: scheduledMatches === 0 && totalMatches > 0 ? 0 : 100,
    restRate: scheduledMatches === 0 && totalMatches > 0 ? 0 : 100,
    distributionRate: distribution,
    scheduledMatches,
    totalMatches,
  };
};

const proposalIsBetter = (left: PlanningProposal, right: PlanningProposal) => {
  if (left.unscheduledMatchIds.length !== right.unscheduledMatchIds.length) {
    return left.unscheduledMatchIds.length < right.unscheduledMatchIds.length;
  }
  if (left.quality.score !== right.quality.score) {
    return left.quality.score > right.quality.score;
  }
  return left.quality.distributionRate > right.quality.distributionRate;
};

const buildDiagnostics = (
  matches: PlanningMatch[],
  unscheduledMatchIds: string[],
  compatibleSlotCount: Map<string, number>,
): PlanningDiagnostic[] => {
  if (unscheduledMatchIds.length === 0) {
    return [
      {
        severity: "info",
        code: "complete",
        message: `Les ${matches.length} matchs de poules sont planifiés.`,
      },
    ];
  }

  return unscheduledMatchIds.map((matchId) => {
    const commonSlots = compatibleSlotCount.get(matchId) ?? 0;
    return commonSlots === 0
      ? {
          severity: "error" as const,
          code: "no_common_availability" as const,
          matchId,
          message: "Aucun créneau de disponibilité commun pour cette rencontre.",
        }
      : {
          severity: "error" as const,
          code: "capacity_conflict" as const,
          matchId,
          message: `${commonSlots} créneau(x) commun(s), mais les conflits de terrain, d’équipe ou de repos empêchent le placement.`,
        };
  });
};

export const validatePlanning = ({
  matches,
  slots,
  availability,
  assignments,
  minimumRestMinutes = 0,
}: Omit<GeneratePlanningOptions, "iterations" | "random"> & {
  assignments: PlanningAssignment[];
}): PlanningValidation => {
  const diagnostics: PlanningDiagnostic[] = [];
  const matchById = new Map(matches.map((match) => [match.id, match]));
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const availabilityMap = buildAvailabilityMap(availability);
  const seenMatches = new Set<string>();
  const seenSlots = new Set<string>();
  const accepted: PlanningAssignment[] = [];

  for (const assignment of assignments) {
    const match = matchById.get(assignment.matchId);
    const slot = slotById.get(assignment.slotId);
    let valid = true;

    if (!match || !slot || seenMatches.has(assignment.matchId) || seenSlots.has(assignment.slotId)) {
      valid = false;
    } else {
      const key = availabilityKey(slot);
      const teamA = availabilityMap.get(match.teamAId) ?? new Set<string>();
      const teamB = availabilityMap.get(match.teamBId) ?? new Set<string>();
      if (!teamA.has(key) || !teamB.has(key)) valid = false;
      if (
        valid &&
        !hasSufficientRest(
          match,
          slot,
          accepted,
          matchById,
          slotById,
          minimumRestMinutes,
        )
      ) {
        valid = false;
      }
    }

    if (!valid) {
      diagnostics.push({
        severity: "error",
        code: "invalid_assignment",
        matchId: assignment.matchId,
        message: "Cette affectation crée un conflit ou ne respecte pas les disponibilités.",
      });
      continue;
    }

    seenMatches.add(assignment.matchId);
    seenSlots.add(assignment.slotId);
    accepted.push(assignment);
  }

  return { valid: diagnostics.length === 0, diagnostics };
};

export const generatePlanningProposal = ({
  matches,
  slots,
  availability,
  minimumRestMinutes = 0,
  iterations = 250,
  random = Math.random,
}: GeneratePlanningOptions): PlanningProposal => {
  const matchById = new Map(matches.map((match) => [match.id, match]));
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const availabilityMap = buildAvailabilityMap(availability);
  const compatibleSlots = new Map(
    matches.map((match) => [
      match.id,
      compatibleSlotsForMatch(match, slots, availabilityMap),
    ]),
  );
  const compatibleSlotCount = new Map(
    [...compatibleSlots.entries()].map(([matchId, values]) => [
      matchId,
      values.length,
    ]),
  );

  const attempt = (): PlanningProposal => {
    const assignments: PlanningAssignment[] = [];
    const usedSlots = new Set<string>();
    const order = [...matches].sort((left, right) => {
      const difference =
        (compatibleSlotCount.get(left.id) ?? 0) -
        (compatibleSlotCount.get(right.id) ?? 0);
      return difference !== 0 ? difference : random() - 0.5;
    });

    for (const match of order) {
      const candidates = (compatibleSlots.get(match.id) ?? [])
        .filter((slot) => !usedSlots.has(slot.id))
        .filter((slot) =>
          hasSufficientRest(
            match,
            slot,
            assignments,
            matchById,
            slotById,
            minimumRestMinutes,
          ),
        )
        .map((slot) => ({
          slot,
          score:
            candidateLoadScore(
              match,
              slot,
              assignments,
              matchById,
              slotById,
            ) + random(),
        }))
        .sort((left, right) => left.score - right.score);

      const selected = candidates[0]?.slot;
      if (!selected) continue;
      assignments.push({ matchId: match.id, slotId: selected.id });
      usedSlots.add(selected.id);
    }

    const scheduled = new Set(assignments.map((assignment) => assignment.matchId));
    const unscheduledMatchIds = matches
      .filter((match) => !scheduled.has(match.id))
      .map((match) => match.id);
    const quality = qualityFor(matches, assignments, matchById, slotById);
    return {
      assignments,
      unscheduledMatchIds,
      diagnostics: buildDiagnostics(matches, unscheduledMatchIds, compatibleSlotCount),
      quality,
    };
  };

  let best = attempt();
  for (let index = 1; index < Math.max(1, iterations); index += 1) {
    const candidate = attempt();
    if (proposalIsBetter(candidate, best)) best = candidate;
    if (best.unscheduledMatchIds.length === 0 && best.quality.score === 100) break;
  }
  return best;
};

export const planningMatchCountForPoolSize = (teamCount: number) =>
  teamCount < 2 ? 0 : (teamCount * (teamCount - 1)) / 2;

export const hasDuplicateMatchPairs = (matches: PlanningMatch[]) =>
  matches.some((match, index) =>
    matches.slice(index + 1).some((other) => sameMatchPair(match, other)),
  );
