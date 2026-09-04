import { useState, type ChangeEvent } from "react";
import type { ChampionshipImportPreview } from "@/features/admin/championships/domain/championshipSourceImport";
import { championshipSourceFileService } from "@/features/admin/championships/services/championshipSourceFileService";
import "./AdminChampionshipImportPage.css";

type SourceFiles = {
  matches: File | null;
  engagements: File | null;
};

const issueSourceLabel = {
  matches: "Parties",
  engagements: "Engagements",
  cross: "Contrôle croisé",
} as const;

export function AdminChampionshipImportPage() {
  const [files, setFiles] = useState<SourceFiles>({
    matches: null,
    engagements: null,
  });
  const [preview, setPreview] = useState<ChampionshipImportPreview | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectFile =
    (kind: keyof SourceFiles) => (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      setFiles((current) => ({ ...current, [kind]: file }));
      setPreview(null);
      setError("");
    };

  const analyse = async () => {
    if (!files.matches || !files.engagements) return;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      setPreview(
        await championshipSourceFileService.parse(
          files.matches,
          files.engagements,
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible de lire les fichiers du championnat.",
      );
    } finally {
      setBusy(false);
    }
  };

  const blockingIssues =
    preview?.issues.filter((issue) => issue.severity === "error") ?? [];
  const warnings =
    preview?.issues.filter((issue) => issue.severity === "warning") ?? [];

  return (
    <section className="admin-page admin-championship-import">
      <header className="admin-page__header">
        <div>
          <p className="admin-page__eyebrow">Championnats · Import</p>
          <h1>Importer un championnat officiel</h1>
          <p className="admin-page__lead">
            Chargez le fichier des parties et le fichier des engagements. Pelote
            Manager les croise localement avant toute écriture en base.
          </p>
        </div>
      </header>

      {error && (
        <p className="admin-championship-import__alert" role="alert">
          {error}
        </p>
      )}

      <div className="admin-card admin-championship-import__files">
        <div>
          <h2>1. Choisir les deux sources</h2>
          <p>
            Les coordonnées de responsable éventuellement présentes dans les
            engagements ne servent jamais à identifier un joueur.
          </p>
        </div>
        <div className="admin-championship-import__file-grid">
          <label>
            Parties (.xlsx)
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              onChange={selectFile("matches")}
            />
            <span>{files.matches?.name ?? "Aucun fichier sélectionné"}</span>
          </label>
          <label>
            Engagements (.csv)
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={selectFile("engagements")}
            />
            <span>
              {files.engagements?.name ?? "Aucun fichier sélectionné"}
            </span>
          </label>
        </div>
        <button
          type="button"
          className="admin-championship-import__primary"
          disabled={busy || !files.matches || !files.engagements}
          onClick={() => void analyse()}
        >
          {busy ? "Analyse en cours…" : "Analyser et croiser les fichiers"}
        </button>
      </div>

      {preview && (
        <>
          <div className="admin-card admin-championship-import__identity">
            <div>
              <span>Compétition détectée</span>
              <strong>{preview.competition ?? "Non reconnue"}</strong>
            </div>
            <div>
              <span>Spécialité</span>
              <strong>{preview.specialty ?? "Non reconnue"}</strong>
            </div>
          </div>

          <div
            className="admin-championship-import__summary"
            aria-label="Résumé de l’import"
          >
            <div className="admin-card">
              <strong>{preview.divisions.length}</strong>
              <span>séries</span>
            </div>
            <div className="admin-card">
              <strong>{preview.poolCount}</strong>
              <span>poules</span>
            </div>
            <div className="admin-card">
              <strong>{preview.teamCount}</strong>
              <span>équipes</span>
            </div>
            <div className="admin-card">
              <strong>{preview.playerCount}</strong>
              <span>joueurs</span>
            </div>
            <div className="admin-card">
              <strong>{preview.matchCount}</strong>
              <span>parties</span>
            </div>
            <div className="admin-card">
              <strong>{preview.federationClubs.length}</strong>
              <span>clubs officiels</span>
            </div>
          </div>

          <div className="admin-card admin-championship-import__table-card">
            <div>
              <h2>2. Prévisualisation par série</h2>
              <p>
                Un même numéro d’équipe peut exister dans plusieurs séries sans
                créer de collision.
              </p>
            </div>
            <div className="admin-championship-import__table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Série</th>
                    <th>Poules</th>
                    <th>Équipes</th>
                    <th>Joueurs</th>
                    <th>Parties</th>
                    <th>Sans poule</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.divisions.map((division) => (
                    <tr key={division.name}>
                      <td>{division.name}</td>
                      <td>{division.poolCount}</td>
                      <td>{division.teamCount}</td>
                      <td>{division.playerCount}</td>
                      <td>{division.matchCount}</td>
                      <td>{division.teamsWithoutPool}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {(blockingIssues.length > 0 || warnings.length > 0) && (
            <div className="admin-card admin-championship-import__issues">
              <h2>3. Contrôles</h2>
              {blockingIssues.length > 0 && (
                <div className="admin-championship-import__issue-group admin-championship-import__issue-group--error">
                  <strong>
                    {blockingIssues.length} anomalie(s) bloquante(s)
                  </strong>
                  <ul>
                    {blockingIssues.slice(0, 20).map((issue, index) => (
                      <li key={`${issue.source}-${issue.row}-${index}`}>
                        {issueSourceLabel[issue.source]}
                        {issue.row > 0 ? ` · ligne ${issue.row}` : ""} :{" "}
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {warnings.length > 0 && (
                <div className="admin-championship-import__issue-group">
                  <strong>{warnings.length} avertissement(s)</strong>
                  <ul>
                    {warnings.slice(0, 20).map((issue, index) => (
                      <li key={`${issue.source}-${issue.row}-${index}`}>
                        {issueSourceLabel[issue.source]}
                        {issue.row > 0 ? ` · ligne ${issue.row}` : ""} :{" "}
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div
            className={`admin-card admin-championship-import__status ${
              preview.valid ? "is-valid" : "is-invalid"
            }`}
            role="status"
          >
            <strong>
              {preview.valid
                ? "Les deux fichiers sont cohérents."
                : "La validation est bloquée tant que les anomalies ne sont pas corrigées."}
            </strong>
            <span>
              L’étape suivante enregistrera le lot en une transaction après le
              choix explicite du club officiel correspondant au club Pelote
              Manager.
            </span>
          </div>
        </>
      )}
    </section>
  );
}
