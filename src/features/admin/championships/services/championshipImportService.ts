import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type { ChampionshipMatchesUpdatePayload } from "../domain/championshipMatchesUpdate";
import type {
  ChampionshipTransactionalImportPayload,
  ChampionshipTransactionalImportResult,
} from "../domain/championshipTransactionalImport";

type RpcResponse = { data: unknown; error: unknown };
type Row = Record<string, unknown>;

type ChampionshipRpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<RpcResponse>;

const rpc = supabase.rpc.bind(supabase) as unknown as ChampionshipRpc;

const asRows = (value: unknown) =>
  Array.isArray(value) ? (value as Row[]) : [];
const nullableString = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : String(value);

const mapImportResult = (
  value: unknown,
): ChampionshipTransactionalImportResult => {
  const row = (value ?? {}) as Row;
  const summary = (row.summary ?? {}) as Row;
  const result: ChampionshipTransactionalImportResult = {
    championshipId: String(row.championshipId ?? ""),
    batchId: String(row.batchId ?? ""),
    alreadyImported: Boolean(row.alreadyImported),
    summary: {
      divisionCount: Number(summary.divisionCount ?? 0),
      poolCount: Number(summary.poolCount ?? 0),
      clubCount: Number(summary.clubCount ?? 0),
      teamCount: Number(summary.teamCount ?? 0),
      playerCount: Number(summary.playerCount ?? 0),
      matchCount: Number(summary.matchCount ?? 0),
      linkedPlayerCount: Number(summary.linkedPlayerCount ?? 0),
    },
  };
  if (!result.championshipId || !result.batchId) {
    throw new Error("La réponse d’import du championnat est incomplète.");
  }
  return result;
};

export type AdminChampionshipSummary = {
  id: string;
  name: string;
  specialty: string;
  seasonLabel: string;
  status: string;
  sourceUrl: string | null;
  divisionCount: number;
  teamCount: number;
  matchCount: number;
  updatedAt: string;
};

export type AdminChampionshipPlayer = {
  id: string;
  licenceNumber: string;
  firstName: string;
  lastName: string;
  linked: boolean;
};

export type AdminChampionshipTeam = {
  id: string;
  divisionId: string;
  clubName: string;
  teamNumber: string;
  sourceLabel: string;
  poolCode: string | null;
  players: AdminChampionshipPlayer[];
};

export type AdminChampionshipMatch = {
  id: string;
  divisionId: string;
  divisionName: string;
  poolCode: string | null;
  phase: string;
  team1Id: string;
  team1Label: string;
  team2Id: string;
  team2Label: string;
  scheduledOn: string | null;
  scheduledTime: string | null;
  reportOn: string | null;
  reportTime: string | null;
  venue: string | null;
  agreementOn: string | null;
  agreementTime: string | null;
  agreementVenue: string | null;
  status: string;
  scoreTeam1: number | null;
  scoreTeam2: number | null;
  scoreRaw: string | null;
  resultComment: string | null;
};

export type AdminChampionshipDetail = {
  id: string;
  name: string;
  specialty: string;
  seasonLabel: string;
  status: string;
  sourceUrl: string | null;
  updatedAt: string;
  lastImportAt: string | null;
  divisions: Array<{
    id: string;
    name: string;
    pools: Array<{ id: string; code: string; name: string }>;
  }>;
  teams: AdminChampionshipTeam[];
  matches: AdminChampionshipMatch[];
};

export type ChampionshipUpdateChange = {
  kind: "new" | "changed";
  category: string;
  phase: string;
  team1: string;
  team1Number: string;
  team2: string;
  team2Number: string;
  score: string | null;
  scheduledOn: string | null;
  fields: string[];
};

export type ChampionshipUpdatePreview = {
  valid: boolean;
  alreadyImported: boolean;
  batchId: string | null;
  summary: {
    incomingCount: number;
    unchangedCount: number;
    changedCount: number;
    newCount: number;
    resultAddedCount: number;
    rescheduledCount: number;
    newPhaseCount: number;
  };
  changes: ChampionshipUpdateChange[];
  issues: Array<{ code: string; message: string }>;
};

export type ChampionshipUpdateApplyResult = {
  championshipId: string;
  batchId: string;
  alreadyImported: boolean;
  summary: ChampionshipUpdatePreview["summary"];
};

