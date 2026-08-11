import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type {
  MyTournamentRegistration,
  MyTournamentRegistrationDraft,
  PublicTournamentDetail,
  PublicTournamentSummary,
  TournamentAvailabilityRule,
  TournamentAvailabilitySlot,
  TournamentPartnerSuggestion,
  TournamentPhase,
  TournamentPlayWindow,
  TournamentRegistrationIdentity,
  TournamentSeriesRegistration,
  TournamentTeamPlayer,
} from "@/features/tournaments/types";

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

const mapSeries = (value: unknown): TournamentSeriesRegistration[] =>
  rows(value).map((series) => ({
    id: String(series.id),
    name: String(series.name),
    capacity: Number(series.capacity ?? 0),
    acceptedCount: Number(series.accepted_count ?? 0),
    remainingSlots: Number(series.remaining_slots ?? 0),
    enabled:
      typeof series.enabled === "boolean" ? Boolean(series.enabled) : undefined,
    reservedCount:
      series.reserved_count === undefined
        ? undefined
        : Number(series.reserved_count ?? 0),
  }));

const mapPlayWindows = (value: unknown): TournamentPlayWindow[] =>
  rows(value).map((window) => ({
    id: String(window.id),
    weekday: Number(window.weekday),
    opensAt: String(window.opens_at ?? "").slice(0, 5),
    closesAt: String(window.closes_at ?? "").slice(0, 5),
  }));

const mapPlayers = (value: unknown): TournamentTeamPlayer[] =>
  rows(value).map((player) => ({
    memberId: player.member_id ? String(player.member_id) : null,
    firstName: String(player.first_name ?? ""),
    lastName: String(player.last_name ?? ""),
    email: String(player.email ?? ""),
    phone: String(player.phone ?? ""),
    emailFromMember:
      player.email_from_member === undefined
        ? undefined
        : Boolean(player.email_from_member),
    phoneFromMember:
      player.phone_from_member === undefined
        ? undefined
        : Boolean(player.phone_from_member),
    role: player.role as TournamentTeamPlayer["role"],
  }));

const mapAvailability = (value: unknown): TournamentAvailabilityRule[] =>
  rows(value).map((rule) => ({
    kind: rule.kind as TournamentAvailabilityRule["kind"],
    weekday: Number(rule.weekday),
    startsAt: String(rule.starts_at ?? "").slice(0, 5),
    endsAt: String(rule.ends_at ?? "").slice(0, 5),
  }));

const mapAvailabilitySlots = (value: unknown): TournamentAvailabilitySlot[] =>
  rows(value).map((slot) => ({
    date: String(slot.play_date ?? slot.date ?? ""),
    startsAt: String(slot.starts_at ?? "").slice(0, 5),
    endsAt: String(slot.ends_at ?? "").slice(0, 5),
    phase:
      slot.phase === "pools" || slot.phase === "finals"
        ? (slot.phase as TournamentPhase)
        : undefined,
  }));

const mapSummary = (row: Row): PublicTournamentSummary => ({
  id: String(row.id),
  name: String(row.name ?? ""),
  description: String(row.description ?? ""),
  startsOn: String(row.starts_on ?? ""),
  endsOn: String(row.ends_on ?? ""),
  registrationOpensAt: String(row.registration_opens_at ?? ""),
  registrationClosesAt: String(row.registration_closes_at ?? ""),
  status: String(row.status ?? ""),
  teamCount: Number(row.team_count ?? 0),
  series: mapSeries(row.series),
});

