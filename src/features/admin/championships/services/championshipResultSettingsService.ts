import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

type Row = Record<string, unknown>;
type RpcResponse = { data: unknown; error: unknown };
type ChampionshipRpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<RpcResponse>;

const rpc = supabase.rpc.bind(supabase) as unknown as ChampionshipRpc;

export type ChampionshipResultInputMode = "points" | "sets";

export type ChampionshipResultSettings = {
  championshipId: string;
  inputMode: ChampionshipResultInputMode | null;
  winningScore: number | null;
};

const mapSettings = (value: unknown): ChampionshipResultSettings => {
  const row = (value ?? {}) as Row;
  const mode = row.inputMode;
  return {
    championshipId: String(row.championshipId ?? ""),
    inputMode: mode === "points" || mode === "sets" ? mode : null,
    winningScore:
      row.winningScore === null || row.winningScore === undefined
        ? null
        : Number(row.winningScore),
  };
};

const fail = (error: unknown): never => {
  if (error && typeof error === "object") {
    const message = String((error as Row).message ?? "");
    if (message === "Invalid championship result settings") {
      throw new Error("Le format de résultat choisi n’est pas valide.");
    }
  }
  throw new Error(
    getSupabaseErrorMessage(
      error,
      "Impossible d’enregistrer le format de saisie des résultats.",
    ),
  );
};

export const championshipResultSettingsService = {
  async get(championshipId: string): Promise<ChampionshipResultSettings> {
    const { data, error } = await rpc(
      "admin_get_championship_result_settings",
      { target_id: championshipId },
    );
    if (error) fail(error);
    return mapSettings(data);
  },

  async update(
    championshipId: string,
    inputMode: ChampionshipResultInputMode,
    winningScore: number,
  ): Promise<ChampionshipResultSettings> {
    const { data, error } = await rpc(
      "admin_update_championship_result_settings",
      {
        target_id: championshipId,
        input_mode: inputMode,
        winning_score: winningScore,
      },
    );
    if (error) fail(error);
    return mapSettings(data);
  },
};
