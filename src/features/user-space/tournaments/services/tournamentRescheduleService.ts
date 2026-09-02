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

export type TournamentRescheduleOption =
  TournamentRescheduleFreeSlot | TournamentRescheduleSwap;

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

export type TournamentRescheduleRequestStatus =
  "pending" | "approved" | "rejected" | "cancelled" | "stale" | "applied";

export type TournamentRescheduleApproval = {
  teamId: string;
  teamLabel: string;
  decision: "pending" | "approved" | "rejected";
  isRequester: boolean;
  canAct: boolean;
  appActorCount: number;
  decidedAt: string | null;
};

export type TournamentRescheduleRequest = {
  id: string;
  tournamentId: string;
  tournamentName: string;
  matchId: string;
  requesterTeamId: string;
  requesterLabel: string;
  proposalKind: "free_slot" | "swap";
  status: TournamentRescheduleRequestStatus;
  match: TournamentRescheduleMatchSummary;
  proposal: TournamentRescheduleOption;
  approvals: TournamentRescheduleApproval[];
  expiresAt: string;
  createdAt: string;
  canCancel: boolean;
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

const requestStatus = (value: unknown): TournamentRescheduleRequestStatus => {
  if (
    value === "approved" ||
    value === "rejected" ||
    value === "cancelled" ||
    value === "stale" ||
    value === "applied"
  ) {
    return value;
  }
  return "pending";
};

const mapApproval = (row: Row): TournamentRescheduleApproval => ({
  teamId: String(row.team_id ?? ""),
  teamLabel: String(row.team_label ?? "Équipe"),
  decision:
    row.decision === "approved" || row.decision === "rejected"
      ? row.decision
      : "pending",
  isRequester: Boolean(row.is_requester),
  canAct: Boolean(row.can_act),
  appActorCount: Number(row.app_actor_count ?? 0),
  decidedAt: row.decided_at ? String(row.decided_at) : null,
});

const mapRequest = (row: Row): TournamentRescheduleRequest => {
  const snapshot = (row.proposal_snapshot ?? {}) as Row;
  const proposal = (snapshot.proposal ?? {}) as Row;
  const proposalKind = row.proposal_kind === "swap" ? "swap" : "free_slot";
  return {
    id: String(row.id ?? ""),
    tournamentId: String(row.tournament_id ?? ""),
    tournamentName: String(row.tournament_name ?? ""),
    matchId: String(row.match_id ?? ""),
    requesterTeamId: String(row.requester_team_id ?? ""),
    requesterLabel: String(row.requester_label ?? "Équipe"),
    proposalKind,
    status: requestStatus(row.status),
    match: mapMatch(snapshot.match),
    proposal:
      proposalKind === "swap" ? mapSwap(proposal) : mapFreeSlot(proposal),
    approvals: rows(row.approvals).map(mapApproval),
    expiresAt: String(row.expires_at ?? ""),
    createdAt: String(row.created_at ?? ""),
    canCancel: Boolean(row.can_cancel),
  };
};

const optionPayload = (option: TournamentRescheduleOption): Row => {
  if (option.kind === "swap") {
    return {
      kind: option.kind,
      swap_match_id: option.swapMatchId,
      resource_id: option.resourceId,
      play_date: option.playDate,
      starts_at: option.startsAt,
      ends_at: option.endsAt,
    };
  }
  return {
    kind: option.kind,
    resource_id: option.resourceId,
    play_date: option.playDate,
    starts_at: option.startsAt,
    ends_at: option.endsAt,
  };
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
  "Tournament reschedule proposal is no longer available":
    "Cette solution n’est plus disponible. Relancez la recherche.",
  "Tournament match already has an active reschedule request":
    "Une demande de report est déjà en cours pour cette partie.",
  "Tournament reschedule request is no longer pending":
    "Cette demande n’est plus en attente de réponse.",
  "Tournament team cannot decide this reschedule":
    "Vous ne pouvez pas répondre au nom de cette équipe.",
  "Tournament team has already decided this reschedule":
    "Votre équipe a déjà répondu à cette demande.",
  "Tournament reschedule request cannot be cancelled":
    "Cette demande ne peut plus être annulée.",
};

const fail = (error: unknown, fallback: string): never => {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "");
    if (knownErrors[message]) throw new Error(knownErrors[message]);
  }
  throw new Error(getSupabaseErrorMessage(error, fallback));
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

    if (error) fail(error, "Impossible de rechercher des solutions de report.");

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

  async createRequest(
    matchId: string,
    requesterTeamId: string,
    option: TournamentRescheduleOption,
  ): Promise<string> {
    const { data, error } = await supabase.rpc(
      "create_my_tournament_reschedule_request",
      {
        target_match_id: matchId,
        requester_team_id: requesterTeamId,
        proposal: optionPayload(option),
      },
    );
    if (error) fail(error, "Impossible de créer la demande de report.");
    return String(data ?? "");
  },

  async listRequests(): Promise<TournamentRescheduleRequest[]> {
    const { data, error } = await supabase.rpc(
      "get_my_tournament_reschedule_requests",
    );
    if (error) fail(error, "Impossible de charger les demandes de report.");
    return rows(data).map(mapRequest);
  },

  async decideRequest(
    requestId: string,
    teamId: string,
    decision: "approved" | "rejected",
  ): Promise<TournamentRescheduleRequestStatus> {
    const { data, error } = await supabase.rpc(
      "decide_my_tournament_reschedule_request",
      {
        target_request_id: requestId,
        acting_team_id: teamId,
        target_decision: decision,
      },
    );
    if (error)
      fail(error, "Impossible d’enregistrer la réponse de votre équipe.");
    return requestStatus(data);
  },

  async cancelRequest(requestId: string): Promise<void> {
    const { error } = await supabase.rpc(
      "cancel_my_tournament_reschedule_request",
      { target_request_id: requestId },
    );
    if (error) fail(error, "Impossible d’annuler cette demande de report.");
  },
};
