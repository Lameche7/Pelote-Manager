import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type {
  TournamentPlayerRole,
  TournamentTeamStatus,
} from "@/features/tournaments/types";
import type { TournamentScorePayload } from "@/features/tournaments/components/TournamentScoreEditor";

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

const resultSubmissionErrors: Record<string, string> = {
  "Tournament result cannot be entered before the scheduled end":
    "Le score pourra être saisi après l’heure de fin prévue de la partie.",
  "Tournament result has already been submitted":
    "Un résultat a déjà été transmis pour cette partie.",
  "Tournament set score is invalid":
    "Le score d’une manche est invalide. Les deux équipes doivent avoir des scores différents.",
  "Tournament set score does not match sporting rules":
    "Le score ne respecte pas le format prévu pour cette partie.",
  "A single-game result must contain exactly one score":
    "Cette partie se joue en une seule manche.",
  "A best-of-three result must contain two or three sets":
    "Renseignez deux manches, ou trois si une manche décisive a été jouée.",
  "A two-set result must be a straight victory":
    "Avec deux manches saisies, la même équipe doit avoir gagné les deux.",
  "A three-set result must finish two sets to one":
    "Une partie en trois manches doit se terminer par deux manches à une.",
  "A deciding set is only allowed after one set each":
    "La manche décisive n’est possible que si les équipes ont gagné une manche chacune.",
};

const resultSubmissionErrorMessage = (error: unknown): string => {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "");
    if (resultSubmissionErrors[message]) return resultSubmissionErrors[message];
  }

  return getSupabaseErrorMessage(error, "Impossible d’enregistrer le résultat.");
};

export type MyTournamentPlayer = {
  firstName: string;
  lastName: string;
  clubName: string;
  role: TournamentPlayerRole;
};

export type MyTournamentSportingRules = {
  matchFormat: "single_game" | "best_of_three_sets";
  singleGamePoints: number;
  mainSetPoints: number;
  decidingSetPoints: number;
};

export type MyTournamentResult = {
  id: string;
  status: "pending_validation" | "validated";
  score: TournamentScorePayload;
  teamASets: number;
  teamBSets: number;
  teamAPoints: number;
  teamBPoints: number;
  teamARankingPoints: number;
  teamBRankingPoints: number;
};

export type MyTournamentMatch = {
  id: string;
  playDate: string;
  startsAt: string;
  endsAt: string;
  resourceName: string;
  poolNumber: number | null;
  teamSide: "a" | "b";
  canSubmitResult: boolean;
  result: MyTournamentResult | null;
  opponentTeamId: string;
  opponentPlayers: MyTournamentPlayer[];
};

export type MyTournamentOverview = {
  id: string;
  name: string;
  status: string;
  startsOn: string;
  endsOn: string;
  registrationClosesAt: string;
  planningPublished: boolean;
  sportingRules: MyTournamentSportingRules;
  team: {
    id: string;
    status: TournamentTeamStatus;
    seriesId: string;
    seriesName: string;
    seriesColor: string;
    poolNumber: number | null;
    canManageRegistration: boolean;
    players: MyTournamentPlayer[];
  };
  matches: MyTournamentMatch[];
};

const mapPlayer = (row: Row): MyTournamentPlayer => ({
  firstName: String(row.first_name ?? ""),
  lastName: String(row.last_name ?? ""),
  clubName: String(row.club_name ?? ""),
  role: row.role as TournamentPlayerRole,
});

const mapScore = (value: unknown): TournamentScorePayload => {
  const score = (value ?? {}) as Row;
  return {
    sets: rows(score.sets).map((set) => ({
      teamA: Number(set.team_a ?? 0),
      teamB: Number(set.team_b ?? 0),
    })),
  };
};

const mapResult = (value: unknown): MyTournamentResult | null => {
  if (!value || typeof value !== "object") return null;
  const result = value as Row;
  return {
    id: String(result.id ?? ""),
    status: result.status as MyTournamentResult["status"],
    score: mapScore(result.score),
    teamASets: Number(result.team_a_sets ?? 0),
    teamBSets: Number(result.team_b_sets ?? 0),
    teamAPoints: Number(result.team_a_points ?? 0),
    teamBPoints: Number(result.team_b_points ?? 0),
    teamARankingPoints: Number(result.team_a_ranking_points ?? 0),
    teamBRankingPoints: Number(result.team_b_ranking_points ?? 0),
  };
};

const mapSportingRules = (value: unknown): MyTournamentSportingRules => {
  const rules = (value ?? {}) as Row;
  return {
    matchFormat: rules.match_format as MyTournamentSportingRules["matchFormat"],
    singleGamePoints: Number(rules.single_game_points ?? 35),
    mainSetPoints: Number(rules.main_set_points ?? 20),
    decidingSetPoints: Number(rules.deciding_set_points ?? 10),
  };
};

const mapTournament = (row: Row): MyTournamentOverview => {
  const team = (row.team ?? {}) as Row;
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    status: String(row.status ?? ""),
    startsOn: String(row.starts_on ?? ""),
    endsOn: String(row.ends_on ?? ""),
    registrationClosesAt: String(row.registration_closes_at ?? ""),
    planningPublished: Boolean(row.planning_published),
    sportingRules: mapSportingRules(row.sporting_rules),
    team: {
      id: String(team.id ?? ""),
      status: team.status as TournamentTeamStatus,
      seriesId: String(team.series_id ?? ""),
      seriesName: String(team.series_name ?? ""),
      seriesColor: String(team.series_color ?? "#2563EB"),
      poolNumber:
        team.pool_number === null || team.pool_number === undefined
          ? null
          : Number(team.pool_number),
      canManageRegistration: Boolean(team.can_manage_registration),
      players: rows(team.players).map(mapPlayer),
    },
    matches: rows(row.matches).map((match) => ({
      id: String(match.id),
      playDate: String(match.play_date ?? ""),
      startsAt: String(match.starts_at ?? "").slice(0, 5),
      endsAt: String(match.ends_at ?? "").slice(0, 5),
      resourceName: String(match.resource_name ?? ""),
      poolNumber:
        match.pool_number === null || match.pool_number === undefined
          ? null
          : Number(match.pool_number),
      teamSide: match.team_side === "b" ? "b" : "a",
      canSubmitResult: Boolean(match.can_submit_result),
      result: mapResult(match.result),
      opponentTeamId: String(match.opponent_team_id ?? ""),
      opponentPlayers: rows(match.opponent_players).map(mapPlayer),
    })),
  };
};

export const myTournamentsService = {
  async list(): Promise<MyTournamentOverview[]> {
    const { data, error } = await supabase.rpc("get_my_tournaments");
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible de charger vos tournois."),
      );
    }
    return rows(data).map(mapTournament);
  },

  async submitResult(
    matchId: string,
    score: TournamentScorePayload,
  ): Promise<void> {
    const { error } = await supabase.rpc("submit_my_tournament_match_result", {
      target_match_id: matchId,
      score_payload: {
        sets: score.sets.map((set) => ({
          team_a: set.teamA,
          team_b: set.teamB,
        })),
      },
    });
    if (error) {
      throw new Error(resultSubmissionErrorMessage(error));
    }
  },
};
