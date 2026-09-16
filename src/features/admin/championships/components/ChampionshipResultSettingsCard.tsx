import { useEffect, useState } from "react";
import { ChampionshipStandingsImportCard } from "@/features/admin/championships/components/ChampionshipStandingsImportCard";
import { championshipImportService } from "@/features/admin/championships/services/championshipImportService";
import { championshipLifecycleService } from "@/features/admin/championships/services/championshipLifecycleService";
import {
  championshipResultSettingsService,
  type ChampionshipResultInputMode,
} from "@/features/admin/championships/services/championshipResultSettingsService";

type Props = {
  championshipId: string;
};

const labelForWinningScore = (mode: ChampionshipResultInputMode) =>
  mode === "sets" ? "Manches à gagner" : "Score à atteindre";

const hintForWinningScore = (mode: ChampionshipResultInputMode) =>
  mode === "sets"
    ? "Ex. 2 pour une partie gagnée en 2 manches."
    : "Ex. 35 ou 40 selon le championnat.";

export function ChampionshipResultSettingsCard({ championshipId }: Props) {
  const [mode, setMode] = useState<ChampionshipResultInputMode>("points");
  const [winningScore, setWinningScore] = useState("35");
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [divisions, setDivisions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [championshipName, setChampionshipName] = useState("");
  const [championshipStatus, setChampionshipStatus] = useState("");
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessage("");
    setError("");
    setArchiveError("");

    void Promise.all([
      championshipResultSettingsService.get(championshipId),
      championshipImportService.detail(championshipId),
    ])
      .then(([settings, detail]) => {
        if (!active) return;
        if (settings.inputMode && settings.winningScore !== null) {
          setMode(settings.inputMode);
          setWinningScore(String(settings.winningScore));
          setConfigured(true);
        } else {
          setMode("points");
          setWinningScore("35");
          setConfigured(false);
        }
        setSourceUrl(detail.sourceUrl);
        setChampionshipName(detail.name);
        setChampionshipStatus(detail.status);
        setDivisions(
          detail.divisions.map((division) => ({
            id: division.id,
            name: division.name,
          })),
        );
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Impossible de charger le paramétrage du championnat.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [championshipId]);

  const save = async () => {
    const value = Number(winningScore);
    if (!Number.isInteger(value) || value < 1 || value > 999) {
      setError("Saisissez une valeur entière comprise entre 1 et 999.");
      return;
    }
    if (mode === "sets" && value > 20) {
      setError(
        "Le nombre de manches à gagner doit être compris entre 1 et 20.",
      );
      return;
    }

    setSaving(true);
    setMessage("");
    setError("");
    try {
      const settings = await championshipResultSettingsService.update(
        championshipId,
        mode,
        value,
      );
      setMode(settings.inputMode ?? mode);
      setWinningScore(String(settings.winningScore ?? value));
      setConfigured(true);
      setMessage("Format de saisie enregistré.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’enregistrer le format de résultat.",
      );
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (championshipStatus === "archived" || archiving) return;

    const confirmed = window.confirm(
      `Archiver « ${championshipName || "ce championnat"} » ?\n\nLes données resteront consultables, mais ses joueurs ne bénéficieront plus de l’accès réservé championnat.`,
    );
    if (!confirmed) return;

    setArchiving(true);
    setArchiveError("");
    try {
      await championshipLifecycleService.archive(championshipId);
      setChampionshipStatus("archived");
      window.location.reload();
    } catch (cause) {
      setArchiveError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’archiver le championnat.",
      );
      setArchiving(false);
    }
  };

  return (
    <>
      <div className="admin-card admin-championships__update admin-championships__result-settings">
        <div>
          <p className="admin-page__eyebrow">Saisie des résultats</p>
          <h2>Format attendu pour ce championnat</h2>
          <p>
            Pelote Manager n’essaie pas de deviner la règle à partir de la
            discipline. Choisissez simplement comment les joueurs devront saisir
            leur résultat.
          </p>
        </div>

        {loading ? (
          <p>Chargement du paramétrage…</p>
        ) : (
          <div className="admin-championships__update-controls">
            <label>
              Type de score
              <select
                value={mode}
                onChange={(event) => {
                  const nextMode = event.target
                    .value as ChampionshipResultInputMode;
                  setMode(nextMode);
                  if (!configured) {
                    setWinningScore(nextMode === "sets" ? "2" : "35");
                  }
                  setMessage("");
                  setError("");
                }}
                disabled={saving || championshipStatus === "archived"}
              >
                <option value="points">Score en points</option>
                <option value="sets">Score en manches</option>
              </select>
            </label>

            <label>
              {labelForWinningScore(mode)}
              <input
                type="number"
                min="1"
                max={mode === "sets" ? "20" : "999"}
                inputMode="numeric"
                value={winningScore}
                onChange={(event) => {
                  setWinningScore(event.target.value);
                  setMessage("");
                  setError("");
                }}
                disabled={saving || championshipStatus === "archived"}
              />
              <span>{hintForWinningScore(mode)}</span>
            </label>

            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || championshipStatus === "archived"}
            >
              {saving
                ? "Enregistrement…"
                : configured
                  ? "Enregistrer les modifications"
                  : "Activer cette saisie"}
            </button>
          </div>
        )}

        {!loading && !configured && !error && (
          <p className="admin-championships__result-settings-note">
            Tant que ce réglage n’est pas enregistré, les joueurs ne peuvent pas
            proposer de résultat pour ce championnat.
          </p>
        )}
        {message && <p className="admin-championships__success">{message}</p>}
        {error && (
          <p className="admin-championships__alert" role="alert">
            {error}
          </p>
        )}
      </div>

      {!loading && championshipStatus !== "archived" && (
        <div className="admin-card admin-championships__archive-card">
          <div>
            <p className="admin-page__eyebrow">Cycle de vie</p>
            <h2>Archiver ce championnat</h2>
            <p>
              L’archivage conserve les équipes, parties, résultats et historiques,
              mais retire immédiatement ce championnat des droits de réservation
              anticipée de ses joueurs.
            </p>
          </div>
          <button
            className="admin-championships__archive-button"
            type="button"
            onClick={() => void archive()}
            disabled={archiving}
          >
            {archiving ? "Archivage…" : "Archiver le championnat"}
          </button>
          {archiveError && (
            <p className="admin-championships__alert" role="alert">
              {archiveError}
            </p>
          )}
        </div>
      )}

      {!loading && (
        <ChampionshipStandingsImportCard
          championshipId={championshipId}
          sourceUrl={sourceUrl}
          divisions={divisions}
        />
      )}
    </>
  );
}
