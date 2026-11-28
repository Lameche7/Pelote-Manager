import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import type { User } from "@supabase/supabase-js";
import {
  isPlatformConfigured,
  platformSupabase,
} from "@/infrastructure/platform/platformClient";
import {
  PlatformAuthContext,
  type PlatformAuthContextValue,
} from "./usePlatformAuth";

export function PlatformAuthProvider({ children }: PropsWithChildren) {
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(isPlatformConfigured);

  const readyUserId = useRef<string | null>(null);
  const revision = useRef(0);

  const synchronize = useCallback(async (user: User | null) => {
    const currentRevision = ++revision.current;
    if (!platformSupabase || !user) {
      readyUserId.current = null;
      setEmail(null);
      setIsAdmin(false);
      setIsLoading(false);
      return;
    }

    if (readyUserId.current !== user.id) {
      readyUserId.current = null;
      setEmail(null);
      setIsAdmin(false);
      setIsLoading(true);
    }
    const { data, error } = await platformSupabase.rpc("platform_is_admin");
    if (currentRevision !== revision.current) return;

    if (error || data !== true) {
      readyUserId.current = null;
      setEmail(user.email ?? null);
      setIsAdmin(false);
      setIsLoading(false);
      return;
    }

    readyUserId.current = user.id;
    setEmail(user.email ?? null);
    setIsAdmin(true);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!platformSupabase) {
      setIsLoading(false);
      return;
    }

    let active = true;
    const {
      data: { subscription },
    } = platformSupabase.auth.onAuthStateChange((_event, session) => {
      if (active) void synchronize(session?.user ?? null);
    });

    void platformSupabase.auth.getUser().then(({ data }) => {
      if (active) void synchronize(data.user);
    });

    return () => {
      active = false;
      revision.current += 1;
      subscription.unsubscribe();
    };
  }, [synchronize]);

  const login = useCallback(async (loginEmail: string, password: string) => {
    if (!platformSupabase) {
      throw new Error("La plateforme centrale n’est pas configurée.");
    }

    const { data, error } = await platformSupabase.auth.signInWithPassword({
      email: loginEmail,
      password,
    });

    if (error) throw error;

    const { data: access, error: accessError } =
      await platformSupabase.rpc("platform_is_admin");

    if (accessError || access !== true) {
      await platformSupabase.auth.signOut();
      throw new Error("Ce compte n’est pas super administrateur.");
    }

    setEmail(data.user.email ?? null);
    setIsAdmin(true);
  }, []);

  const logout = useCallback(async () => {
    if (platformSupabase) await platformSupabase.auth.signOut();
    setEmail(null);
    setIsAdmin(false);
  }, []);

  const value = useMemo<PlatformAuthContextValue>(
    () => ({
      email,
      isConfigured: isPlatformConfigured,
      isAuthenticated: email !== null,
      isAdmin,
      isLoading,
      login,
      logout,
    }),
    [email, isAdmin, isLoading, login, logout],
  );

  return (
    <PlatformAuthContext.Provider value={value}>
      {children}
    </PlatformAuthContext.Provider>
  );
}
