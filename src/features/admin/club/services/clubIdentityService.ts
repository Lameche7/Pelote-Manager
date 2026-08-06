import {
  CLUB_BRANDING_CHANGED_EVENT,
} from "@/features/branding/services/clubBrandingService";
import { supabase } from "@/infrastructure/supabase/client";

export type ClubIdentity = {
  id: string;
  name: string;
  shortName: string;
  affiliationNumber: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  socialLinks: string;
  notes: string;
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

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown) => (typeof value === "string" ? value : "");

const mapIdentity = (value: unknown): ClubIdentity => {
  const row = record(value);
  return {
    id: text(row.id),
    name: text(row.name),
    shortName: text(row.short_name),
    affiliationNumber: text(row.affiliation_number),
    email: text(row.email),
    phone: text(row.phone),
    website: text(row.website),
    address: text(row.address),
    socialLinks: text(row.social_links),
    notes: text(row.notes),
    location: text(row.location),
    venueName: text(row.venue_name),
    tagline: text(row.tagline),
    foundedYear:
      row.founded_year === null || row.founded_year === undefined
        ? ""
        : String(row.founded_year),
    description: text(row.description),
    logoUrl: text(row.logo_url),
    logoAlt: text(row.logo_alt),
    heroImageUrl: text(row.hero_image_url),
    primaryColor: text(row.primary_color) || "#0f3d2e",
    secondaryColor: text(row.secondary_color) || "#0d2b6c",
    accentColor: text(row.accent_color) || "#d62828",
    neutralColor: text(row.neutral_color) || "#65717c",
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
};

const imageExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const uploadImage = async (
  clubId: string,
  kind: "logo" | "hero",
  file: File,
) => {
  const extension = imageExtensions[file.type];
  if (!extension) {
    throw new Error("Utilisez une image PNG, JPEG ou WebP.");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("L’image ne doit pas dépasser 8 Mo.");
  }

  const path = `${clubId}/${kind}.${extension}`;
  const { error } = await supabase.storage
    .from("club-branding")
    .upload(path, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: true,
    });
  if (error) throw error;

  const { data } = supabase.storage
    .from("club-branding")
    .getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
};

export const clubIdentityService = {
  async getIdentity(): Promise<ClubIdentity> {
    const { data, error } = await supabase.rpc("admin_get_club_identity");
    if (error) throw error;
    return mapIdentity(data);
  },

  async updateIdentity(identity: ClubIdentity): Promise<ClubIdentity> {
    const { data, error } = await supabase.rpc("admin_update_club_identity", {
      target_identity: {
        name: identity.name,
        short_name: identity.shortName,
        affiliation_number: identity.affiliationNumber,
        email: identity.email,
        phone: identity.phone,
        website: identity.website,
        address: identity.address,
        social_links: identity.socialLinks,
        notes: identity.notes,
        location: identity.location,
        venue_name: identity.venueName,
        tagline: identity.tagline,
        founded_year: identity.foundedYear,
        description: identity.description,
        logo_url: identity.logoUrl,
        logo_alt: identity.logoAlt,
        hero_image_url: identity.heroImageUrl,
        primary_color: identity.primaryColor,
        secondary_color: identity.secondaryColor,
        accent_color: identity.accentColor,
        neutral_color: identity.neutralColor,
      },
    });
    if (error) throw error;

    const updatedIdentity = mapIdentity(data);
    window.dispatchEvent(new Event(CLUB_BRANDING_CHANGED_EVENT));
    return updatedIdentity;
  },

  uploadLogo(clubId: string, file: File) {
    return uploadImage(clubId, "logo", file);
  },

  uploadHeroImage(clubId: string, file: File) {
    return uploadImage(clubId, "hero", file);
  },
};
