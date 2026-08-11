import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type { TournamentStatus } from "@/features/admin/tournaments/services/tournamentAdminService";
import type {
  PlanningAssignment,
  PlanningMatch,
  PlanningSlot,
  TeamPlanningAvailability,
} from "@/features/tournaments/domain/planningEngine";

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

export type TournamentPlanningTeam = {
  id: string;
  label: string;
};

export type TournamentPlanningSeries = {
  id: string;
  name: string;
  color: string;
  displayOrder: number;
};

export type TournamentPlanningWorkspace = {
  tournament: {
    id: string;
    name: string;
    status: TournamentStatus;
    startsOn: string;
    endsOn: string;
    poolStartsOn: string;
    poolEndsOn: string;
    finalsStartsOn: string | null;
    finalsEndsOn: string | null;
    slotDurationMinutes: number;
    minimumRestMinutes: number;
  };
  series: TournamentPlanningSeries[];
  resources: Array<{
    id: string;
    name: string;
    displayOrder: number;
  }>;
  teams: TournamentPlanningTeam[];
  slots: PlanningSlot[];
  availability: TeamPlanningAvailability[];
  matches: PlanningMatch[];
  planning: PlanningAssignment[];
};

const knownErrors: Record<string, string> = {
  Forbidden: "Vous n’avez pas le droit de gérer le planning de ce tournoi.",
  "Tournament not found": "Tournoi introuvable.",
  "Tournament planning is not available at this stage":
    "Le planning devient disponible lorsque les poules sont validées.",
  "Tournament planning is not editable at this stage":
    "Le planning ne peut plus être modifié à cette étape.",
  "Tournament pools are incomplete":
    "Les poules doivent être complètes avant de préparer les matchs.",
  "Tournament planning payload is invalid":
    "La proposition de planning est invalide.",
  "Tournament planning match is invalid":
    "Une rencontre du planning n’existe plus.",
  "Tournament planning resource is invalid":
    "Un terrain utilisé par le planning n’est pas autorisé pour ce tournoi.",
  "Tournament planning slot is invalid":
    "Un créneau du planning n’appartient pas à la phase de poules.",
  "Tournament planning violates team availability":
    "Au moins une rencontre est placée hors des disponibilités communes des deux équipes.",
  "Tournament planning contains a conflict":
    "Le planning contient un conflit de terrain ou une équipe est prévue deux fois au même horaire.",
  "Tournament matches have not been prepared":
    "Les rencontres doivent être préparées avant d’enregistrer le planning.",
  "Every tournament match must be scheduled exactly once":
    "Toutes les rencontres doivent être planifiées exactement une fois.",
  "Tournament series colors are invalid": "Une couleur de série est invalide.",
  "Tournament series colors are locked at this stage":
    "Les couleurs des séries ne peuvent plus être modifiées sur ce tournoi.",
};

const fail = (error: unknown, fallback: string): never => {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "");
    if (knownErrors[message]) throw new Error(knownErrors[message]);
  }
  throw new Error(getSupabaseErrorMessage(error, fallback));
};

const playerLabel = (value: unknown) =>
  rows(value)
    .map((player) =>
      `${String(player.first_name ?? "").trim()} ${String(player.last_name ?? "").trim()}`.trim(),
    )
    .filter(Boolean)
    .join(" / ");

