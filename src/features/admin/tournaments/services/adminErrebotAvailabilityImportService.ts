import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type { ErrebotAvailabilityImportRow } from "@/features/admin/tournaments/domain/errebotAvailabilityImport";

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

export type AdminErrebotAvailabilityTeam = {
  externalTeamId: string;
  teamId: string;
  label: string;
  availabilityKnown: boolean;
  slotCount: number;
};

export type AdminErrebotAvailabilityContext = {
  enabled: boolean;
  tournamentId: string;
  tournamentName: string;
  tournamentStatus: string;
  slotDurationMinutes: number;
  acceptedTeamCount: number;
  knownTeamCount: number;
  coverageComplete: boolean;
  teams: AdminErrebotAvailabilityTeam[];
};

export type AdminErrebotAvailabilityPreviewError = {
  row: number;
  code: string;
  message: string;
};

export type AdminErrebotAvailabilityPreview = {
  valid: boolean;
  rowCount: number;
  teamCount: number;
  acceptedTeamCount: number;
  knownTeamCountBefore: number;
  knownTeamCountAfter: number;
  coverageCompleteAfter: boolean;
  errors: AdminErrebotAvailabilityPreviewError[];
};

export type AdminErrebotAvailabilityImportResult = {
  importedTeamCount: number;
  importedSlotCount: number;
  knownTeamCount: number;
  acceptedTeamCount: number;
  coverageComplete: boolean;
};

const fail = (error: unknown, fallback: string): never => {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "");
    if (message === "Forbidden") {
      throw new Error("Vous n’avez pas le droit de gérer ce tournoi.");
    }
    if (message === "Tournament not found") {
      throw new Error("Tournoi introuvable.");
    }
    if (message === "Tournament is not an Errebot import") {
      throw new Error("Ce tournoi n’est pas issu d’un import Errebot.");
    }
    if (message === "Tournament availability cannot be imported at this stage") {
      throw new Error(
        "Les disponibilités ne peuvent plus être importées à cette étape du tournoi.",
      );
    }
    if (message === "Errebot availability import is invalid") {
      throw new Error(
        "Le fichier contient encore des lignes invalides. Relancez la prévisualisation.",
      );
    }
  }
  throw new Error(getSupabaseErrorMessage(error, fallback));
};

const payload = (items: ErrebotAvailabilityImportRow[]) => ({
  rows: items.map((item) => ({
    external_team_id: item.externalTeamId,
    play_date: item.playDate,
    starts_at: item.startsAt,
    ends_at: item.endsAt,
  })),
});

const mapContext = (value: unknown): AdminErrebotAvailabilityContext => {
  const root = (value ?? {}) as Row;
  return {
    enabled: Boolean(root.enabled),
    tournamentId: String(root.tournament_id ?? ""),
    tournamentName: String(root.tournament_name ?? ""),
    tournamentStatus: String(root.tournament_status ?? ""),
    slotDurationMinutes: Number(root.slot_duration_minutes ?? 60),
    acceptedTeamCount: Number(root.accepted_team_count ?? 0),
    knownTeamCount: Number(root.known_team_count ?? 0),
    coverageComplete: Boolean(root.coverage_complete),
    teams: rows(root.teams).map((team) => ({
      externalTeamId: String(team.external_team_id ?? ""),
      teamId: String(team.team_id ?? ""),
      label: String(team.label ?? ""),
      availabilityKnown: Boolean(team.availability_known),
      slotCount: Number(team.slot_count ?? 0),
    })),
  };
};

export const adminErrebotAvailabilityImportService = {
  async getContext(
    tournamentId: string,
  ): Promise<AdminErrebotAvailabilityContext> {
    const { data, error } = await supabase.rpc(
      "admin_get_errebot_availability_import_context",
      { target_tournament_id: tournamentId },
    );
    if (error) fail(error, "Impossible de charger l’import des disponibilités.");
    return mapContext(data);
  },

  async preview(
    tournamentId: string,
    items: ErrebotAvailabilityImportRow[],
  ): Promise<AdminErrebotAvailabilityPreview> {
    const { data, error } = await supabase.rpc(
      "admin_preview_errebot_availability_import",
      {
        target_tournament_id: tournamentId,
        payload: payload(items),
      },
    );
    if (error) fail(error, "Impossible de contrôler le fichier.");
    const root = (data ?? {}) as Row;
    return {
      valid: Boolean(root.valid),
      rowCount: Number(root.row_count ?? 0),
      teamCount: Number(root.team_count ?? 0),
      acceptedTeamCount: Number(root.accepted_team_count ?? 0),
      knownTeamCountBefore: Number(root.known_team_count_before ?? 0),
      knownTeamCountAfter: Number(root.known_team_count_after ?? 0),
      coverageCompleteAfter: Boolean(root.coverage_complete_after),
      errors: rows(root.errors).map((item) => ({
        row: Number(item.row ?? 0),
        code: String(item.code ?? ""),
        message: String(item.message ?? "Ligne invalide."),
      })),
    };
  },

  async apply(
    tournamentId: string,
    items: ErrebotAvailabilityImportRow[],
  ): Promise<AdminErrebotAvailabilityImportResult> {
    const { data, error } = await supabase.rpc(
      "admin_import_errebot_availability",
      {
        target_tournament_id: tournamentId,
        payload: payload(items),
      },
    );
    if (error) fail(error, "Impossible d’importer les disponibilités.");
    const root = (data ?? {}) as Row;
    return {
      importedTeamCount: Number(root.imported_team_count ?? 0),
      importedSlotCount: Number(root.imported_slot_count ?? 0),
      knownTeamCount: Number(root.known_team_count ?? 0),
      acceptedTeamCount: Number(root.accepted_team_count ?? 0),
      coverageComplete: Boolean(root.coverage_complete),
    };
  },
};
