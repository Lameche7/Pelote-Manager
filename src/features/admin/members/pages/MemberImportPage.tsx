import { useState } from "react";
import {
  autoMapColumns,
  decodeCsv,
  detectSeparator,
  MEMBER_IMPORT_LIMITS,
  mapMemberRow,
  parseCsv,
  type CsvEncoding,
  type CsvSeparator,
} from "../domain/csvImport";
import {
  buildImportPreview,
  summarizePreview,
  type ImportPreviewRow,
} from "../domain/importPreview";
export function MemberImportPage() {
  const [rows, setRows] = useState<ImportPreviewRow[]>([]);
  const [encoding, setEncoding] = useState<CsvEncoding>("utf-8");
  const [separator, setSeparator] = useState<CsvSeparator>(";");
  const [error, setError] = useState("");
  const load = async (file: File) => {
    if (file.size > MEMBER_IMPORT_LIMITS.maxBytes) {
      setError("Le fichier dépasse la limite de 5 Mo.");
      return;
    }
    const decoded = decodeCsv(await file.arrayBuffer());
    const detected = detectSeparator(decoded.text);
    const table = parseCsv(decoded.text, detected);
    if (table.length - 1 > MEMBER_IMPORT_LIMITS.maxRows) {
      setError("Le fichier dépasse la limite de 10 000 lignes.");
      return;
    }
    setEncoding(decoded.encoding);
    setSeparator(detected);
    const mapping = autoMapColumns(table[0] ?? []);
    setRows(
      buildImportPreview(
        table.slice(1).map((row) => mapMemberRow(row, mapping)),
        [],
        "current",
      ),
    );
  };
  const summary = summarizePreview(rows);
  return (
    <section className="members-page">
      <header>
        <div>
          <p className="eyebrow">Assistant en 8 étapes</p>
          <h1>Importer les licenciés</h1>
          <p>
            L’import cible exclusivement la saison active et ne désactive jamais
            les absents.
          </p>
        </div>
      </header>
      <ol className="import-steps">
        <li className="active">Fichier</li>
        <li>Détection</li>
        <li>Colonnes</li>
        <li>Prévisualisation</li>
        <li>Résolution</li>
        <li>Bilan</li>
        <li>Exécution</li>
        <li>Résultat</li>
      </ol>
      <div className="import-card">
        <label>
          Fichier CSV (5 Mo et 10 000 lignes maximum)
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void load(file);
            }}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="form-grid">
          <label>
            Encodage
            <select
              value={encoding}
              onChange={(e) => setEncoding(e.target.value as CsvEncoding)}
            >
              <option value="utf-8">UTF-8</option>
              <option value="windows-1252">Windows-1252</option>
            </select>
          </label>
          <label>
            Séparateur
            <select
              value={separator}
              onChange={(e) => setSeparator(e.target.value as CsvSeparator)}
            >
              <option value=";">Point-virgule</option>
              <option value=",">Virgule</option>
              <option value="\t">Tabulation</option>
            </select>
          </label>
        </div>
      </div>
      {rows.length > 0 && (
        <>
          <div className="preview-summary">
            <strong>{rows.length} lignes</strong>
            <span>{summary.create} créations</span>
            <span>{summary.errors} erreurs</span>
            <span>{summary.warnings} avertissements</span>
          </div>
          <div className="member-table">
            <table>
              <thead>
                <tr>
                  <th>Ligne</th>
                  <th>Licence</th>
                  <th>Identité</th>
                  <th>Naissance</th>
                  <th>Action prévue</th>
                  <th>Messages</th>
                  <th>Décision</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.lineNumber}>
                    <td>{row.lineNumber}</td>
                    <td>{row.data.licenceNumber}</td>
                    <td>
                      {row.data.firstName} {row.data.lastName}
                    </td>
                    <td>{row.data.birthDate ?? "Invalide"}</td>
                    <td>{row.action}</td>
                    <td>{[...row.errors, ...row.warnings].join(" ") || "—"}</td>
                    <td>
                      <label>
                        <input
                          type="checkbox"
                          checked={row.ignored}
                          onChange={(e) =>
                            setRows((current) =>
                              current.map((item, i) =>
                                i === index
                                  ? {
                                      ...item,
                                      ignored: e.target.checked,
                                      action: e.target.checked
                                        ? "ignored"
                                        : item.action,
                                    }
                                  : item,
                              ),
                            )
                          }
                        />{" "}
                        Ignorer
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
