import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";
import type {
  ChampionshipMatchesUpdatePayload,
  ChampionshipMatchSnapshot,
} from "../domain/championshipMatchUpdate";
import type {
  ChampionshipTransactionalImportPayload,
  ChampionshipTransactionalImportResult,
} from "../domain/championshipTransactionalImport";

type RpcResponse = { data: unknown; error: unknown };
type Row = Record<string, unknown>;
type ChampionshipRpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<RpcResponse>;
const rpc = supabase.rpc.bind(supabase) as unknown as ChampionshipRpc;

const array = (value: unknown) => (Array.isArray(value) ? value : []);
const row = (value: unknown) =>
  value && typeof value === "object" ? (value as Row) : {};
const nullable = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : String(value);

const mapImportResult = (
  value: unknown,
): ChampionshipTransactionalImportResult => {
  const source = row(value);
  const summary = row(source.summary);
  const result: ChampionshipTransactionalImportResult = {
    championshipId: String(source.championshipId ?? ""),
    batchId: String(source.batchId ?? ""),
    alreadyImported: Boolean(source.alreadyImported),
    summary: {
      divisionCount: Number(summary.divisionCount ?? 0),
      poolCount: Number(summary.poolCount ?? 0),
      clubCount: Number(summary.clubCount ?? 0),
      teamCount: Number(summary.teamCount ?? 0),
      playerCount: Number(summary.playerCount ?? 0),
      matchCount: Number(summary.matchCount ?? 0),
      linkedPlayerCount: Number(summary.linkedPlayerCount ?? 0),
    },
  };
  if (!result.championshipId || !result.batchId) {
    throw new Error("La réponse d’import du championnat est incomplète.");
  }
  return result;
};

export type AdminChampionshipSummary = {
  id: string;
  name: string;
  specialty: string;
  seasonLabel: string;
  status: string;
  sourceUrl: string | null;
  divisionCount: number;
  teamCount: number;
  matchCount: number;
  updatedAt: string;
};

const mapChampionship = (value: unknown): AdminChampionshipSummary => {
  const source = row(value);
  return {
    id: String(source.id ?? ""),
    name: String(source.name ?? ""),
    specialty: String(source.specialty ?? ""),
    seasonLabel: String(source.season_label ?? ""),
    status: String(source.status ?? "preparation"),
    sourceUrl: nullable(source.source_url),
    divisionCount: Number(source.division_count ?? 0),
    teamCount: Number(source.team_count ?? 0),
    matchCount: Number(source.match_count ?? 0),
    updatedAt: String(source.updated_at ?? ""),
  };
};

export type ChampionshipDetailPlayer = {
  id: string;
  licenceNumber: string;
  firstName: string;
  lastName: string;
  profileId: string | null;
  linkStatus: string;
};
export type ChampionshipDetailTeam = {
  id: string;
  sourceLabel: string;
  teamNumber: string;
  clubName: string;
  players: ChampionshipDetailPlayer[];
};
export type ChampionshipDetailPool = {
  id: string;
  code: string;
  name: string;
  teams: ChampionshipDetailTeam[];
};
export type ChampionshipDetailDivision = {
  id: string;
  name: string;
  displayOrder: number;
  pools: ChampionshipDetailPool[];
  teamsWithoutPool: ChampionshipDetailTeam[];
};
export type AdminChampionshipDetail = {
  id: string;
  name: string;
  specialty: string;
  seasonLabel: string;
  status: string;
  sourceProvider: string;
  sourceExternalId: string | null;
  sourceUrl: string | null;
  updatedAt: string;
  latestImportAt: string | null;
  counts: {
    divisionCount: number;
    poolCount: number;
    teamCount: number;
    playerCount: number;
    matchCount: number;
    playedMatchCount: number;
    linkedPlayerCount: number;
  };
  divisions: ChampionshipDetailDivision[];
  matches: ChampionshipMatchSnapshot[];
};

const mapPlayer = (value: unknown): ChampionshipDetailPlayer => {
  const source = row(value);
  return {
    id: String(source.id ?? ""),
    licenceNumber: String(source.licenceNumber ?? ""),
    firstName: String(source.firstName ?? ""),
    lastName: String(source.lastName ?? ""),
    profileId: nullable(source.profileId),
    linkStatus: String(source.linkStatus ?? "unlinked"),
  };
};
const mapTeam = (value: unknown): ChampionshipDetailTeam => {
  const source = row(value);
  return {
    id: String(source.id ?? ""),
    sourceLabel: String(source.sourceLabel ?? ""),
    teamNumber: String(source.teamNumber ?? ""),
    clubName: String(source.clubName ?? ""),
    players: array(source.players).map(mapPlayer),
  };
};
const mapPool = (value: unknown): ChampionshipDetailPool => {
  const source = row(value);
  return {
    id: String(source.id ?? ""),
    code: String(source.code ?? ""),
    name: String(source.name ?? ""),
    teams: array(source.teams).map(mapTeam),
  };
};
const mapMatch = (value: unknown): ChampionshipMatchSnapshot => {
  const source = row(value);
  return {
    id: String(source.id ?? ""),
    divisionName: String(source.divisionName ?? ""),
    poolCode: nullable(source.poolCode),
    phase: String(source.phase ?? ""),
    sourceKey: String(source.sourceKey ?? ""),
    team1Label: String(source.team1Label ?? ""),
    team2Label: String(source.team2Label ?? ""),
    scheduledOn: nullable(source.scheduledOn),
    scheduledTime: nullable(source.scheduledTime),
    reportOn: nullable(source.reportOn),
    reportTime: nullable(source.reportTime),
    venue: nullable(source.venue),
    agreementOn: nullable(source.agreementOn),
    agreementTime: nullable(source.agreementTime),
    agreementVenue: nullable(source.agreementVenue),
    status: String(source.status ?? "to_schedule"),
    scoreRaw: nullable(source.scoreRaw),
    scoreTeam1: source.scoreTeam1 == null ? null : Number(source.scoreTeam1),
    scoreTeam2: source.scoreTeam2 == null ? null : Number(source.scoreTeam2),
    resultComment: nullable(source.resultComment),
    sourceMetadata: row(source.sourceMetadata) as Record<string, string>,
  };
};

