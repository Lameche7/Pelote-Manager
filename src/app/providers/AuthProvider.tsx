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
import { AuthContext, type AuthContextValue } from "@/shared/hooks/useAuth";
import type { AuthUser } from "@/shared/types/auth";

type AuthProviderProps = PropsWithChildren<{
  service?: AuthService;
}>;

export function AuthProvider({
  children,
  service = defaultAuthService,
}: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    void service
      .getCurrentUser()
      .then((currentUser) => {
        if (isActive) {
          setUser(currentUser);
        }
      })
      .catch(() => {
        if (isActive) {
          setUser(null);
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [service]);

  const login = useCallback(async () => {
    setUser(await service.login());
  }, [service]);

  const logout = useCallback(async () => {
    await service.logout();
    setUser(null);
  }, [service]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      login,
      logout,
    }),
    [isLoading, login, logout, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
