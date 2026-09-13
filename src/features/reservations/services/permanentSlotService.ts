import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

export type PermanentSlotOccurrenceStatus =
  "scheduled" | "confirmed" | "released";

export type PermanentSlotOccurrence = {
  occurrenceId: string;
  permanentSlotId: string;
  label: string;
  resourceId: string;
  resourceName: string;
  startsAt: string;
  endsAt: string;
  status: PermanentSlotOccurrenceStatus;
  managementOpensAt: string;
  canManageNow: boolean;
  isRebooked: boolean;
  isPrimary: boolean;
};

type PermanentSlotOccurrenceRow = {
  occurrence_id: string;
  permanent_slot_id: string;
  label: string;
  resource_id: string;
  resource_name: string;
  starts_at: string;
  ends_at: string;
  status: PermanentSlotOccurrenceStatus;
  management_opens_at: string;
  can_manage_now: boolean;
  is_rebooked: boolean;
  is_primary: boolean;
};

export const permanentSlotService = {
  async hasPermanentSlots(): Promise<boolean> {
    const { data, error } = await supabase.rpc("has_my_permanent_slots");
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de vérifier vos créneaux permanents.",
        ),
      );
    }
    return data === true;
  },

  async listMyOccurrences(
    fromDate: string,
    toDate: string,
  ): Promise<PermanentSlotOccurrence[]> {
    const { data, error } = await supabase.rpc(
      "list_my_permanent_slot_occurrences",
      {
        target_from: fromDate,
        target_to: toDate,
      },
    );
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de charger vos créneaux permanents.",
        ),
      );
    }

    return ((data ?? []) as PermanentSlotOccurrenceRow[]).map((row) => ({
      occurrenceId: row.occurrence_id,
      permanentSlotId: row.permanent_slot_id,
      label: row.label,
      resourceId: row.resource_id,
      resourceName: row.resource_name,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
      managementOpensAt: row.management_opens_at,
      canManageNow: row.can_manage_now,
      isRebooked: row.is_rebooked,
      isPrimary: row.is_primary,
    }));
  },

  async setOccurrenceStatus(
    occurrenceId: string,
    status: PermanentSlotOccurrenceStatus,
  ): Promise<void> {
    const { error } = await supabase.rpc(
      "set_my_permanent_slot_occurrence_status",
      {
        target_occurrence_id: occurrenceId,
        target_status: status,
      },
    );
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de modifier ce créneau permanent.",
        ),
      );
    }
  },
};