const mapDetail = (value: unknown): AdminChampionshipDetail => {
  const source = row(value);
  const counts = row(source.counts);
  return {
    id: String(source.id ?? ""),
    name: String(source.name ?? ""),
    specialty: String(source.specialty ?? ""),
    seasonLabel: String(source.seasonLabel ?? ""),
    status: String(source.status ?? "preparation"),
    sourceProvider: String(source.sourceProvider ?? "ffpb"),
    sourceExternalId: nullable(source.sourceExternalId),
    sourceUrl: nullable(source.sourceUrl),
    updatedAt: String(source.updatedAt ?? ""),
    latestImportAt: nullable(source.latestImportAt),
    counts: {
      divisionCount: Number(counts.divisionCount ?? 0),
      poolCount: Number(counts.poolCount ?? 0),
      teamCount: Number(counts.teamCount ?? 0),
      playerCount: Number(counts.playerCount ?? 0),
      matchCount: Number(counts.matchCount ?? 0),
      playedMatchCount: Number(counts.playedMatchCount ?? 0),
      linkedPlayerCount: Number(counts.linkedPlayerCount ?? 0),
    },
    divisions: array(source.divisions).map((value) => {
      const division = row(value);
      return {
        id: String(division.id ?? ""),
        name: String(division.name ?? ""),
        displayOrder: Number(division.displayOrder ?? 0),
        pools: array(division.pools).map(mapPool),
        teamsWithoutPool: array(division.teamsWithoutPool).map(mapTeam),
      };
    }),
    matches: array(source.matches).map(mapMatch),
  };
};

export type ChampionshipMatchesUpdateResult = {
  championshipId: string;
  batchId: string;
  summary: {
    insertedMatches: number;
    updatedMatches: number;
    unchangedMatches: number;
    fileMatchCount: number;
  };
};

const fail = (error: unknown, fallback: string): never => {
  const message = String(row(error).message ?? "");
  if (message === "Championship import payload is invalid")
    throw new Error("Les données préparées pour l’import sont incomplètes.");
  if (message === "Championship federation club mapping is invalid")
    throw new Error(
      "Le club officiel choisi ne peut pas être rattaché à ce club Pelote Manager.",
    );
  if (message === "Championship source is already managed by another club")
    throw new Error(
      "Ce championnat est déjà administré par un autre club Pelote Manager.",
    );
  if (message === "Championship player identity conflict")
    throw new Error(
      "Une licence existe déjà avec une identité différente. L’import est bloqué pour vérification.",
    );
  if (message.includes("Championship update source mismatch"))
    throw new Error(
      "Le fichier sélectionné ne correspond pas à ce championnat.",
    );
  if (message.includes("Championship update division not found"))
    throw new Error(
      "Une nouvelle série est apparue : réimportez aussi les engagements avant de poursuivre.",
    );
  if (message.includes("Championship update team not found"))
    throw new Error(
      "Une nouvelle équipe est apparue : réimportez aussi les engagements avant de poursuivre.",
    );
  if (message.includes("Championship update match is ambiguous"))
    throw new Error(
      "Deux rencontres sont impossibles à distinguer automatiquement. Vérification manuelle nécessaire.",
    );
  throw new Error(getSupabaseErrorMessage(error, fallback));
};

export const championshipImportService = {
  async importSources(payload: ChampionshipTransactionalImportPayload) {
    const { data, error } = await rpc("admin_import_championship_sources", {
      payload,
    });
    if (error) fail(error, "Impossible d’enregistrer le championnat.");
    return mapImportResult(data);
  },
  async list(): Promise<AdminChampionshipSummary[]> {
    const { data, error } = await rpc("admin_list_championships");
    if (error) fail(error, "Impossible de charger les championnats.");
    if (!Array.isArray(data)) return [];
    return data.map(mapChampionship).filter((item) => item.id);
  },
  async detail(championshipId: string): Promise<AdminChampionshipDetail> {
    const { data, error } = await rpc("admin_get_championship_detail", {
      target_id: championshipId,
    });
    if (error) fail(error, "Impossible de charger le championnat.");
    return mapDetail(data);
  },
  async updateMatches(
    championshipId: string,
    payload: ChampionshipMatchesUpdatePayload,
  ): Promise<ChampionshipMatchesUpdateResult> {
    const { data, error } = await rpc(
      "admin_apply_championship_matches_update",
      {
        target_id: championshipId,
        payload,
      },
    );
    if (error) fail(error, "Impossible d’actualiser le championnat.");
    const source = row(data);
    const summary = row(source.summary);
    return {
      championshipId: String(source.championshipId ?? ""),
      batchId: String(source.batchId ?? ""),
      summary: {
        insertedMatches: Number(summary.insertedMatches ?? 0),
        updatedMatches: Number(summary.updatedMatches ?? 0),
        unchangedMatches: Number(summary.unchangedMatches ?? 0),
        fileMatchCount: Number(summary.fileMatchCount ?? 0),
      },
    };
  },
};
