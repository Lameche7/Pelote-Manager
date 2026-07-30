import { Link } from "react-router-dom";
import { useMemberImports } from "../hooks/useAdminMembers";
export function MemberImportsPage() {
  const query = useMemberImports();
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
                <th>Statut</th>
                <th>Créations</th>
                <th>Modifications</th>
                <th>Réactivations</th>
                <th>Ignorées</th>
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
                  <td>{item.status}</td>
                  <td>{item.created_count}</td>
                  <td>{item.updated_count}</td>
                  <td>{item.reactivated_count}</td>
                  <td>{item.ignored_count}</td>
                  <td>{item.global_error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
