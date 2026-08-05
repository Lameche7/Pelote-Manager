import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/shared/config/env";

const platformUrl = env.VITE_PLATFORM_SUPABASE_URL?.trim();
const platformAnonKey = env.VITE_PLATFORM_SUPABASE_ANON_KEY?.trim();

export const platformSupabase: SupabaseClient | null =
  platformUrl && platformAnonKey
    ? createClient(platformUrl, platformAnonKey, {
        auth: {
          storageKey: "pelote-manager-platform-auth",
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null;

export const isPlatformConfigured = platformSupabase !== null;

export function requirePlatformSupabase(): SupabaseClient {
  if (!platformSupabase) {
    throw new Error(
      "La plateforme centrale n’est pas configurée sur ce déploiement.",
    );
  }

  return platformSupabase;
}
