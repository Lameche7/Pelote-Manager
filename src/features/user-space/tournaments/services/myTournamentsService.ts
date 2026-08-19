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

export type MyTournamentQualification = {
  status:
    | "not_configured"
    | "qualified"
    | "eliminated"
    | "provisional"
    | "possible"
    | "must_win";
  currentPosition: number;
  qualifierCount: number;
  remainingMatches: number;
  bestPossiblePosition: number | null;
  worstPossiblePosition: number | null;
  minimumWinMargin: number | null;
  dependsOnOthers: boolean;
  message: string;
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
  qualification: MyTournamentQualification | null;
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

const mapQualification = (row: Row): MyTournamentQualification => ({
  status: String(
    row.status ?? "possible",
  ) as MyTournamentQualification["status"],
  currentPosition: Number(row.current_position ?? 0),
  qualifierCount: Number(row.qualifier_count ?? 0),
  remainingMatches: Number(row.remaining_matches ?? 0),
  bestPossiblePosition:
    row.best_possible_position === null ||
    row.best_possible_position === undefined
      ? null
      : Number(row.best_possible_position),
  worstPossiblePosition:
    row.worst_possible_position === null ||
    row.worst_possible_position === undefined
      ? null
      : Number(row.worst_possible_position),
  minimumWinMargin:
    row.minimum_win_margin === null || row.minimum_win_margin === undefined
      ? null
      : Number(row.minimum_win_margin),
  dependsOnOthers: Boolean(row.depends_on_others),
  message: String(row.message ?? ""),
});

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
    qualification: null,
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
    const [tournamentsResponse, qualificationResponse] = await Promise.all([
      supabase.rpc("get_my_tournaments"),
      supabase.rpc("get_my_tournament_qualification_scenarios"),
    ]);

    if (tournamentsResponse.error) {
      throw new Error(
        getSupabaseErrorMessage(
          tournamentsResponse.error,
          "Impossible de charger vos tournois.",
        ),
      );
    }

    if (qualificationResponse.error) {
      throw new Error(
        getSupabaseErrorMessage(
          qualificationResponse.error,
          "Impossible de calculer votre situation de qualification.",
        ),
      );
    }

    const qualificationByTeam = new Map<string, MyTournamentQualification>();
    for (const scenario of rows(qualificationResponse.data)) {
      const key = `${String(scenario.tournament_id ?? "")}:${String(
        scenario.team_id ?? "",
      )}`;
      qualificationByTeam.set(key, mapQualification(scenario));
    }

    return rows(tournamentsResponse.data).map((row) => {
      const tournament = mapTournament(row);
      return {
        ...tournament,
        qualification:
          qualificationByTeam.get(`${tournament.id}:${tournament.team.id}`) ??
          null,
      };
    });
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
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible d’enregistrer le résultat."),
      );
    }
  },
};
