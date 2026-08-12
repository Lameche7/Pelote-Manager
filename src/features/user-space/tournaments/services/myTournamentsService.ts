import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type {
  TournamentPlayerRole,
  TournamentTeamStatus,
} from "@/features/tournaments/types";

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

export type MyTournamentPlayer = {
  firstName: string;
  lastName: string;
  clubName: string;
  role: TournamentPlayerRole;
};

export type MyTournamentMatch = {
  id: string;
  playDate: string;
  startsAt: string;
  endsAt: string;
  resourceName: string;
  poolNumber: number | null;
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
};
