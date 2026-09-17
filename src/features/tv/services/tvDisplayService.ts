import { supabase } from "@/infrastructure/supabase/client";
import {
  formatCompetitionReservationParts,
  formatMatchupLines,
} from "@/shared/utils/competitionDisplay";

export type TvSlotStatus = "available" | "reserved" | "unavailable";
export type TvWeekItemStatus = "reserved" | "unavailable";
export type TvDisplayStatus = "ready" | "disabled" | "invalid";

export type TvDisplaySlot = {
  startsAt: string;
  endsAt: string;
  status: TvSlotStatus;
  displayName: string | null;
  seriesName: string | null;
  displayColor: string | null;
};

export type TvDisplayResource = {
  id: string;
  name: string;
  slots: TvDisplaySlot[];
};

export type TvWeekItem = {
  resourceId: string;
  resourceName: string;
  startsAt: string;
  endsAt: string;
  status: TvWeekItemStatus;
  displayName: string;
  seriesName: string | null;
  displayColor: string | null;
};

export type TvWeekDay = {
  date: string;
  items: TvWeekItem[];
};

export type TvDisplay = {
  status: TvDisplayStatus;
  clubName: string | null;
  clubLogoUrl: string | null;
  displayDate: string | null;
  displayStartTime: string | null;
  displayEndTime: string | null;
  refreshIntervalSeconds: number;
  viewDurationSeconds: number;
  generatedAt: string | null;
  resources: TvDisplayResource[];
  weekStart: string | null;
  weekEnd: string | null;
  weekDays: TvWeekDay[];
};

type SlotDecoration = {
  resourceId: string;
  startsAt: string;
  endsAt: string;
  seriesName: string | null;
  displayColor: string;
  displayName: string | null;
};

const statuses = new Set<TvDisplayStatus>(["ready", "disabled", "invalid"]);
const slotStatuses = new Set<TvSlotStatus>([
  "available",
  "reserved",
  "unavailable",
]);
const weekItemStatuses = new Set<TvWeekItemStatus>(["reserved", "unavailable"]);
const colorPattern = /^#[0-9A-Fa-f]{6}$/;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const formatTournamentWeekDisplayName = (
  value: string,
  seriesName: string | null,
) => {
  if (!seriesName) return value;

  const prefix = `${seriesName} · `;
  const label = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  return formatMatchupLines(label);
};

const mapTournamentDecoration = (value: unknown): SlotDecoration | null => {
  const row = asRecord(value);
  const resourceId = String(row.resource_id ?? "");
  const startsAt = String(row.starts_at ?? "");
  const endsAt = String(row.ends_at ?? "");
  const seriesName = String(row.series_name ?? "");
  const displayColor = String(row.display_color ?? "").toUpperCase();

  if (
    !resourceId ||
    !startsAt ||
    !endsAt ||
    !seriesName ||
    !colorPattern.test(displayColor)
  ) {
    return null;
  }

  return {
    resourceId,
    startsAt,
    endsAt,
    seriesName,
    displayColor,
    displayName: null,
  };
};

const mapChampionshipDecoration = (value: unknown): SlotDecoration | null => {
  const row = asRecord(value);
  const resourceId = String(row.resource_id ?? "");
  const startsAt = String(row.starts_at ?? "");
  const endsAt = String(row.ends_at ?? "");
  const displayColor = String(row.display_color ?? "").toUpperCase();
  const championshipName = String(row.championship_name ?? "");
  const divisionName = String(row.division_name ?? "");
  const matchLabel = String(row.match_label ?? "");

  if (!resourceId || !startsAt || !endsAt || !colorPattern.test(displayColor)) {
    return null;
  }

  return {
    resourceId,
    startsAt,
    endsAt,
    seriesName: null,
    displayColor,
    displayName:
      formatCompetitionReservationParts(
        championshipName,
        divisionName,
        matchLabel,
      ) || "Match championnat",
  };
};

const findDecoration = (
  decorations: SlotDecoration[],
  resourceId: string,
  startsAt: string,
  endsAt: string,
) => {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

  return (
    decorations.find((decoration) => {
      if (decoration.resourceId !== resourceId) return false;
      const decorationStart = Date.parse(decoration.startsAt);
      const decorationEnd = Date.parse(decoration.endsAt);
      return decorationStart < end && decorationEnd > start;
    }) ?? null
  );
};

const mapSlot = (
  value: unknown,
  resourceId: string,
  decorations: SlotDecoration[],
): TvDisplaySlot => {
  const row = asRecord(value);
  const status = String(row.status ?? "unavailable") as TvSlotStatus;
  const startsAt = String(row.starts_at ?? "");
  const endsAt = String(row.ends_at ?? "");
  const decoration = findDecoration(decorations, resourceId, startsAt, endsAt);

  return {
    startsAt,
    endsAt,
    status: slotStatuses.has(status) ? status : "unavailable",
    displayName:
      decoration?.displayName ??
      (row.display_name === null || row.display_name === undefined
        ? null
        : String(row.display_name)),
    seriesName: decoration?.seriesName ?? null,
    displayColor: decoration?.displayColor ?? null,
  };
};

