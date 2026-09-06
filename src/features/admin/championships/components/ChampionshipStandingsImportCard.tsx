import { useState, type ChangeEvent } from "react";
import {
  buildChampionshipStandingsImportPayload,
  type ChampionshipStandingsImportPayload,
  type ChampionshipStandingsPreviewFile,
} from "../domain/championshipStandingsImport";
import { championshipSourceFileService } from "../services/championshipSourceFileService";
import {
  championshipStandingsService,
  type ChampionshipStandingsServerPreview,
} from "../services/championshipStandingsService";

type Props = {
  championshipId: string;
  sourceUrl: string | null;
  onApplied: () => Promise<void>;
};

export function ChampionshipStandingsImportCard({
  championshipId,
  sourceUrl,
  onApplied,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] =
    useState<ChampionshipStandingsPreviewFile | null>(null);
  const [payload, setPayload] =
    useState<ChampionshipStandingsImportPayload | null>(null);
  const [preview, setPreview] =
    useState<ChampionshipStandingsServerPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
    setFilePreview(null);
    setPayload(null);
    setPreview(null);
    setError("");
    setMessage("");
  };

  const analyse = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const parsed = await championshipSourceFileService.parseStandings(file);
      setFilePreview(parsed);
      if (!parsed.valid) return;
      const descriptor = await championshipSourceFileService.describeStandings(
        file,
        parsed.standings.length,
        sourceUrl,
      );
      const nextPayload = buildChampionshipStandingsImportPayload(
        parsed,
        descriptor,
      );
      setPayload(nextPayload);
      setPreview(
        await championshipStandingsService.preview(
          championshipId,
          nextPayload,
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’analyser le classement officiel.",
      );
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!payload || !preview?.valid) return;
    setBusy(true);
    setError("");
    try {
      const result = await championshipStandingsService.apply(
        championshipId,
        payload,
      );
      setMessage(
        result.alreadyImported
          ? "Ce classement avait déjà été importé : aucune donnée n’a été dupliquée."
          : `Classement officiel importé : ${result.summary.newCount} nouvelle(s) ligne(s), ${result.summary.changedCount} mise(s) à jour.`,
      );
      setPreview(null);
      setPayload(null);
      setFilePreview(null);
      setFile(null);
      await onApplied();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’importer le classement officiel.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-card admin-championships__update">
      <div>
        <p className="admin-page__eyebrow">Classement officiel</p>
        <h2>Importer / actualiser le classement</h2>
        <p>
          Chargez l’export officiel en .xlsx ou .csv. Pelote Manager rapproche
          la série, la poule et l’équipe puis affiche les changements avant
          écriture. Aucun classement n’est recalculé ici.
        </p>
      </div>

      <div className="admin-championships__update-controls">
        <label>
          Fichier de classement (.xlsx ou .csv)
          <input
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={selectFile}
            disabled={busy}
          />
          <span>{file?.name ?? "Aucun classement sélectionné"}</span>
        </label>
        <button type="button" onClick={() => void analyse()} disabled={!file || busy}>
          {busy ? "Analyse en cours…" : "Comparer le classement"}
        </button>
      </div>

      {filePreview && !filePreview.valid && (
        <div className="admin-championships__update-issues" role="alert">
          <strong>Le fichier ne peut pas encore être utilisé.</strong>
          {filePreview.issues.map((issue, index) => (
            <p key={`${issue.row}-${index}`}>{issue.message}</p>
          ))}
        </div>
      )}

      {preview && (
        <div className="admin-championships__diff">
          <div className="admin-championships__diff-kpis">
            <div>
              <strong>{preview.summary.incomingCount}</strong>
              <span>lignes officielles</span>
            </div>
            <div>
              <strong>{preview.summary.poolCount}</strong>
              <span>poules</span>
            </div>
            <div>
              <strong>{preview.summary.newCount}</strong>
              <span>nouvelles</span>
            </div>
            <div>
              <strong>{preview.summary.changedCount}</strong>
              <span>modifiées</span>
            </div>
            <div>
              <strong>{preview.summary.unchangedCount}</strong>
              <span>inchangées</span>
            </div>
          </div>

          {preview.alreadyImported && (
            <p className="admin-championships__success">
              Ce fichier a déjà été appliqué.
            </p>
          )}

          {preview.issues.length > 0 && (
            <div className="admin-championships__update-issues">
              {preview.issues.map((issue, index) => (
                <p key={`${issue.code}-${index}`}>{issue.message}</p>
              ))}
            </div>
          )}

          {preview.changes.length > 0 && (
            <div className="admin-championships__change-list">
              <h3>Détail des changements</h3>
              {preview.changes.slice(0, 100).map((change, index) => (
                <div key={`${change.teamLabel}-${index}`}>
                  <strong>
                    Poule {change.poolCode} · {change.teamLabel}
                  </strong>
                  <span>
                    {change.kind === "new"
                      ? `rang ${change.rank}`
                      : `rang ${change.previousRank ?? "—"} → ${change.rank}`}
                  </span>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            className="admin-championships__primary"
            onClick={() => void apply()}
            disabled={!preview.valid || preview.alreadyImported || busy}
          >
            {busy ? "Import en cours…" : "Appliquer le classement officiel"}
          </button>
        </div>
      )}

      {error && <p className="admin-championships__alert">{error}</p>}
      {message && <p className="admin-championships__success">{message}</p>}
    </div>
  );
}
