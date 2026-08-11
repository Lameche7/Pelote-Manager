import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type {
  AdminTournamentTeam,
  AdminTournamentTeamDraft,
  AdminTournamentTeamsPayload,
  TournamentAvailabilityRule,
  TournamentAvailabilitySlot,
  TournamentPhase,
  TournamentSeriesRegistration,
  TournamentTeamPlayer,
  TournamentTeamStatus,
} from "@/features/tournaments/types";

type Row = Record<string, unknown>;

type TeamMutationResult = {
  poolsInvalidated: boolean;
};

type TeamSaveResult = TeamMutationResult & {
  teamId: string;
};

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

const mapPlayers = (value: unknown): TournamentTeamPlayer[] =>
  rows(value).map((player) => ({
    memberId: player.member_id ? String(player.member_id) : null,
    firstName: String(player.first_name ?? ""),
    lastName: String(player.last_name ?? ""),
    clubName: String(player.club_name ?? ""),
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

const mapSeries = (value: unknown): TournamentSeriesRegistration[] =>
  rows(value).map((series) => ({
    id: String(series.id),
    name: String(series.name ?? ""),
    capacity: Number(series.capacity ?? 0),
    acceptedCount: Number(series.accepted_count ?? 0),
    remainingSlots: Math.max(
      Number(series.capacity ?? 0) - Number(series.reserved_count ?? 0),
      0,
    ),
    enabled: Boolean(series.enabled),
    reservedCount: Number(series.reserved_count ?? 0),
  }));

const knownErrors: Record<string, string> = {
  Forbidden: "Vous n’avez pas le droit de gérer les équipes de ce tournoi.",
  "Tournament not found": "Tournoi introuvable.",
  "Tournament team not found": "Équipe introuvable.",
  "Tournament teams are locked at this stage":
    "Les équipes sont verrouillées à cette étape.",
  "Tournament teams cannot be changed after planning generation":
    "Les équipes ne peuvent plus être modifiées une fois le planning généré.",
  "Tournament series is invalid": "La série choisie n’est pas disponible.",
  "Tournament series is full": "Cette série est complète.",
  "Tournament team status is invalid": "Le statut de l’équipe est invalide.",
  "Tournament registration fields are incomplete":
    "Renseignez au minimum une adresse de contact.",
  "A tournament team must contain exactly two players":
    "Une équipe doit contenir exactement deux joueurs.",
  "Tournament players are invalid":
    "Renseignez les noms et postes des deux joueurs.",
  "Tournament player clubs are incomplete":
    "Renseignez le club de chacun des deux joueurs.",
  "A team must contain one front player and one back player":
    "L’équipe doit comporter un Avant et un Arrière.",
  "Tournament availability rules are invalid":
    "Vérifiez les disponibilités de l’équipe.",
  "Tournament availability slots are invalid":
    "Les créneaux sélectionnés ne correspondent plus à la configuration du tournoi.",
  "Tournament availability minimum not reached":
    "Le nombre minimum de créneaux de la phase de poules n’est pas atteint.",
  "Tournament weekend availability minimum not reached":
    "Le minimum week-end de la phase de poules n’est pas atteint.",
  "Tournament finals availability minimum not reached":
    "Le minimum de 35 créneaux de la phase finale n’est pas atteint.",
  "A player can only belong to one active team per tournament":
    "Un joueur appartient déjà à une autre équipe active de ce tournoi.",
};

const fail = (error: unknown, fallback: string): never => {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "");
    if (knownErrors[message]) throw new Error(knownErrors[message]);
  }
  throw new Error(getSupabaseErrorMessage(error, fallback));
};

const mapMutationResult = (value: unknown): TeamMutationResult => {
  const row = (value ?? {}) as Row;
  return { poolsInvalidated: Boolean(row.pools_invalidated) };
};

const teamPayload = (draft: AdminTournamentTeamDraft) => ({
  series_id: draft.seriesId,
  status: draft.status,
  contact_email: draft.contactEmail.trim(),
  contact_phone: draft.contactPhone.trim(),
  comments: draft.comments.trim(),
  players: draft.players.map((player) => ({
    member_id: player.memberId || null,
    first_name: player.firstName.trim(),
    last_name: player.lastName.trim(),
    club_name: player.clubName.trim(),
    email: (player.email ?? "").trim(),
    phone: (player.phone ?? "").trim(),
    role: player.role,
  })),
  availability_rules: [],
  availability_slots: draft.availabilitySlots.map((slot) => ({
    date: slot.date,
    starts_at: slot.startsAt,
    ends_at: slot.endsAt,
  })),
});

export const adminTournamentTeamService = {
  async get(tournamentId: string): Promise<AdminTournamentTeamsPayload> {
    const [teamsResponse, availabilityResponse] = await Promise.all([
      supabase.rpc("admin_list_tournament_teams_v2", {
        target_tournament_id: tournamentId,
      }),
      supabase.rpc("admin_get_tournament_dated_availability", {
        target_tournament_id: tournamentId,
      }),
    ]);

    if (teamsResponse.error) {
      fail(
        teamsResponse.error,
        "Impossible de charger les équipes du tournoi.",
      );
    }
    if (availabilityResponse.error) {
      fail(
        availabilityResponse.error,
        "Impossible de charger les disponibilités du tournoi.",
      );
    }

    const row = (teamsResponse.data ?? {}) as Row;
    const tournament = (row.tournament ?? {}) as Row;
    const availability = (availabilityResponse.data ?? {}) as Row;
    const availabilityByTeam = new Map(
      rows(availability.teams).map((item) => [
        String(item.team_id),
        {
          slotCount: Number(item.slot_count ?? 0),
          weekendSlotCount: Number(item.weekend_slot_count ?? 0),
          poolSlotCount: Number(item.pool_slot_count ?? 0),
          finalsSlotCount: Number(item.finals_slot_count ?? 0),
        },
      ]),
    );

    return {
      tournament: {
        id: String(tournament.id ?? ""),
        name: String(tournament.name ?? ""),
        status: String(tournament.status ?? ""),
        registrationOpensAt: String(tournament.registration_opens_at ?? ""),
        registrationClosesAt: String(tournament.registration_closes_at ?? ""),
        minimumAvailabilitySlots: Number(availability.minimum_total ?? 0),
        minimumWeekendAvailabilitySlots: Number(
          availability.minimum_weekend ?? 0,
        ),
        slotDurationMinutes: Number(availability.slot_duration_minutes ?? 60),
        poolStartsOn: String(availability.pool_starts_on ?? ""),
        poolEndsOn: String(availability.pool_ends_on ?? ""),
        finalsStartsOn: availability.finals_starts_on
          ? String(availability.finals_starts_on)
          : null,
        finalsEndsOn: availability.finals_ends_on
          ? String(availability.finals_ends_on)
          : null,
        availableSlotCount: Number(availability.available_slot_count ?? 0),
        availableWeekendSlotCount: Number(
          availability.available_weekend_slot_count ?? 0,
        ),
        availablePoolSlotCount: Number(
          availability.available_pool_slot_count ?? 0,
        ),
        availableFinalsSlotCount: Number(
          availability.available_finals_slot_count ?? 0,
        ),
        availableSlots: mapAvailabilitySlots(availability.slots),
      },
      series: mapSeries(row.series),
      teams: rows(row.teams).map((team): AdminTournamentTeam => {
        const datedAvailability = availabilityByTeam.get(String(team.id)) ?? {
          slotCount: 0,
          weekendSlotCount: 0,
          poolSlotCount: 0,
          finalsSlotCount: 0,
        };
        return {
          id: String(team.id),
          seriesId: String(team.series_id),
          seriesName: String(team.series_name ?? ""),
          status: team.status as TournamentTeamStatus,
          contactEmail: String(team.contact_email ?? ""),
          contactPhone: String(team.contact_phone ?? ""),
          comments: String(team.comments ?? ""),
          submittedBy: team.submitted_by ? String(team.submitted_by) : null,
          registeredAt: String(team.registered_at ?? ""),
          updatedAt: String(team.updated_at ?? ""),
          players: mapPlayers(team.players),
          availabilityRules: mapAvailability(team.availability_rules),
          availabilitySlotCount: datedAvailability.slotCount,
          weekendAvailabilitySlotCount: datedAvailability.weekendSlotCount,
          poolAvailabilitySlotCount: datedAvailability.poolSlotCount,
          finalsAvailabilitySlotCount: datedAvailability.finalsSlotCount,
        };
      }),
    };
  },

  async getDatedAvailability(
    teamId: string,
  ): Promise<TournamentAvailabilitySlot[]> {
    const { data, error } = await supabase.rpc(
      "admin_get_tournament_team_dated_availability",
      { target_team_id: teamId },
    );
    if (error) {
      fail(error, "Impossible de charger les créneaux de l’équipe.");
    }
    const row = (data ?? {}) as Row;
    return mapAvailabilitySlots(row.slots);
  },

  async save(
    tournamentId: string,
    teamId: string | null,
    draft: AdminTournamentTeamDraft,
  ): Promise<TeamSaveResult> {
    const { data, error } = await supabase.rpc(
      "admin_save_tournament_team_v4",
      {
        target_tournament_id: tournamentId,
        target_team_id: teamId,
        payload: teamPayload(draft),
      },
    );
    if (error) fail(error, "Impossible d’enregistrer l’équipe.");
    const row = (data ?? {}) as Row;
    return {
      teamId: String(row.team_id ?? ""),
      ...mapMutationResult(row),
    };
  },

  async setStatus(
    teamId: string,
    status: TournamentTeamStatus,
  ): Promise<TeamMutationResult> {
    const { data, error } = await supabase.rpc(
      "admin_set_tournament_team_status_v2",
      {
        target_team_id: teamId,
        target_status: status,
      },
    );
    if (error) fail(error, "Impossible de modifier le statut de l’équipe.");
    return mapMutationResult(data);
  },

  async delete(teamId: string): Promise<TeamMutationResult> {
    const { data, error } = await supabase.rpc("admin_delete_tournament_team", {
      target_team_id: teamId,
    });
    if (error) fail(error, "Impossible de supprimer l’équipe.");
    return mapMutationResult(data);
  },
};