const mapChampionship = (value: unknown): AdminChampionshipSummary => {
  const row = (value ?? {}) as Row;
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    specialty: String(row.specialty ?? ""),
    seasonLabel: String(row.season_label ?? ""),
    status: String(row.status ?? "preparation"),
    sourceUrl: nullableString(row.source_url),
    divisionCount: Number(row.division_count ?? 0),
    teamCount: Number(row.team_count ?? 0),
    matchCount: Number(row.match_count ?? 0),
    updatedAt: String(row.updated_at ?? ""),
  };
};

const mapDetail = (value: unknown): AdminChampionshipDetail => {
  const row = (value ?? {}) as Row;
  const detail: AdminChampionshipDetail = {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    specialty: String(row.specialty ?? ""),
    seasonLabel: String(row.season_label ?? ""),
    status: String(row.status ?? "preparation"),
    sourceUrl: nullableString(row.source_url),
    updatedAt: String(row.updated_at ?? ""),
    lastImportAt: nullableString(row.last_import_at),
    divisions: asRows(row.divisions).map((division) => ({
      id: String(division.id ?? ""),
      name: String(division.name ?? ""),
      pools: asRows(division.pools).map((pool) => ({
        id: String(pool.id ?? ""),
        code: String(pool.code ?? ""),
        name: String(pool.name ?? ""),
      })),
    })),
    teams: asRows(row.teams).map((team) => ({
      id: String(team.id ?? ""),
      divisionId: String(team.division_id ?? ""),
      clubName: String(team.club_name ?? ""),
      teamNumber: String(team.team_number ?? ""),
      sourceLabel: String(team.source_label ?? ""),
      poolCode: nullableString(team.pool_code),
      players: asRows(team.players).map((player) => ({
        id: String(player.id ?? ""),
        licenceNumber: String(player.licence_number ?? ""),
        firstName: String(player.first_name ?? ""),
        lastName: String(player.last_name ?? ""),
        linked: Boolean(player.linked),
      })),
    })),
    matches: asRows(row.matches).map((match) => ({
      id: String(match.id ?? ""),
      divisionId: String(match.division_id ?? ""),
      divisionName: String(match.division_name ?? ""),
      poolCode: nullableString(match.pool_code),
      phase: String(match.phase ?? ""),
      team1Id: String(match.team1_id ?? ""),
      team1Label: String(match.team1_label ?? ""),
      team2Id: String(match.team2_id ?? ""),
      team2Label: String(match.team2_label ?? ""),
      scheduledOn: nullableString(match.scheduled_on),
      scheduledTime: nullableString(match.scheduled_time),
      reportOn: nullableString(match.report_on),
      reportTime: nullableString(match.report_time),
      venue: nullableString(match.venue),
      agreementOn: nullableString(match.agreement_on),
      agreementTime: nullableString(match.agreement_time),
      agreementVenue: nullableString(match.agreement_venue),
      status: String(match.status ?? "to_schedule"),
      scoreTeam1:
        match.score_team1 === null || match.score_team1 === undefined
          ? null
          : Number(match.score_team1),
      scoreTeam2:
        match.score_team2 === null || match.score_team2 === undefined
          ? null
          : Number(match.score_team2),
      scoreRaw: nullableString(match.score_raw),
      resultComment: nullableString(match.result_comment),
    })),
  };
  if (!detail.id) throw new Error("Le championnat demandé est introuvable.");
  return detail;
};

