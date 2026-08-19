import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

export type TournamentSeriesQualification = {
  seriesId: string;
  finalsQualifierCount: number;
};

export const tournamentQualificationAdminService = {
  async get(tournamentId: string): Promise<Map<string, number>> {
    const { data, error } = await supabase.rpc(
      "admin_get_tournament_series_qualifiers",
      { target_id: tournamentId },
    );

    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de charger les règles de qualification.",
        ),
      );
    }

    return new Map(
      rows(data).map((row) => [
        String(row.series_id ?? ""),
        Number(row.finals_qualifier_count ?? 0),
      ]),
    );
  },

  async save(
    tournamentId: string,
    series: TournamentSeriesQualification[],
  ): Promise<void> {
    const { error } = await supabase.rpc(
      "admin_save_tournament_series_qualifiers",
      {
        target_id: tournamentId,
        payload: series.map((item) => ({
          series_id: item.seriesId,
          finals_qualifier_count: item.finalsQualifierCount,
        })),
      },
    );

    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible d’enregistrer les règles de qualification.",
        ),
      );
    }
  },
};
