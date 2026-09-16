import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];
const time = (value: unknown) => String(value ?? "").slice(0, 5);

export type AdminManualRescheduleMatch = {
  id: string;
  phase: string;
  teamAId: string;
  teamALabel: string;
  teamBId: string;
  teamBLabel: string;
  resourceId: string;
  resourceName: string;
  playDate: string;
  startsAt: string;
  endsAt: string;
};

export type AdminManualRescheduleTournament = {
  id: string;
  name: string;
  status: string;
  matches: AdminManualRescheduleMatch[];
};

export type AdminManualRescheduleSlot = {
  resourceId: string;
  resourceName: string;
  playDate: string;
  startsAt: string;
  endsAt: string;
};

const mapMatch = (row: Row): AdminManualRescheduleMatch => ({
  id: String(row.id ?? ""),
  phase: String(row.phase ?? ""),
  teamAId: String(row.team_a_id ?? ""),
  teamALabel: String(row.team_a_label ?? "Équipe A"),
  teamBId: String(row.team_b_id ?? ""),
  teamBLabel: String(row.team_b_label ?? "Équipe B"),
  resourceId: String(row.resource_id ?? ""),
  resourceName: String(row.resource_name ?? ""),
  playDate: String(row.play_date ?? ""),
  startsAt: time(row.starts_at),
  endsAt: time(row.ends_at),
});

const knownErrors: Record<string, string> = {
  Forbidden: "Vous n’avez pas les droits nécessaires pour gérer ces reports.",
  "Tournament match not found": "Cette partie n’existe plus.",
  "Tournament reschedule is not available at this stage":
    "Les reports ne sont pas disponibles à cette étape du tournoi.",
  "Tournament match is not scheduled": "Cette partie n’est plus programmée.",
  "Tournament match resource is invalid":
    "Le terrain actuel de cette partie n’est plus disponible.",
  "Tournament match is not published":
    "Cette partie n’est pas actuellement publiée.",
  "Tournament match already has a result":
    "Une partie ayant déjà un résultat ne peut plus être reportée.",
  "Tournament match has already started":
    "Une partie commencée ne peut plus être reportée.",
  "Tournament match already has an active reschedule request":
    "Une demande de report est déjà en cours pour cette partie.",
  "Tournament reschedule requester team is invalid":
    "Choisissez l’équipe à l’origine de la demande.",
  "Tournament reschedule offline contact note is required":
    "Indiquez comment la demande a été recueillie hors application.",
  "Tournament reschedule proposal is no longer available":
    "Ce créneau n’est plus disponible. Rechargez les créneaux puis réessayez.",
};

const fail = (error: unknown, fallback: string): never => {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "");
    if (knownErrors[message]) throw new Error(knownErrors[message]);
  }
  throw new Error(getSupabaseErrorMessage(error, fallback));
};

export const adminTournamentManualRescheduleService = {
  async getContext(): Promise<AdminManualRescheduleTournament[]> {
    const { data, error } = await supabase.rpc(
      "admin_get_tournament_manual_reschedule_context",
    );
    if (error) {
      fail(error, "Impossible de charger les parties pouvant être reportées.");
    }

    return rows(data).map((row) => ({
      id: String(row.id ?? ""),
      name: String(row.name ?? ""),
      status: String(row.status ?? ""),
      matches: rows(row.matches).map(mapMatch),
    }));
  },

  async getSlots(matchId: string): Promise<AdminManualRescheduleSlot[]> {
    const { data, error } = await supabase.rpc(
      "admin_get_tournament_manual_reschedule_slots",
      { target_match_id: matchId },
    );
    if (error) {
      fail(error, "Impossible de charger les créneaux disponibles.");
    }

    return rows(data).map((row) => ({
      resourceId: String(row.resource_id ?? ""),
      resourceName: String(row.resource_name ?? ""),
      playDate: String(row.play_date ?? ""),
      startsAt: time(row.starts_at),
      endsAt: time(row.ends_at),
    }));
  },

  async create(input: {
    matchId: string;
    requesterTeamId: string;
    slot: AdminManualRescheduleSlot;
    contactNote: string;
  }): Promise<string> {
    const { data, error } = await supabase.rpc(
      "admin_create_tournament_manual_reschedule_request",
      {
        target_match_id: input.matchId,
        requester_team_id: input.requesterTeamId,
        target_resource_id: input.slot.resourceId,
        target_play_date: input.slot.playDate,
        target_starts_at: input.slot.startsAt,
        target_ends_at: input.slot.endsAt,
        contact_note: input.contactNote.trim(),
      },
    );
    if (error) {
      fail(error, "Impossible de créer cette demande de report.");
    }
    return String(data ?? "");
  },
};
