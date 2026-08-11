export type PoolCompatibility = {
  teamAId: string;
  teamBId: string;
  commonSlotCount: number;
};

export type PoolEngineTeam = {
  id: string;
  seriesId: string;
  clubNames: string[];
};

export type PoolDraftTeam = {
  teamId: string;
};

export type PoolDraft = {
  key: string;
  seriesId: string;
  displayOrder: number;
  targetSize: 4 | 5 | 6;
  teams: PoolDraftTeam[];
};

export type PoolMetric = {
  minimum: number;
  average: number;
  pairCount: number;
};

export type PoolClubMetric = {
  maxTeamsPerClub: number;
  duplicatePairCount: number;
  representedClubCount: number;
};

export type SeriesPoolInput = {
  id: string;
  name: string;
  teams: PoolEngineTeam[];
};

export type GeneratePoolOptions = {
  series: SeriesPoolInput[];
  pairings: PoolCompatibility[];
  poolSizesBySeries?: Record<string, (4 | 5 | 6)[]>;
  random?: () => number;
  iterationsPerSeries?: number;
};

export type ClubAffiliations = ReadonlyMap<string, readonly string[]>;

const compatibilityKey = (left: string, right: string) =>
  left < right ? `${left}|${right}` : `${right}|${left}`;

const normalizeClubName = (value: string) =>
  value.trim().toLocaleLowerCase("fr-FR");

const distinctClubNames = (values: readonly string[]) => [
  ...new Set(values.map(normalizeClubName).filter(Boolean)),
];

export const buildCompatibilityMap = (pairings: PoolCompatibility[]) => {
  const result = new Map<string, number>();
  for (const pairing of pairings) {
    result.set(
      compatibilityKey(pairing.teamAId, pairing.teamBId),
      pairing.commonSlotCount,
    );
  }
  return result;
};

export const buildClubAffiliationMap = (
  teams: Pick<PoolEngineTeam, "id" | "clubNames">[],
): Map<string, string[]> =>
  new Map(teams.map((team) => [team.id, distinctClubNames(team.clubNames)]));

export const commonSlots = (
  compatibility: Map<string, number>,
  teamAId: string,
  teamBId: string,
) => compatibility.get(compatibilityKey(teamAId, teamBId)) ?? 0;

export const poolSizesFor = (teamCount: number): (4 | 5 | 6)[] => {
  if (teamCount === 0) return [];
  if (teamCount < 4) return [];

  let best: { fours: number; fives: number; sixes: number } | null = null;

  for (let sixes = 0; sixes <= Math.floor(teamCount / 6); sixes += 1) {
    for (let fives = 0; fives <= Math.floor(teamCount / 5); fives += 1) {
      const remaining = teamCount - sixes * 6 - fives * 5;
      if (remaining < 0 || remaining % 4 !== 0) continue;
      const fours = remaining / 4;
      const candidate = { fours, fives, sixes };

      if (
        !best ||
        candidate.fours > best.fours ||
        (candidate.fours === best.fours && candidate.sixes < best.sixes) ||
        (candidate.fours === best.fours &&
          candidate.sixes === best.sixes &&
          candidate.fives < best.fives)
      ) {
        best = candidate;
      }
    }
  }

  if (!best) return [];
  return [
    ...Array.from({ length: best.fours }, () => 4 as const),
    ...Array.from({ length: best.fives }, () => 5 as const),
    ...Array.from({ length: best.sixes }, () => 6 as const),
  ];
};

export const poolSizesAreValidFor = (
  teamCount: number,
  sizes: readonly number[],
): sizes is readonly (4 | 5 | 6)[] =>
  sizes.length > 0 &&
  sizes.every((size) => size === 4 || size === 5 || size === 6) &&
  sizes.reduce((sum, size) => sum + size, 0) === teamCount;

const shuffle = <T>(items: T[], random: () => number) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
};

export const getPoolMetric = (
  pool: PoolDraft,
  compatibility: Map<string, number>,
): PoolMetric => {
  if (pool.teams.length < 2) return { minimum: 0, average: 0, pairCount: 0 };

  const values: number[] = [];
  for (let left = 0; left < pool.teams.length; left += 1) {
    for (let right = left + 1; right < pool.teams.length; right += 1) {
      values.push(
        commonSlots(
          compatibility,
          pool.teams[left].teamId,
          pool.teams[right].teamId,
        ),
      );
    }
  }

  return {
    minimum: Math.min(...values),
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    pairCount: values.length,
  };
};

