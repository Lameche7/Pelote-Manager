import { createContext, useContext } from "react";

export type PlatformAuthContextValue = {
  email: string | null;
  isConfigured: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

export const PlatformAuthContext = createContext<
  PlatformAuthContextValue | undefined
>(undefined);

export function usePlatformAuth(): PlatformAuthContextValue {
  const context = useContext(PlatformAuthContext);

  if (!context) {
    throw new Error(
      "usePlatformAuth doit être utilisé dans PlatformAuthProvider.",
    );
  }

  return context;
}
