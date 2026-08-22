import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import { buildFinalBracketProjectedMatches } from "@/features/tournaments/domain/finalBracketProjection";

export type PublicTournamentScore = {
  sets: Array<{ teamA: number; teamB: number }>;
};

export type PublicTournamentResultMatch = {
  id: string;
  displayOrder: number;
  teamAId: string;
  teamALabel: string;
  teamBId: string;
  teamBLabel: string;
  playDate: string;
  startsAt: string;
  endsAt: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  resourceName: string;
  resultStatus: "pending_validation" | "validated" | null;
  score: PublicTournamentScore | null;
  teamASets: number | null;
  teamBSets: number | null;
};

export type PublicTournamentFinalSeed = {
  seed: number;
  teamId: string;
  teamLabel: string;
};

export type PublicTournamentFinalMatch = {
  id: string;
  round: string;
  roundNumber: number;
  displayOrder: number;
  seedA: number | null;
  seedB: number | null;
  teamAId: string;
  teamALabel: string;
  teamBId: string;
  teamBLabel: string;
  published: boolean;
  playDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  resourceName: string | null;
  resultStatus: "pending_validation" | "validated" | null;
  winnerTeamId: string | null;
  score: PublicTournamentScore | null;
  teamASets: number | null;
  teamBSets: number | null;
};

export type PublicTournamentResultPool = {
  id: string;
  number: number;
  matches: PublicTournamentResultMatch[];
};

export type PublicTournamentResultSeries = {
  id: string;
  name: string;
  color: string;
  displayOrder: number;
  qualifierCount: number;
  finalsGenerated: boolean;
  finalSeeds: PublicTournamentFinalSeed[];
  finalMatches: PublicTournamentFinalMatch[];
  pools: PublicTournamentResultPool[];
};

export type PublicTournamentResults = {
  tournamentId: string;
  tournamentName: string;
  status: string;
  series: PublicTournamentResultSeries[];
};

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

const nullableString = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : String(value);

const resultStatus = (
  value: unknown,
): "pending_validation" | "validated" | null =>
  value === "validated" || value === "pending_validation" ? value : null;

const mapScore = (value: unknown): PublicTournamentScore | null => {
  if (!value || typeof value !== "object") return null;
  const score = value as Row;
  return {
    sets: rows(score.sets).map((set) => ({
      teamA: Number(set.team_a ?? 0),
      teamB: Number(set.team_b ?? 0),
    })),
  };
};

const mapFinalMatch = (match: Row): PublicTournamentFinalMatch => ({
  id: String(match.id ?? ""),
  round: String(match.round ?? ""),
  roundNumber: Number(match.round_number ?? 0),
  displayOrder: Number(match.display_order ?? 0),
  seedA:
    match.seed_a === null || match.seed_a === undefined
      ? null
      : Number(match.seed_a),
  seedB:
    match.seed_b === null || match.seed_b === undefined
      ? null
      : Number(match.seed_b),
  teamAId: String(match.team_a_id ?? ""),
  teamALabel: String(match.team_a_label ?? "Équipe A"),
  teamBId: String(match.team_b_id ?? ""),
  teamBLabel: String(match.team_b_label ?? "Équipe B"),
  published: Boolean(match.published),
  playDate: nullableString(match.play_date),
  startsAt: nullableString(match.starts_at)?.slice(0, 5) ?? null,
  endsAt: nullableString(match.ends_at)?.slice(0, 5) ?? null,
  resourceName: nullableString(match.resource_name),
  resultStatus: resultStatus(match.result_status),
  winnerTeamId: nullableString(match.winner_team_id),
  score: mapScore(match.score),
  teamASets:
    match.team_a_sets === null || match.team_a_sets === undefined
      ? null
      : Number(match.team_a_sets),
  teamBSets:
    match.team_b_sets === null || match.team_b_sets === undefined
      ? null
      : Number(match.team_b_sets),
});

const mapSeries = (series: Row): PublicTournamentResultSeries => {
  const id = String(series.id ?? "");
  const qualifierCount = Number(series.qualifier_count ?? 0);
  const finalSeeds: PublicTournamentFinalSeed[] = rows(series.final_seeds).map(
    (seed) => ({
      seed: Number(seed.seed ?? 0),
      teamId: String(seed.team_id ?? ""),
      teamLabel: String(seed.team_label ?? "Équipe"),
    }),
  );
  const actualFinalMatches = rows(series.final_matches).map(mapFinalMatch);
  const projectedFinalMatches = buildFinalBracketProjectedMatches({
    qualifierCount,
    seeds: finalSeeds,
    actualMatches: actualFinalMatches,
  }).map<PublicTournamentFinalMatch>((match) => ({
    id: `preview:${id}:${match.round}:${match.displayOrder}`,
    round: match.round,
    roundNumber: match.roundNumber,
    displayOrder: match.displayOrder,
    seedA: null,
    seedB: null,
    teamAId: match.sideA.teamId,
    teamALabel: match.sideA.teamLabel,
    teamBId: match.sideB.teamId,
    teamBLabel: match.sideB.teamLabel,
    published: false,
    playDate: null,
    startsAt: null,
    endsAt: null,
    resourceName: null,
    resultStatus: null,
    winnerTeamId: null,
    score: null,
    teamASets: null,
    teamBSets: null,
  }));

  return {
    id,
    name: String(series.name ?? "Série"),
    color: String(series.color ?? "#2563EB"),
    displayOrder: Number(series.display_order ?? 0),
    qualifierCount,
    finalsGenerated: Boolean(series.finals_generated),
    finalSeeds,
    finalMatches: [...actualFinalMatches, ...projectedFinalMatches],
    pools: rows(series.pools).map((pool) => ({
      id: String(pool.id ?? ""),
      number: Number(pool.number ?? 0),
      matches: rows(pool.matches).map((match) => ({
        id: String(match.id ?? ""),
        displayOrder: Number(match.display_order ?? 0),
        teamAId: String(match.team_a_id ?? ""),
        teamALabel: String(match.team_a_label ?? "Équipe A"),
        teamBId: String(match.team_b_id ?? ""),
        teamBLabel: String(match.team_b_label ?? "Équipe B"),
        playDate: String(match.play_date ?? ""),
        startsAt: String(match.starts_at ?? "").slice(0, 5),
        endsAt: String(match.ends_at ?? "").slice(0, 5),
        scheduledStartAt: String(match.scheduled_start_at ?? ""),
        scheduledEndAt: String(match.scheduled_end_at ?? ""),
        resourceName: String(match.resource_name ?? ""),
        resultStatus: resultStatus(match.result_status),
        score: mapScore(match.score),
        teamASets:
          match.team_a_sets === null || match.team_a_sets === undefined
            ? null
            : Number(match.team_a_sets),
        teamBSets:
          match.team_b_sets === null || match.team_b_sets === undefined
            ? null
            : Number(match.team_b_sets),
      })),
    })),
  };
};

const mapResults = (value: unknown): PublicTournamentResults | null => {
  if (!value || typeof value !== "object") return null;
  const root = value as Row;
  return {
    tournamentId: String(root.tournament_id ?? ""),
    tournamentName: String(root.tournament_name ?? ""),
    status: String(root.status ?? ""),
    series: rows(root.series).map(mapSeries),
  };
};

export const tournamentResultsService = {
  async get(tournamentId: string): Promise<PublicTournamentResults | null> {
    const { data, error } = await supabase.rpc(
      "get_public_tournament_results",
      {
        target_tournament_id: tournamentId,
      },
    );
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de charger les résultats du tournoi.",
        ),
      );
    }
    return mapResults(data);
  },
};
