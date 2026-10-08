import { supabase } from "@/infrastructure/supabase/client";

export const slotExchangeService = {
  async exchangeTwoReservations(firstOccupationId: string, secondOccupationId: string): Promise<{ exchangeId: string; notificationsPublished: number }> {
    const { data, error } = await supabase.rpc("admin_exchange_calendar_occupations", {
      first_occupation_id: firstOccupationId,
      second_occupation_id: secondOccupationId,
    });
    if (error) throw new Error(error.message);
    const result = data as { status?: string; exchange_id?: string } | null;
    if (result?.status !== "exchanged" || !result.exchange_id)
      throw new Error("Échange non confirmé par le serveur.");
    const published = await supabase.rpc("admin_publish_slot_exchange_notifications", {
      target_exchange_id: result.exchange_id,
    });
    if (published.error) throw new Error("Échange enregistré, mais notifications non publiées : " + published.error.message);
    return { exchangeId: result.exchange_id, notificationsPublished: Number(published.data ?? 0) };
  },
};
