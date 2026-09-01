import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

const time = (value: unknown) => String(value ?? "").slice(0, 5);

export type TournamentReschedulePreference =
  "recommended" | "requester_compromise";

export type TournamentRescheduleAvailabilitySource =
  | "unknown_from_errebot"
  | "partial_from_errebot"
  | "errebot_imported"
  | "declared"
  | "not_required";

export type TournamentRescheduleMatchSummary = {
  id: string;
  phase: "pools" | "finals";
  requesterTeamId: string;
  requesterLabel: string;
  opponentTeamId: string;
  opponentLabel: string;
  resourceId: string;
  resourceName: string;
  playDate: string;
  startsAt: string;
  endsAt: string;
};

export type TournamentRescheduleFreeSlot = {
  kind: "free_slot";
  resourceId: string;
  resourceName: string;
  playDate: string;
  startsAt: string;
  endsAt: string;
  requesterSameDayPenalty: number;
  requesterOutsideDeclaredAvailability: boolean;
  opponentAvailabilityKnown: boolean;
  preference: TournamentReschedulePreference;
};

export type TournamentRescheduleSwap = {
  kind: "swap";
  swapMatchId: string;
  swapTeamAId: string;
  swapTeamBId: string;
  swapTeamALabel: string;
  swapTeamBLabel: string;
  resourceId: string;
  resourceName: string;
  playDate: string;
  startsAt: string;
  endsAt: string;
  swapMovesToResourceId: string;
  swapMovesToResourceName: string;
  swapMovesToPlayDate: string;
  swapMovesToStartsAt: string;
  swapMovesToEndsAt: string;
  requesterSameDayPenalty: number;
  requesterOutsideDeclaredAvailability: boolean;
  preference: TournamentReschedulePreference;
};

export type TournamentRescheduleOptions = {
  match: TournamentRescheduleMatchSummary;
  policy: {
    minimumRestEnforced: boolean;
    requesterMayTakeExtraSameDayMatch: boolean;
    otherTeamsSameDayLoadProtected: boolean;
    swapsEnabled: boolean;
    availabilitySource: TournamentRescheduleAvailabilitySource;
    availabilityKnownTeamCount: number;
    availabilityTeamCount: number;
    availabilityCoverageComplete: boolean;
    swapRestrictionReason:
      | "errebot_availability_not_imported"
      | "errebot_availability_incomplete"
      | null;
  };
  freeSlots: TournamentRescheduleFreeSlot[];
  swaps: TournamentRescheduleSwap[];
};

const mapMatch = (value: unknown): TournamentRescheduleMatchSummary => {
  const row = (value ?? {}) as Row;
  return {
    id: String(row.id ?? ""),
    phase: row.phase === "finals" ? "finals" : "pools",
    requesterTeamId: String(row.requester_team_id ?? ""),
    requesterLabel: String(row.requester_label ?? ""),
    opponentTeamId: String(row.opponent_team_id ?? ""),
    opponentLabel: String(row.opponent_label ?? ""),
    resourceId: String(row.resource_id ?? ""),
    resourceName: String(row.resource_name ?? ""),
    playDate: String(row.play_date ?? ""),
    startsAt: time(row.starts_at),
    endsAt: time(row.ends_at),
  };
};

const mapFreeSlot = (row: Row): TournamentRescheduleFreeSlot => ({
  kind: "free_slot",
  resourceId: String(row.resource_id ?? ""),
  resourceName: String(row.resource_name ?? ""),
  playDate: String(row.play_date ?? ""),
  startsAt: time(row.starts_at),
  endsAt: time(row.ends_at),
  requesterSameDayPenalty: Number(row.requester_same_day_penalty ?? 0),
  requesterOutsideDeclaredAvailability: Boolean(
    row.requester_outside_declared_availability,
  ),
  opponentAvailabilityKnown: Boolean(row.opponent_availability_known),
  preference:
    row.preference === "requester_compromise"
      ? "requester_compromise"
      : "recommended",
});

