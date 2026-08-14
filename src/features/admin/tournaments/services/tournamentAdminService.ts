import { supabase } from "@/infrastructure/supabase/client";
import { getSupabaseErrorMessage } from "@/infrastructure/supabase/errorMessages";

export type TournamentStatus =
  | "preparation"
  | "configuration"
  | "registrations_open"
  | "registrations_closed"
  | "pools_generated"
  | "pools_validated"
  | "planning_generated"
  | "planning_published"
  | "in_progress"
  | "completed"
  | "archived"
  | "cancelled";

export type TournamentSeasonOption = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isActive: boolean;
};

export type TournamentResourceOption = {
  id: string;
  name: string;
};

export type TournamentOptions = {
  seasons: TournamentSeasonOption[];
  resources: TournamentResourceOption[];
};

export type TournamentSummary = {
  id: string;
  name: string;
  seasonId: string;
  seasonName: string;
  startsOn: string;
  endsOn: string;
  poolStartsOn: string;
  poolEndsOn: string;
  finalsStartsOn: string | null;
  finalsEndsOn: string | null;
  registrationOpensAt: string;
  registrationClosesAt: string;
  status: TournamentStatus;
  seriesCount: number;
  resourceCount: number;
  updatedAt: string;
};

export type TournamentSeries = {
  id?: string;
  name: string;
  displayOrder: number;
  capacity: number;
  enabled: boolean;
};

export type TournamentPlayWindow = {
  id?: string;
  weekday: number;
  opensAt: string;
  closesAt: string;
  displayOrder: number;
};

export type TournamentResource = TournamentResourceOption & {
  displayOrder: number;
};

export type TournamentMatchFormat = "single_game" | "best_of_three_sets";
export type TournamentRankingMode = "total_points" | "points_per_match";
export type TournamentGoalAverageMode =
  "point_difference" | "point_difference_per_match";

export type TournamentSportingRules = {
  tournamentId: string;
  matchFormat: TournamentMatchFormat;
  singleGamePoints: number;
  mainSetPoints: number;
  decidingSetPoints: number;
  baseWinPoints: number;
  baseLossPoints: number;
  offensiveBonusPoints: number;
  defensiveBonusPoints: number;
  offensiveBonusMargin: number;
  defensiveBonusMargin: number;
  rankingMode: TournamentRankingMode;
  goalAverageMode: TournamentGoalAverageMode;
  updatedAt: string;
};

export type TournamentDraft = {
  id?: string;
  seasonId: string;
  name: string;
  description: string;
  rules: string;
  startsOn: string;
  endsOn: string;
  poolStartsOn: string;
  poolEndsOn: string;
  finalsStartsOn: string | null;
  finalsEndsOn: string | null;
  registrationOpensAt: string;
  registrationClosesAt: string;
  minimumAvailabilitySlots: number;
  minimumWeekendAvailabilitySlots: number;
  slotDurationMinutes: number;
};

export type TournamentDetail = TournamentDraft & {
  id: string;
  seasonName: string;
  status: TournamentStatus;
  timezone: string;
  resources: TournamentResource[];
  series: TournamentSeries[];
  playWindows: TournamentPlayWindow[];
  createdAt: string;
  updatedAt: string;
};

type Row = Record<string, unknown>;

const asRows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

const knownErrors: Record<string, string> = {
  "Tournament fields are incomplete":
    "Complétez tous les champs obligatoires du tournoi.",
  "Tournament dates are invalid": "Les dates du tournoi sont incohérentes.",
  "Tournament phase dates are invalid":
    "Vérifiez les dates des poules et de la phase finale. La phase finale doit commencer après les poules.",
  "Tournament availability settings are invalid":
    "Vérifiez la durée des créneaux et les minima de disponibilités.",
  "Registration dates are invalid":
    "Les dates d’inscription sont incohérentes.",
  "Open registration window must contain current time":
    "Pendant que les inscriptions sont ouvertes, leur période doit continuer à inclure la date et l’heure actuelles.",
  "Tournament must fit inside its season":
    "Les dates du tournoi doivent être comprises dans la saison sélectionnée.",
  "Tournament settings are locked at this stage":
    "Les informations générales sont verrouillées depuis la génération des poules.",
  "Tournament configuration is locked at this stage":
    "La configuration sportive est verrouillée depuis la génération des poules.",
  "Tournament configuration would invalidate existing availability":
    "Cette modification supprimerait des créneaux déjà choisis par une ou plusieurs équipes. Corrigez d’abord leurs disponibilités ou conservez ces créneaux.",
  "Tournament availability settings conflict with existing teams":
    "Le nouveau minimum de disponibilités n’est pas respecté par toutes les équipes déjà inscrites.",
  "Tournament series capacity conflicts with existing teams":
    "La capacité d’une série ne peut pas devenir inférieure au nombre d’équipes déjà inscrites, ni être désactivée tant qu’elle contient des équipes actives.",
  "Tournament series with teams cannot be removed":
    "Une série contenant déjà des équipes ne peut pas être supprimée.",
  "A resource can only be selected once":
    "Un terrain ne peut être sélectionné qu’une fois.",
  "One or more resources are invalid":
    "Un des terrains sélectionnés n’est plus disponible.",
  "Tournament series are invalid":
    "Chaque série active doit avoir un nom unique et une capacité strictement positive.",
  "Tournament play windows are invalid":
    "Vérifiez les jours et horaires du tournoi.",
  "Complete resources, series and play windows first":
    "Sélectionnez au moins un terrain, une série active et une plage horaire avant de valider la configuration.",
  "Tournament configuration is incomplete":
    "La configuration du tournoi est incomplète.",
  "Registration window is not open":
    "La date prévue d’ouverture des inscriptions n’est pas encore atteinte ou la clôture est déjà passée.",
  "Invalid tournament transition":
    "Cette transition n’est pas autorisée depuis l’état actuel.",
  "Tournament cannot be cancelled by the core engine at this stage":
    "L’annulation sera gérée par le moteur correspondant à cette étape.",
};

