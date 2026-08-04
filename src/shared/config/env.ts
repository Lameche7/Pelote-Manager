import { z } from "zod";

const optionalText = z.string().trim().optional();

const envSchema = z.object({
  VITE_SUPABASE_URL: z.url("VITE_SUPABASE_URL doit être une URL valide."),
  VITE_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "VITE_SUPABASE_ANON_KEY est obligatoire."),
  VITE_PLATFORM_SUPABASE_URL: optionalText,
  VITE_PLATFORM_SUPABASE_ANON_KEY: optionalText,
  VITE_CLUB_NAME: optionalText,
  VITE_CLUB_SHORT_NAME: optionalText,
  VITE_CLUB_LOCATION: optionalText,
  VITE_CLUB_VENUE_NAME: optionalText,
  VITE_CLUB_TAGLINE: optionalText,
  VITE_CLUB_FOUNDED_YEAR: optionalText,
  VITE_CLUB_DESCRIPTION: optionalText,
  VITE_CLUB_LOGO_URL: optionalText,
  VITE_CLUB_LOGO_ALT: optionalText,
  VITE_CLUB_HERO_URL: optionalText,
});

export const env = envSchema.parse(import.meta.env);
