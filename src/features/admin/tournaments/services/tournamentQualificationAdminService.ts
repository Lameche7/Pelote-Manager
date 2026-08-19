import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

export type TournamentSeriesQualification = {
  seriesId: string;
  finalsQualifierCount: number;
};

export type TournamentFinalStageShape = {
  seriesId: string;
  seriesName: string;
  qualifierCount: number;
  mainBracketSize: number;
  directQualifiers: number;
  preliminaryMatches: number;
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

  async getShape(tournamentId: string): Promise<TournamentFinalStageShape[]> {
    const { data, error } = await supabase.rpc(
      "get_tournament_final_stage_shape",
      {
        target_tournament_id: tournamentId,
      },
    );

    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de calculer la forme de la phase finale.",
        ),
      );
    }

    return rows(data).map((row) => ({
      seriesId: String(row.series_id ?? ""),
      seriesName: String(row.series_name ?? "Série"),
      qualifierCount: Number(row.qualifier_count ?? 0),
      mainBracketSize: Number(row.main_bracket_size ?? 0),
      directQualifiers: Number(row.direct_qualifiers ?? 0),
      preliminaryMatches: Number(row.preliminary_matches ?? 0),
    }));
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