const mapUpdatePreview = (value: unknown): ChampionshipUpdatePreview => {
  const row = (value ?? {}) as Row;
  const summary = (row.summary ?? {}) as Row;
  return {
    valid: Boolean(row.valid),
    alreadyImported: Boolean(row.alreadyImported),
    batchId: nullableString(row.batchId),
    summary: {
      incomingCount: Number(summary.incomingCount ?? 0),
      unchangedCount: Number(summary.unchangedCount ?? 0),
      changedCount: Number(summary.changedCount ?? 0),
      newCount: Number(summary.newCount ?? 0),
      resultAddedCount: Number(summary.resultAddedCount ?? 0),
      rescheduledCount: Number(summary.rescheduledCount ?? 0),
      newPhaseCount: Number(summary.newPhaseCount ?? 0),
    },
    changes: asRows(row.changes).map((change) => ({
      kind: change.kind === "new" ? "new" : "changed",
      category: String(change.category ?? ""),
      phase: String(change.phase ?? ""),
      team1: String(change.team1 ?? ""),
      team1Number: String(change.team1Number ?? ""),
      team2: String(change.team2 ?? ""),
      team2Number: String(change.team2Number ?? ""),
      score: nullableString(change.score),
      scheduledOn: nullableString(change.scheduledOn),
      fields: Array.isArray(change.fields)
        ? change.fields.map((field) => String(field))
        : [],
    })),
    issues: asRows(row.issues).map((issue) => ({
      code: String(issue.code ?? "unknown"),
      message: String(issue.message ?? "Mise à jour non exploitable."),
    })),
  };
};

const fail = (error: unknown, fallback: string): never => {
  if (error && typeof error === "object") {
    const message = String((error as Row).message ?? "");
    if (message === "Championship import payload is invalid") {
      throw new Error("Les données préparées pour l’import sont incomplètes.");
    }
    if (message === "Championship matches update payload is invalid") {
      throw new Error("Le fichier de mise à jour des parties est incomplet.");
    }
    if (message === "Championship matches update is invalid") {
      throw new Error(
        "La mise à jour contient des incohérences. Corrigez-les avant validation.",
      );
    }
    if (message === "Championship federation club mapping is invalid") {
      throw new Error(
        "Le club officiel choisi ne peut pas être rattaché à ce club Pelote Manager.",
      );
    }
    if (message === "Championship source is already managed by another club") {
      throw new Error(
        "Ce championnat est déjà administré par un autre club Pelote Manager.",
      );
    }
    if (message === "Championship player identity conflict") {
      throw new Error(
        "Une licence existe déjà avec une identité différente. L’import est bloqué pour vérification.",
      );
    }
  }
  throw new Error(getSupabaseErrorMessage(error, fallback));
};

export const championshipImportService = {
  async importSources(
    payload: ChampionshipTransactionalImportPayload,
  ): Promise<ChampionshipTransactionalImportResult> {
    const { data, error } = await rpc("admin_import_championship_sources", {
      payload,
    });
    if (error) fail(error, "Impossible d’enregistrer le championnat.");
    return mapImportResult(data);
  },

  async list(): Promise<AdminChampionshipSummary[]> {
    const { data, error } = await rpc("admin_list_championships");
    if (error) fail(error, "Impossible de charger les championnats.");
    if (!Array.isArray(data)) return [];
    return data.map(mapChampionship).filter((item) => item.id);
  },

  async detail(championshipId: string): Promise<AdminChampionshipDetail> {
    const { data, error } = await rpc("admin_get_championship_detail", {
      target_id: championshipId,
    });
    if (error) fail(error, "Impossible de charger le championnat.");
    return mapDetail(data);
  },

  async previewMatchesUpdate(
    championshipId: string,
    payload: ChampionshipMatchesUpdatePayload,
  ): Promise<ChampionshipUpdatePreview> {
    const { data, error } = await rpc(
      "admin_preview_championship_matches_update",
      { target_id: championshipId, payload },
    );
    if (error) fail(error, "Impossible d’analyser la mise à jour.");
    return mapUpdatePreview(data);
  },

  async applyMatchesUpdate(
    championshipId: string,
    payload: ChampionshipMatchesUpdatePayload,
  ): Promise<ChampionshipUpdateApplyResult> {
    const { data, error } = await rpc(
      "admin_apply_championship_matches_update",
      {
        target_id: championshipId,
        payload,
      },
    );
    if (error) fail(error, "Impossible d’appliquer la mise à jour.");
    const row = (data ?? {}) as Row;
    const result = {
      championshipId: String(row.championshipId ?? ""),
      batchId: String(row.batchId ?? ""),
      alreadyImported: Boolean(row.alreadyImported),
      summary: mapUpdatePreview({ summary: row.summary }).summary,
    };
    if (!result.championshipId || !result.batchId) {
      throw new Error(
        "La réponse de mise à jour du championnat est incomplète.",
      );
    }
    return result;
  },
};
