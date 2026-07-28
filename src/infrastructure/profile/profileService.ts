import { supabase } from "@/infrastructure/supabase/client";
import {
  mapProfileInsert,
  mapProfileRow,
  type CreateProfileInput,
} from "@/infrastructure/profile/profileMappers";
import type { AuthUser } from "@/shared/types/auth";
import type { UserProfile } from "@/shared/types/profile";

export interface ProfileService {
  getProfile(userId: string): Promise<UserProfile | null>;
  createProfile(input: CreateProfileInput): Promise<UserProfile>;
  getOrCreateProfile(authUser: AuthUser): Promise<UserProfile>;
}

class ProfileServiceError extends Error {
  readonly code: string | undefined;

  constructor(operation: string, message: string, code: string | undefined) {
    super(`Impossible de ${operation} le profil : ${message}`);
    this.name = "ProfileServiceError";
    this.code = code;
  }
}

export const profileService: ProfileService = {
  async getProfile(userId) {
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id,email,first_name,last_name,display_name,role,created_at,updated_at",
      )
      .eq("id", userId)
      .maybeSingle();

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
        "id,email,first_name,last_name,display_name,role,created_at,updated_at",
      )
      .single();

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
