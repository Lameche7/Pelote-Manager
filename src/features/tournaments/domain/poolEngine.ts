export type PoolCompatibility = {
  teamAId: string;
  teamBId: string;
  commonSlotCount: number;
};

export type PoolEngineTeam = {
  id: string;
  seriesId: string;
};

export type PoolDraftTeam = {
  teamId: string;
  isLocked: boolean;
};

export type PoolDraft = {
  key: string;
  seriesId: string;
  displayOrder: number;
  targetSize: 4 | 5;
  isLocked: boolean;
  teams: PoolDraftTeam[];
};

export type PoolMetric = {
  minimum: number;
  average: number;
  pairCount: number;
};

export type SeriesPoolInput = {
  id: string;
  name: string;
  teams: PoolEngineTeam[];
};

export type GeneratePoolOptions = {
  series: SeriesPoolInput[];
  pairings: PoolCompatibility[];
  existingPools?: PoolDraft[];
  random?: () => number;
  iterationsPerSeries?: number;
};

const compatibilityKey = (left: string, right: string) =>
  left < right ? `${left}|${right}` : `${right}|${left}`;

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

export const commonSlots = (
  compatibility: Map<string, number>,
  teamAId: string,
  teamBId: string,
) => compatibility.get(compatibilityKey(teamAId, teamBId)) ?? 0;

export const poolSizesFor = (teamCount: number): (4 | 5)[] => {
  if (teamCount === 0) return [];
  if (teamCount < 4) return [];

  for (
    let poolCount = Math.floor(teamCount / 4);
    poolCount >= Math.ceil(teamCount / 5);
    poolCount -= 1
  ) {
    const fiveCount = teamCount - poolCount * 4;
    if (fiveCount < 0 || fiveCount > poolCount) continue;
    return Array.from({ length: poolCount }, (_, index) =>
      index < poolCount - fiveCount ? 4 : 5,
    );
  }

  return [];
};

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

const metricIsBetter = (candidate: PoolMetric, current: PoolMetric) => {
  if (candidate.minimum !== current.minimum) {
    return candidate.minimum > current.minimum;
  }
  return candidate.average > current.average + 0.0001;
};

const normalizePoolTeams = (pools: PoolDraft[]) =>
  pools.map((pool) => ({
    ...pool,
    targetSize: pool.teams.length as 4 | 5,
    teams: pool.teams.map((team) => ({ ...team })),
  }));

const seedSeriesPools = (
  series: SeriesPoolInput,
  existingPools: PoolDraft[],
  random: () => number,
) => {
  const knownTeamIds = new Set(series.teams.map((team) => team.id));
  const current = existingPools
    .filter((pool) => pool.seriesId === series.id)
    .sort((left, right) => left.displayOrder - right.displayOrder);

  if (current.length === 0) {
    const sizes = poolSizesFor(series.teams.length);
    if (sizes.length === 0 && series.teams.length > 0) {
      throw new Error(
        `${series.name} compte ${series.teams.length} équipes : impossible de constituer uniquement des poules de 4 ou 5.`,
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
        isLocked: false,
        teams: assigned.map((team) => ({ teamId: team.id, isLocked: false })),
      };
    });
  }

  const capacity = current.reduce((sum, pool) => sum + pool.targetSize, 0);
  if (capacity !== series.teams.length) {
    throw new Error(
      `${series.name} a changé de nombre d’équipes. Enregistrez une nouvelle génération complète.`,
    );
  }

  const fixedTeamIds = new Set<string>();
  const seeded = current.map((pool) => ({
    ...pool,
    teams: pool.teams
      .filter((team) => knownTeamIds.has(team.teamId))
      .filter((team) => {
        const fixed = pool.isLocked || team.isLocked;
        if (fixed) fixedTeamIds.add(team.teamId);
        return fixed;
      })
      .map((team) => ({
        ...team,
        isLocked: pool.isLocked || team.isLocked,
      })),
  }));

  const availableTeams = shuffle(
    series.teams.filter((team) => !fixedTeamIds.has(team.id)),
    random,
  );
  let cursor = 0;

  for (const pool of seeded) {
    const missing = pool.targetSize - pool.teams.length;
    if (missing < 0) {
      throw new Error(
        `La ${series.name} contient trop d’équipes verrouillées.`,
      );
    }
    const additions = availableTeams.slice(cursor, cursor + missing);
    cursor += missing;
    pool.teams.push(
      ...additions.map((team) => ({ teamId: team.id, isLocked: false })),
    );
  }

  if (cursor !== availableTeams.length) {
    throw new Error(
      `Impossible de rééquilibrer ${series.name} avec ces verrous.`,
    );
  }

  return seeded;
};

const optimizeSeries = (
  pools: PoolDraft[],
  compatibility: Map<string, number>,
  random: () => number,
  iterations: number,
) => {
  let result = normalizePoolTeams(pools);
  let score = getSeriesMetric(result, compatibility);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const movable: Array<{ poolIndex: number; teamIndex: number }> = [];
    result.forEach((pool, poolIndex) => {
      if (pool.isLocked) return;
      pool.teams.forEach((team, teamIndex) => {
        if (!team.isLocked) movable.push({ poolIndex, teamIndex });
      });
    });

    if (movable.length < 2) break;
    const first = movable[Math.floor(random() * movable.length)];
    const candidates = movable.filter(
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

    const candidateScore = getSeriesMetric(candidate, compatibility);
    if (metricIsBetter(candidateScore, score)) {
      result = candidate;
      score = candidateScore;
    }
  }

  return result;
};

export const generateOptimizedPools = ({
  series,
  pairings,
  existingPools = [],
  random = Math.random,
  iterationsPerSeries = 1_200,
}: GeneratePoolOptions): PoolDraft[] => {
  const compatibility = buildCompatibilityMap(pairings);
  const result: PoolDraft[] = [];

  for (const currentSeries of series) {
    const seeded = seedSeriesPools(currentSeries, existingPools, random);
    result.push(
      ...optimizeSeries(
        seeded,
        compatibility,
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
  const firstTeam = firstPool.teams[firstPosition.teamIndex];
  const secondTeam = secondPool.teams[secondPosition.teamIndex];

  if (
    firstPool.seriesId !== secondPool.seriesId ||
    firstPool.isLocked ||
    secondPool.isLocked ||
    firstTeam.isLocked ||
    secondTeam.isLocked
  ) {
    return result;
  }

  firstPool.teams[firstPosition.teamIndex] = secondTeam;
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
    team.isLocked ||
    sourcePool.isLocked ||
    targetPool.isLocked ||
    sourcePool.seriesId !== targetPool.seriesId ||
    sourcePool.teams.length !== 5 ||
    targetPool.teams.length !== 4
  ) {
    return result;
  }

  sourcePool.teams = sourcePool.teams.filter(
    (candidate) => candidate.teamId !== teamId,
  );
  targetPool.teams.push(team);
  sourcePool.targetSize = 4;
  targetPool.targetSize = 5;
  return result;
};

export const setPoolLock = (
  pools: PoolDraft[],
  poolKey: string,
  locked: boolean,
) =>
  clonePools(pools).map((pool) =>
    pool.key === poolKey ? { ...pool, isLocked: locked } : pool,
  );

export const setTeamLock = (
  pools: PoolDraft[],
  teamId: string,
  locked: boolean,
) =>
  clonePools(pools).map((pool) => ({
    ...pool,
    teams: pool.teams.map((team) =>
      team.teamId === teamId && !pool.isLocked
        ? { ...team, isLocked: locked }
        : team,
    ),
  }));