const mapSwap = (row: Row): TournamentRescheduleSwap => ({
  kind: "swap",
  swapMatchId: String(row.swap_match_id ?? ""),
  swapTeamAId: String(row.swap_team_a_id ?? ""),
  swapTeamBId: String(row.swap_team_b_id ?? ""),
  swapTeamALabel: String(row.swap_team_a_label ?? ""),
  swapTeamBLabel: String(row.swap_team_b_label ?? ""),
  resourceId: String(row.resource_id ?? ""),
  resourceName: String(row.resource_name ?? ""),
  playDate: String(row.play_date ?? ""),
  startsAt: time(row.starts_at),
  endsAt: time(row.ends_at),
  swapMovesToResourceId: String(row.swap_moves_to_resource_id ?? ""),
  swapMovesToResourceName: String(row.swap_moves_to_resource_name ?? ""),
  swapMovesToPlayDate: String(row.swap_moves_to_play_date ?? ""),
  swapMovesToStartsAt: time(row.swap_moves_to_starts_at),
  swapMovesToEndsAt: time(row.swap_moves_to_ends_at),
  requesterSameDayPenalty: Number(row.requester_same_day_penalty ?? 0),
  requesterOutsideDeclaredAvailability: Boolean(
    row.requester_outside_declared_availability,
  ),
  preference:
    row.preference === "requester_compromise"
      ? "requester_compromise"
      : "recommended",
});

const availabilitySource = (
  value: unknown,
): TournamentRescheduleAvailabilitySource => {
  if (
    value === "unknown_from_errebot" ||
    value === "partial_from_errebot" ||
    value === "errebot_imported" ||
    value === "declared"
  ) {
    return value;
  }
  return "not_required";
};

const knownErrors: Record<string, string> = {
  "Tournament match not found": "Cette partie n’existe plus.",
  "Tournament team cannot request this reschedule":
    "Vous ne pouvez pas demander le report de cette partie.",
  "Tournament reschedule is not available at this stage":
    "Les reports ne sont pas disponibles à cette étape du tournoi.",
  "Tournament match is not scheduled": "Cette partie n’est plus programmée.",
  "Tournament match resource is invalid":
    "Le terrain de cette partie n’est plus disponible.",
  "Tournament match is not published":
    "Cette partie n’est pas actuellement publiée.",
  "Tournament match already has a result":
    "Une partie ayant déjà un résultat ne peut plus être reportée.",
  "Tournament match has already started":
    "Une partie commencée ne peut plus être reportée.",
};

const fail = (error: unknown): never => {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "");
    if (knownErrors[message]) throw new Error(knownErrors[message]);
  }
  throw new Error(
    getSupabaseErrorMessage(
      error,
      "Impossible de rechercher des solutions de report.",
    ),
  );
};

export const tournamentRescheduleService = {
  async getOptions(
    matchId: string,
    requesterTeamId: string,
  ): Promise<TournamentRescheduleOptions> {
    const { data, error } = await supabase.rpc(
      "get_my_tournament_reschedule_options",
      {
        target_match_id: matchId,
        requester_team_id: requesterTeamId,
      },
    );

    if (error) fail(error);

    const root = (data ?? {}) as Row;
    const policy = (root.policy ?? {}) as Row;
    return {
      match: mapMatch(root.match),
      policy: {
        minimumRestEnforced: Boolean(policy.minimum_rest_enforced),
        requesterMayTakeExtraSameDayMatch: Boolean(
          policy.requester_may_take_extra_same_day_match,
        ),
        otherTeamsSameDayLoadProtected: Boolean(
          policy.other_teams_same_day_load_protected,
        ),
        swapsEnabled: policy.swaps_enabled !== false,
        availabilitySource: availabilitySource(policy.availability_source),
        availabilityKnownTeamCount: Number(
          policy.availability_known_team_count ?? 0,
        ),
        availabilityTeamCount: Number(policy.availability_team_count ?? 0),
        availabilityCoverageComplete: Boolean(
          policy.availability_coverage_complete,
        ),
        swapRestrictionReason:
          policy.swap_restriction_reason === "errebot_availability_incomplete"
            ? "errebot_availability_incomplete"
            : policy.swap_restriction_reason ===
                "errebot_availability_not_imported"
              ? "errebot_availability_not_imported"
              : null,
      },
      freeSlots: rows(root.free_slots).map(mapFreeSlot),
      swaps: rows(root.swaps).map(mapSwap),
    };
  },
};
