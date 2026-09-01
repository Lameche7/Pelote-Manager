import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type { TournamentStatus } from "@/features/admin/tournaments/services/tournamentAdminService";

type Row = Record<string, unknown>;

export type TournamentPublicationSummary = {
  id: string;
  name: string;
  status: TournamentStatus;
  startsOn: string;
  endsOn: string;
  matchCount: number;
  publishedMatchCount: number;
  conflictCount: number;
};

export type TournamentPublicationConflict = {
  matchId: string;
  resourceId: string;
  resourceName: string;
  playDate: string;
  startsAt: string;
  endsAt: string;
  matchLabel: string;
  occupationId: string;
  occupationType: string;
  occupationTitle: string;
  occupationStartsAt: string;
  occupationEndsAt: string;
  conflictTournamentId: string | null;
  conflictTournamentName: string | null;
  conflictTournamentStatus: TournamentStatus | null;
};

export type TournamentPublicationPreview = {
  tournament: {
    id: string;
    name: string;
    status: TournamentStatus;
    startsOn: string;
    endsOn: string;
  };
  matchCount: number;
  plannedMatchCount: number;
  publishedMatchCount: number;
  conflicts: TournamentPublicationConflict[];
};

const knownErrors: Record<string, string> = {
  Forbidden: "Vous n’avez pas le droit de publier ce tournoi.",
  "Tournament not found": "Tournoi introuvable.",
  "Tournament publication is not available at this stage":
    "Ce tournoi n’est pas encore prêt pour la publication du planning.",
  "Tournament planning must be generated before publication":
    "Enregistrez d’abord un planning complet avant de le publier.",
  "Tournament planning must be complete before publication":
    "Toutes les rencontres doivent être planifiées avant publication.",
  "Tournament planning contains overlapping matches":
    "Le planning contient deux rencontres qui se chevauchent sur le même terrain.",
  "Tournament publication conflicts with calendar":
    "Le planning entre en conflit avec une réservation ou une autre occupation déjà présente dans le calendrier.",
  "Tournament planning is not published":
    "Ce planning n’est pas actuellement publié.",
  "Tournament calendar event is invalid":
    "Un événement calendrier lié à ce tournoi est incohérent.",
};

const fail = (error: unknown, fallback: string): never => {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "");
    if (knownErrors[message]) throw new Error(knownErrors[message]);
  }
  throw new Error(getSupabaseErrorMessage(error, fallback));
};

const nullableString = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : String(value);

const mapSummary = (row: Row): TournamentPublicationSummary => ({
  id: String(row.id),
  name: String(row.name ?? "Tournoi"),
  status: row.status as TournamentStatus,
  startsOn: String(row.starts_on ?? ""),
  endsOn: String(row.ends_on ?? ""),
  matchCount: Number(row.match_count ?? 0),
  publishedMatchCount: Number(row.published_match_count ?? 0),
  conflictCount: Number(row.conflict_count ?? 0),
});

const mapPreview = (value: unknown): TournamentPublicationPreview => {
  const root = (value ?? {}) as Row;
  const tournament = (root.tournament ?? {}) as Row;
  const conflictRows = Array.isArray(root.conflicts)
    ? (root.conflicts as Row[])
    : [];

  return {
    tournament: {
      id: String(tournament.id ?? ""),
      name: String(tournament.name ?? "Tournoi"),
      status: tournament.status as TournamentStatus,
      startsOn: String(tournament.starts_on ?? ""),
      endsOn: String(tournament.ends_on ?? ""),
    },
    matchCount: Number(root.match_count ?? 0),
    plannedMatchCount: Number(root.planned_match_count ?? 0),
    publishedMatchCount: Number(root.published_match_count ?? 0),
    conflicts: conflictRows.map((conflict) => ({
      matchId: String(conflict.match_id),
      resourceId: String(conflict.resource_id),
      resourceName: String(conflict.resource_name ?? "Terrain"),
      playDate: String(conflict.play_date),
      startsAt: String(conflict.starts_at),
      endsAt: String(conflict.ends_at),
      matchLabel: String(conflict.match_label ?? "Rencontre"),
      occupationId: String(conflict.occupation_id),
      occupationType: String(conflict.occupation_type ?? "occupation"),
      occupationTitle: String(conflict.occupation_title ?? "Indisponible"),
      occupationStartsAt: String(conflict.occupation_starts_at),
      occupationEndsAt: String(conflict.occupation_ends_at),
      conflictTournamentId: nullableString(conflict.conflict_tournament_id),
      conflictTournamentName: nullableString(conflict.conflict_tournament_name),
      conflictTournamentStatus: conflict.conflict_tournament_status
        ? (String(conflict.conflict_tournament_status) as TournamentStatus)
        : null,
    })),
  };
};

export const adminTournamentPublicationService = {
  async list(): Promise<TournamentPublicationSummary[]> {
    const { data, error } = await supabase.rpc(
      "admin_list_tournament_publications",
    );
    if (error)
      fail(error, "Impossible de charger les publications de tournois.");
    return ((data ?? []) as Row[]).map(mapSummary);
  },

  async preview(tournamentId: string): Promise<TournamentPublicationPreview> {
    const { data, error } = await supabase.rpc(
      "admin_get_tournament_publication_preview",
      { target_tournament_id: tournamentId },
    );
    if (error) fail(error, "Impossible de vérifier la publication du tournoi.");
    return mapPreview(data);
  },

  async publish(tournamentId: string): Promise<number> {
    const { data, error } = await supabase.rpc(
      "admin_publish_tournament_planning",
      { target_tournament_id: tournamentId },
    );
    if (error) fail(error, "Impossible de publier le planning du tournoi.");
    return Number(data ?? 0);
  },

  async unpublish(tournamentId: string): Promise<number> {
    const { data, error } = await supabase.rpc(
      "admin_unpublish_tournament_planning",
      { target_tournament_id: tournamentId },
    );
    if (error) fail(error, "Impossible de retirer le planning du calendrier.");
    return Number(data ?? 0);
  },
};
