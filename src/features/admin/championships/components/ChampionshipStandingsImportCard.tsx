import { useEffect, useState } from "react";
import { parseChampionshipStandingsClipboard } from "../domain/championshipStandingsClipboard";
import {
  buildChampionshipStandingsImportPayload,
  type ChampionshipStandingsImportPayload,
  type ChampionshipStandingsPreviewFile,
} from "../domain/championshipStandingsImport";
import { championshipImportService } from "../services/championshipImportService";
import { championshipSourceFileService } from "../services/championshipSourceFileService";
import {
  championshipStandingsService,
  type ChampionshipStandingsServerPreview,
} from "../services/championshipStandingsService";

type ChampionshipDivisionOption = {
  id: string;
  name: string;
};

type Props = {
  championshipId: string;
  divisions?: ChampionshipDivisionOption[];
  sourceUrl?: string | null;
  onApplied?: () => Promise<void>;
};

export function ChampionshipStandingsImportCard({
  championshipId,
  divisions = [],
  sourceUrl = null,
  onApplied,
}: Props) {
  const [sourceText, setSourceText] = useState("");
  const [divisionOptions, setDivisionOptions] =
    useState<ChampionshipDivisionOption[]>(divisions);
  const [effectiveSourceUrl, setEffectiveSourceUrl] =
    useState<string | null>(sourceUrl);
  const [selectedDivisionId, setSelectedDivisionId] = useState("");
  const [sourcePreview, setSourcePreview] =
    useState<ChampionshipStandingsPreviewFile | null>(null);
  const [payload, setPayload] =
    useState<ChampionshipStandingsImportPayload | null>(null);
  const [preview, setPreview] =
    useState<ChampionshipStandingsServerPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (divisions.length > 0) {
      setDivisionOptions(divisions);
      setEffectiveSourceUrl(sourceUrl);
      return;
    }

    let active = true;
    void championshipImportService
      .detail(championshipId)
      .then((detail) => {
        if (!active) return;
        setDivisionOptions(
          detail.divisions.map((division) => ({
            id: division.id,
            name: division.name,
          })),
        );
        setEffectiveSourceUrl(detail.sourceUrl);
      })
      .catch(() => {
        if (active) {
          setError(
            "Impossible de charger la liste des séries du championnat.",
          );
        }
      });

    return () => {
      active = false;
    };
  }, [championshipId, divisions, sourceUrl]);

  useEffect(() => {
    if (divisionOptions.length === 1) {
      setSelectedDivisionId(divisionOptions[0].id);
    }
  }, [divisionOptions]);

  const resetPreview = () => {
    setSourcePreview(null);
    setPayload(null);
    setPreview(null);
    setError("");
    setMessage("");
  };

  const pasteFromClipboard = async () => {
    try {
      const value = await navigator.clipboard.readText();
      setSourceText(value);
      resetPreview();
    } catch {
      setError(
        "Le navigateur n’autorise pas la lecture du presse-papiers. Collez simplement le classement dans la zone ci-dessous avec Ctrl+V.",
      );
    }
  };

  const analyse = async () => {
    if (!sourceText.trim()) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const fallbackDivision =
        divisionOptions.find(
          (division) => division.id === selectedDivisionId,
        )?.name ?? "";
      const parsed = parseChampionshipStandingsClipboard(
        sourceText,
        fallbackDivision,
      );
      setSourcePreview(parsed);
      if (!parsed.valid) return;

      const snapshot = new File([sourceText], "classement-page-federale.txt", {
        type: "text/plain;charset=utf-8",
      });
      const descriptor = await championshipSourceFileService.describeStandings(
        snapshot,
        parsed.standings.length,
        effectiveSourceUrl,
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
      setSourcePreview(null);
      await onApplied?.();
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
          Le site fédéral n’exporte pas le classement. Copiez la page (ou une
          poule complète) puis collez-la ici. Si la copie commence directement
          à « Poule 1 », choisissez simplement la série concernée ci-dessous.
          Aucun classement n’est recalculé ici.
        </p>
      </div>

      <div className="admin-championships__update-controls">
        {divisionOptions.length > 1 && (
          <label>
            Série du classement copié
            <select
              value={selectedDivisionId}
              onChange={(event) => {
                setSelectedDivisionId(event.target.value);
                resetPreview();
              }}
              disabled={busy}
            >
              <option value="">Détection automatique si le titre est copié</option>
              {divisionOptions.map((division) => (
                <option key={division.id} value={division.id}>
                  {division.name}
                </option>
              ))}
            </select>
            <span>
              Utile uniquement si votre copie ne contient pas le nom de la
              série.
            </span>
          </label>
        )}

        <label>
          Classement copié depuis la page fédérale
          <textarea
            rows={10}
            value={sourceText}
            onChange={(event) => {
              setSourceText(event.target.value);
              resetPreview();
            }}
            placeholder="Collez ici le classement affiché sur le site de la fédération…"
            disabled={busy}
          />
          <span>
            Le numéro d’équipe peut être sur la ligne suivante : Pelote Manager
            le reconnaît désormais automatiquement.
          </span>
        </label>
        <button
          type="button"
          onClick={() => void pasteFromClipboard()}
          disabled={busy}
        >
          Coller depuis le presse-papiers
        </button>
        <button
          type="button"
          onClick={() => void analyse()}
          disabled={!sourceText.trim() || busy}
        >
          {busy ? "Analyse en cours…" : "Comparer le classement"}
        </button>
      </div>

      {sourcePreview && !sourcePreview.valid && (
        <div className="admin-championships__update-issues" role="alert">
          <strong>Le classement copié ne peut pas encore être utilisé.</strong>
          {sourcePreview.issues.map((issue, index) => (
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
              Ce classement a déjà été appliqué.
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
