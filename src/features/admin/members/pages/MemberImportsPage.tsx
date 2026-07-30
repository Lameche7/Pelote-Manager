import { Link } from "react-router-dom";
import { useState } from "react";
import { useMemberImports } from "../hooks/useAdminMembers";
export function MemberImportsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const query = useMemberImports({ page, page_size: pageSize });
  const total = query.data?.[0]?.total_count ?? 0;
  return (
    <section className="members-page">
      <header>
        <div>
          <p className="eyebrow">Traçabilité</p>
          <h1>Historique des imports</h1>
          <p>Un import terminé ne peut pas être annulé automatiquement.</p>
        </div>
      </header>
      {query.isLoading ? (
        <p>Chargement…</p>
      ) : (
        <div className="member-table">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Fichier</th>
                <th>Auteur</th>
                <th>Club</th>
                <th>Saison</th>
                <th>Statut</th>
                <th>Créations</th>
                <th>Modifications</th>
                <th>Réactivations</th>
                <th>Inchangées</th>
                <th>Ignorées</th>
                <th>Erreurs</th>
                <th>Avertissements</th>
                <th>Erreur</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.map((item) => (
                <tr key={item.id}>
                  <td>{new Date(item.created_at).toLocaleString("fr-FR")}</td>
                  <td>
                    <Link to={`/admin/membres/imports/${item.id}`}>
                      {item.file_name}
                    </Link>
                  </td>
                  <td>{item.author_name}</td>
                  <td>{item.club_name}</td>
                  <td>{item.season_name}</td>
                  <td>{item.status}</td>
                  <td>{item.created_count}</td>
                  <td>{item.updated_count}</td>
                  <td>{item.reactivated_count}</td>
                  <td>{item.unchanged_count}</td>
                  <td>{item.ignored_count}</td>
                  <td>{item.error_count}</td>
                  <td>{item.warning_count}</td>
                  <td>{item.global_error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          Page {page} · {total} import(s)
        </span>
        <select
          value={pageSize}
          onChange={(event) => {
            setPageSize(Number(event.target.value));
            setPage(1);
          }}
        >
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>
        <button
          className="secondary"
          disabled={page * pageSize >= total}
          onClick={() => setPage((value) => value + 1)}
        >
          Suivant
        </button>
      </div>
    </section>
  );
}
