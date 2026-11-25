export const CLUB_MODULES = [
  "tournaments",
  "tournamentPlanning",
  "registrations",
  "tournamentRefereeing",
  "payments",
  "communication",
  "reservations",
  "championships",
  "licences",
  "tv",
  "live",
] as const;

export type ClubModule = (typeof CLUB_MODULES)[number];
export type ClubModules = Record<ClubModule, boolean>;

// Existing clubs retain their functionality until an explicit server profile
// is installed. These profiles are configuration presets, not permissions.
export const FULL_CLUB_MODULES: ClubModules = {
  tournaments: true,
  tournamentPlanning: true,
  registrations: true,
  tournamentRefereeing: true,
  payments: true,
  communication: true,
  reservations: true,
  championships: true,
  licences: true,
  tv: true,
  live: true,
};

export const TOURNAMENT_CLUB_MODULES: ClubModules = {
  ...FULL_CLUB_MODULES,
  reservations: false,
  championships: false,
  licences: false,
  tv: false,
  live: false,
};

// A malformed or incomplete explicit profile must not grant access.
export function parseClubModules(value: unknown): ClubModules | null {
  if (!value || typeof value !== "object") return null;
  const profile = value as Record<string, unknown>;
  if (!CLUB_MODULES.every((key) => typeof profile[key] === "boolean")) {
    return null;
  }
  return Object.fromEntries(
    CLUB_MODULES.map((key) => [key, profile[key]]),
  ) as ClubModules;
}
