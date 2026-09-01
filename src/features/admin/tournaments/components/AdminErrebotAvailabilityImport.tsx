import { useEffect, useState, type ChangeEvent } from "react";
import {
  parseErrebotAvailabilityImport,
  type ErrebotAvailabilityImportIssue,
  type ErrebotAvailabilityImportRow,
} from "@/features/admin/tournaments/domain/errebotAvailabilityImport";
import {
  adminErrebotAvailabilityImportService,
  type AdminErrebotAvailabilityContext,
  type AdminErrebotAvailabilityPreview,
} from "@/features/admin/tournaments/services/adminErrebotAvailabilityImportService";
import "./AdminErrebotAvailabilityImport.css";

type Props = {
  tournamentId: string;
  onImported?: () => Promise<void> | void;
};

export function AdminErrebotAvailabilityImport({
  tournamentId,
  onImported,
}: Props) {
  const [context, setContext] = useState<AdminErrebotAvailabilityContext | null>(
    null,
  );
  const [items, setItems] = useState<ErrebotAvailabilityImportRow[]>([]);
  const [issues, setIssues] = useState<ErrebotAvailabilityImportIssue[]>([]);
  const [preview, setPreview] = useState<AdminErrebotAvailabilityPreview | null>(
    null,
  );
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadContext = async () => {
    const next = await adminErrebotAvailabilityImportService.getContext(
      tournamentId,
    );
    setContext(next);
    return next;
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setItems([]);
    setIssues([]);
    setPreview(null);
    setFileName("");
    setError("");
    setMessage("");

    adminErrebotAvailabilityImportService
      .getContext(tournamentId)
      .then((next) => {
        if (active) setContext(next);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Impossible de charger l’import des disponibilités.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [tournamentId]);

  const previewRows = async (nextItems: ErrebotAvailabilityImportRow[]) => {
    setChecking(true);
    setError("");
    setMessage("");
    setPreview(null);
    try {
      setPreview(
        await adminErrebotAvailabilityImportService.preview(
          tournamentId,
          nextItems,
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible de contrôler le fichier.",
      );
    } finally {
      setChecking(false);
    }
  };

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !context?.enabled) return;

    setFileName(file.name);
    setError("");
    setMessage("");
    setPreview(null);

    try {
      const parsed = parseErrebotAvailabilityImport(
        await file.text(),
        context.slotDurationMinutes,
      );
      setItems(parsed.rows);
      setIssues(parsed.issues);
      if (parsed.issues.length === 0 && parsed.rows.length > 0) {
        await previewRows(parsed.rows);
      }
    } catch {
      setItems([]);
      setIssues([{ row: 0, message: "Impossible de lire ce fichier." }]);
    }
  };

  const apply = async () => {
    if (!preview?.valid || items.length === 0 || !context) return;
    if (
      context.knownTeamCount > 0 &&
      !window.confirm(
        "Les disponibilités déjà importées des équipes présentes dans ce fichier seront remplacées. Continuer ?",
      )
    ) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await adminErrebotAvailabilityImportService.apply(
        tournamentId,
        items,
      );
      await loadContext();
      await onImported?.();
      setMessage(
        result.coverageComplete
          ? `${result.importedSlotCount} créneaux importés. Les ${result.acceptedTeamCount} équipes ont maintenant des disponibilités connues : les échanges peuvent être proposés.`
          : `${result.importedSlotCount} créneaux importés pour ${result.importedTeamCount} équipes. Couverture actuelle : ${result.knownTeamCount}/${result.acceptedTeamCount} équipes.`,
      );
      setItems([]);
      setIssues([]);
      setPreview(null);
      setFileName("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’importer les disponibilités.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p role="status">Vérification des données Errebot…</p>;
  }
  if (!context?.enabled) return null;

  return (
    <section className="admin-card admin-errebot-availability">
      <div className="admin-errebot-availability__heading">
        <div>
          <p className="admin-page__eyebrow">Import Errebot</p>
          <h2>Disponibilités des équipes</h2>
          <p>
            Importez à posteriori les créneaux choisis lors des inscriptions.
            Cette opération ne modifie ni les matchs ni le planning publié.
          </p>
        </div>
        <strong>
          {context.knownTeamCount}/{context.acceptedTeamCount} équipes
        </strong>
      </div>

      {context.coverageComplete ? (
        <p className="admin-errebot-availability__status" role="status">
          Toutes les équipes ont des disponibilités connues. Un nouvel import
          peut servir à les corriger.
        </p>
      ) : (
        <p className="admin-errebot-availability__status" role="status">
          Tant que la couverture n’est pas complète, les échanges de créneaux
          restent désactivés. Les reports vers un créneau libre restent possibles.
        </p>
      )}

      <div className="admin-errebot-availability__format">
        <strong>Format accepté</strong>
        <code>N° équipe ; Date ; Heure ; Fin (facultative)</code>
        <span>
          Une ligne par créneau choisi. Dates acceptées : 24/08/2026 ou
          2026-08-24. Si « Fin » manque, Pelote Manager applique la durée du
          tournoi ({context.slotDurationMinutes} min).
        </span>
      </div>

      <label className="admin-errebot-availability__file">
        Fichier CSV / TSV
        <input
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          disabled={checking || saving}
          onChange={(event) => void chooseFile(event)}
        />
      </label>

      {fileName && <p>Fichier sélectionné : {fileName}</p>}
      {checking && <p role="status">Contrôle des équipes et des créneaux…</p>}

      {issues.length > 0 && (
        <div className="admin-errebot-availability__errors" role="alert">
          <strong>Le fichier doit être corrigé.</strong>
          <ul>
            {issues.slice(0, 8).map((issue, index) => (
              <li key={`${issue.row}-${index}`}>
                {issue.row > 0 ? `Ligne ${issue.row} : ` : ""}
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview && (
        <div className="admin-errebot-availability__preview">
          <strong>Prévisualisation</strong>
          <p>
            {preview.rowCount} créneaux reconnus pour {preview.teamCount} équipes.
            Couverture après import : {preview.knownTeamCountAfter}/
            {preview.acceptedTeamCount} équipes.
          </p>
          {preview.errors.length > 0 && (
            <ul className="admin-errebot-availability__errors">
              {preview.errors.slice(0, 8).map((item, index) => (
                <li key={`${item.row}-${item.code}-${index}`}>
                  Ligne {item.row} : {item.message}
                </li>
              ))}
            </ul>
          )}
          {preview.valid && (
            <button
              className="admin-tournament-teams__primary"
              type="button"
              disabled={saving}
              onClick={() => void apply()}
            >
              {saving
                ? "Import en cours…"
                : `Importer ${preview.rowCount} créneaux`}
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="admin-tournament-teams__alert admin-tournament-teams__alert--error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="admin-tournament-teams__alert" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
