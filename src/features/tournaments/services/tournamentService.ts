import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type {
  MyTournamentRegistration,
  MyTournamentRegistrationDraft,
  PublicTournamentDetail,
  PublicTournamentSummary,
  TournamentAvailabilityRule,
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

const mapPlayers = (value: unknown): TournamentTeamPlayer[] =>
  rows(value).map((player) => ({
    memberId: player.member_id ? String(player.member_id) : null,
    firstName: String(player.first_name ?? ""),
    lastName: String(player.last_name ?? ""),
    email: String(player.email ?? ""),
    phone: String(player.phone ?? ""),
    role: player.role as TournamentTeamPlayer["role"],
  }));

const mapAvailability = (value: unknown): TournamentAvailabilityRule[] =>
  rows(value).map((rule) => ({
    kind: rule.kind as TournamentAvailabilityRule["kind"],
    weekday: Number(rule.weekday),
    startsAt: String(rule.starts_at ?? "").slice(0, 5),
    endsAt: String(rule.ends_at ?? "").slice(0, 5),
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
    "Complétez les informations des deux joueurs et l’adresse de contact.",
  "Tournament availability rules are invalid":
    "Vérifiez les jours et horaires de disponibilité.",
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
  partner_first_name: draft.partnerFirstName.trim(),
  partner_last_name: draft.partnerLastName.trim(),
  partner_email: draft.partnerEmail.trim(),
  partner_phone: draft.partnerPhone.trim(),
  contact_email: draft.contactEmail.trim(),
  contact_phone: draft.contactPhone.trim(),
  comments: draft.comments.trim(),
  availability_rules: draft.availabilityRules.map((rule) => ({
    kind: rule.kind,
    weekday: rule.weekday,
    starts_at: rule.startsAt,
    ends_at: rule.endsAt,
  })),
});

export const tournamentService = {
  async listPublic(): Promise<PublicTournamentSummary[]> {
    const { data, error } = await supabase.rpc("list_public_tournaments");
    if (error) fail(error, "Impossible de charger les tournois.");
    return rows(data).map(mapSummary);
  },

  async getPublic(id: string): Promise<PublicTournamentDetail | null> {
    const { data, error } = await supabase.rpc("get_public_tournament", {
      target_id: id,
    });
    if (error) fail(error, "Impossible de charger le tournoi.");
    if (!data) return null;
    const row = data as Row;
    return {
      ...mapSummary({ ...row, team_count: rows(row.teams).length }),
      rules: String(row.rules ?? ""),
      canRegister: Boolean(row.can_register),
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
      "get_my_tournament_registration",
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
    };
  },

  async saveMine(
    tournamentId: string,
    draft: MyTournamentRegistrationDraft,
  ): Promise<string> {
    const { data, error } = await supabase.rpc(
      "save_my_tournament_registration",
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
