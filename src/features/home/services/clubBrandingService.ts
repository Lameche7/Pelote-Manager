import { supabase } from "@/infrastructure/supabase/client";
import { CLUB_CONFIG } from "@/shared/config";

export type ClubBranding = {
  name: string;
  logoUrl: string;
  heroImageUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  neutralColor: string;
};

type ClubBrandingRow = {
  name?: unknown;
  logo_url?: unknown;
  hero_image_url?: unknown;
  primary_color?: unknown;
  secondary_color?: unknown;
  accent_color?: unknown;
  neutral_color?: unknown;
};

const fallback: ClubBranding = {
  name: CLUB_CONFIG.name,
  logoUrl: CLUB_CONFIG.logoUrl,
  heroImageUrl: CLUB_CONFIG.heroImageUrl,
  primaryColor: "#0F3D2E",
  secondaryColor: "#1E5AA8",
  accentColor: "#B22525",
  neutralColor: "#6B7280",
};

const value = (input: unknown, defaultValue: string) =>
  typeof input === "string" && input.trim() ? input.trim() : defaultValue;

function brandingAssetUrl(input: unknown, defaultValue: string) {
  const resolved = value(input, defaultValue);

  try {
    const parsed = new URL(resolved);
    const fallbackPath = defaultValue.startsWith("/") ? defaultValue : null;

    if (
      fallbackPath &&
      parsed.hostname.endsWith(".vercel.app") &&
      parsed.pathname === fallbackPath
    ) {
      return fallbackPath;
    }
  } catch {
    // Les chemins relatifs et les URL non standard sont conservés tels quels.
  }

  return resolved;
}

export const clubBrandingService = {
  fallback,
  async getPublicBranding(): Promise<ClubBranding> {
    const { data, error } = await supabase.rpc("get_public_club_branding");
    if (error) throw error;

    const row = (data ?? {}) as ClubBrandingRow;
    return {
      name: value(row.name, fallback.name),
      logoUrl: brandingAssetUrl(row.logo_url, fallback.logoUrl),
      heroImageUrl: brandingAssetUrl(row.hero_image_url, fallback.heroImageUrl),
      primaryColor: value(row.primary_color, fallback.primaryColor),
      secondaryColor: value(row.secondary_color, fallback.secondaryColor),
      accentColor: value(row.accent_color, fallback.accentColor),
      neutralColor: value(row.neutral_color, fallback.neutralColor),
    };
  },
};
