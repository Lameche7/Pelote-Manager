import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

type Row = Record<string, unknown>;
type RpcResponse = { data: unknown; error: unknown };
type ChampionshipRpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<RpcResponse>;

const rpc = supabase.rpc.bind(supabase) as unknown as ChampionshipRpc;

export type ChampionshipArchiveResult = {
  championshipId: string;
  status: "archived";
  alreadyArchived: boolean;
};

export const championshipLifecycleService = {
  async archive(championshipId: string): Promise<ChampionshipArchiveResult> {
    const { data, error } = await rpc("admin_archive_championship", {
      target_id: championshipId,
    });

    if (error) {
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible d’archiver le championnat."),
      );
    }

    const row = (data ?? {}) as Row;
    const result: ChampionshipArchiveResult = {
      championshipId: String(row.championshipId ?? ""),
      status: "archived",
      alreadyArchived: Boolean(row.alreadyArchived),
    };

    if (!result.championshipId) {
      throw new Error("La réponse d’archivage du championnat est incomplète.");
    }

    return result;
  },
};
