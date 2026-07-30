import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
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
  const [access, setAccess] = useState<ClubAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    adminAccessService
      .getAccess()
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
  }, []);

  const value = useMemo<AdminAccessValue>(
    () => ({
      access,
      error,
      isLoading,
      hasPermission: (permission) =>
        access?.permissions.includes(permission) ?? false,
    }),
    [access, error, isLoading],
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
