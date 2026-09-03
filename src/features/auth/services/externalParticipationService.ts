import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

type Row = Record<string, unknown>;

export type ExternalParticipationCandidate = {
  externalIdentityId: string;
  tournamentId: string;
  teamId: string;
  tournamentName: string;
  seriesName: string;
  partnerFirstName: string | null;
  partnerLastName: string | null;
  role: "front" | "back";
};

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

const optionalString = (value: unknown): string | null => {
  const text = String(value ?? "").trim();
  return text ? text : null;
};

const mapCandidate = (value: unknown): ExternalParticipationCandidate => {
  const row = (value ?? {}) as Row;
  return {
    externalIdentityId: String(row.externalIdentityId ?? ""),
    tournamentId: String(row.tournamentId ?? ""),
    teamId: String(row.teamId ?? ""),
    tournamentName: String(row.tournamentName ?? ""),
    seriesName: String(row.seriesName ?? ""),
    partnerFirstName: optionalString(row.partnerFirstName),
    partnerLastName: optionalString(row.partnerLastName),
    role: row.role === "back" ? "back" : "front",
  };
};

const claimErrors: Record<string, string> = {
  "Authentication required": "Connectez-vous pour rattacher cette participation.",
  "Profile required": "Votre profil doit être finalisé avant le rattachement.",
  "External participation not found": "Cette participation n’existe plus.",
  "External participation is no longer available":
    "Cette participation a déjà été rattachée à un autre compte.",
  "External participation identity does not match profile":
    "Le nom ou le prénom du compte ne correspond plus à cette participation.",
  "External participation is not claimable":
    "Cette participation ne peut plus être rattachée.",
  "Account already represents another player in this tournament":
    "Ce compte est déjà rattaché à un autre joueur de ce tournoi.",
};

export const externalParticipationService = {
  async find(
    firstName: string,
    lastName: string,
  ): Promise<ExternalParticipationCandidate[]> {
    const { data, error } = await supabase.rpc(
      "find_external_participation_candidates",
      {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      },
    );

    if (error) {
      throw new Error(
        getSupabaseErrorMessage(
          error,
          "Impossible de rechercher vos participations pour le moment.",
        ),
      );
    }

    return rows(data)
      .map(mapCandidate)
      .filter(
        (candidate) =>
          candidate.externalIdentityId &&
          candidate.tournamentId &&
          candidate.teamId &&
          candidate.tournamentName,
      );
  },

  async claim(externalIdentityId: string): Promise<void> {
    const { error } = await supabase.rpc("claim_external_participation", {
      target_external_identity_id: externalIdentityId,
    });

    if (error) {
      const mapped = claimErrors[String(error.message ?? "")];
      throw new Error(
        mapped ??
          getSupabaseErrorMessage(
            error,
            "Impossible de rattacher cette participation à votre compte.",
          ),
      );
    }
  },
};
