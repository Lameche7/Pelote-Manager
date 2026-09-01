import { useEffect, useState, type ChangeEvent } from "react";
import type {
  ErrebotAvailabilityDeclaration,
  ErrebotAvailabilityImportIssue,
  ErrebotAvailabilityImportRow,
  ErrebotAvailabilitySheetSummary,
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

const phaseLabel = (phase: "pools" | "finals") =>
  phase === "pools" ? "Poules" : "Phases finales";

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
    setItems([]);
    setDeclarations([]);
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
        context.finalsRequired,
      );
      setItems(parsed.rows);
      setDeclarations(parsed.declarations);
      setSheetSummaries(parsed.sheets);
      setIssues(parsed.issues);
      if (parsed.issues.length === 0 && parsed.declarations.length > 0) {
        await previewRows(parsed.rows, parsed.declarations);
      }
    } catch {
      setItems([]);
      setDeclarations([]);
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
    if (!preview?.valid || declarations.length === 0 || !context) return;
    if (
      (context.poolsKnownTeamCount > 0 || context.finalsKnownTeamCount > 0) &&
      !window.confirm(
        "Pour les équipes présentes dans le classeur, les disponibilités de chaque phase importée seront remplacées. Le planning actuel restera inchangé. Continuer ?",
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
      );
      await loadContext();
      await onImported?.();
      const finalsStatus = context.finalsRequired
        ? ` Phases finales : ${result.finalsKnownTeamCount}/${result.acceptedTeamCount}.`
        : "";
      setMessage(
        `${result.importedSlotCount} créneaux importés pour ${result.importedTeamCount} équipes. Poules : ${result.poolsKnownTeamCount}/${result.acceptedTeamCount}.${finalsStatus}${
          result.coverageComplete
            ? " Les disponibilités nécessaires sont maintenant complètes."
            : " Les échanges restent protégés pour toute phase encore incomplète."
        }`,
      );
      setItems([]);
      setDeclarations([]);
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
          <h2>Disponibilités des équipes</h2>
          <p>
            Déposez directement le classeur Excel Errebot. Pelote Manager lit
            séparément les onglets de poules et de phases finales sans modifier
            ni les matchs ni le planning publié.
          </p>
        </div>
        <strong>{context.acceptedTeamCount} équipes</strong>
      </div>

      <div className="admin-errebot-availability__status" role="status">
        <strong>
          Poules : {context.poolsKnownTeamCount}/{context.acceptedTeamCount}
        </strong>
        {context.finalsRequired && (
          <strong>
            Phases finales : {context.finalsKnownTeamCount}/
            {context.acceptedTeamCount}
          </strong>
        )}
        <span>
          Les échanges ne sont activés, pour une phase donnée, que lorsque les
          disponibilités de toutes les équipes y sont connues.
        </span>
      </div>

      <div className="admin-errebot-availability__format">
        <strong>Format Errebot reconnu automatiquement</strong>
        <code>
          Série | ID équipe | Joueur1 | Joueur2 | 21/09/2026 17h30 (27367) | …
        </code>
        <span>
          Les colonnes Joueur1/Joueur2 sont ignorées et ne sont jamais envoyées
          à Supabase. Une cellule non vide sous un créneau signifie que l’équipe
          est disponible ; une cellule vide signifie qu’elle ne l’est pas.
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
      {checking && <p role="status">Lecture des onglets et contrôle des créneaux…</p>}

      {sheetSummaries.length > 0 && (
        <div className="admin-errebot-availability__preview">
          <strong>Onglets reconnus</strong>
          <ul>
            {sheetSummaries.map((sheet) => (
              <li key={`${sheet.sheet}-${sheet.phase}`}>
                {sheet.sheet} — {phaseLabel(sheet.phase)} : {sheet.teamCount}{" "}
                équipes, {sheet.slotCount} disponibilités
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
            équipes.
          </p>
          <p>
            Poules après import : {preview.poolsKnownTeamCountAfter}/
            {preview.acceptedTeamCount} équipes.
            {context.finalsRequired && (
              <>
                {" "}Phases finales : {preview.finalsKnownTeamCountAfter}/
                {preview.acceptedTeamCount} équipes.
              </>
            )}
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