const mapWorkspace = (value: unknown): TournamentPlanningWorkspace => {
  const root = (value ?? {}) as Row;
  const tournament = (root.tournament ?? {}) as Row;

  return {
    tournament: {
      id: String(tournament.id ?? ""),
      name: String(tournament.name ?? ""),
      status: tournament.status as TournamentStatus,
      startsOn: String(tournament.starts_on ?? tournament.pool_starts_on ?? ""),
      endsOn: String(tournament.ends_on ?? tournament.pool_ends_on ?? ""),
      poolStartsOn: String(
        tournament.pool_starts_on ?? tournament.starts_on ?? "",
      ),
      poolEndsOn: String(tournament.pool_ends_on ?? tournament.ends_on ?? ""),
      finalsStartsOn: tournament.finals_starts_on
        ? String(tournament.finals_starts_on)
        : null,
      finalsEndsOn: tournament.finals_ends_on
        ? String(tournament.finals_ends_on)
        : null,
      slotDurationMinutes: Number(tournament.slot_duration_minutes ?? 60),
      minimumRestMinutes: Number(tournament.minimum_rest_minutes ?? 0),
    },
    series: rows(root.series).map((series) => ({
      id: String(series.id),
      name: String(series.name ?? "Série"),
      color: String(series.color ?? "#2563EB"),
      displayOrder: Number(series.display_order ?? 0),
    })),
    resources: rows(root.resources).map((resource) => ({
      id: String(resource.id),
      name: String(resource.name ?? ""),
      displayOrder: Number(resource.display_order ?? 0),
    })),
    teams: rows(root.teams).map((team) => ({
      id: String(team.id),
      label: playerLabel(team.players) || "Équipe sans nom",
    })),
    slots: rows(root.slots).map((slot) => ({
      id: String(slot.id),
      resourceId: String(slot.resource_id),
      resourceName: String(slot.resource_name ?? "Terrain"),
      date: String(slot.date),
      startsAt: String(slot.starts_at),
      endsAt: String(slot.ends_at),
    })),
    availability: rows(root.availability).map((team) => ({
      teamId: String(team.team_id),
      slots: rows(team.slots).map((slot) => ({
        date: String(slot.date),
        startsAt: String(slot.starts_at),
        endsAt: String(slot.ends_at),
      })),
    })),
    matches: rows(root.matches).map((match) => ({
      id: String(match.id),
      poolId: String(match.pool_id),
      seriesId: String(match.series_id),
      teamAId: String(match.team_a_id),
      teamBId: String(match.team_b_id),
      displayOrder: Number(match.display_order ?? 0),
    })),
    planning: rows(root.planning).map((planning) => ({
      matchId: String(planning.match_id),
      slotId: String(planning.slot_id),
    })),
  };
};

const planningPayload = (
  assignments: PlanningAssignment[],
  slots: PlanningSlot[],
  source: "generated" | "manual",
) => {
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  return {
    planning: assignments.map((assignment) => {
      const slot = slotById.get(assignment.slotId);
      if (!slot) throw new Error("Un créneau du planning n’existe plus.");
      return {
        match_id: assignment.matchId,
        resource_id: slot.resourceId,
        play_date: slot.date,
        starts_at: slot.startsAt,
        ends_at: slot.endsAt,
        source,
      };
    }),
  };
};

export const adminTournamentPlanningService = {
  async prepare(tournamentId: string): Promise<number> {
    const { data, error } = await supabase.rpc(
      "admin_prepare_tournament_matches",
      { target_tournament_id: tournamentId },
    );
    if (error) fail(error, "Impossible de préparer les rencontres du tournoi.");
    return Number(data ?? 0);
  },

  async get(tournamentId: string): Promise<TournamentPlanningWorkspace> {
    const { data, error } = await supabase.rpc(
      "admin_get_tournament_planning_workspace",
      { target_tournament_id: tournamentId },
    );
    if (error) fail(error, "Impossible de charger le planning du tournoi.");
    return mapWorkspace(data);
  },

  async save(
    tournamentId: string,
    assignments: PlanningAssignment[],
    slots: PlanningSlot[],
    source: "generated" | "manual" = "generated",
  ): Promise<void> {
    const { error } = await supabase.rpc("admin_save_tournament_planning", {
      target_tournament_id: tournamentId,
      payload: planningPayload(assignments, slots, source),
    });
    if (error) fail(error, "Impossible d’enregistrer le planning du tournoi.");
  },

  async saveSeriesColors(
    tournamentId: string,
    values: Array<{ id: string; color: string }>,
  ): Promise<void> {
    const { error } = await supabase.rpc(
      "admin_update_tournament_series_colors",
      {
        target_tournament_id: tournamentId,
        payload: values.map((value) => ({
          id: value.id,
          color: value.color.toUpperCase(),
        })),
      },
    );
    if (error) fail(error, "Impossible d’enregistrer les couleurs des séries.");
  },
};
