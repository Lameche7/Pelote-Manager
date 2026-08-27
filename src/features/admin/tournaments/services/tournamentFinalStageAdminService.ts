import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type {
  PlanningAssignment,
  PlanningMatch,
  PlanningSlot,
  TeamPlanningAvailability,
} from "@/features/tournaments/domain/planningEngine";

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

const knownErrors: Record<string, string> = {
  Forbidden: "Vous n’avez pas le droit de gérer cette phase finale.",
  "Tournament not found": "Tournoi introuvable.",
  "Tournament pools are not in progress or completed":
    "La phase finale ne peut être préparée qu’après publication du planning des poules.",
  "Tournament finals dates are missing":
    "Les dates de phase finale ne sont pas configurées sur ce tournoi.",
  "Tournament final stage is already generated":
    "La phase finale de ce tournoi a déjà été générée.",
  "Tournament qualifier count is not configured for every series":
    "Configurez le nombre de qualifiés pour chaque série avant de poursuivre.",
  "Every pool match must have a validated result before finals":
    "Toutes les parties de poule doivent avoir un résultat validé avant de générer la phase finale.",
  "Tournament qualification cutoff contains an unresolved tie":
    "Une égalité parfaite traverse la limite de qualification. Départagez-la avant de générer la phase finale.",
  "Tournament does not contain enough ranked teams":
    "Le classement ne contient pas assez d’équipes pour le nombre de qualifiés choisi.",
  "Tournament final stage has not been generated":
    "Générez d’abord la phase finale.",
  "No tournament finals matches are ready for planning":
    "Aucune partie du tour actuel n’est à planifier.",
  "Every current finals match must be scheduled exactly once":
    "Toutes les parties du tour actuel doivent être planifiées exactement une fois.",
  "Tournament finals planning payload is invalid":
    "La proposition de planning de phase finale est invalide.",
  "Tournament finals planning match is invalid":
    "Une partie de phase finale n’est plus disponible.",
  "Published tournament finals match is locked":
    "Une partie déjà publiée doit d’abord être retirée du calendrier avant d’être déplacée.",
  "Tournament finals planning resource is invalid":
    "Un terrain utilisé n’est pas autorisé pour ce tournoi.",
  "Tournament finals planning slot is invalid":
    "Un créneau choisi n’appartient pas à la phase finale.",
  "Tournament finals planning violates team availability":
    "Au moins une partie est placée hors des disponibilités communes des deux équipes.",
  "Tournament finals planning contains a conflict":
    "Le planning contient un conflit de terrain ou d’équipe.",
  "Every current finals match must be planned before publication":
    "Planifiez toutes les parties du tour actuel avant de les publier.",
  "Tournament finals publication conflicts with calendar":
    "Un créneau de phase finale est désormais occupé dans le calendrier.",
  "No published tournament finals matches are ready for replanning":
    "Aucune partie publiée du tour actuel ne peut être retirée du calendrier.",
  "Tournament finals full planning payload is invalid":
    "Le planning global des phases finales est invalide.",
  "Tournament finals planning node is invalid":
    "Une partie du tableau final n’existe plus.",
  "Published or completed tournament finals node is locked":
    "Une partie publiée ou déjà jouée ne peut plus être déplacée.",
  "Tournament finals generated planning violates team availability":
    "La proposition automatique contient un créneau hors disponibilités communes.",
  "Tournament finals planning violates round order":
    "Le planning place une étape avant un tour précédent.",
};

const fail = (error: unknown, fallback: string): never => {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "");
    if (knownErrors[message]) throw new Error(knownErrors[message]);
  }
  throw new Error(getSupabaseErrorMessage(error, fallback));
};

export type TournamentFinalSeed = {
  seed: number;
  teamId: string;
  teamLabel: string;
};

export type TournamentFinalMatch = {
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
  resultStatus: string | null;
  winnerTeamId: string | null;
  planned: boolean;
  published: boolean;
  playDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  resourceId: string | null;
  resourceName: string | null;
};

export type TournamentFinalSeriesState = {
  seriesId: string;
  seriesName: string;
  qualifierCount: number;
  poolMatchCount: number;
  validatedPoolMatchCount: number;
  cutoffTie: boolean;
  generated: boolean;
  currentRoundNumber: number | null;
  seeds: TournamentFinalSeed[];
  matches: TournamentFinalMatch[];
};

export type TournamentFinalStageState = {
  tournamentId: string;
  status: string;
  finalsStartsOn: string | null;
  finalsEndsOn: string | null;
  generated: boolean;
  series: TournamentFinalSeriesState[];
};