const mapWeekItem = (
  value: unknown,
  decorations: SlotDecoration[],
): TvWeekItem => {
  const row = asRecord(value);
  const status = String(row.status ?? "unavailable") as TvWeekItemStatus;
  const resourceId = String(row.resource_id ?? "");
  const startsAt = String(row.starts_at ?? "");
  const endsAt = String(row.ends_at ?? "");
  const decoration = findDecoration(decorations, resourceId, startsAt, endsAt);
  const displayName =
    decoration?.displayName ?? String(row.display_name ?? "Indisponible");

  return {
    resourceId,
    resourceName: String(row.resource_name ?? "Terrain"),
    startsAt,
    endsAt,
    status: weekItemStatuses.has(status) ? status : "unavailable",
    displayName: formatTournamentWeekDisplayName(
      displayName,
      decoration?.seriesName ?? null,
    ),
    seriesName: decoration?.seriesName ?? null,
    displayColor: decoration?.displayColor ?? null,
  };
};

const clampViewDuration = (value: unknown) => {
  const seconds = Number(value ?? 60);
  if (!Number.isFinite(seconds)) return 60;
  return Math.min(300, Math.max(10, seconds));
};

const mapDisplay = (
  value: unknown,
  viewDurationSeconds: unknown,
  decorations: SlotDecoration[],
): TvDisplay => {
  const row = asRecord(value);
  const status = String(row.status ?? "invalid") as TvDisplayStatus;
  const resources = Array.isArray(row.resources)
    ? (row.resources as Record<string, unknown>[])
    : [];
  const weekDays = Array.isArray(row.week_days)
    ? (row.week_days as Record<string, unknown>[])
    : [];

  return {
    status: statuses.has(status) ? status : "invalid",
    clubName: row.club_name ? String(row.club_name) : null,
    clubLogoUrl: row.club_logo_url ? String(row.club_logo_url) : null,
    displayDate: row.display_date ? String(row.display_date) : null,
    displayStartTime: row.display_start_time
      ? String(row.display_start_time)
      : null,
    displayEndTime: row.display_end_time ? String(row.display_end_time) : null,
    refreshIntervalSeconds: Math.max(
      15,
      Number(row.refresh_interval_seconds ?? 30),
    ),
    viewDurationSeconds: clampViewDuration(viewDurationSeconds),
    generatedAt: row.generated_at ? String(row.generated_at) : null,
    resources: resources.map((resource) => {
      const resourceId = String(resource.id ?? "");
      return {
        id: resourceId,
        name: String(resource.name ?? "Terrain"),
        slots: Array.isArray(resource.slots)
          ? resource.slots.map((slot) => mapSlot(slot, resourceId, decorations))
          : [],
      };
    }),
    weekStart: row.week_start ? String(row.week_start) : null,
    weekEnd: row.week_end ? String(row.week_end) : null,
    weekDays: weekDays.map((day) => ({
      date: String(day.date ?? ""),
      items: Array.isArray(day.items)
        ? day.items.map((item) => mapWeekItem(item, decorations))
        : [],
    })),
  };
};

export const tvDisplayService = {
  async getDisplay(token: string): Promise<TvDisplay> {
    const [
      displayResult,
      durationResult,
      tournamentDecorationResult,
      championshipDecorationResult,
    ] = await Promise.all([
      supabase.rpc("get_public_tv_display", {
        target_token: token,
      }),
      supabase.rpc("get_public_tv_view_duration", {
        target_token: token,
      }),
      supabase.rpc("get_public_tv_tournament_slot_colors", {
        target_token: token,
      }),
      supabase.rpc("get_public_tv_championship_slot_decorations", {
        target_token: token,
      }),
    ]);

    if (displayResult.error) throw displayResult.error;
    if (durationResult.error) throw durationResult.error;

    const tournamentDecorations = tournamentDecorationResult.error
      ? []
      : ((tournamentDecorationResult.data ?? []) as unknown[])
          .map(mapTournamentDecoration)
          .filter((item): item is SlotDecoration => item !== null);
    const championshipDecorations = championshipDecorationResult.error
      ? []
      : ((championshipDecorationResult.data ?? []) as unknown[])
          .map(mapChampionshipDecoration)
          .filter((item): item is SlotDecoration => item !== null);

    return mapDisplay(displayResult.data, durationResult.data, [
      ...championshipDecorations,
      ...tournamentDecorations,
    ]);
  },
};
