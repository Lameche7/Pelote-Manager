import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { memberAdminService } from "../services/memberAdminService";
export function MemberImportDetailPage() {
  const { importId = "" } = useParams();
  const query = useQuery({
    queryKey: ["admin-members", "imports", importId],
    queryFn: () => memberAdminService.getImport(importId),
  });
  if (query.isLoading) return <p>Chargement de l’import…</p>;
  if (query.error || !query.data)
    return <p role="alert">{query.error?.message ?? "Import introuvable."}</p>;
  const data = query.data;
  return (
    <section className="members-page">
      <header>
        <div>
          <p className="eyebrow">Import {data.import.status}</p>
          <h1>{data.import.file_name}</h1>
          <p>{new Date(data.import.created_at).toLocaleString("fr-FR")}</p>
        </div>
      </header>
      <div className="preview-summary">
        <span>{data.import.created_count} créations</span>
        <span>{data.import.updated_count} modifications</span>
        <span>{data.import.reactivated_count} réactivations</span>
        <span>{data.import.unchanged_count} inchangées</span>
        <span>{data.import.ignored_count} ignorées</span>
      </div>
      {data.import.global_error && (
        <p role="alert">{data.import.global_error}</p>
      )}
      <div className="member-table">
        <table>
          <thead>
            <tr>
              <th>Ligne</th>
              <th>Prévision</th>
              <th>Exécution</th>
              <th>Erreurs</th>
              <th>Avertissements</th>
              <th>Décision</th>
              <th>Avant / après</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.id}>
                <td>{row.line_number}</td>
                <td>{row.planned_action}</td>
                <td>{row.executed_action ?? "—"}</td>
                <td>{row.errors.join(" ") || "—"}</td>
                <td>{row.warnings.join(" ") || "—"}</td>
                <td>
                  <pre>{JSON.stringify(row.admin_decision, null, 2)}</pre>
                </td>
                <td>
                  <details>
                    <summary>Valeurs</summary>
                    <pre>
                      {JSON.stringify(
                        { avant: row.before_values, apres: row.after_values },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
