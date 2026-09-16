import { useMemo, useState } from "react";
import { useUnlicensedPilotokiUsers } from "../hooks/useAdminMembers";
import type { AdminUnlicensedPilotokiUser } from "../types";
import "./AdminMembersPage.css";

const statusLabels: Record<AdminUnlicensedPilotokiUser["status"], string> = {
  unlinked: "Compte non rattaché",
  member_inactive: "Fiche licencié inactive",
  unlicensed: "Licence non active",
};

const displayName = (user: AdminUnlicensedPilotokiUser) => {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return fullName || user.display_name || "Utilisateur PILOTOKI";
};

export function AdminUnlicensedPilotokiUsersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const filters = useMemo(
    () => ({ search, page, page_size: pageSize }),
    [page, pageSize, search],
  );
  const query = useUnlicensedPilotokiUsers(filters);
  const total = query.data?.[0]?.total_count ?? 0;

  return (
    <section className="members-page">
      <header>
        <div>
          <p className="eyebrow">Comptes PILOTOKI du club</p>
          <h1>Inscrits sans licence</h1>
          <p>
            Comptes créés dans PILOTOKI qui ne disposent pas d’une licence valide
            pour la saison active du club.
          </p>
        </div>
      </header>

      <div className="member-filters">
        <label>
          Rechercher
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Nom, prénom ou e-mail"
          />
        </label>
      </div>

      {query.isLoading ? (
        <p role="status">Chargement des inscrits…</p>
      ) : query.error ? (
        <p role="alert">{query.error.message}</p>
      ) : (
        <div className="member-table">
          <table>
            <thead>
              <tr>
                <th>Utilisateur</th>
                <th>E-mail</th>
                <th>Inscription PILOTOKI</th>
                <th>Situation</th>
                <th>Licence connue</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{displayName(user)}</strong>
                  </td>
                  <td>{user.email || "—"}</td>
                  <td>{new Date(user.created_at).toLocaleDateString("fr-FR")}</td>
                  <td>
                    <span className="pill muted">{statusLabels[user.status]}</span>
                  </td>
                  <td>{user.licence_number || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {query.data?.length === 0 && (
            <p className="empty">Aucun inscrit sans licence ne correspond à la recherche.</p>
          )}

          <div className="members-actions">
            <button
              className="secondary"
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Précédent
            </button>
            <span>
              Page {page} · {total} résultat{total > 1 ? "s" : ""}
            </span>
            <select
              aria-label="Taille de page"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <button
              className="secondary"
              disabled={page * pageSize >= total}
              onClick={() => setPage((value) => value + 1)}
            >
              Suivant
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
