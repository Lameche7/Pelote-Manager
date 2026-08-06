import { supabase } from "@/infrastructure/supabase/client";
import { CLUB_CONFIG } from "@/shared/config";

export const CLUB_BRANDING_CHANGED_EVENT =
  "pelote-manager:club-branding-changed";

export type ClubBranding = {
  name: string;
  shortName: string;
  location: string;
  venueName: string;
  tagline: string;
  foundedYear: string;
  description: string;
  logoUrl: string;
  logoAlt: string;
  heroImageUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  neutralColor: string;
  updatedAt: string | null;
};

export const DEFAULT_CLUB_BRANDING: ClubBranding = {
  name: CLUB_CONFIG.name,
  shortName: CLUB_CONFIG.shortName,
  location: CLUB_CONFIG.location,
  venueName: CLUB_CONFIG.venueName,
  tagline: CLUB_CONFIG.tagline,
  foundedYear: CLUB_CONFIG.foundedYear,
  description: CLUB_CONFIG.description,
  logoUrl: CLUB_CONFIG.logoUrl,
  logoAlt: CLUB_CONFIG.logoAlt,
  heroImageUrl: CLUB_CONFIG.heroImageUrl,
  primaryColor: "#0f3d2e",
  secondaryColor: "#0d2b6c",
  accentColor: "#d62828",
  neutralColor: "#65717c",
  updatedAt: null,
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const color = (value: unknown, fallback: string) => {
  const candidate = text(value, fallback).toLowerCase();
  return /^#[0-9a-f]{6}$/.test(candidate) ? candidate : fallback;
};

const mapBranding = (value: unknown): ClubBranding => {
  const payload = record(value);
  if (payload.status !== "ready") return DEFAULT_CLUB_BRANDING;

  return {
    name: text(payload.name, DEFAULT_CLUB_BRANDING.name),
    shortName: text(payload.short_name, DEFAULT_CLUB_BRANDING.shortName),
    location: text(payload.location, DEFAULT_CLUB_BRANDING.location),
    venueName: text(payload.venue_name, DEFAULT_CLUB_BRANDING.venueName),
    tagline: text(payload.tagline, DEFAULT_CLUB_BRANDING.tagline),
    foundedYear:
      payload.founded_year === null || payload.founded_year === undefined
        ? ""
        : String(payload.founded_year),
    description: text(payload.description, DEFAULT_CLUB_BRANDING.description),
    logoUrl: text(payload.logo_url, DEFAULT_CLUB_BRANDING.logoUrl),
    logoAlt: text(payload.logo_alt, DEFAULT_CLUB_BRANDING.logoAlt),
    heroImageUrl: text(
      payload.hero_image_url,
      DEFAULT_CLUB_BRANDING.heroImageUrl,
    ),
    primaryColor: color(
      payload.primary_color,
      DEFAULT_CLUB_BRANDING.primaryColor,
    ),
    secondaryColor: color(
      payload.secondary_color,
      DEFAULT_CLUB_BRANDING.secondaryColor,
    ),
    accentColor: color(
      payload.accent_color,
      DEFAULT_CLUB_BRANDING.accentColor,
    ),
    neutralColor: color(
      payload.neutral_color,
      DEFAULT_CLUB_BRANDING.neutralColor,
    ),
    updatedAt:
      typeof payload.updated_at === "string" ? payload.updated_at : null,
  };
};

export const clubBrandingService = {
  async getPublicBranding(): Promise<ClubBranding> {
    const { data, error } = await supabase.rpc("get_public_club_branding");
    if (error) throw error;
    return mapBranding(data);
  },
};
