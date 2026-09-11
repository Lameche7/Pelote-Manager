import { supabase } from "@/infrastructure/supabase/client";

export type ChampionshipReservationWindow = {
  weekday: number;
  opensAt: string;
  closesAt: string;
};

export type ChampionshipReservationResource = {
  id: string;
  name: string;
  selected: boolean;
};

export type ChampionshipReservationSettings = {
  clubId: string;
  enabled: boolean;
  advanceDays: number;
  maxActiveReservations: number;
  eligiblePlayerCount: number;
  resources: ChampionshipReservationResource[];
  windows: ChampionshipReservationWindow[];
};

type RpcResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

export const championshipReservationService = {
  async getSettings(): Promise<ChampionshipReservationSettings> {
    const { data, error } = (await supabase.rpc(
      "admin_get_championship_reservation_settings",
    )) as RpcResult<ChampionshipReservationSettings>;

    if (error) throw new Error(error.message);
    if (!data) throw new Error("Paramètres championnat introuvables.");
    return data;
  },

  async saveSettings(input: {
    enabled: boolean;
    advanceDays: number;
    maxActiveReservations: number;
    resourceIds: string[];
    windows: ChampionshipReservationWindow[];
  }): Promise<void> {
    const { error } = await supabase.rpc(
      "admin_save_championship_reservation_settings",
      {
        target_enabled: input.enabled,
        target_advance_days: input.advanceDays,
        target_max_active_reservations: input.maxActiveReservations,
        target_resource_ids: input.resourceIds,
        target_windows: input.windows.map((window) => ({
          weekday: window.weekday,
          opensAt: window.opensAt,
          closesAt: window.closesAt,
        })),
      },
    );

    if (error) throw new Error(error.message);
  },
};
