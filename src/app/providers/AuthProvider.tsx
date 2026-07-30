import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import { finalizeAccountProfile } from "@/features/auth/domain/accountProfileFinalization";

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
  const synchronizationRevision = useRef(0);

  const synchronize = useCallback(
    async (currentUser: AuthUser | null, requireProfile = false) => {
      const currentRevision = ++synchronizationRevision.current;
      setUser(currentUser);

      if (!currentUser) {
        setProfile(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      try {
        const currentProfile = await finalizeAccountProfile(
          currentUser,
          profileService.getOrCreateProfile.bind(profileService),
        );
        if (currentRevision === synchronizationRevision.current) {
          setProfile(currentProfile);
        }
      } catch (error) {
        if (currentRevision === synchronizationRevision.current) {
          setProfile(null);
        }
        if (requireProfile) throw error;
      } finally {
        if (currentRevision === synchronizationRevision.current) {
          setIsLoading(false);
        }
      }
    },
    [profileService],
  );

  useEffect(() => {
    let isActive = true;
    let authRevision = 0;

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
      synchronizationRevision.current += 1;
      unsubscribe();
    };
  }, [service, synchronize]);

  const login = useCallback(
    async (email: string, password: string) => {
      const authenticatedUser = await service.login(email, password);
      // An explicit login must not complete until the account has its profile.
      // This is especially important after an email-confirmed visitor signup.
      await synchronize(authenticatedUser, true);
    },
    [service, synchronize],
  );

  const logout = useCallback(async () => {
    await service.logout();
    await synchronize(null);
  }, [service, synchronize]);

  const refreshProfile = useCallback(async () => {
    await synchronize(await service.getCurrentUser());
  }, [service, synchronize]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      isAuthenticated: user !== null,
      isLoading,
      login,
      refreshProfile,
      logout,
    }),
    [isLoading, login, logout, profile, refreshProfile, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
