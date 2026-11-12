import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useLocation } from "react-router-dom";
import { adminAccessService, type ClubAccess } from "./adminAccessService";
import type { AdminPermission } from "@/features/admin/config/adminPermissions";

type AdminAccessValue = {
  access: ClubAccess | null;
  error: string | null;
  isLoading: boolean;
  hasPermission: (permission: AdminPermission) => boolean;
};

const AdminAccessContext = createContext<AdminAccessValue | undefined>(
  undefined,
);

export function AdminAccessProvider({ children }: PropsWithChildren) {
  const location = useLocation();
  const requestedClubId =
    new URLSearchParams(location.search).get("adminClubId")?.trim() || null;
  const [access, setAccess] = useState<ClubAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setAccess(null);
    setError(null);
    setIsLoading(true);
    adminAccessService
      .getOptionalAccess(requestedClubId ?? undefined)
      .then((value) => {
        if (active) setAccess(value);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Chargement des permissions impossible.",
          );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [requestedClubId]);

  // Never render a prior club's permissions while the URL is changing.
  const visibleAccess =
    requestedClubId && access?.clubId !== requestedClubId ? null : access;

  const value = useMemo<AdminAccessValue>(
    () => ({
      access: visibleAccess,
      error,
      isLoading,
      hasPermission: (permission) =>
        visibleAccess?.permissions.includes(permission) ?? false,
    }),
    [visibleAccess, error, isLoading],
  );

  return (
    <AdminAccessContext.Provider value={value}>
      {children}
    </AdminAccessContext.Provider>
  );
}

export function useAdminAccess() {
  const value = useContext(AdminAccessContext);
  if (!value)
    throw new Error(
      "useAdminAccess doit être utilisé dans AdminAccessProvider.",
    );
  return value;
}
