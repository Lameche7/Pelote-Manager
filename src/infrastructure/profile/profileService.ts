import { supabase } from "@/infrastructure/supabase/client";
import {
  mapProfileInsert,
  mapProfileRow,
  type CreateProfileInput,
  type ProfileRow,
} from "@/infrastructure/profile/profileMappers";
import type { AuthUser } from "@/shared/types/auth";
import type { UserProfile } from "@/shared/types/profile";

export interface ProfileService {
  getProfile(userId: string): Promise<UserProfile | null>;
  createProfile(input: CreateProfileInput): Promise<UserProfile>;
  getOrCreateProfile(authUser: AuthUser): Promise<UserProfile>;
}

class ProfileServiceError extends Error {
  constructor(
    operation: string,
    message: string,
    readonly code?: string,
  ) {
    super(`Impossible de ${operation} le profil : ${message}`);
    this.name = "ProfileServiceError";
  }
}

export const profileService: ProfileService = {
  async getProfile(userId) {
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id,email,first_name,last_name,display_name,created_at,updated_at",
      )
      .eq("id", userId)
      .maybeSingle<ProfileRow>();

    if (error) {
      throw new ProfileServiceError("charger", error.message, error.code);
    }

    return data ? mapProfileRow(data) : null;
  },

  async createProfile(input) {
    const { data, error } = await supabase
      .from("profiles")
      .insert(mapProfileInsert(input))
      .select(
        "id,email,first_name,last_name,display_name,created_at,updated_at",
      )
      .single<ProfileRow>();

    if (error) {
      throw new ProfileServiceError("créer", error.message, error.code);
    }

    return mapProfileRow(data);
  },

  async getOrCreateProfile(authUser) {
    const existingProfile = await this.getProfile(authUser.id);

    if (existingProfile) {
      return existingProfile;
    }

    try {
      return await this.createProfile({
        id: authUser.id,
        email: authUser.email,
        ...(authUser.displayName ? { displayName: authUser.displayName } : {}),
      });
    } catch (error: unknown) {
      // A simultaneous auth event may have created the same one-to-one profile.
      if (error instanceof ProfileServiceError && error.code === "23505") {
        const concurrentlyCreatedProfile = await this.getProfile(authUser.id);
        if (concurrentlyCreatedProfile) {
          return concurrentlyCreatedProfile;
        }
      }

      throw error;
    }
  },
};