export type TournamentFinalPlanningWorkspace = {
  tournament: {
    id: string;
    name: string;
    finalsStartsOn: string | null;
    finalsEndsOn: string | null;
    minimumRestMinutes: number;
  };
  series: Array<{
    id: string;
    name: string;
    color: string;
    displayOrder: number;
  }>;
  resources: Array<{
    id: string;
    name: string;
    displayOrder: number;
  }>;
  teams: Array<{ id: string; label: string }>;
  slots: PlanningSlot[];
  availability: TeamPlanningAvailability[];
  matches: PlanningMatch[];
  planning: PlanningAssignment[];
};

export type TournamentFinalFullPlanningSeries = {
  id: string;
  name: string;
  color: string;
  displayOrder: number;
  qualifierCount: number;
  seeds: TournamentFinalSeed[];
};

export type TournamentFinalFullPlanningNodeRow = {
  seriesId: string;
  round: string;
  roundNumber: number;
  displayOrder: number;
  resourceId: string | null;
  playDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  source: "generated" | "manual" | null;
  actualMatchId: string | null;
  teamAId: string | null;
  teamALabel: string | null;
  teamBId: string | null;
  teamBLabel: string | null;
  resultStatus: string | null;
  published: boolean;
  actualMatchPlanned: boolean;
  needsManual: boolean;
};

export type TournamentFinalFullPlanningWorkspace = {
  tournament: {
    id: string;
    name: string;
    finalsStartsOn: string | null;
    finalsEndsOn: string | null;
    minimumRestMinutes: number;
  };
  series: TournamentFinalFullPlanningSeries[];
  resources: Array<{
    id: string;
    name: string;
    displayOrder: number;
  }>;
  slots: PlanningSlot[];
  availability: TeamPlanningAvailability[];
  nodes: TournamentFinalFullPlanningNodeRow[];
};

export type TournamentFinalFullPlanningUpdate = {
  seriesId: string;
  roundNumber: number;
  displayOrder: number;
  slotId: string | null;
  source: "generated" | "manual" | null;
};

const playerLabel = (value: unknown) =>
  rows(value)
    .map((player) =>
      `${String(player.first_name ?? "").trim()} ${String(player.last_name ?? "").trim()}`.trim(),
    )
    .filter(Boolean)
    .join(" / ");

const nullableString = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : String(value);

const mapState = (value: unknown): TournamentFinalStageState => {
  const root = (value ?? {}) as Row;
  return {
    tournamentId: String(root.tournament_id ?? ""),
    status: String(root.status ?? ""),
    finalsStartsOn: nullableString(root.finals_starts_on),
    finalsEndsOn: nullableString(root.finals_ends_on),
    generated: Boolean(root.generated),
    series: rows(root.series).map((series) => ({
      seriesId: String(series.series_id ?? ""),
      seriesName: String(series.series_name ?? "Série"),
      qualifierCount: Number(series.qualifier_count ?? 0),
      poolMatchCount: Number(series.pool_match_count ?? 0),
      validatedPoolMatchCount: Number(series.validated_pool_match_count ?? 0),
      cutoffTie: Boolean(series.cutoff_tie),
      generated: Boolean(series.generated),
      currentRoundNumber:
        series.current_round_number === null ||
        series.current_round_number === undefined
          ? null
          : Number(series.current_round_number),
      seeds: rows(series.seeds).map((seed) => ({
        seed: Number(seed.seed ?? 0),
        teamId: String(seed.team_id ?? ""),
        teamLabel: String(seed.team_label ?? "Équipe"),
      })),
      matches: rows(series.matches).map((match) => ({
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
        teamALabel: String(match.team_a_label ?? "Équipe"),
        teamBId: String(match.team_b_id ?? ""),
        teamBLabel: String(match.team_b_label ?? "Équipe"),
        resultStatus: nullableString(match.result_status),
        winnerTeamId: nullableString(match.winner_team_id),
        planned: Boolean(match.planned),
        published: Boolean(match.published),
        playDate: nullableString(match.play_date),
        startsAt: nullableString(match.starts_at),
        endsAt: nullableString(match.ends_at),
        resourceId: nullableString(match.resource_id),
        resourceName: nullableString(match.resource_name),
      })),
    })),
  };
};