export const getSeriesMetric = (
  pools: PoolDraft[],
  compatibility: Map<string, number>,
): PoolMetric => {
  const values: number[] = [];
  for (const pool of pools) {
    for (let left = 0; left < pool.teams.length; left += 1) {
      for (let right = left + 1; right < pool.teams.length; right += 1) {
        values.push(
          commonSlots(
            compatibility,
            pool.teams[left].teamId,
            pool.teams[right].teamId,
          ),
        );
      }
    }
  }

  if (values.length === 0) return { minimum: 0, average: 0, pairCount: 0 };
  return {
    minimum: Math.min(...values),
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    pairCount: values.length,
  };
};

export const getPoolClubMetric = (
  pool: PoolDraft,
  affiliations: ClubAffiliations,
): PoolClubMetric => {
  const counts = new Map<string, number>();
  for (const assignment of pool.teams) {
    for (const clubName of distinctClubNames(
      affiliations.get(assignment.teamId) ?? [],
    )) {
      counts.set(clubName, (counts.get(clubName) ?? 0) + 1);
    }
  }

  let maxTeamsPerClub = 0;
  let duplicatePairCount = 0;
  for (const count of counts.values()) {
    maxTeamsPerClub = Math.max(maxTeamsPerClub, count);
    duplicatePairCount += (count * (count - 1)) / 2;
  }

  return {
    maxTeamsPerClub,
    duplicatePairCount,
    representedClubCount: counts.size,
  };
};

export const getSeriesClubMetric = (
  pools: PoolDraft[],
  affiliations: ClubAffiliations,
): PoolClubMetric => {
  let maxTeamsPerClub = 0;
  let duplicatePairCount = 0;
  const representedClubs = new Set<string>();

  for (const pool of pools) {
    const poolMetric = getPoolClubMetric(pool, affiliations);
    maxTeamsPerClub = Math.max(maxTeamsPerClub, poolMetric.maxTeamsPerClub);
    duplicatePairCount += poolMetric.duplicatePairCount;
    for (const assignment of pool.teams) {
      for (const clubName of distinctClubNames(
        affiliations.get(assignment.teamId) ?? [],
      )) {
        representedClubs.add(clubName);
      }
    }
  }

  return {
    maxTeamsPerClub,
    duplicatePairCount,
    representedClubCount: representedClubs.size,
  };
};

const availabilityMetricIsBetter = (
  candidate: PoolMetric,
  current: PoolMetric,
) => {
  if (candidate.minimum !== current.minimum) {
    return candidate.minimum > current.minimum;
  }
  return candidate.average > current.average + 0.0001;
};

const clubMetricIsBetter = (
  candidate: PoolClubMetric,
  current: PoolClubMetric,
) => {
  if (candidate.maxTeamsPerClub !== current.maxTeamsPerClub) {
    return candidate.maxTeamsPerClub < current.maxTeamsPerClub;
  }
  return candidate.duplicatePairCount < current.duplicatePairCount;
};

const clubMetricIsEqual = (left: PoolClubMetric, right: PoolClubMetric) =>
  left.maxTeamsPerClub === right.maxTeamsPerClub &&
  left.duplicatePairCount === right.duplicatePairCount;

const seedSeriesPools = (
  series: SeriesPoolInput,
  random: () => number,
  requestedSizes?: readonly (4 | 5 | 6)[],
) => {
  const sizes = requestedSizes ? [...requestedSizes] : poolSizesFor(series.teams.length);
  if (!poolSizesAreValidFor(series.teams.length, sizes)) {
    throw new Error(
      `${series.name} compte ${series.teams.length} équipes : la répartition choisie doit utiliser uniquement des poules de 4, 5 ou 6 et affecter toutes les équipes.`,
    );
  }

  const teams = shuffle(series.teams, random);
  let cursor = 0;
  return sizes.map((size, index): PoolDraft => {
    const assigned = teams.slice(cursor, cursor + size);
    cursor += size;
    return {
      key: `generated-${series.id}-${index}`,
      seriesId: series.id,
      displayOrder: index,
      targetSize: size,
      teams: assigned.map((team) => ({ teamId: team.id })),
    };
  });
};