const knownErrors: Record<string, string> = {
  "Authentication required": "Connectez-vous pour inscrire une équipe.",
  "Profile required": "Votre profil doit être créé avant l’inscription.",
  "Tournament not found": "Ce tournoi est introuvable.",
  "Tournament registrations are closed":
    "Les inscriptions de ce tournoi sont fermées.",
  "Tournament series is invalid": "La série choisie n’est plus disponible.",
  "Tournament series is full": "Cette série est complète.",
  "Tournament player role is invalid": "Choisissez votre poste dans l’équipe.",
  "Tournament registration fields are incomplete":
    "Complétez les informations des deux joueurs.",
  "Tournament player contacts are incomplete":
    "Renseignez un e-mail et un téléphone pour chaque joueur lorsque la fiche licencié ne les fournit pas.",
  "Tournament partner is invalid":
    "Le partenaire sélectionné n’est pas un licencié actif de ce club.",
  "Tournament availability rules are invalid":
    "Vérifiez les disponibilités sélectionnées.",
  "Tournament availability slots are invalid":
    "Un ou plusieurs créneaux sélectionnés ne sont pas disponibles pour ce tournoi.",
  "Tournament availability minimum not reached":
    "Vous n’avez pas sélectionné assez de créneaux disponibles pour la phase de poules.",
  "Tournament weekend availability minimum not reached":
    "Vous n’avez pas sélectionné assez de créneaux le week-end pendant la phase de poules.",
  "A player can only belong to one active team per tournament":
    "Un joueur est déjà inscrit dans une autre équipe de ce tournoi.",
  "Tournament registration not found": "Aucune inscription active trouvée.",
};

const fail = (error: unknown, fallback: string): never => {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "");
    if (knownErrors[message]) throw new Error(knownErrors[message]);
  }
  throw new Error(getSupabaseErrorMessage(error, fallback));
};

const registrationPayload = (draft: MyTournamentRegistrationDraft) => ({
  series_id: draft.seriesId,
  submitter_role: draft.submitterRole,
  submitter_first_name: draft.submitterFirstName.trim(),
  submitter_last_name: draft.submitterLastName.trim(),
  partner_member_id: draft.partnerMemberId,
  partner_first_name: draft.partnerFirstName.trim(),
  partner_last_name: draft.partnerLastName.trim(),
  partner_email: draft.partnerEmail.trim(),
  partner_phone: draft.partnerPhone.trim(),
  contact_email: draft.contactEmail.trim(),
  contact_phone: draft.contactPhone.trim(),
  comments: draft.comments.trim(),
  availability_rules: [],
  availability_slots: draft.availabilitySlots.map((slot) => ({
    date: slot.date,
    starts_at: slot.startsAt,
    ends_at: slot.endsAt,
  })),
});

