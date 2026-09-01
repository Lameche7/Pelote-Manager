import { useEffect, useState, type ChangeEvent } from "react";
import type {
  ErrebotAvailabilityDeclaration,
  ErrebotAvailabilityImportIssue,
  ErrebotAvailabilityImportRow,
  ErrebotAvailabilitySheetSummary,
  ErrebotAvailabilitySourceSlot,
} from "@/features/admin/tournaments/domain/errebotAvailabilityImport";
import {
  adminErrebotAvailabilityImportService,
  type AdminErrebotAvailabilityContext,
  type AdminErrebotAvailabilityPreview,
} from "@/features/admin/tournaments/services/adminErrebotAvailabilityImportService";
import { errebotAvailabilityWorkbookService } from "@/features/admin/tournaments/services/errebotAvailabilityWorkbookService";
import "./AdminErrebotAvailabilityImport.css";

type Props = {
  tournamentId: string;
  onImported?: () => Promise<void> | void;
};

export function AdminErrebotAvailabilityImport({
  tournamentId,
  onImported,
}: Props) {
  const [context, setContext] =
    useState<AdminErrebotAvailabilityContext | null>(null);
  const [items, setItems] = useState<ErrebotAvailabilityImportRow[]>([]);
  const [declarations, setDeclarations] = useState<
    ErrebotAvailabilityDeclaration[]
  >([]);
  const [sourceSlots, setSourceSlots] = useState<
    ErrebotAvailabilitySourceSlot[]
  >([]);
  const [sheetSummaries, setSheetSummaries] = useState<
    ErrebotAvailabilitySheetSummary[]
  >([]);
  const [issues, setIssues] = useState<ErrebotAvailabilityImportIssue[]>([]);
  const [preview, setPreview] =
    useState<AdminErrebotAvailabilityPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadContext = async () => {
    const next =
      await adminErrebotAvailabilityImportService.getContext(tournamentId);
    setContext(next);
    return next;
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setItems([]);
    setDeclarations([]);
    setSourceSlots([]);
    setSheetSummaries([]);
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

  const previewRows = async (
    nextItems: ErrebotAvailabilityImportRow[],
    nextDeclarations: ErrebotAvailabilityDeclaration[],
    nextSourceSlots: ErrebotAvailabilitySourceSlot[],
  ) => {
    setChecking(true);
    setError("");
    setMessage("");
    setPreview(null);
    try {
      setPreview(
        await adminErrebotAvailabilityImportService.preview(
          tournamentId,
          nextItems,
          nextDeclarations,
          nextSourceSlots,
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible de contrôler le classeur.",
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
    setItems([]);
    setDeclarations([]);
    setSourceSlots([]);
    setSheetSummaries([]);
    setIssues([]);

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setIssues([
        {
          row: 0,
          message:
            "Sélectionnez directement le classeur .xlsx exporté par Errebot.",
        },
      ]);
      return;
    }

    try {
      const parsed = await errebotAvailabilityWorkbookService.parse(
        file,
        context.slotDurationMinutes,
      );
      setItems(parsed.rows);
      setDeclarations(parsed.declarations);
      setSourceSlots(parsed.sourceSlots);
      setSheetSummaries(parsed.sheets);
      setIssues(parsed.issues);
      if (
        parsed.issues.length === 0 &&
        parsed.declarations.length > 0 &&
        parsed.sourceSlots.length > 0
      ) {
        await previewRows(parsed.rows, parsed.declarations, parsed.sourceSlots);
      }
    } catch {
      setItems([]);
      setDeclarations([]);
      setSourceSlots([]);
      setSheetSummaries([]);
      setIssues([
        {
          row: 0,
          message:
            "Impossible de lire ce classeur Excel. Vérifiez qu’il s’agit bien du fichier .xlsx exporté par Errebot.",
        },
      ]);
    }
  };

  const apply = async () => {
    if (
      !preview?.valid ||
      declarations.length === 0 ||
      sourceSlots.length === 0 ||
      !context
    ) {
      return;
    }
    if (
      context.knownTeamCount > 0 &&
      !window.confirm(
        "Pour les équipes présentes dans le classeur, les disponibilités de poules déjà importées seront remplacées. Le planning actuel restera inchangé. Continuer ?",
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
        declarations,
        sourceSlots,
      );
      await loadContext();
      await onImported?.();
      setMessage(
        `${result.importedSlotCount} disponibilités de poules importées pour ${result.importedTeamCount} équipes à partir de ${result.sourceSlotCount} créneaux Errebot. Couverture : ${result.knownTeamCount}/${result.acceptedTeamCount} équipes.${
          result.coverageComplete
            ? " Les échanges peuvent maintenant être proposés pendant les poules."
            : " Les échanges restent désactivés tant que toutes les équipes ne sont pas couvertes."
        }`,
      );
      setItems([]);
      setDeclarations([]);
      setSourceSlots([]);
      setSheetSummaries([]);
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
          <h2>Disponibilités des équipes — poules</h2>
          <p>
            Déposez directement le classeur Excel Errebot. Pelote Manager lit
            uniquement l’onglet des poules. L’onglet des phases finales est
            ignoré : les phases finales seront créées et gérées ensuite par
            Pelote Manager.
          </p>
        </div>
        <strong>
          {context.knownTeamCount}/{context.acceptedTeamCount} équipes
        </strong>
      </div>

      <p className="admin-errebot-availability__status" role="status">
        {context.coverageComplete
          ? "Toutes les équipes ont des disponibilités de poules connues. Les échanges peuvent être recherchés."
          : "Tant que toutes les équipes ne sont pas couvertes, les échanges restent désactivés et seuls les créneaux libres sont proposés."}
      </p>

      <div className="admin-errebot-availability__format">
        <strong>Format Errebot reconnu automatiquement</strong>
        <code>
          Série | ID équipe | Joueur1 | Joueur2 | 21/09/2026 17h30 (27367) | …
        </code>
        <span>
          Seul l’onglet dont le nom contient « Poule » est exploité. Les
          colonnes Joueur1/Joueur2 sont ignorées et ne sont jamais envoyées à
          Supabase. Les dates, heures et identifiants entre parenthèses servent
          à conserver la grille exacte Errebot.
        </span>
      </div>

      <label className="admin-errebot-availability__file">
        Classeur Excel Errebot (.xlsx)
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={checking || saving}
          onChange={(event) => void chooseFile(event)}
        />
      </label>

      {fileName && <p>Fichier sélectionné : {fileName}</p>}
      {checking && <p role="status">Lecture des poules et contrôle…</p>}

      {sheetSummaries.length > 0 && (
        <div className="admin-errebot-availability__preview">
          <strong>Onglet de poules reconnu</strong>
          <ul>
            {sheetSummaries.map((sheet) => (
              <li key={sheet.sheet}>
                {sheet.sheet} : {sheet.teamCount} équipes, {sheet.slotCount}{" "}
                disponibilités sur {sheet.sourceSlotCount} créneaux
              </li>
            ))}
          </ul>
        </div>
      )}

      {issues.length > 0 && (
        <div className="admin-errebot-availability__errors" role="alert">
          <strong>Le classeur doit être contrôlé.</strong>
          <ul>
            {issues.slice(0, 8).map((issue, index) => (
              <li key={`${issue.sheet ?? "file"}-${issue.row}-${index}`}>
                {issue.sheet ? `${issue.sheet} — ` : ""}
                {issue.row > 0 ? `ligne ${issue.row} : ` : ""}
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
            {preview.rowCount} disponibilités reconnues pour {preview.teamCount}{" "}
            équipes sur {preview.sourceSlotCount} créneaux de poules.
          </p>
          <p>
            Couverture après import : {preview.knownTeamCountAfter}/
            {preview.acceptedTeamCount} équipes.
          </p>
          {preview.errors.length > 0 && (
            <ul className="admin-errebot-availability__errors">
              {preview.errors.slice(0, 8).map((item, index) => (
                <li key={`${item.row}-${item.code}-${index}`}>
                  {item.row > 0 ? `Ligne ${item.row} : ` : ""}
                  {item.message}
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
                : `Importer ${preview.rowCount} disponibilités`}
            </button>
          )}
        </div>
      )}

      {error && (
        <p
          className="admin-tournament-teams__alert admin-tournament-teams__alert--error"
          role="alert"
        >
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
