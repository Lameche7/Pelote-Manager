import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import {
  authService as defaultAuthService,
  type AuthService,
} from "@/infrastructure/auth/authService";
import {
  profileService as defaultProfileService,
  type ProfileService,
} from "@/infrastructure/profile/profileService";
import { AuthContext, type AuthContextValue } from "@/shared/hooks/useAuth";
import type { AuthUser } from "@/shared/types/auth";
import type { UserProfile } from "@/shared/types/profile";

type AuthProviderProps = PropsWithChildren<{
  service?: AuthService;
  profileService?: ProfileService;
}>;

export function AuthProvider({
  children,
  service = defaultAuthService,
  profileService = defaultProfileService,
}: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isActive = true;
    let authRevision = 0;
    let profileRevision = 0;

    const synchronize = async (currentUser: AuthUser | null) => {
      const currentProfileRevision = ++profileRevision;
      setUser(currentUser);

      if (!currentUser) {
        setProfile(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      try {
        const currentProfile =
          await profileService.getOrCreateProfile(currentUser);
        if (isActive && currentProfileRevision === profileRevision) {
          setProfile(currentProfile);
        }
      } catch {
        if (isActive && currentProfileRevision === profileRevision) {
          setProfile(null);
        }
      } finally {
        if (isActive && currentProfileRevision === profileRevision) {
          setIsLoading(false);
        }
      }
    };

    const initialAuthRevision = authRevision;
    const unsubscribe = service.onAuthStateChange((currentUser) => {
      authRevision += 1;
      if (isActive) {
        void synchronize(currentUser);
      }
    });

    void service
      .getCurrentUser()
      .then((currentUser) => {
        if (isActive && initialAuthRevision === authRevision) {
          void synchronize(currentUser);
        }
      })
      .catch(() => {
        if (isActive && initialAuthRevision === authRevision) {
          setUser(null);
          setProfile(null);
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [profileService, service]);

  const login = useCallback(
    async (email: string, password: string) => {
      const authenticatedUser = await service.login(email, password);
      setUser(authenticatedUser);
      setProfile(await profileService.getOrCreateProfile(authenticatedUser));
    },
    [profileService, service],
  );

  const logout = useCallback(async () => {
    await service.logout();
    setUser(null);
    setProfile(null);
  }, [service]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      isAuthenticated: user !== null,
      isLoading,
      login,
      logout,
    }),
    [isLoading, login, logout, profile, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
