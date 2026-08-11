import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type { TournamentStatus } from "@/features/admin/tournaments/services/tournamentAdminService";
import type {
  PoolCompatibility,
  PoolDraft,
  PoolEngineTeam,
} from "@/features/tournaments/domain/poolEngine";

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

export type TournamentPoolPlayer = {
  firstName: string;
  lastName: string;
  role: "front" | "back";
};

export type TournamentPoolTeam = PoolEngineTeam & {
  players: TournamentPoolPlayer[];
  poolAvailabilityCount: number;
};

export type TournamentPoolSeries = {
  id: string;
  name: string;
  displayOrder: number;
  acceptedCount: number;
};

export type TournamentPoolWorkspace = {
  tournament: {
    id: string;
    name: string;
    status: TournamentStatus;
    pendingCount: number;
  };
  series: TournamentPoolSeries[];
  teams: TournamentPoolTeam[];
  pairings: PoolCompatibility[];
  pools: PoolDraft[];
};

const knownErrors: Record<string, string> = {
  Forbidden: "Vous n’avez pas le droit de gérer les poules de ce tournoi.",
  "Tournament not found": "Tournoi introuvable.",
  "Tournament pools are not editable at this stage":
    "Les poules ne sont modifiables qu’après la fermeture des inscriptions et avant le planning.",
  "Pending tournament teams must be resolved before pool generation":
    "Il reste des équipes en attente. Validez ou refusez-les avant de générer les poules.",
  "Tournament pool payload is invalid":
    "La composition des poules est invalide.",
  "Tournament pool series is invalid":
    "Une poule référence une série invalide.",
  "Tournament pool team is invalid":
    "Une équipe ne peut pas être placée dans cette poule.",
  "Every accepted team must belong to exactly one pool":
    "Chaque équipe inscrite doit apparaître une seule fois dans une poule.",
  "Tournament pools are incomplete":
    "Les poules sont incomplètes ou ne comportent pas toutes entre 4 et 6 équipes.",
  "Tournament pools cannot be validated at this stage":
    "Les poules ne peuvent pas être validées à cette étape.",
  "Tournament pools cannot be reopened at this stage":
    "Les poules ne peuvent plus être rouvertes à cette étape.",
};

const fail = (error: unknown, fallback: string): never => {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "");
    if (knownErrors[message]) throw new Error(knownErrors[message]);
  }
  throw new Error(getSupabaseErrorMessage(error, fallback));
};

const mapWorkspace = (value: unknown): TournamentPoolWorkspace => {
  const root = (value ?? {}) as Row;
  const tournament = (root.tournament ?? {}) as Row;

  return {
    tournament: {
      id: String(tournament.id ?? ""),
      name: String(tournament.name ?? ""),
      status: tournament.status as TournamentStatus,
      pendingCount: Number(tournament.pending_count ?? 0),
    },
    series: rows(root.series).map((series) => ({
      id: String(series.id),
      name: String(series.name ?? ""),
      displayOrder: Number(series.display_order ?? 0),
      acceptedCount: Number(series.accepted_count ?? 0),
    })),
    teams: rows(root.teams).map((team) => ({
      id: String(team.id),
      seriesId: String(team.series_id),
      poolAvailabilityCount: Number(team.pool_availability_count ?? 0),
      players: rows(team.players).map((player) => ({
        firstName: String(player.first_name ?? ""),
        lastName: String(player.last_name ?? ""),
        role: player.role as TournamentPoolPlayer["role"],
      })),
    })),
    pairings: rows(root.pairings).map((pairing) => ({
      teamAId: String(pairing.team_a_id),
      teamBId: String(pairing.team_b_id),
      commonSlotCount: Number(pairing.common_slot_count ?? 0),
    })),
    pools: rows(root.pools).map((pool) => ({
      key: String(pool.id),
      seriesId: String(pool.series_id),
      displayOrder: Number(pool.display_order ?? 0),
      targetSize: Number(pool.target_size) as 4 | 5 | 6,
      teams: rows(pool.teams).map((team) => ({
        teamId: String(team.team_id),
      })),
    })),
  };
};

const poolPayload = (pools: PoolDraft[]) => ({
  pools: pools.map((pool) => ({
    series_id: pool.seriesId,
    display_order: pool.displayOrder,
    target_size: pool.teams.length,
    teams: pool.teams.map((team, index) => ({
      team_id: team.teamId,
      display_order: index,
    })),
  })),
});

export const adminTournamentPoolService = {
  async get(tournamentId: string): Promise<TournamentPoolWorkspace> {
    const { data, error } = await supabase.rpc(
      "admin_get_tournament_pool_workspace",
      { target_tournament_id: tournamentId },
    );
    if (error) fail(error, "Impossible de charger le moteur de poules.");
    return mapWorkspace(data);
  },

  async save(tournamentId: string, pools: PoolDraft[]): Promise<void> {
    const { error } = await supabase.rpc("admin_save_tournament_pools", {
      target_tournament_id: tournamentId,
      payload: poolPayload(pools),
    });
    if (error) fail(error, "Impossible d’enregistrer les poules.");
  },

  async validate(tournamentId: string): Promise<void> {
    const { error } = await supabase.rpc("admin_validate_tournament_pools", {
      target_tournament_id: tournamentId,
    });
    if (error) fail(error, "Impossible de valider les poules.");
  },

  async reopen(tournamentId: string): Promise<void> {
    const { error } = await supabase.rpc("admin_reopen_tournament_pools", {
      target_tournament_id: tournamentId,
    });
    if (error) fail(error, "Impossible de rouvrir les poules.");
  },
};