const fail = (error: unknown, fallback: string): never => {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "");
    if (knownErrors[message]) throw new Error(knownErrors[message]);
  }
  throw new Error(getSupabaseErrorMessage(error, fallback));
};

const mapOptions = (value: unknown): TournamentOptions => {
  const row = (value ?? {}) as Row;
  return {
    seasons: asRows(row.seasons).map((season) => ({
      id: String(season.id),
      name: String(season.name),
      startsOn: String(season.starts_on),
      endsOn: String(season.ends_on),
      isActive: Boolean(season.is_active),
    })),
    resources: asRows(row.resources).map((resource) => ({
      id: String(resource.id),
      name: String(resource.name),
    })),
  };
};

const mapSummary = (row: Row): TournamentSummary => ({
  id: String(row.id),
  name: String(row.name),
  seasonId: String(row.season_id),
  seasonName: String(row.season_name),
  startsOn: String(row.starts_on),
  endsOn: String(row.ends_on),
  poolStartsOn: String(row.pool_starts_on ?? row.starts_on),
  poolEndsOn: String(row.pool_ends_on ?? row.ends_on),
  finalsStartsOn: row.finals_starts_on ? String(row.finals_starts_on) : null,
  finalsEndsOn: row.finals_ends_on ? String(row.finals_ends_on) : null,
  registrationOpensAt: String(row.registration_opens_at),
  registrationClosesAt: String(row.registration_closes_at),
  status: row.status as TournamentStatus,
  seriesCount: Number(row.series_count ?? 0),
  resourceCount: Number(row.resource_count ?? 0),
  updatedAt: String(row.updated_at),
});

