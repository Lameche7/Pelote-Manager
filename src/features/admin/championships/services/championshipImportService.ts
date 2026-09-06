import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type {
  ChampionshipTransactionalImportPayload,
  ChampionshipTransactionalImportResult,
} from "../domain/championshipTransactionalImport";

type RpcResponse = { data: unknown; error: unknown };
type Row = Record<string, unknown>;

const rpc = supabase.rpc as unknown as (
  name: string,
  args?: Record<string, unknown>,
) => Promise<RpcResponse>;

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

const mapChampionship = (value: unknown): AdminChampionshipSummary => {
  const row = (value ?? {}) as Row;
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    specialty: String(row.specialty ?? ""),
    seasonLabel: String(row.season_label ?? ""),
    status: String(row.status ?? "preparation"),
    sourceUrl:
      row.source_url === null || row.source_url === undefined
        ? null
        : String(row.source_url),
    divisionCount: Number(row.division_count ?? 0),
    teamCount: Number(row.team_count ?? 0),
    matchCount: Number(row.match_count ?? 0),
    updatedAt: String(row.updated_at ?? ""),
  };
};

const fail = (error: unknown, fallback: string): never => {
  if (error && typeof error === "object") {
    const message = String((error as Row).message ?? "");
    if (message === "Championship import payload is invalid") {
      throw new Error("Les données préparées pour l’import sont incomplètes.");
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
};
