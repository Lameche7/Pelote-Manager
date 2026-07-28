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
    async (currentUser: AuthUser | null) => {
      const currentRevision = ++synchronizationRevision.current;
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
        if (currentRevision === synchronizationRevision.current) {
          setProfile(currentProfile);
        }
      } catch {
        if (currentRevision === synchronizationRevision.current) {
          setProfile(null);
        }
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
      await synchronize(authenticatedUser);
    },
    [service, synchronize],
  );

  const logout = useCallback(async () => {
    await service.logout();
    await synchronize(null);
  }, [service, synchronize]);

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