const mapDetail = (value: unknown): TournamentDetail => {
  const row = value as Row;
  return {
    id: String(row.id),
    seasonId: String(row.season_id),
    seasonName: String(row.season_name),
    name: String(row.name),
    description: String(row.description ?? ""),
    rules: String(row.rules ?? ""),
    startsOn: String(row.starts_on),
    endsOn: String(row.ends_on),
    poolStartsOn: String(row.pool_starts_on ?? row.starts_on),
    poolEndsOn: String(row.pool_ends_on ?? row.ends_on),
    finalsStartsOn: row.finals_starts_on ? String(row.finals_starts_on) : null,
    finalsEndsOn: row.finals_ends_on ? String(row.finals_ends_on) : null,
    registrationOpensAt: String(row.registration_opens_at),
    registrationClosesAt: String(row.registration_closes_at),
    minimumAvailabilitySlots: Number(row.minimum_availability_slots ?? 65),
    minimumWeekendAvailabilitySlots: Number(
      row.minimum_weekend_availability_slots ?? 0,
    ),
    slotDurationMinutes: Number(row.slot_duration_minutes ?? 60),
    status: row.status as TournamentStatus,
    timezone: String(row.timezone ?? "Europe/Paris"),
    resources: asRows(row.resources).map((resource) => ({
      id: String(resource.id),
      name: String(resource.name),
      displayOrder: Number(resource.display_order ?? 0),
    })),
    series: asRows(row.series).map((series) => ({
      id: String(series.id),
      name: String(series.name),
      displayOrder: Number(series.display_order ?? 0),
      capacity: Number(series.capacity ?? 0),
      enabled: Boolean(series.enabled),
    })),
    playWindows: asRows(row.play_windows).map((playWindow) => ({
      id: String(playWindow.id),
      weekday: Number(playWindow.weekday),
      opensAt: String(playWindow.opens_at).slice(0, 5),
      closesAt: String(playWindow.closes_at).slice(0, 5),
      displayOrder: Number(playWindow.display_order ?? 0),
    })),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
};

const mapSportingRules = (value: unknown): TournamentSportingRules => {
  const row = value as Row;
  return {
    tournamentId: String(row.tournament_id),
    matchFormat: row.match_format as TournamentMatchFormat,
    singleGamePoints: Number(row.single_game_points ?? 35),
    mainSetPoints: Number(row.main_set_points ?? 20),
    decidingSetPoints: Number(row.deciding_set_points ?? 10),
    baseWinPoints: Number(row.base_win_points ?? 3),
    baseLossPoints: Number(row.base_loss_points ?? 1),
    offensiveBonusPoints: Number(row.offensive_bonus_points ?? 1),
    defensiveBonusPoints: Number(row.defensive_bonus_points ?? 1),
    offensiveBonusMargin: Number(row.offensive_bonus_margin ?? 10),
    defensiveBonusMargin: Number(row.defensive_bonus_margin ?? 5),
    rankingMode: row.ranking_mode as TournamentRankingMode,
    goalAverageMode: row.goal_average_mode as TournamentGoalAverageMode,
    updatedAt: String(row.updated_at ?? ""),
  };
};

const draftPayload = (draft: TournamentDraft) => ({
  season_id: draft.seasonId,
  name: draft.name.trim(),
  description: draft.description.trim(),
  rules: draft.rules.trim(),
  starts_on: draft.startsOn,
  ends_on: draft.endsOn,
  pool_starts_on: draft.poolStartsOn,
  pool_ends_on: draft.poolEndsOn,
  finals_starts_on: draft.finalsStartsOn ?? "",
  finals_ends_on: draft.finalsEndsOn ?? "",
  registration_opens_at: draft.registrationOpensAt,
  registration_closes_at: draft.registrationClosesAt,
  minimum_availability_slots: draft.minimumAvailabilitySlots,
  minimum_weekend_availability_slots: draft.minimumWeekendAvailabilitySlots,
  slot_duration_minutes: draft.slotDurationMinutes,
});

export const tournamentAdminService = {
  async getOptions(): Promise<TournamentOptions> {
    const { data, error } = await supabase.rpc("admin_get_tournament_options");
    if (error) fail(error, "Impossible de charger les saisons et terrains.");
    return mapOptions(data);
  },

  async list(): Promise<TournamentSummary[]> {
    const { data, error } = await supabase.rpc("admin_list_tournaments");
    if (error) fail(error, "Impossible de charger les tournois.");
    return asRows(data).map(mapSummary);
  },

  async get(id: string): Promise<TournamentDetail> {
    const { data, error } = await supabase.rpc("admin_get_tournament", {
      target_id: id,
    });
    if (error) fail(error, "Impossible de charger le tournoi.");
    return mapDetail(data);
  },

  async create(draft: TournamentDraft): Promise<string> {
    const { data, error } = await supabase.rpc("admin_create_tournament", {
      payload: draftPayload(draft),
    });
    if (error) fail(error, "Impossible de créer le tournoi.");
    return String(data);
  },

  async update(id: string, draft: TournamentDraft): Promise<void> {
    const { error } = await supabase.rpc("admin_update_tournament", {
      target_id: id,
      payload: draftPayload(draft),
    });
    if (error) fail(error, "Impossible de modifier le tournoi.");
  },

  async saveConfiguration(
    id: string,
    value: {
      resourceIds: string[];
      series: TournamentSeries[];
      playWindows: TournamentPlayWindow[];
    },
  ): Promise<void> {
    const { error } = await supabase.rpc(
      "admin_save_tournament_configuration",
      {
        target_id: id,
        payload: {
          resource_ids: value.resourceIds,
          series: value.series.map((series, index) => ({
            id: series.id ?? null,
            name: series.name.trim(),
            display_order: index,
            capacity: series.capacity,
            enabled: series.enabled,
          })),
          play_windows: value.playWindows.map((playWindow, index) => ({
            weekday: playWindow.weekday,
            opens_at: playWindow.opensAt,
            closes_at: playWindow.closesAt,
            display_order: index,
          })),
        },
      },
    );
    if (error)
      fail(error, "Impossible d’enregistrer la configuration du tournoi.");
  },

  async getSportingRules(id: string): Promise<TournamentSportingRules> {
    const { data, error } = await supabase.rpc(
      "admin_get_tournament_sporting_rules",
      { target_id: id },
    );
    if (error)
      fail(error, "Impossible de charger les règles sportives du tournoi.");
    return mapSportingRules(data);
  },

  async saveSportingRules(
    id: string,
    rules: TournamentSportingRules,
  ): Promise<void> {
    const { error } = await supabase.rpc(
      "admin_save_tournament_sporting_rules",
      {
        target_id: id,
        payload: {
          match_format: rules.matchFormat,
          single_game_points: rules.singleGamePoints,
          main_set_points: rules.mainSetPoints,
          deciding_set_points: rules.decidingSetPoints,
          base_win_points: rules.baseWinPoints,
          base_loss_points: rules.baseLossPoints,
          offensive_bonus_points: rules.offensiveBonusPoints,
          defensive_bonus_points: rules.defensiveBonusPoints,
          offensive_bonus_margin: rules.offensiveBonusMargin,
          defensive_bonus_margin: rules.defensiveBonusMargin,
          ranking_mode: rules.rankingMode,
          goal_average_mode: rules.goalAverageMode,
        },
      },
    );
    if (error) fail(error, "Impossible d’enregistrer les règles sportives.");
  },

  async transition(id: string, status: TournamentStatus): Promise<void> {
    const { error } = await supabase.rpc("admin_transition_tournament", {
      target_id: id,
      target_status: status,
    });
    if (error) fail(error, "Impossible de changer l’état du tournoi.");
  },
};
