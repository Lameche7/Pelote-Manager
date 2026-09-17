import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

export type TournamentAccountCandidate = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  exactName: boolean;
  matchReason?: "email" | "name";
};

export type TournamentAccountAuditRow = {
  externalIdentityId: string;
  firstName: string;
  lastName: string;
  status: "recognized" | "probable" | "unmatched";
  linkedProfile: TournamentAccountCandidate | null;
  participations: Array<{
    teamId: string;
    seriesName: string;
    role: string;
    partnerName: string;
  }>;
  candidates: TournamentAccountCandidate[];
};

// prettier-ignore
const mapCandidate = (row: Row): TournamentAccountCandidate => ({
  id: String(row.id ?? ""),
  email: String(row.email ?? ""),
  firstName: String(row.firstName ?? row.first_name ?? ""),
  lastName: String(row.lastName ?? row.last_name ?? ""),
  displayName: String(row.displayName ?? row.display_name ?? ""),
  exactName: Boolean(row.exactName ?? row.exact_name),
  matchReason: (row.matchReason ?? row.match_reason) as
    | "email"
    | "name"
    | undefined,
});

const mapAuditRow = (row: Row): TournamentAccountAuditRow => ({
  externalIdentityId: String(row.externalIdentityId ?? ""),
  firstName: String(row.firstName ?? ""),
  lastName: String(row.lastName ?? ""),
  status: row.status as TournamentAccountAuditRow["status"],
  linkedProfile:
    row.linkedProfile && typeof row.linkedProfile === "object"
      ? mapCandidate(row.linkedProfile as Row)
      : null,
  participations: rows(row.participations).map((item) => ({
    teamId: String(item.teamId ?? ""),
    seriesName: String(item.seriesName ?? ""),
    role: String(item.role ?? ""),
    partnerName: String(item.partnerName ?? ""),
  })),
  candidates: rows(row.candidates).map(mapCandidate),
});

export const adminTournamentAccountService = {
  async list(tournamentId: string): Promise<TournamentAccountAuditRow[]> {
    const { data, error } = await supabase.rpc(
      "admin_list_tournament_account_audit",
      { target_tournament_id: tournamentId },
    );
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de contrôler les comptes du tournoi.",
        ),
      );
    }
    return rows(data).map(mapAuditRow);
  },

  async searchCandidates(
    externalIdentityId: string,
    searchTerm = "",
  ): Promise<TournamentAccountCandidate[]> {
    const { data, error } = await supabase.rpc(
      "admin_search_tournament_account_candidates",
      {
        target_external_identity_id: externalIdentityId,
        search_term: searchTerm,
      },
    );
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible de rechercher les comptes."),
      );
    }
    return rows(data).map(mapCandidate);
  },

  async link(externalIdentityId: string, profileId: string): Promise<void> {
    const { error } = await supabase.rpc("admin_link_tournament_account", {
      target_external_identity_id: externalIdentityId,
      target_profile_id: profileId,
    });
    if (error) {
      throw new Error(
        getSupabaseErrorMessage(error, "Impossible de rattacher ce compte."),
      );
    }
  },
};
