import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type {
  ErrebotAvailabilityDeclaration,
  ErrebotAvailabilityImportRow,
  ErrebotAvailabilitySourceSlot,
} from "@/features/admin/tournaments/domain/errebotAvailabilityImport";

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

export type AdminErrebotAvailabilityTeam = {
  externalTeamId: string;
  teamId: string;
  label: string;
  poolsKnown: boolean;
  poolsSlotCount: number;
  finalsKnown: boolean;
  finalsSlotCount: number;
};

export type AdminErrebotAvailabilityContext = {
  enabled: boolean;
  tournamentId: string;
  tournamentName: string;
  tournamentStatus: string;
  slotDurationMinutes: number;
  acceptedTeamCount: number;
  finalsRequired: boolean;
  poolsKnownTeamCount: number;
  finalsKnownTeamCount: number;
  poolsCoverageComplete: boolean;
  finalsCoverageComplete: boolean;
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
  sourceSlotCount: number;
  teamCount: number;
  poolTeamCount: number;
  finalsTeamCount: number;
  acceptedTeamCount: number;
  poolsKnownTeamCountBefore: number;
  poolsKnownTeamCountAfter: number;
  finalsKnownTeamCountBefore: number;
  finalsKnownTeamCountAfter: number;
  poolsCoverageCompleteAfter: boolean;
  finalsCoverageCompleteAfter: boolean;
  coverageCompleteAfter: boolean;
  errors: AdminErrebotAvailabilityPreviewError[];
};

export type AdminErrebotAvailabilityImportResult = {
  importedTeamCount: number;
  importedSlotCount: number;
  sourceSlotCount: number;
  acceptedTeamCount: number;
  poolsKnownTeamCount: number;
  finalsKnownTeamCount: number;
  poolsCoverageComplete: boolean;
  finalsCoverageComplete: boolean;
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
    if (
      message === "Tournament availability cannot be imported at this stage"
    ) {
      throw new Error(
        "Les disponibilités ne peuvent plus être importées à cette étape du tournoi.",
      );
    }
    if (message === "Errebot availability import is invalid") {
      throw new Error(
        "Le classeur contient encore des données invalides. Relancez la prévisualisation.",
      );
    }
  }
  throw new Error(getSupabaseErrorMessage(error, fallback));
};

const sourceSlotKey = (
  phase: string,
  playDate: string,
  startsAt: string,
  endsAt: string,
) => `${phase}|${playDate}|${startsAt}|${endsAt}`;

const legacyPayload = (
  items: ErrebotAvailabilityImportRow[],
  declarations: ErrebotAvailabilityDeclaration[],
  sourceSlots: ErrebotAvailabilitySourceSlot[],
) => ({
  rows: items.map((item) => ({
    external_team_id: item.externalTeamId,
    phase: item.phase,
    play_date: item.playDate,
    starts_at: item.startsAt,
    ends_at: item.endsAt,
  })),
  declarations: declarations.map((item) => ({
    external_team_id: item.externalTeamId,
    phase: item.phase,
    slot_count: item.slotCount,
  })),
  source_slots: sourceSlots.map((item) => ({
    phase: item.phase,
    play_date: item.playDate,
    starts_at: item.startsAt,
    ends_at: item.endsAt,
    source_slot_id: item.sourceSlotId,
  })),
});

const payload = (
  items: ErrebotAvailabilityImportRow[],
  declarations: ErrebotAvailabilityDeclaration[],
  sourceSlots: ErrebotAvailabilitySourceSlot[],
) => {
  const sourceIdsBySlot = new Map<string, string>();
  const seenSourceIds = new Set<string>();

  for (const sourceSlot of sourceSlots) {
    if (!sourceSlot.sourceSlotId || seenSourceIds.has(sourceSlot.sourceSlotId)) {
      return legacyPayload(items, declarations, sourceSlots);
    }
    seenSourceIds.add(sourceSlot.sourceSlotId);
    sourceIdsBySlot.set(
      sourceSlotKey(
        sourceSlot.phase,
        sourceSlot.playDate,
        sourceSlot.startsAt,
        sourceSlot.endsAt,
      ),
      sourceSlot.sourceSlotId,
    );
  }

  const availabilityByTeam = new Map<
    string,
    {
      external_team_id: string;
      phase: ErrebotAvailabilityDeclaration["phase"];
      source_slot_ids: string[];
    }
  >();

  for (const declaration of declarations) {
    const key = `${declaration.externalTeamId}|${declaration.phase}`;
    availabilityByTeam.set(key, {
      external_team_id: declaration.externalTeamId,
      phase: declaration.phase,
      source_slot_ids: [],
    });
  }

  for (const item of items) {
    const sourceSlotId = sourceIdsBySlot.get(
      sourceSlotKey(item.phase, item.playDate, item.startsAt, item.endsAt),
    );
    const groupKey = `${item.externalTeamId}|${item.phase}`;
    const group = availabilityByTeam.get(groupKey);
    if (!sourceSlotId || !group) {
      return legacyPayload(items, declarations, sourceSlots);
    }
    group.source_slot_ids.push(sourceSlotId);
  }

  return {
    availability_by_team: Array.from(availabilityByTeam.values()),
    declarations: declarations.map((item) => ({
      external_team_id: item.externalTeamId,
      phase: item.phase,
      slot_count: item.slotCount,
    })),
    source_slots: sourceSlots.map((item) => ({
      phase: item.phase,
      play_date: item.playDate,
      starts_at: item.startsAt,
      ends_at: item.endsAt,
      source_slot_id: item.sourceSlotId,
    })),
  };
};

