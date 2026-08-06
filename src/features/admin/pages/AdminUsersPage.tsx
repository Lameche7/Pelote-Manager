import { useEffect, useMemo, useState } from "react";
import { adminUserService } from "@/features/admin/services/adminUserService";
import {
  filterAdminProfiles,
  getProfileDisplayName,
  USER_ROLE_LABELS,
  USER_ROLE_OPTIONS,
} from "@/features/admin/utils/adminUsers";
import { USER_ROLES, type UserRole } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";
import type { UserProfile } from "@/shared/types/profile";

export function AdminUsersPage() {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [isLoading, setIsLoading] = useState(true);
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    adminUserService
      .listProfiles()
      .then((loadedProfiles) => {
        if (isMounted) {
          setProfiles(loadedProfiles);
        }
      })
      .catch((loadError: unknown) => {
        if (isMounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Impossible de charger les utilisateurs.",
          );
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const filteredProfiles = useMemo(
    () => filterAdminProfiles(profiles, search, roleFilter),
    [profiles, roleFilter, search],
  );

  async function handleRoleChange(profile: UserProfile, role: UserRole) {
    if (profile.role === role || profile.id === user?.id) {
      return;
    }

    setSavingProfileId(profile.id);
    setError(null);
    setSuccess(null);

    try {
      const updatedProfile = await adminUserService.setRole(profile.id, role);
      setProfiles((currentProfiles) =>
        currentProfiles.map((currentProfile) =>
          currentProfile.id === updatedProfile.id ? updatedProfile : currentProfile,
        ),
      );
      setSuccess(
        `Le rôle et les habilitations de ${getProfileDisplayName(updatedProfile)} ont été modifiés.`,
      );
    } catch (updateError: unknown) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Impossible de modifier le rôle.",
      );
    } finally {
      setSavingProfileId(null);
    }
  }

  return (
    <section className="simple-page" aria-labelledby="admin-users-title">
      <h1 id="admin-users-title">Gestion des utilisateurs</h1>
      <p>Consultez les profils et attribuez les droits applicatifs.</p>
      <p>
        Attribuer le rôle Administrateur donne automatiquement l’habilitation
        complète du club. Retirer ce rôle retire également cette habilitation,
        sans intervention dans Supabase.
      </p>

      <div>
        <label htmlFor="admin-user-search">Rechercher</label>{" "}
        <input
          id="admin-user-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Nom ou adresse e-mail"
        />
      </div>

      <div>
        <label htmlFor="admin-role-filter">Filtrer par rôle</label>{" "}
        <select
          id="admin-role-filter"
          value={roleFilter}
          onChange={(event) =>
            setRoleFilter(event.target.value as UserRole | "all")
          }
        >
          <option value="all">Tous les rôles</option>
          {USER_ROLE_OPTIONS.map((role) => (
            <option key={role} value={role}>
              {USER_ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </div>

      {error && <p role="alert">{error}</p>}
      {success && <p role="status">{success}</p>}

      {isLoading ? (
        <p>Chargement des utilisateurs…</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th scope="col">Nom</th>
                <th scope="col">Adresse e-mail</th>
                <th scope="col">Rôle</th>
                <th scope="col">Inscription</th>
              </tr>
            </thead>
            <tbody>
              {filteredProfiles.map((profile) => {
                const isCurrentUser = profile.id === user?.id;
                const isSaving = savingProfileId === profile.id;

                return (
                  <tr key={profile.id}>
                    <td>{getProfileDisplayName(profile)}</td>
                    <td>{profile.email}</td>
                    <td>
                      <select
                        aria-label={`Rôle de ${getProfileDisplayName(profile)}`}
                        value={profile.role}
                        disabled={isCurrentUser || isSaving}
                        onChange={(event) =>
                          void handleRoleChange(
                            profile,
                            event.target.value as UserRole,
                          )
                        }
                      >
                        {USER_ROLE_OPTIONS.map((role) => (
                          <option key={role} value={role}>
                            {USER_ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                      {isCurrentUser && " (votre compte)"}
                      {isSaving && " Enregistrement…"}
                    </td>
                    <td>{new Date(profile.createdAt).toLocaleDateString("fr-FR")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && filteredProfiles.length === 0 && (
        <p>Aucun utilisateur ne correspond aux critères.</p>
      )}

      <p>
        Les comptes commencent avec le rôle {USER_ROLE_LABELS[USER_ROLES.visitor]}.
      </p>
    </section>
  );
}
