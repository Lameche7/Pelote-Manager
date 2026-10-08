import { supabase } from "@/infrastructure/supabase/client";

export const slotExchangeService = {
  async exchangeTwoReservations(firstOccupationId: string, secondOccupationId: string): Promise<void> {
    const { data, error } = await supabase.rpc("admin_exchange_reservation_slots", {
      first_occupation_id: firstOccupationId,
      second_occupation_id: secondOccupationId,
    });
    if (error) throw new Error(error.message);
    if ((data as { status?: string } | null)?.status !== "exchanged")
      throw new Error("Échange non confirmé par le serveur.");
  },
};
