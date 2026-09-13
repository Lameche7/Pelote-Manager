import { reservationCalendarService } from "@/features/reservations/services/reservationCalendarService";
import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

export type PermanentSlotManager = {
  profileId: string;
  displayName: string;
  isPrimary: boolean;
};

export type AdminPermanentSlot = {
  id: string;
  label: string;
  resourceId: string;
  resourceName: string;
  weekday: number;
  startsAt: string;
  endsAt: string;
  validFrom: string;
  validUntil: string;
  managementWindowHours: number;
  isActive: boolean;
  managers: PermanentSlotManager[];
};

export type PermanentSlotCandidate = {
  profileId: string;
  displayName: string;
  email: string;
};

export type CreatePermanentSlotInput = {
  resourceId: string;
  label: string;
  weekday: number;
  startsAt: string;
  endsAt: string;
  validFrom: string;
  validUntil: string;
  managementWindowHours: number;
  primaryProfileId: string;
  managerProfileIds: string[];
};

type PermanentSlotCandidateRow = {
  profile_id: string;
  display_name: string;
  email: string;
};

export const adminPermanentSlotService = {
  listResources: reservationCalendarService.listResources,

  async listCandidates(): Promise<PermanentSlotCandidate[]> {
    const { data, error } = await supabase.rpc(
      "admin_list_permanent_slot_candidates",
    );
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de charger les titulaires disponibles.",
        ),
      );
    }

    return ((data ?? []) as PermanentSlotCandidateRow[]).map((row) => ({
      profileId: row.profile_id,
      displayName: row.display_name,
      email: row.email,
    }));
  },

  async listSlots(): Promise<AdminPermanentSlot[]> {
    const { data, error } = await supabase.rpc("admin_list_permanent_slots");
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de charger les créneaux permanents.",
        ),
      );
    }
    return (data ?? []) as AdminPermanentSlot[];
  },

  async createSlot(input: CreatePermanentSlotInput): Promise<string> {
    const { data, error } = await supabase.rpc("admin_create_permanent_slot", {
      target_resource_id: input.resourceId,
      target_label: input.label,
      target_weekday: input.weekday,
      target_starts_at: input.startsAt,
      target_ends_at: input.endsAt,
      target_valid_from: input.validFrom,
      target_valid_until: input.validUntil,
      target_management_window_hours: input.managementWindowHours,
      target_primary_profile_id: input.primaryProfileId,
      target_manager_profile_ids: input.managerProfileIds,
    });
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de créer ce créneau permanent.",
        ),
      );
    }
    return data as string;
  },

  async deactivateSlot(permanentSlotId: string): Promise<void> {
    const { error } = await supabase.rpc("admin_deactivate_permanent_slot", {
      target_permanent_slot_id: permanentSlotId,
    });
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de désactiver ce créneau permanent.",
        ),
      );
    }
  },
};
