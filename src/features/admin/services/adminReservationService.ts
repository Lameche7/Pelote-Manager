import { supabase } from "@/infrastructure/supabase/client";

export type ReservationAdminSettings = {
  licenseeAdvanceHours: number;
  publicAdvanceHours: number;
  licenseePriceCents: number;
  publicPriceCents: number;
  defaultDurationMinutes: number;
  bookingStepMinutes: number;
  minimumNoticeMinutes: number;
  licenseeMaxActiveReservations: number;
  publicMaxActiveReservations: number;
};

export type OpeningHour = {
  id: string;
  resourceId: string;
  weekday: number;
  opensAt: string;
  closesAt: string;
  isActive: boolean;
};

export type CalendarClosure = {
  id: string;
  resourceId: string;
  title: string;
  startsAt: string;
  endsAt: string;
};

type SettingsRow = {
  licensee_advance_hours: number;
  public_advance_hours: number;
  licensee_price_cents: number;
  public_price_cents: number;
  default_duration_minutes: number;
  booking_step_minutes: number;
  minimum_notice_minutes: number;
  licensee_max_active_reservations: number;
  public_max_active_reservations: number;
};

export const adminReservationService = {
  async getSettings(): Promise<ReservationAdminSettings> {
    const { data, error } = await supabase.rpc("admin_get_reservation_settings");
    if (error) throw error;

    const row = (data as SettingsRow[] | null)?.[0];
    if (!row) throw new Error("Paramètres de réservation introuvables.");

    return {
      licenseeAdvanceHours: row.licensee_advance_hours,
      publicAdvanceHours: row.public_advance_hours,
      licenseePriceCents: row.licensee_price_cents,
      publicPriceCents: row.public_price_cents,
      defaultDurationMinutes: row.default_duration_minutes,
      bookingStepMinutes: row.booking_step_minutes,
      minimumNoticeMinutes: row.minimum_notice_minutes,
      licenseeMaxActiveReservations: row.licensee_max_active_reservations,
      publicMaxActiveReservations: row.public_max_active_reservations,
    };
  },

  async updateSettings(settings: ReservationAdminSettings): Promise<void> {
    const { error } = await supabase.rpc("admin_update_reservation_settings", {
      new_licensee_advance_hours: settings.licenseeAdvanceHours,
      new_public_advance_hours: settings.publicAdvanceHours,
      new_licensee_price_cents: settings.licenseePriceCents,
      new_public_price_cents: settings.publicPriceCents,
      new_default_duration_minutes: settings.defaultDurationMinutes,
      new_booking_step_minutes: settings.bookingStepMinutes,
      new_minimum_notice_minutes: settings.minimumNoticeMinutes,
      new_licensee_max_active_reservations: settings.licenseeMaxActiveReservations,
      new_public_max_active_reservations: settings.publicMaxActiveReservations,
    });
    if (error) throw error;
  },

  async listOpeningHours(resourceId: string): Promise<OpeningHour[]> {
    const { data, error } = await supabase.rpc("admin_list_opening_hours", {
      target_resource_id: resourceId,
    });
    if (error) throw error;

    return ((data ?? []) as Array<{
      id: string;
      resource_id: string;
      weekday: number;
      opens_at: string;
      closes_at: string;
      is_active: boolean;
    }>).map((row) => ({
      id: row.id,
      resourceId: row.resource_id,
      weekday: row.weekday,
      opensAt: row.opens_at,
      closesAt: row.closes_at,
      isActive: row.is_active,
    }));
  },

  async saveOpeningHour(hour: Omit<OpeningHour, "id"> & { id?: string }): Promise<void> {
    const { error } = await supabase.rpc("admin_save_opening_hour", {
      target_id: hour.id ?? null,
      target_resource_id: hour.resourceId,
      target_weekday: hour.weekday,
      target_opens_at: hour.opensAt,
      target_closes_at: hour.closesAt,
      target_is_active: hour.isActive,
    });
    if (error) throw error;
  },

  async deleteOpeningHour(id: string): Promise<void> {
    const { error } = await supabase.rpc("admin_delete_opening_hour", {
      target_id: id,
    });
    if (error) throw error;
  },

  async listClosures(resourceId: string): Promise<CalendarClosure[]> {
    const { data, error } = await supabase.rpc("admin_list_calendar_closures", {
      target_resource_id: resourceId,
    });
    if (error) throw error;

    return ((data ?? []) as Array<{
      id: string;
      resource_id: string;
      title: string;
      starts_at: string;
      ends_at: string;
    }>).map((row) => ({
      id: row.id,
      resourceId: row.resource_id,
      title: row.title,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    }));
  },

  async createClosure(closure: Omit<CalendarClosure, "id">): Promise<void> {
    const { error } = await supabase.rpc("admin_create_calendar_closure", {
      target_resource_id: closure.resourceId,
      target_title: closure.title,
      target_starts_at: closure.startsAt,
      target_ends_at: closure.endsAt,
    });
    if (error) throw error;
  },

  async deleteClosure(id: string): Promise<void> {
    const { error } = await supabase.rpc("admin_delete_calendar_closure", {
      target_id: id,
    });
    if (error) throw error;
  },
};
