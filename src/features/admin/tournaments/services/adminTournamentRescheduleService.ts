import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];
const time = (value: unknown) => String(value ?? "").slice(0, 5);

export type AdminTournamentRescheduleApproval = {
  teamId: string;
  teamLabel: string;
  decision: "pending" | "approved" | "rejected";
  isRequester: boolean;
  appActorCount: number;
  decidedAt: string | null;
};

export type AdminTournamentRescheduleRequest = {
  id: string;
  tournamentId: string;
  tournamentName: string;
  matchId: string;
  requesterTeamId: string;
  requesterLabel: string;
  proposalKind: "free_slot" | "swap";
  status: "pending" | "approved" | "rejected" | "cancelled" | "stale" | "applied";
  original: {
    playDate: string;
    startsAt: string;
    endsAt: string;
    resourceName: string;
    opponentLabel: string;
  };
  target: {
    playDate: string;
    startsAt: string;
    endsAt: string;
    resourceName: string;
  };
  swap: null | {
    teamALabel: string;
    teamBLabel: string;
    returnPlayDate: string;
    returnStartsAt: string;
    returnEndsAt: string;
    returnResourceName: string;
  };
  approvals: AdminTournamentRescheduleApproval[];
  expiresAt: string;
  createdAt: string;
};

const status = (value: unknown): AdminTournamentRescheduleRequest["status"] => {
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

const approvalDecision = (
  value: unknown,
): AdminTournamentRescheduleApproval["decision"] =>
  value === "approved" || value === "rejected" ? value : "pending";

const mapRequest = (row: Row): AdminTournamentRescheduleRequest => {
  const snapshot = (row.proposal_snapshot ?? {}) as Row;
  const match = (snapshot.match ?? {}) as Row;
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
    status: status(row.status),
    original: {
      playDate: String(match.play_date ?? ""),
      startsAt: time(match.starts_at),
      endsAt: time(match.ends_at),
      resourceName: String(match.resource_name ?? ""),
      opponentLabel: String(match.opponent_label ?? "Équipe"),
    },
    target: {
      playDate: String(proposal.play_date ?? ""),
      startsAt: time(proposal.starts_at),
      endsAt: time(proposal.ends_at),
      resourceName: String(proposal.resource_name ?? ""),
    },
    swap:
      proposalKind === "swap"
        ? {
            teamALabel: String(proposal.swap_team_a_label ?? "Équipe"),
            teamBLabel: String(proposal.swap_team_b_label ?? "Équipe"),
            returnPlayDate: String(proposal.swap_moves_to_play_date ?? ""),
            returnStartsAt: time(proposal.swap_moves_to_starts_at),
            returnEndsAt: time(proposal.swap_moves_to_ends_at),
            returnResourceName: String(
              proposal.swap_moves_to_resource_name ?? "",
            ),
          }
        : null,
    approvals: rows(row.approvals).map((approval) => ({
      teamId: String(approval.team_id ?? ""),
      teamLabel: String(approval.team_label ?? "Équipe"),
      decision: approvalDecision(approval.decision),
      isRequester: Boolean(approval.is_requester),
      appActorCount: Number(approval.app_actor_count ?? 0),
      decidedAt: approval.decided_at ? String(approval.decided_at) : null,
    })),
    expiresAt: String(row.expires_at ?? ""),
    createdAt: String(row.created_at ?? ""),
  };
};

export const adminTournamentRescheduleService = {
  async list(
    tournamentId: string | null = null,
  ): Promise<AdminTournamentRescheduleRequest[]> {
    const { data, error } = await supabase.rpc(
      "admin_list_tournament_reschedule_requests",
      { target_tournament_id: tournamentId },
    );
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de charger les demandes de report.",
        ),
      );
    }
    return rows(data).map(mapRequest);
  },
};
