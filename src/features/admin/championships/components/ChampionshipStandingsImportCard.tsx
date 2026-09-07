import { useState } from "react";
import {
  buildChampionshipStandingsImportPayload,
  type ChampionshipGeneralStandingImportRow,
  type ChampionshipStandingImportRow,
  type ChampionshipStandingsImportPayload,
  type ChampionshipStandingsPreviewFile,
} from "../domain/championshipStandingsImport";
import { championshipSourceFileService } from "../services/championshipSourceFileService";
import {
  championshipStandingsService,
  type ChampionshipStandingsServerPreview,
} from "../services/championshipStandingsService";
import "./ChampionshipStandingsImportCard.css";

type ChampionshipDivisionOption = {
  id: string;
  name: string;
};

type PoolSourceReadResponse = {
  standings?: ChampionshipStandingImportRow[];
  warnings?: string[];
  summary?: {
    divisionCount?: number;
    poolCount?: number;
    teamCount?: number;
  };
  error?: string;
};

type GeneralSourceReadResponse = {
  generalStandings?: ChampionshipGeneralStandingImportRow[];
  warnings?: string[];
  summary?: {
    divisionCount?: number;
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
    generalTeamCount: number;
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
      const requestBody = JSON.stringify({
        sourceUrl,
        divisions: divisions.map((division) => ({ name: division.name })),
      });
      const [poolResponse, generalResponse] = await Promise.all([
        fetch("/api/championship-standings-source", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestBody,
        }),
        fetch("/api/championship-general-standings-source", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestBody,
        }),
      ]);

      const poolData = (await poolResponse.json()) as PoolSourceReadResponse;
      const generalData =
        (await generalResponse.json()) as GeneralSourceReadResponse;

      if (!poolResponse.ok) {
        throw new Error(
          poolData.error ??
            "Impossible de lire les classements de poule sur le site fédéral.",
        );
      }
      if (!generalResponse.ok) {
        throw new Error(
          generalData.error ??
            "Impossible de lire le classement général sur le site fédéral.",
        );
      }

      const standings = Array.isArray(poolData.standings)
        ? poolData.standings
        : [];
      const generalStandings = Array.isArray(generalData.generalStandings)
        ? generalData.generalStandings
        : [];
      if (standings.length === 0 || generalStandings.length === 0) {
        throw new Error(
          "La fédération n’a pas renvoyé tous les classements attendus.",
        );
      }

      const sourcePreview: ChampionshipStandingsPreviewFile = {
        standings,
        issues: [],
        valid: true,
      };
      const snapshot = new File(
        [JSON.stringify({ standings, generalStandings })],
        "classements-federation.json",
        { type: "application/json" },
      );
      const descriptor = await championshipSourceFileService.describeStandings(
        snapshot,
        standings.length + generalStandings.length,
        sourceUrl,
      );
      const nextPayload = buildChampionshipStandingsImportPayload(
        sourcePreview,
        descriptor,
      );
      nextPayload.generalStandings = generalStandings;
      const nextPreview = await championshipStandingsService.previewRankings(
        championshipId,
        nextPayload,
      );

      setSourceSummary({
        divisionCount: Number(poolData.summary?.divisionCount ?? 0),
        poolCount: Number(poolData.summary?.poolCount ?? 0),
        teamCount: Number(poolData.summary?.teamCount ?? standings.length),
        generalTeamCount: Number(
          generalData.summary?.teamCount ?? generalStandings.length,
        ),
      });
      setWarnings([
        ...(Array.isArray(poolData.warnings) ? poolData.warnings : []),
        ...(Array.isArray(generalData.warnings) ? generalData.warnings : []),
      ]);
      setPayload(nextPayload);
      setPreview(nextPreview);
    } catch (cause) {
      setSourceSummary(null);
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible de lire les classements officiels.",
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
      const result = await championshipStandingsService.applyRankings(
        championshipId,
        payload,
      );
      setMessage(
        result.alreadyImported
          ? "Les classements officiels sont déjà à jour."
          : `Classements officiels mis à jour : ${result.summary.newCount} ligne(s) de poule et ${result.generalSummary.newCount} ligne(s) générales importée(s).`,
      );
      setPreview(null);
      setPayload(null);
      await onApplied?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’appliquer les classements officiels.",
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
          <p className="admin-page__eyebrow">Classements officiels</p>
          <h2>Actualiser depuis la fédération</h2>
          <p>
            Pelote Manager lit les classements de toutes les poules et le
            classement général officiel à l’issue des poules avant la moindre
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
          {busy
            ? "Lecture de la fédération…"
            : "Lire les classements officiels"}
        </button>
        <span>
          {divisions.length} série(s) connue(s) · poules + classement général
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
            <span>équipes en poules</span>
          </div>
          <div>
            <strong>{sourceSummary.generalTeamCount}</strong>
            <span>équipes au général</span>
          </div>
          {preview && (
            <div>
              <strong>
                {preview.summary.changedCount +
                  preview.generalSummary.changedCount}
              </strong>
              <span>modifications</span>
            </div>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="admin-championships__standings-warning">
          <strong>Information de lecture</strong>
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
            <h3>Changements de poule détectés</h3>
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
          Ces classements officiels ont déjà été appliqués.
        </p>
      )}

      {preview && preview.valid && !preview.alreadyImported && (
        <button
          type="button"
          className="admin-championships__apply admin-championships__standings-apply"
          onClick={() => void apply()}
          disabled={busy}
        >
          {busy ? "Mise à jour…" : "Appliquer les classements officiels"}
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
