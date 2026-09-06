import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type { ChampionshipStandingsImportPayload } from "../domain/championshipStandingsImport";

type Row = Record<string, unknown>;
type RpcResponse = { data: unknown; error: unknown };
type ChampionshipRpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<RpcResponse>;
const rpc = supabase.rpc.bind(supabase) as unknown as ChampionshipRpc;

export type ChampionshipStandingsServerPreview = {
  valid: boolean;
  alreadyImported: boolean;
  batchId: string | null;
  summary: {
    incomingCount: number;
    newCount: number;
    changedCount: number;
    unchangedCount: number;
    poolCount: number;
  };
  changes: Array<{
    kind: "new" | "changed";
    teamLabel: string;
    poolCode: string;
    rank: number;
    previousRank: number | null;
  }>;
  issues: Array<{ code: string; message: string }>;
};

const asRows = (value: unknown) =>
  Array.isArray(value) ? (value as Row[]) : [];

const mapPreview = (value: unknown): ChampionshipStandingsServerPreview => {
  const row = (value ?? {}) as Row;
  const summary = (row.summary ?? {}) as Row;
  return {
    valid: Boolean(row.valid),
    alreadyImported: Boolean(row.alreadyImported),
    batchId: row.batchId ? String(row.batchId) : null,
    summary: {
      incomingCount: Number(summary.incomingCount ?? 0),
      newCount: Number(summary.newCount ?? 0),
      changedCount: Number(summary.changedCount ?? 0),
      unchangedCount: Number(summary.unchangedCount ?? 0),
      poolCount: Number(summary.poolCount ?? 0),
    },
    changes: asRows(row.changes).map((change) => ({
      kind: change.kind === "new" ? "new" : "changed",
      teamLabel: String(change.teamLabel ?? ""),
      poolCode: String(change.poolCode ?? ""),
      rank: Number(change.rank ?? 0),
      previousRank:
        change.previousRank === null || change.previousRank === undefined
          ? null
          : Number(change.previousRank),
    })),
    issues: asRows(row.issues).map((issue) => ({
      code: String(issue.code ?? "unknown"),
      message: String(issue.message ?? "Classement non exploitable."),
    })),
  };
};

const fail = (error: unknown, fallback: string): never => {
  if (error && typeof error === "object") {
    const message = String((error as Row).message ?? "");
    if (message === "Championship standings payload is invalid") {
      throw new Error("Le fichier de classement préparé est incomplet.");
    }
    if (message === "Championship standings import is invalid") {
      throw new Error(
        "Le classement contient des lignes qui ne correspondent pas au championnat importé.",
      );
    }
  }
  throw new Error(getSupabaseErrorMessage(error, fallback));
};

export const championshipStandingsService = {
  async preview(
    championshipId: string,
    payload: ChampionshipStandingsImportPayload,
  ) {
    const { data, error } = await rpc(
      "admin_preview_championship_standings_import",
      { target_id: championshipId, payload },
    );
    if (error) fail(error, "Impossible d’analyser le classement officiel.");
    return mapPreview(data);
  },

  async apply(
    championshipId: string,
    payload: ChampionshipStandingsImportPayload,
  ) {
    const { data, error } = await rpc(
      "admin_apply_championship_standings_import",
      { target_id: championshipId, payload },
    );
    if (error) fail(error, "Impossible d’importer le classement officiel.");
    const row = (data ?? {}) as Row;
    return {
      championshipId: String(row.championshipId ?? ""),
      batchId: String(row.batchId ?? ""),
      alreadyImported: Boolean(row.alreadyImported),
      summary: mapPreview({ summary: row.summary }).summary,
    };
  },
};
