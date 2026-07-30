import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  autoMapColumns,
  decodeCsv,
  detectSeparator,
  MEMBER_IMPORT_LIMITS,
  mapMemberRow,
  parseCsv,
  type ColumnMapping,
  type CsvEncoding,
  type CsvSeparator,
  type MemberColumn,
} from "../domain/csvImport";
import {
  buildImportPreview,
  summarizePreview,
  type ImportPreviewRow,
} from "../domain/importPreview";
import { memberAdminService } from "../services/memberAdminService";
import type { Json } from "@/infrastructure/supabase/database";
const fields: Array<[MemberColumn, string, boolean]> = [
  ["licence_number", "Numéro de licence", true],
  ["last_name", "Nom", true],
  ["first_name", "Prénom", true],
  ["birth_date", "Date de naissance", true],
  ["gender", "Sexe", true],
  ["email", "E-mail", false],
  ["phone", "Téléphone", false],
  ["ranking", "Classement", false],
];
export function MemberImportPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File>();
  const [table, setTable] = useState<string[][]>([]);
  const [encoding, setEncoding] = useState<CsvEncoding>("utf-8");
  const [separator, setSeparator] = useState<CsvSeparator>(";");
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [rows, setRows] = useState<ImportPreviewRow[]>([]);
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [importId, setImportId] = useState<string>();
  const [result, setResult] = useState<Json>();
  const summary = useMemo(() => summarizePreview(rows), [rows]);
  const rebuild = (nextMapping = mapping) =>
    setRows(
      buildImportPreview(
        table.slice(1).map((row) => mapMemberRow(row, nextMapping)),
        [],
        "current",
      ),
    );
  const load = async (next: File) => {
    setError("");
    if (next.size > MEMBER_IMPORT_LIMITS.maxBytes) {
      setError("Le fichier dépasse 5 Mo.");
      return;
    }
    const decoded = decodeCsv(await next.arrayBuffer());
    const detected = detectSeparator(decoded.text);
    const parsed = parseCsv(decoded.text, detected);
    if (parsed.length < 2 || parsed.length - 1 > MEMBER_IMPORT_LIMITS.maxRows) {
      setError("Le fichier doit contenir entre 1 et 10 000 lignes de données.");
      return;
    }
    const mapped = autoMapColumns(parsed[0]);
    setFile(next);
    setEncoding(decoded.encoding);
    setSeparator(detected);
    setTable(parsed);
    setMapping(mapped);
    setRows(
      buildImportPreview(
        parsed.slice(1).map((row) => mapMemberRow(row, mapped)),
        [],
        "current",
      ),
    );
    setStep(2);
  };
  const setDecision = (index: number, patch: Partial<ImportPreviewRow>) =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  const persist = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await file.arrayBuffer(),
      );
      const hash = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const id =
        importId ??
        (await memberAdminService.createImport({
          file_name: file.name,
          file_size: file.size,
          file_hash: hash,
          encoding,
          separator,
          mapping: mapping as Json,
          options: { header: true },
        }));
      if (!importId) setImportId(id);
      await memberAdminService.validateImport(
        id,
        rows.map((row) => ({
          lineNumber: row.lineNumber,
          original: table[row.lineNumber - 1] as Json,
          data: row.data as unknown as Json,
          decision: {
            ignored: row.ignored,
            confirmedSensitive: row.confirmedSensitive,
            reactivate: row.reactivate,
            confirmDistinctIdentity: row.confirmedSensitive,
          },
        })),
      );
      const detail = await memberAdminService.getImport(id);
      const blocking = detail.rows.filter(
        (row) => row.errors.length && row.planned_action !== "ignored",
      );
      if (blocking.length) {
        setRows((current) =>
          current.map((row) => {
            const serverRow = detail.rows.find(
              (candidate) => candidate.line_number === row.lineNumber,
            );
            return serverRow
              ? {
                  ...row,
                  action:
                    serverRow.planned_action as ImportPreviewRow["action"],
                  errors: serverRow.errors,
                  warnings: serverRow.warnings,
                }
              : row;
          }),
        );
        setError(
          `La validation PostgreSQL a détecté ${blocking.length} ligne(s) bloquante(s). Consultez le détail puis corrigez ou ignorez-les.`,
        );
        setStep(5);
        return;
      }
      setStep(6);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Validation impossible.",
      );
    } finally {
      setBusy(false);
    }
  };
  const execute = async () => {
    if (!importId) return;
    setBusy(true);
    try {
      const response = await memberAdminService.executeImport(importId);
      setResult(response);
      setStep(8);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import impossible.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="members-page">
      <header>
        <div>
          <p className="eyebrow">Assistant CSV transactionnel</p>
          <h1>Importer les licenciés</h1>
          <p>
            Saison active uniquement. Aucune absence ne provoque de
            désactivation.
          </p>
        </div>
      </header>
      <ol className="import-steps">
        {[
          "Fichier",
          "Détection",
          "Colonnes",
          "Prévisualisation",
          "Résolution",
          "Bilan",
          "Exécution",
          "Résultat",
        ].map((label, index) => (
          <li key={label} className={step === index + 1 ? "active" : ""}>
            {index + 1}. {label}
          </li>
        ))}
      </ol>
      {error && (
        <p role="alert" className="import-error">
          {error}
        </p>
      )}
      {step === 1 && (
        <div className="import-card">
          <label>
            Fichier CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const selected = event.target.files?.[0];
                if (selected) void load(selected);
              }}
            />
          </label>
        </div>
      )}
      {step === 2 && (
        <div className="import-card">
          <h2>Détection</h2>
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
          <button onClick={() => setStep(3)}>Confirmer la détection</button>
        </div>
      )}
      {step === 3 && (
        <div className="import-card">
          <h2>Association des colonnes</h2>
          <div className="form-grid">
            {fields.map(([key, label, required]) => (
              <label key={key}>
                {label}
                {required ? " *" : ""}
                <select
                  value={mapping[key] ?? ""}
                  onChange={(e) => {
                    const next = {
                      ...mapping,
                      [key]:
                        e.target.value === ""
                          ? undefined
                          : Number(e.target.value),
                    };
                    setMapping(next);
                    rebuild(next);
                  }}
                >
                  <option value="">Non associée</option>
                  {(table[0] ?? []).map((header, index) => (
                    <option value={index} key={`${header}-${index}`}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            disabled={fields.some(
              ([key, , required]) => required && mapping[key] === undefined,
            )}
            onClick={() => setStep(4)}
          >
            Prévisualiser
          </button>
        </div>
      )}
      {step >= 4 && step <= 5 && (
        <>
          <div className="preview-summary">
            <strong>{rows.length} lignes</strong>
            <span>{summary.create} créations</span>
            <span>{summary.errors} erreurs client</span>
            <span>{summary.warnings} avertissements</span>
          </div>
          <div className="member-table">
            <table>
              <thead>
                <tr>
                  <th>Ligne</th>
                  <th>Licence</th>
                  <th>Identité</th>
                  <th>Action</th>
                  <th>Messages</th>
                  <th>Résolution</th>
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
                    <td>{row.action}</td>
                    <td>{[...row.errors, ...row.warnings].join(" ") || "—"}</td>
                    <td>
                      <label>
                        <input
                          type="checkbox"
                          checked={row.ignored}
                          onChange={(e) =>
                            setDecision(index, {
                              ignored: e.target.checked,
                              action: e.target.checked ? "ignored" : row.action,
                            })
                          }
                        />{" "}
                        Ignorer
                      </label>
                      {row.warnings.length > 0 && (
                        <label>
                          <input
                            type="checkbox"
                            checked={row.confirmedSensitive}
                            onChange={(e) =>
                              setDecision(index, {
                                confirmedSensitive: e.target.checked,
                              })
                            }
                          />{" "}
                          Confirmer
                        </label>
                      )}{" "}
                      {row.action === "inactive" && (
                        <label>
                          <input
                            type="checkbox"
                            checked={row.reactivate}
                            onChange={(e) =>
                              setDecision(index, {
                                reactivate: e.target.checked,
                              })
                            }
                          />{" "}
                          Réactiver
                        </label>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            disabled={
              busy || rows.some((row) => row.errors.length && !row.ignored)
            }
            onClick={() => void persist()}
          >
            {busy ? "Validation PostgreSQL…" : "Valider côté serveur"}
          </button>
        </>
      )}
      {step === 6 && (
        <div className="import-card">
          <h2>Bilan avant import</h2>
          <p>
            {summary.create} créations, {summary.update} mises à jour,{" "}
            {summary.ignored} lignes ignorées.
          </p>
          <p>
            L’exécution est atomique et revérifiera les permissions, la saison,
            l’unicité et les versions.
          </p>
          <button onClick={() => setStep(7)}>Confirmer l’exécution</button>
        </div>
      )}
      {step === 7 && (
        <div className="import-card">
          <h2>Exécution définitive</h2>
          <p>Cette opération ne pourra pas être annulée automatiquement.</p>
          <button disabled={busy} onClick={() => void execute()}>
            {busy ? "Import en cours…" : "Exécuter l’import"}
          </button>
        </div>
      )}
      {step === 8 && (
        <div className="import-card">
          <h2>Résultat</h2>
          <pre>{JSON.stringify(result, null, 2)}</pre>
          <button onClick={() => navigate("/admin/membres/imports")}>
            Consulter l’historique
          </button>
        </div>
      )}
    </section>
  );
}