const mapPlanningWorkspace = (
  value: unknown,
): TournamentFinalPlanningWorkspace => {
  const root = (value ?? {}) as Row;
  const tournament = (root.tournament ?? {}) as Row;
  return {
    tournament: {
      id: String(tournament.id ?? ""),
      name: String(tournament.name ?? ""),
      finalsStartsOn: nullableString(tournament.finals_starts_on),
      finalsEndsOn: nullableString(tournament.finals_ends_on),
      minimumRestMinutes: Number(tournament.minimum_rest_minutes ?? 0),
    },
    series: rows(root.series).map((series) => ({
      id: String(series.id ?? ""),
      name: String(series.name ?? "Série"),
      color: String(series.color ?? "#2563EB"),
      displayOrder: Number(series.display_order ?? 0),
    })),
    resources: rows(root.resources).map((resource) => ({
      id: String(resource.id ?? ""),
      name: String(resource.name ?? "Terrain"),
      displayOrder: Number(resource.display_order ?? 0),
    })),
    teams: rows(root.teams).map((team) => ({
      id: String(team.id ?? ""),
      label: playerLabel(team.players) || "Équipe",
    })),
    slots: rows(root.slots).map((slot) => ({
      id: String(slot.id ?? ""),
      resourceId: String(slot.resource_id ?? ""),
      resourceName: String(slot.resource_name ?? "Terrain"),
      date: String(slot.date ?? ""),
      startsAt: String(slot.starts_at ?? ""),
      endsAt: String(slot.ends_at ?? ""),
    })),
    availability: rows(root.availability).map((team) => ({
      teamId: String(team.team_id ?? ""),
      slots: rows(team.slots).map((slot) => ({
        date: String(slot.date ?? ""),
        startsAt: String(slot.starts_at ?? ""),
        endsAt: String(slot.ends_at ?? ""),
      })),
    })),
    matches: rows(root.matches).map((match) => ({
      id: String(match.id ?? ""),
      poolId: String(match.pool_id ?? ""),
      seriesId: String(match.series_id ?? ""),
      teamAId: String(match.team_a_id ?? ""),
      teamBId: String(match.team_b_id ?? ""),
      displayOrder: Number(match.display_order ?? 0),
    })),
    planning: rows(root.planning).map((planning) => ({
      matchId: String(planning.match_id ?? ""),
      slotId: String(planning.slot_id ?? ""),
    })),
  };
};