const mapContext = (value: unknown): AdminErrebotAvailabilityContext => {
  const root = (value ?? {}) as Row;
  return {
    enabled: Boolean(root.enabled),
    tournamentId: String(root.tournament_id ?? ""),
    tournamentName: String(root.tournament_name ?? ""),
    tournamentStatus: String(root.tournament_status ?? ""),
    slotDurationMinutes: Number(root.slot_duration_minutes ?? 60),
    acceptedTeamCount: Number(root.accepted_team_count ?? 0),
    finalsRequired: Boolean(root.finals_required),
    poolsKnownTeamCount: Number(root.pools_known_team_count ?? 0),
    finalsKnownTeamCount: Number(root.finals_known_team_count ?? 0),
    poolsCoverageComplete: Boolean(root.pools_coverage_complete),
    finalsCoverageComplete: Boolean(root.finals_coverage_complete),
    coverageComplete: Boolean(root.coverage_complete),
    teams: rows(root.teams).map((team) => ({
      externalTeamId: String(team.external_team_id ?? ""),
      teamId: String(team.team_id ?? ""),
      label: String(team.label ?? ""),
      poolsKnown: Boolean(team.pools_known),
      poolsSlotCount: Number(team.pools_slot_count ?? 0),
      finalsKnown: Boolean(team.finals_known),
      finalsSlotCount: Number(team.finals_slot_count ?? 0),
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
    if (error)
      fail(error, "Impossible de charger l’import des disponibilités.");
    return mapContext(data);
  },

  async preview(
    tournamentId: string,
    items: ErrebotAvailabilityImportRow[],
    declarations: ErrebotAvailabilityDeclaration[],
    sourceSlots: ErrebotAvailabilitySourceSlot[],
  ): Promise<AdminErrebotAvailabilityPreview> {
    const { data, error } = await supabase.rpc(
      "admin_preview_errebot_availability_import_compact",
      {
        target_tournament_id: tournamentId,
        payload: payload(items, declarations, sourceSlots),
      },
    );
    if (error) fail(error, "Impossible de contrôler le classeur.");
    const root = (data ?? {}) as Row;
    return {
      valid: Boolean(root.valid),
      rowCount: Number(root.row_count ?? 0),
      sourceSlotCount: Number(root.source_slot_count ?? 0),
      teamCount: Number(root.team_count ?? 0),
      poolTeamCount: Number(root.pool_team_count ?? 0),
      finalsTeamCount: Number(root.finals_team_count ?? 0),
      acceptedTeamCount: Number(root.accepted_team_count ?? 0),
      poolsKnownTeamCountBefore: Number(
        root.pools_known_team_count_before ?? 0,
      ),
      poolsKnownTeamCountAfter: Number(root.pools_known_team_count_after ?? 0),
      finalsKnownTeamCountBefore: Number(
        root.finals_known_team_count_before ?? 0,
      ),
      finalsKnownTeamCountAfter: Number(
        root.finals_known_team_count_after ?? 0,
      ),
      poolsCoverageCompleteAfter: Boolean(root.pools_coverage_complete_after),
      finalsCoverageCompleteAfter: Boolean(root.finals_coverage_complete_after),
      coverageCompleteAfter: Boolean(root.coverage_complete_after),
      errors: rows(root.errors).map((item) => ({
        row: Number(item.row ?? 0),
        code: String(item.code ?? ""),
        message: String(item.message ?? "Donnée invalide."),
      })),
    };
  },

  async apply(
    tournamentId: string,
    items: ErrebotAvailabilityImportRow[],
    declarations: ErrebotAvailabilityDeclaration[],
    sourceSlots: ErrebotAvailabilitySourceSlot[],
  ): Promise<AdminErrebotAvailabilityImportResult> {
    const { data, error } = await supabase.rpc(
      "admin_import_errebot_availability_compact",
      {
        target_tournament_id: tournamentId,
        payload: payload(items, declarations, sourceSlots),
      },
    );
    if (error) fail(error, "Impossible d’importer les disponibilités.");
    const root = (data ?? {}) as Row;
    return {
      importedTeamCount: Number(root.imported_team_count ?? 0),
      importedSlotCount: Number(root.imported_slot_count ?? 0),
      sourceSlotCount: Number(root.source_slot_count ?? 0),
      acceptedTeamCount: Number(root.accepted_team_count ?? 0),
      poolsKnownTeamCount: Number(root.pools_known_team_count ?? 0),
      finalsKnownTeamCount: Number(root.finals_known_team_count ?? 0),
      poolsCoverageComplete: Boolean(root.pools_coverage_complete),
      finalsCoverageComplete: Boolean(root.finals_coverage_complete),
      coverageComplete: Boolean(root.coverage_complete),
    };
  },
};
