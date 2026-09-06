import { useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import type { ChampionshipImportPreview } from "@/features/admin/championships/domain/championshipSourceImport";
import {
  buildChampionshipTransactionalImportPayload,
  type ChampionshipTransactionalImportResult,
} from "@/features/admin/championships/domain/championshipTransactionalImport";
import { championshipImportService } from "@/features/admin/championships/services/championshipImportService";
import { championshipSourceFileService } from "@/features/admin/championships/services/championshipSourceFileService";
import { ROUTES } from "@/shared/config";
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
  const [sourceUrl, setSourceUrl] = useState("");
  const [localFederationClubName, setLocalFederationClubName] = useState("");
  const [preview, setPreview] = useState<ChampionshipImportPreview | null>(null);
  const [result, setResult] =
    useState<ChampionshipTransactionalImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectFile =
    (kind: keyof SourceFiles) => (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      setFiles((current) => ({ ...current, [kind]: file }));
      setPreview(null);
      setResult(null);
      setLocalFederationClubName("");
      setError("");
    };

  const analyse = async () => {
    if (!files.matches || !files.engagements) return;
    setBusy(true);
    setError("");
    setPreview(null);
    setResult(null);
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

  const importChampionship = async () => {
    if (
      !preview ||
      !preview.valid ||
      !files.matches ||
      !files.engagements ||
      !localFederationClubName
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const descriptors = await championshipSourceFileService.describe(
        files.matches,
        files.engagements,
        preview,
      );
      const payload = buildChampionshipTransactionalImportPayload(preview, {
        sourceUrl,
        localFederationClubName,
        files: descriptors,
      });
      setResult(await championshipImportService.importSources(payload));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’enregistrer le championnat.",
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
            Chargez les fichiers officiels tels quels. Pelote Manager les croise,
            vérifie les équipes et les licences, puis enregistre le championnat
            complet en une transaction.
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
            Aucune préparation manuelle n’est demandée. Les coordonnées de
            responsable éventuellement présentes dans les engagements ne servent
            jamais à identifier un joueur.
          </p>
        </div>
        <label className="admin-championship-import__source-url">
          URL de la compétition officielle
          <input
            type="url"
            placeholder="https://lbpb.competition.ffpb.net?id_competition=…"
            value={sourceUrl}
            disabled={busy}
            onChange={(event) => setSourceUrl(event.target.value)}
          />
          <span>
            Facultatif pour le premier import, mais conseillé pour reconnaître la
            même compétition lors des futures mises à jour.
          </span>
        </label>
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
          {busy && !preview
            ? "Analyse en cours…"
            : "Analyser et croiser les fichiers"}
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
              Les numéros de licence servent au rattachement sportif. Aucun
              licencié d’un club adverse n’est créé comme membre de votre club.
            </span>
          </div>

          {preview.valid && (
            <div className="admin-card admin-championship-import__mapping">
              <div>
                <h2>4. Identifier votre club</h2>
                <p>
                  Cette confirmation rattache uniquement votre club Pelote
                  Manager à son nom officiel dans ce championnat.
                </p>
              </div>
              <label>
                Notre club dans les données officielles
                <select
                  value={localFederationClubName}
                  disabled={busy || Boolean(result)}
                  onChange={(event) =>
                    setLocalFederationClubName(event.target.value)
                  }
                >
                  <option value="">Choisir le club…</option>
                  {preview.federationClubs.map((club) => (
                    <option value={club} key={club}>
                      {club}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="admin-championship-import__primary"
                disabled={busy || !localFederationClubName || Boolean(result)}
                onClick={() => void importChampionship()}
              >
                {busy ? "Enregistrement en cours…" : "Valider l’import complet"}
              </button>
            </div>
          )}

          {result && (
            <div className="admin-card admin-championship-import__success" role="status">
              <h2>
                {result.alreadyImported
                  ? "Ces fichiers avaient déjà été importés."
                  : "Championnat importé avec succès."}
              </h2>
              <p>
                {result.summary.divisionCount} séries · {result.summary.teamCount}{" "}
                équipes · {result.summary.playerCount} joueurs · {result.summary.matchCount}{" "}
                parties. {result.summary.linkedPlayerCount} joueur(s) sont déjà
                rattachés à un compte Pelote Manager.
              </p>
              <Link to={ROUTES.adminChampionships}>
                Ouvrir la gestion des championnats
              </Link>
            </div>
          )}
        </>
      )}
    </section>
  );
}