const mapFullPlanningWorkspace = (
  value: unknown,
): TournamentFinalFullPlanningWorkspace => {
  const root = (value ?? {}) as Row;
  const tournament = (root.tournament ?? {}) as Row;
  return {
    tournament: {
      id: String(tournament.id ?? ""),
      name: String(tournament.name ?? ""),
      finalsStartsOn: nullableString(tournament.finals_starts_on),
      finalsEndsOn: nullableString(tournament.finals_ends_on),
      minimumRestMinutes: Number(tournament.minimum_rest_minutes ?? 0),
    },
    series: rows(root.series).map((series) => ({
      id: String(series.id ?? ""),
      name: String(series.name ?? "Série"),
      color: String(series.color ?? "#2563EB"),
      displayOrder: Number(series.display_order ?? 0),
      qualifierCount: Number(series.qualifier_count ?? 0),
      seeds: rows(series.seeds).map((seed) => ({
        seed: Number(seed.seed ?? 0),
        teamId: String(seed.team_id ?? ""),
        teamLabel: String(seed.team_label ?? "Équipe"),
      })),
    })),
    resources: rows(root.resources).map((resource) => ({
      id: String(resource.id ?? ""),
      name: String(resource.name ?? "Terrain"),
      displayOrder: Number(resource.display_order ?? 0),
    })),
    slots: rows(root.slots).map((slot) => ({
      id: String(slot.id ?? ""),
      resourceId: String(slot.resource_id ?? ""),
      resourceName: String(slot.resource_name ?? "Terrain"),
      date: String(slot.date ?? ""),
      startsAt: String(slot.starts_at ?? ""),
      endsAt: String(slot.ends_at ?? ""),
    })),
    availability: rows(root.availability).map((team) => ({
      teamId: String(team.team_id ?? ""),
      slots: rows(team.slots).map((slot) => ({
        date: String(slot.date ?? ""),
        startsAt: String(slot.starts_at ?? ""),
        endsAt: String(slot.ends_at ?? ""),
      })),
    })),
    nodes: rows(root.nodes).map((node) => ({
      seriesId: String(node.series_id ?? ""),
      round: String(node.round ?? ""),
      roundNumber: Number(node.round_number ?? 0),
      displayOrder: Number(node.display_order ?? 0),
      resourceId: nullableString(node.resource_id),
      playDate: nullableString(node.play_date),
      startsAt: nullableString(node.starts_at),
      endsAt: nullableString(node.ends_at),
      source:
        node.source === "generated" || node.source === "manual"
          ? node.source
          : null,
      actualMatchId: nullableString(node.actual_match_id),
      teamAId: nullableString(node.team_a_id),
      teamALabel: nullableString(node.team_a_label),
      teamBId: nullableString(node.team_b_id),
      teamBLabel: nullableString(node.team_b_label),
      resultStatus: nullableString(node.result_status),
      published: Boolean(node.published),
      actualMatchPlanned: Boolean(node.actual_match_planned),
      needsManual: Boolean(node.needs_manual),
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

const fullPlanningPayload = (
  updates: TournamentFinalFullPlanningUpdate[],
  slots: PlanningSlot[],
) => {
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  return {
    nodes: updates.map((update) => {
      const slot = update.slotId ? slotById.get(update.slotId) : null;
      if (update.slotId && !slot) {
        throw new Error("Un créneau du planning n’existe plus.");
      }
      return {
        series_id: update.seriesId,
        round_number: update.roundNumber,
        display_order: update.displayOrder,
        resource_id: slot?.resourceId ?? null,
        play_date: slot?.date ?? null,
        starts_at: slot?.startsAt ?? null,
        ends_at: slot?.endsAt ?? null,
        source: slot ? update.source : null,
      };
    }),
  };
};

export const tournamentFinalStageAdminService = {
  async getState(tournamentId: string): Promise<TournamentFinalStageState> {
    const { data, error } = await supabase.rpc(
      "admin_get_tournament_final_stage",
      { target_tournament_id: tournamentId },
    );
    if (error) fail(error, "Impossible de charger la phase finale.");
    return mapState(data);
  },

  async generate(tournamentId: string): Promise<number> {
    const { data, error } = await supabase.rpc(
      "admin_generate_tournament_final_stage",
      { target_tournament_id: tournamentId },
    );
    if (error) fail(error, "Impossible de générer la phase finale.");
    return Number(data ?? 0);
  },

  async advance(tournamentId: string): Promise<number> {
    const { data, error } = await supabase.rpc(
      "admin_advance_tournament_final_stage",
      { target_tournament_id: tournamentId },
    );
    if (error) fail(error, "Impossible de préparer le tour suivant.");
    return Number(data ?? 0);
  },

  async getPlanning(
    tournamentId: string,
  ): Promise<TournamentFinalPlanningWorkspace> {
    const { data, error } = await supabase.rpc(
      "admin_get_tournament_final_planning_workspace",
      { target_tournament_id: tournamentId },
    );
    if (error)
      fail(error, "Impossible de charger le planning de phase finale.");
    return mapPlanningWorkspace(data);
  },

  async savePlanning(
    tournamentId: string,
    assignments: PlanningAssignment[],
    slots: PlanningSlot[],
    source: "generated" | "manual" = "generated",
  ): Promise<number> {
    const { data, error } = await supabase.rpc(
      "admin_save_tournament_final_planning",
      {
        target_tournament_id: tournamentId,
        payload: planningPayload(assignments, slots, source),
      },
    );
    if (error)
      fail(error, "Impossible d’enregistrer le planning de phase finale.");
    return Number(data ?? 0);
  },

  async prepareFullPlanning(tournamentId: string): Promise<number> {
    const { data, error } = await supabase.rpc(
      "admin_prepare_tournament_final_planning_grid",
      { target_tournament_id: tournamentId },
    );
    if (error)
      fail(error, "Impossible de préparer le planning global des phases finales.");
    return Number(data ?? 0);
  },

  async getFullPlanning(
    tournamentId: string,
  ): Promise<TournamentFinalFullPlanningWorkspace> {
    await this.prepareFullPlanning(tournamentId);
    const { data, error } = await supabase.rpc(
      "admin_get_tournament_final_full_planning_workspace",
      { target_tournament_id: tournamentId },
    );
    if (error)
      fail(error, "Impossible de charger le planning global des phases finales.");
    return mapFullPlanningWorkspace(data);
  },

  async saveFullPlanning(
    tournamentId: string,
    updates: TournamentFinalFullPlanningUpdate[],
    slots: PlanningSlot[],
  ): Promise<number> {
    const { data, error } = await supabase.rpc(
      "admin_save_tournament_final_full_planning",
      {
        target_tournament_id: tournamentId,
        payload: fullPlanningPayload(updates, slots),
      },
    );
    if (error)
      fail(error, "Impossible d’enregistrer le planning global des phases finales.");
    return Number(data ?? 0);
  },

  async publish(tournamentId: string): Promise<number> {
    const { data, error } = await supabase.rpc(
      "admin_publish_tournament_final_round",
      { target_tournament_id: tournamentId },
    );
    if (error) fail(error, "Impossible de publier le tour de phase finale.");
    return Number(data ?? 0);
  },

  async unpublish(tournamentId: string): Promise<number> {
    const { data, error } = await supabase.rpc(
      "admin_unpublish_tournament_final_round",
      { target_tournament_id: tournamentId },
    );
    if (error)
      fail(
        error,
        "Impossible de retirer le tour du calendrier pour le modifier.",
      );
    return Number(data ?? 0);
  },
};
