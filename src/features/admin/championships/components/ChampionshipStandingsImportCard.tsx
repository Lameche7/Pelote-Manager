import { useState } from "react";
import {
  buildChampionshipStandingsImportPayload,
  type ChampionshipStandingImportRow,
  type ChampionshipStandingsImportPayload,
  type ChampionshipStandingsPreviewFile,
} from "../domain/championshipStandingsImport";
import { championshipSourceFileService } from "../services/championshipSourceFileService";
import {
  championshipStandingsService,
  type ChampionshipStandingsServerPreview,
} from "../services/championshipStandingsService";

type ChampionshipDivisionOption = {
  id: string;
  name: string;
};

type SourceReadResponse = {
  standings?: ChampionshipStandingImportRow[];
  warnings?: string[];
  summary?: {
    divisionCount?: number;
    poolCount?: number;
    teamCount?: number;
  };
  error?: string;
};

type Props = {
  championshipId: string;
  divisions: ChampionshipDivisionOption[];
  sourceUrl: string | null;
  onApplied?: () => Promise<void>;
};

const officialUrl = (value: string | null) => {
  if (!value) return null;
  return /^https?:\/\//iu.test(value) ? value : `https://${value}`;
};

export function ChampionshipStandingsImportCard({
  championshipId,
  divisions,
  sourceUrl,
  onApplied,
}: Props) {
  const [payload, setPayload] =
    useState<ChampionshipStandingsImportPayload | null>(null);
  const [preview, setPreview] =
    useState<ChampionshipStandingsServerPreview | null>(null);
  const [sourceSummary, setSourceSummary] = useState<{
    divisionCount: number;
    poolCount: number;
    teamCount: number;
  } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const readOfficialStandings = async () => {
    if (!sourceUrl || divisions.length === 0) return;
    setBusy(true);
    setError("");
    setMessage("");
    setWarnings([]);
    setPreview(null);
    setPayload(null);

    try {
      const response = await fetch("/api/championship-standings-source", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceUrl,
          divisions: divisions.map((division) => ({ name: division.name })),
        }),
      });
      const data = (await response.json()) as SourceReadResponse;
      if (!response.ok) {
        throw new Error(
          data.error ?? "Impossible de lire le classement sur le site fédéral.",
        );
      }

      const standings = Array.isArray(data.standings) ? data.standings : [];
      if (standings.length === 0) {
        throw new Error("La fédération n’a renvoyé aucune ligne de classement.");
      }

      const sourcePreview: ChampionshipStandingsPreviewFile = {
        standings,
        issues: [],
        valid: true,
      };
      const snapshot = new File(
        [JSON.stringify(standings)],
        "classement-federation.json",
        { type: "application/json" },
      );
      const descriptor = await championshipSourceFileService.describeStandings(
        snapshot,
        standings.length,
        sourceUrl,
      );
      const nextPayload = buildChampionshipStandingsImportPayload(
        sourcePreview,
        descriptor,
      );
      const nextPreview = await championshipStandingsService.preview(
        championshipId,
        nextPayload,
      );

      setSourceSummary({
        divisionCount: Number(data.summary?.divisionCount ?? 0),
        poolCount: Number(data.summary?.poolCount ?? 0),
        teamCount: Number(data.summary?.teamCount ?? standings.length),
      });
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setPayload(nextPayload);
      setPreview(nextPreview);
    } catch (cause) {
      setSourceSummary(null);
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible de lire le classement officiel.",
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
          ? "Le classement officiel est déjà à jour."
          : `Classement officiel mis à jour : ${result.summary.newCount} nouvelle(s) ligne(s), ${result.summary.changedCount} modification(s).`,
      );
      setPreview(null);
      setPayload(null);
      await onApplied?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’appliquer le classement officiel.",
      );
    } finally {
      setBusy(false);
    }
  };

  const sourceHref = officialUrl(sourceUrl);

  return (
    <div className="admin-card admin-championships__standings-reader">
      <div className="admin-championships__standings-reader-head">
        <div>
          <p className="admin-page__eyebrow">Classement officiel</p>
          <h2>Actualiser depuis la fédération</h2>
          <p>
            Pelote Manager lit directement la source officielle, parcourt les
            séries du championnat et compare toutes les poules avant la moindre
            écriture. Aucun classement n’est recalculé localement.
          </p>
        </div>
        {sourceHref && (
          <a href={sourceHref} target="_blank" rel="noreferrer">
            Ouvrir la source officielle
          </a>
        )}
      </div>

      <div className="admin-championships__standings-actions">
        <button
          type="button"
          className="admin-championships__primary"
          onClick={() => void readOfficialStandings()}
          disabled={!sourceUrl || divisions.length === 0 || busy}
        >
          {busy ? "Lecture de la fédération…" : "Lire le classement officiel"}
        </button>
        <span>
          {divisions.length} série(s) connue(s) · lecture de toutes les poules
          publiées
        </span>
      </div>

      {!sourceUrl && (
        <p className="admin-championships__standings-note">
          Aucune URL officielle n’est enregistrée pour ce championnat.
        </p>
      )}

      {sourceSummary && (
        <div className="admin-championships__standings-summary">
          <div>
            <strong>{sourceSummary.divisionCount}</strong>
            <span>séries lues</span>
          </div>
          <div>
            <strong>{sourceSummary.poolCount}</strong>
            <span>poules lues</span>
          </div>
          <div>
            <strong>{sourceSummary.teamCount}</strong>
            <span>équipes classées</span>
          </div>
          {preview && (
            <>
              <div>
                <strong>{preview.summary.changedCount}</strong>
                <span>modifications</span>
              </div>
              <div>
                <strong>{preview.summary.newCount}</strong>
                <span>nouvelles lignes</span>
              </div>
            </>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="admin-championships__standings-warning">
          <strong>Lecture partielle</strong>
          <p>{warnings.join(" · ")}</p>
        </div>
      )}

      {preview && preview.issues.length > 0 && (
        <div className="admin-championships__standings-warning">
          {preview.issues.map((issue, index) => (
            <p key={`${issue.code}-${index}`}>{issue.message}</p>
          ))}
        </div>
      )}

      {preview && preview.changes.length > 0 && (
        <div className="admin-championships__standings-changes">
          <div>
            <h3>Changements détectés</h3>
            <span>{preview.changes.length} ligne(s) concernée(s)</span>
          </div>
          {preview.changes.slice(0, 30).map((change, index) => (
            <div key={`${change.teamLabel}-${index}`}>
              <strong>
                Poule {change.poolCode} · {change.teamLabel}
              </strong>
              <span>
                {change.kind === "new"
                  ? `nouveau rang ${change.rank}`
                  : `rang ${change.previousRank ?? "—"} → ${change.rank}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {preview?.alreadyImported && (
        <p className="admin-championships__success">
          Ce classement officiel a déjà été appliqué.
        </p>
      )}

      {preview && preview.valid && !preview.alreadyImported && (
        <button
          type="button"
          className="admin-championships__apply admin-championships__standings-apply"
          onClick={() => void apply()}
          disabled={busy}
        >
          {busy ? "Mise à jour…" : "Appliquer le classement officiel"}
        </button>
      )}

      {error && (
        <p className="admin-championships__standings-error" role="alert">
          {error}
        </p>
      )}
      {message && <p className="admin-championships__success">{message}</p>}
    </div>
  );
}
