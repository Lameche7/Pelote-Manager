import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

type Row = Record<string, unknown>;

export type MyChampionshipResultInputMode = "points" | "sets";

export type MyChampionshipResultSettings = {
  championshipId: string;
  inputMode: MyChampionshipResultInputMode | null;
  winningScore: number | null;
};

const mapInputMode = (value: unknown): MyChampionshipResultInputMode | null =>
  value === "points" || value === "sets" ? value : null;

export const myChampionshipResultSettingsService = {
  async list(): Promise<MyChampionshipResultSettings[]> {
    const { data, error } = await supabase.rpc(
      "get_my_championship_result_settings",
    );
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de charger le format de saisie des résultats.",
        ),
      );
    }

    if (!Array.isArray(data)) return [];
    return (data as Row[])
      .map((row): MyChampionshipResultSettings => ({
        championshipId: String(row.championship_id ?? ""),
        inputMode: mapInputMode(row.input_mode),
        winningScore:
          row.winning_score === null || row.winning_score === undefined
            ? null
            : Number(row.winning_score),
      }))
      .filter((item) => item.championshipId);
  },
};
