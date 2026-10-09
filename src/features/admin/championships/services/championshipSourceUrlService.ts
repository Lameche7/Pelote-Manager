import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

type RpcResponse = { data: unknown; error: unknown };
type Row = Record<string, unknown>;

type ChampionshipRpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<RpcResponse>;

const rpc = supabase.rpc.bind(supabase) as unknown as ChampionshipRpc;

export const championshipSourceUrlService = {
  async update(
    championshipId: string,
    sourceUrl: string,
  ): Promise<string | null> {
    const { data, error } = await rpc("admin_update_championship_source_url", {
      target_id: championshipId,
      source_url: sourceUrl,
    });
    if (error) {
      const message =
        error && typeof error === "object"
          ? String((error as Row).message ?? "")
          : "";
      if (message === "Championship source URL is invalid") {
        throw new Error(
          "L’URL doit commencer par https://lbpb.competition.ffpb.net",
        );
      }
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible d’enregistrer la source officielle.",
        ),
      );
    }
    const row = (data ?? {}) as Row;
    const value = row.sourceUrl;
    return value === null || value === undefined || value === ""
      ? null
      : String(value);
  },
};
