// A bracket's printed order follows its branches, never ascending ranking.
// In the round of 32, the first eightième is winner(1 vs 32) vs winner(16 vs 17).
export function seedOrder(size) {
  let seeds = [1, 2];
  for (let n = 4; n <= size; n *= 2) {
    seeds = seeds.flatMap((seed) => [seed, n + 1 - seed]);
  }
  return seeds;
}

export function orderRoundOf32MatchesBySeed(matches, getSeed) {
  const slots = seedOrder(32).filter((seed) => seed <= 16);
  const position = new Map(slots.map((seed, index) => [seed, index]));
  return [...matches].sort((left, right) => {
    const l = getSeed(left);
    const r = getSeed(right);
    return (position.get(l) ?? 999) - (position.get(r) ?? 999) || l - r;
  });
}