const optimizeSeries = (
  pools: PoolDraft[],
  compatibility: Map<string, number>,
  affiliations: ClubAffiliations,
  random: () => number,
  iterations: number,
) => {
  let result = pools.map((pool) => ({
    ...pool,
    teams: pool.teams.map((team) => ({ ...team })),
  }));
  let clubScore = getSeriesClubMetric(result, affiliations);
  let availabilityScore = getSeriesMetric(result, compatibility);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const positions = result.flatMap((pool, poolIndex) =>
      pool.teams.map((_, teamIndex) => ({ poolIndex, teamIndex })),
    );
    if (positions.length < 2) break;

    const first = positions[Math.floor(random() * positions.length)];
    const candidates = positions.filter(
      (candidate) => candidate.poolIndex !== first.poolIndex,
    );
    if (candidates.length === 0) break;
    const second = candidates[Math.floor(random() * candidates.length)];

    const candidate = result.map((pool) => ({
      ...pool,
      teams: pool.teams.map((team) => ({ ...team })),
    }));
    const firstTeam = candidate[first.poolIndex].teams[first.teamIndex];
    candidate[first.poolIndex].teams[first.teamIndex] =
      candidate[second.poolIndex].teams[second.teamIndex];
    candidate[second.poolIndex].teams[second.teamIndex] = firstTeam;

    const candidateClubScore = getSeriesClubMetric(candidate, affiliations);
    const candidateAvailabilityScore = getSeriesMetric(
      candidate,
      compatibility,
    );
    if (
      clubMetricIsBetter(candidateClubScore, clubScore) ||
      (clubMetricIsEqual(candidateClubScore, clubScore) &&
        availabilityMetricIsBetter(
          candidateAvailabilityScore,
          availabilityScore,
        ))
    ) {
      result = candidate;
      clubScore = candidateClubScore;
      availabilityScore = candidateAvailabilityScore;
    }
  }

  return result;
};

export const generateOptimizedPools = ({
  series,
  pairings,
  poolSizesBySeries = {},
  random = Math.random,
  iterationsPerSeries = 2_500,
}: GeneratePoolOptions): PoolDraft[] => {
  const compatibility = buildCompatibilityMap(pairings);
  const result: PoolDraft[] = [];

  for (const currentSeries of series) {
    if (currentSeries.teams.length === 0) continue;
    const seeded = seedSeriesPools(
      currentSeries,
      random,
      poolSizesBySeries[currentSeries.id],
    );
    const affiliations = buildClubAffiliationMap(currentSeries.teams);
    result.push(
      ...optimizeSeries(
        seeded,
        compatibility,
        affiliations,
        random,
        Math.max(iterationsPerSeries, 0),
      ),
    );
  }

  return result;
};

const clonePools = (pools: PoolDraft[]) =>
  pools.map((pool) => ({
    ...pool,
    teams: pool.teams.map((team) => ({ ...team })),
  }));

export const swapPoolTeams = (
  pools: PoolDraft[],
  firstTeamId: string,
  secondTeamId: string,
) => {
  if (firstTeamId === secondTeamId) return clonePools(pools);
  const result = clonePools(pools);
  let first: { poolIndex: number; teamIndex: number } | null = null;
  let second: { poolIndex: number; teamIndex: number } | null = null;

  result.forEach((pool, poolIndex) => {
    pool.teams.forEach((team, teamIndex) => {
      if (team.teamId === firstTeamId) first = { poolIndex, teamIndex };
      if (team.teamId === secondTeamId) second = { poolIndex, teamIndex };
    });
  });

  if (!first || !second) return result;
  const firstPosition = first as { poolIndex: number; teamIndex: number };
  const secondPosition = second as { poolIndex: number; teamIndex: number };
  const firstPool = result[firstPosition.poolIndex];
  const secondPool = result[secondPosition.poolIndex];

  if (firstPool.seriesId !== secondPool.seriesId) return result;

  const firstTeam = firstPool.teams[firstPosition.teamIndex];
  firstPool.teams[firstPosition.teamIndex] =
    secondPool.teams[secondPosition.teamIndex];
  secondPool.teams[secondPosition.teamIndex] = firstTeam;
  return result;
};

export const movePoolTeam = (
  pools: PoolDraft[],
  teamId: string,
  targetPoolKey: string,
) => {
  const result = clonePools(pools);
  const sourcePool = result.find((pool) =>
    pool.teams.some((team) => team.teamId === teamId),
  );
  const targetPool = result.find((pool) => pool.key === targetPoolKey);
  if (!sourcePool || !targetPool || sourcePool.key === targetPool.key) {
    return result;
  }

  const team = sourcePool.teams.find(
    (candidate) => candidate.teamId === teamId,
  );
  if (
    !team ||
    sourcePool.seriesId !== targetPool.seriesId ||
    sourcePool.teams.length <= 4 ||
    targetPool.teams.length >= 6
  ) {
    return result;
  }

  sourcePool.teams = sourcePool.teams.filter(
    (candidate) => candidate.teamId !== teamId,
  );
  targetPool.teams.push(team);
  sourcePool.targetSize = sourcePool.teams.length as 4 | 5 | 6;
  targetPool.targetSize = targetPool.teams.length as 4 | 5 | 6;
  return result;
};