export const tournamentService = {
  async listPublic(): Promise<PublicTournamentSummary[]> {
    const { data, error } = await supabase.rpc("list_public_tournaments");
    if (error) fail(error, "Impossible de charger les tournois.");
    return rows(data).map(mapSummary);
  },

  async getPublic(id: string): Promise<PublicTournamentDetail | null> {
    const [tournamentResult, availabilityResult] = await Promise.all([
      supabase.rpc("get_public_tournament", { target_id: id }),
      supabase.rpc("get_public_tournament_availability_grid", {
        target_tournament_id: id,
      }),
    ]);

    if (tournamentResult.error)
      fail(tournamentResult.error, "Impossible de charger le tournoi.");
    if (availabilityResult.error)
      fail(
        availabilityResult.error,
        "Impossible de charger les créneaux du tournoi.",
      );
    if (!tournamentResult.data) return null;

    const row = tournamentResult.data as Row;
    const availability = (availabilityResult.data ?? {}) as Row;
    return {
      ...mapSummary({ ...row, team_count: rows(row.teams).length }),
      rules: String(row.rules ?? ""),
      canRegister: Boolean(row.can_register),
      playWindows: mapPlayWindows(row.play_windows),
      availableSlots: mapAvailabilitySlots(availability.slots),
      minimumAvailabilitySlots: Number(availability.minimum_total ?? 65),
      minimumWeekendAvailabilitySlots: Number(
        availability.minimum_weekend ?? 0,
      ),
      slotDurationMinutes: Number(availability.slot_duration_minutes ?? 60),
      poolStartsOn: String(availability.pool_starts_on ?? row.starts_on ?? ""),
      poolEndsOn: String(availability.pool_ends_on ?? row.ends_on ?? ""),
      finalsStartsOn: availability.finals_starts_on
        ? String(availability.finals_starts_on)
        : null,
      finalsEndsOn: availability.finals_ends_on
        ? String(availability.finals_ends_on)
        : null,
      availablePoolSlotCount: Number(
        availability.available_pool_slot_count ?? 0,
      ),
      availableFinalsSlotCount: Number(
        availability.available_finals_slot_count ?? 0,
      ),
      teams: rows(row.teams).map((team) => ({
        id: String(team.id),
        seriesId: String(team.series_id),
        seriesName: String(team.series_name ?? ""),
        players: mapPlayers(team.players),
      })),
    };
  },

  async getMine(
    tournamentId: string,
  ): Promise<MyTournamentRegistration | null> {
    const { data, error } = await supabase.rpc(
      "get_my_tournament_registration_v2",
      { target_tournament_id: tournamentId },
    );
    if (error) fail(error, "Impossible de charger votre inscription.");
    if (!data) return null;
    const row = data as Row;
    return {
      id: String(row.id),
      seriesId: String(row.series_id),
      status: row.status as MyTournamentRegistration["status"],
      contactEmail: String(row.contact_email ?? ""),
      contactPhone: String(row.contact_phone ?? ""),
      comments: String(row.comments ?? ""),
      players: mapPlayers(row.players),
      availabilityRules: mapAvailability(row.availability_rules),
      availabilitySlots: mapAvailabilitySlots(row.availability_slots),
    };
  },

  async getIdentity(
    tournamentId: string,
  ): Promise<TournamentRegistrationIdentity> {
    const { data, error } = await supabase.rpc(
      "get_my_tournament_registration_identity",
      { target_tournament_id: tournamentId },
    );
    if (error) fail(error, "Impossible de charger vos coordonnées.");
    const row = (data ?? {}) as Row;
    return {
      memberId: row.member_id ? String(row.member_id) : null,
      firstName: String(row.first_name ?? ""),
      lastName: String(row.last_name ?? ""),
      email: String(row.email ?? ""),
      phone: String(row.phone ?? ""),
      emailFromMember: Boolean(row.email_from_member),
      phoneFromMember: Boolean(row.phone_from_member),
    };
  },

  async searchPartnerMembers(
    tournamentId: string,
    query: string,
  ): Promise<TournamentPartnerSuggestion[]> {
    const search = query.trim();
    if (search.length < 2) return [];
    const { data, error } = await supabase.rpc(
      "search_tournament_partner_members",
      {
        target_tournament_id: tournamentId,
        search_text: search,
      },
    );
    if (error) fail(error, "Impossible de rechercher les licenciés.");
    return rows(data).map((member) => ({
      id: String(member.id),
      firstName: String(member.first_name ?? ""),
      lastName: String(member.last_name ?? ""),
      clubName: String(member.club_name ?? ""),
      hasEmail: Boolean(member.has_email),
      hasPhone: Boolean(member.has_phone),
    }));
  },

  async saveMine(
    tournamentId: string,
    draft: MyTournamentRegistrationDraft,
  ): Promise<string> {
    const { data, error } = await supabase.rpc(
      "save_my_tournament_registration_v2",
      {
        target_tournament_id: tournamentId,
        payload: registrationPayload(draft),
      },
    );
    if (error) fail(error, "Impossible d’enregistrer votre équipe.");
    return String(data);
  },

  async withdrawMine(tournamentId: string): Promise<void> {
    const { error } = await supabase.rpc(
      "withdraw_my_tournament_registration",
      { target_tournament_id: tournamentId },
    );
    if (error) fail(error, "Impossible de retirer votre inscription.");
  },
};
