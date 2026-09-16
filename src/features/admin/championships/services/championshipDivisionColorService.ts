import { supabase } from "@/infrastructure/supabase/client";

export type ChampionshipDivisionColor = {
  divisionId: string;
  divisionName: string;
  displayColor: string | null;
};

type Row = {
  division_id: string;
  division_name: string;
  display_color: string | null;
};

const mapRow = (row: Row): ChampionshipDivisionColor => ({
  divisionId: row.division_id,
  divisionName: row.division_name,
  displayColor: row.display_color,
});

export const championshipDivisionColorService = {
  async list(championshipId: string): Promise<ChampionshipDivisionColor[]> {
    const { data, error } = await supabase.rpc(
      "admin_get_championship_division_colors",
      { target_id: championshipId },
    );
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map(mapRow);
  },

  async update(divisionId: string, color: string | null): Promise<void> {
    const { error } = await supabase.rpc(
      "admin_update_championship_division_color",
      {
        target_division_id: divisionId,
        target_color: color,
      },
    );
    if (error) throw new Error(error.message);
  },
};
