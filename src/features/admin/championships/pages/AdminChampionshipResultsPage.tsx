import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  adminChampionshipDayResultsService,
  type AdminChampionshipDayResult,
} from "@/features/admin/championships/services/adminChampionshipDayResultsService";
import {
  buildChampionshipMatchesUpdatePayload,
  type ChampionshipMatchesUpdatePayload,
} from "@/features/admin/championships/domain/championshipMatchesUpdate";
import {
  championshipImportService,
  type AdminChampionshipSummary,
  type ChampionshipUpdatePreview,
} from "@/features/admin/championships/services/championshipImportService";
import {
  championshipResultSettingsService,
  type ChampionshipResultSettings,
} from "@/features/admin/championships/services/championshipResultSettingsService";
import { championshipSourceFileService } from "@/features/admin/championships/services/championshipSourceFileService";
import "./AdminChampionshipResultsPage.css";

const formatDate = (value: string | null) => {
  if (!value) return "Date non renseignée";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
};

const formatShortDate = (value: string) => {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
};

const formatTime = (value: string | null) =>
  value ? value.slice(0, 5).replace(":", "h") : null;

const hasOfficialResult = (match: AdminChampionshipDayResult) =>
  match.officialScoreTeam1 !== null && match.officialScoreTeam2 !== null;

const hasPlayerProposal = (match: AdminChampionshipDayResult) =>
  match.proposalStatus !== "withdrawn" &&
  match.proposedScoreTeam1 !== null &&
  match.proposedScoreTeam2 !== null;

const matchDays = (matches: AdminChampionshipDayResult[]) =>
  Array.from(
    new Set(
      matches
        .map((match) => match.dayOn)
        .filter((day): day is string => Boolean(day)),
    ),
  ).sort((a, b) => a.localeCompare(b));

const defaultDay = (days: string[]) => {
  if (days.length === 0) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pastOrToday = days
    .filter((day) => new Date(`${day}T00:00:00`).getTime() <= today.getTime())
    .sort((a, b) => b.localeCompare(a));
  return pastOrToday[0] ?? [...days].sort((a, b) => a.localeCompare(b))[0];
};

const matchHasStarted = (match: AdminChampionshipDayResult) => {
  if (!match.actualOn) return true;
  const time = match.actualTime?.slice(0, 8) ?? "00:00:00";
  const startsAt = new Date(`${match.actualOn.slice(0, 10)}T${time}`);
  return Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now();
};

type ResultEditorProps = {
  match: AdminChampionshipDayResult;
  settings: ChampionshipResultSettings | null;
  isEditing: boolean;
  onCancel: () => void;
  onSaved: () => Promise<void>;
};

function ResultEditor({
  match,
  settings,
  isEditing,
  onCancel,
  onSaved,
}: ResultEditorProps) {
  const [scoreTeam1, setScoreTeam1] = useState(
    match.proposedScoreTeam1 === null ? "" : String(match.proposedScoreTeam1),
  );
  const [scoreTeam2, setScoreTeam2] = useState(
    match.proposedScoreTeam2 === null ? "" : String(match.proposedScoreTeam2),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    const first = Number(scoreTeam1);
    const second = Number(scoreTeam2);
    const winningScore = settings?.winningScore ?? null;

    if (
      !Number.isInteger(first) ||
      !Number.isInteger(second) ||
      first < 0 ||
      second < 0
    ) {
      setError("Saisissez deux scores entiers positifs.");
      return;
    }
    if (first === second) {
      setError("Une partie de pelote ne peut pas se terminer sur une égalité.");
      return;
    }
    if (
      winningScore !== null &&
      (Math.max(first, second) !== winningScore ||
        Math.min(first, second) >= winningScore)
    ) {
      setError(`Le vainqueur doit atteindre ${winningScore}.`);
      return;
    }

    setSaving(true);
    setError("");
    try {
      await adminChampionshipDayResultsService.submit(
        match.matchId,
        first,
        second,
      );
      await onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’enregistrer ce résultat.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-championship-results__editor">
      <p>
        {isEditing ? "Modifier le résultat" : "Saisir le résultat"}
        {settings?.winningScore ? ` · ${settings.winningScore} à gagner` : ""}
      </p>
      <div className="admin-championship-results__score-inputs">
        <label>
          <span>{match.team1Label}</span>
          <input
            type="number"
            min="0"
            max="999"
            inputMode="numeric"
            value={scoreTeam1}
            onChange={(event) => setScoreTeam1(event.target.value)}
            disabled={saving}
            autoFocus
          />
        </label>
        <strong>—</strong>
        <label>
          <span>{match.team2Label}</span>
          <input
            type="number"
            min="0"
            max="999"
            inputMode="numeric"
            value={scoreTeam2}
            onChange={(event) => setScoreTeam2(event.target.value)}
            disabled={saving}
          />
        </label>
      </div>
      {error && <p className="admin-championship-results__error">{error}</p>}
      <div className="admin-championship-results__editor-actions">
        <button
          type="button"
          className="secondary"
          onClick={onCancel}
          disabled={saving}
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !scoreTeam1 || !scoreTeam2}
        >
          {saving
            ? "Enregistrement…"
            : isEditing
              ? "Enregistrer la modification"
              : "Enregistrer le résultat"}
        </button>
      </div>
    </div>
  );
}

export function AdminChampionshipResultsPage() {
  const [championships, setChampionships] = useState<AdminChampionshipSummary[]>(
    [],
  );
  const [championshipId, setChampionshipId] = useState("");
  const [matches, setMatches] = useState<AdminChampionshipDayResult[]>([]);
  const [settings, setSettings] = useState<ChampionshipResultSettings | null>(
    null,
  );
  const [selectedDay, setSelectedDay] = useState("");
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [loadingChampionships, setLoadingChampionships] = useState(true);
  const [loadingResults, setLoadingResults] = useState(false);
  const [error, setError] = useState("");

  const [officialUpdateOpen, setOfficialUpdateOpen] = useState(false);
  const [officialUpdateFile, setOfficialUpdateFile] = useState<File | null>(null);
  const [officialUpdatePayload, setOfficialUpdatePayload] =
    useState<ChampionshipMatchesUpdatePayload | null>(null);
  const [officialUpdatePreview, setOfficialUpdatePreview] =
    useState<ChampionshipUpdatePreview | null>(null);
  const [officialUpdateBusy, setOfficialUpdateBusy] = useState(false);
  const [officialUpdateError, setOfficialUpdateError] = useState("");
  const [officialUpdateMessage, setOfficialUpdateMessage] = useState("");

  const resetOfficialUpdate = () => {
    setOfficialUpdateFile(null);
    setOfficialUpdatePayload(null);
    setOfficialUpdatePreview(null);
    setOfficialUpdateError("");
    setOfficialUpdateMessage("");
  };

  useEffect(() => {
    let active = true;
    void championshipImportService
      .list()
      .then((items) => {
        if (!active) return;
        setChampionships(items);
        const preferred =
          items.find((item) => item.status === "active") ?? items[0];
        if (preferred) setChampionshipId(preferred.id);
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Impossible de charger les championnats.",
          );
        }
      })
      .finally(() => {
        if (active) setLoadingChampionships(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const loadResults = async (targetChampionshipId: string) => {
    const [nextMatches, nextSettings] = await Promise.all([
      adminChampionshipDayResultsService.list(targetChampionshipId),
      championshipResultSettingsService.get(targetChampionshipId),
    ]);
    setMatches(nextMatches);
    setSettings(nextSettings);
    return nextMatches;
  };

  useEffect(() => {
    resetOfficialUpdate();
    setOfficialUpdateOpen(false);
    if (!championshipId) {
      setMatches([]);
      setSettings(null);
      setSelectedDay("");
      return;
    }
    let active = true;
    setLoadingResults(true);
    setError("");
    setEditingMatchId(null);
    void loadResults(championshipId)
      .then((nextMatches) => {
        if (!active) return;
        setSelectedDay(defaultDay(matchDays(nextMatches)));
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Impossible de charger les résultats.",
          );
        }
      })
      .finally(() => {
        if (active) setLoadingResults(false);
      });
    return () => {
      active = false;
    };
  }, [championshipId]);

  const days = useMemo(() => matchDays(matches), [matches]);

  const divisions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; order: number }>();
    matches.forEach((match) => {
      if (!map.has(match.divisionId)) {
        map.set(match.divisionId, {
          id: match.divisionId,
          name: match.divisionName,
          order: match.divisionDisplayOrder,
        });
      }
    });
    return Array.from(map.values()).sort(
      (first, second) =>
        first.order - second.order ||
        first.name.localeCompare(second.name, "fr"),
    );
  }, [matches]);

  const matchesForDay = useMemo(
    () => matches.filter((match) => match.dayOn === selectedDay),
    [matches, selectedDay],
  );

  const refresh = async () => {
    if (!championshipId) return;
    const nextMatches = await loadResults(championshipId);
    setMatches(nextMatches);
    setEditingMatchId(null);
  };

  const selectOfficialUpdateFile = (event: ChangeEvent<HTMLInputElement>) => {
    setOfficialUpdateFile(event.target.files?.[0] ?? null);
    setOfficialUpdatePayload(null);
    setOfficialUpdatePreview(null);
    setOfficialUpdateError("");
    setOfficialUpdateMessage("");
  };

  const analyseOfficialUpdate = async () => {
    if (!championshipId || !officialUpdateFile) return;
    setOfficialUpdateBusy(true);
    setOfficialUpdateError("");
    setOfficialUpdateMessage("");
    setOfficialUpdatePreview(null);
    setOfficialUpdatePayload(null);
    try {
      const parsed =
        await championshipSourceFileService.parseMatchesUpdate(
          officialUpdateFile,
        );
      if (!parsed.valid) {
        const details = parsed.issues
          .filter((issue) => issue.severity === "error")
          .slice(0, 4)
          .map((issue) => issue.message)
          .join(" ");
        throw new Error(
          details || "Le fichier officiel ne peut pas être utilisé.",
        );
      }
      const descriptor =
        await championshipSourceFileService.describeMatchesUpdate(
          officialUpdateFile,
          parsed.matches.length,
        );
      const payload = buildChampionshipMatchesUpdatePayload(parsed, descriptor);
      const preview = await championshipImportService.previewMatchesUpdate(
        championshipId,
        payload,
      );
      setOfficialUpdatePayload(payload);
      setOfficialUpdatePreview(preview);
    } catch (cause) {
      setOfficialUpdateError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’analyser le fichier officiel.",
      );
    } finally {
      setOfficialUpdateBusy(false);
    }
  };

  const applyOfficialUpdate = async () => {
    if (
      !championshipId ||
      !officialUpdatePayload ||
      !officialUpdatePreview?.valid
    ) {
      return;
    }
    setOfficialUpdateBusy(true);
    setOfficialUpdateError("");
    try {
      const result = await championshipImportService.applyMatchesUpdate(
        championshipId,
        officialUpdatePayload,
      );
      const [nextMatches, nextChampionships] = await Promise.all([
        loadResults(championshipId),
        championshipImportService.list(),
      ]);
      setMatches(nextMatches);
      setChampionships(nextChampionships);
      setSelectedDay((current) =>
        current && nextMatches.some((match) => match.dayOn === current)
          ? current
          : defaultDay(matchDays(nextMatches)),
      );
      setEditingMatchId(null);
      setOfficialUpdateMessage(
        result.alreadyImported
          ? "Ce fichier officiel avait déjà été appliqué : aucune donnée n’a été dupliquée."
          : `Mise à jour officielle appliquée : ${result.summary.resultAddedCount} nouveau(x) résultat(s), ${result.summary.changedCount} rencontre(s) modifiée(s).`,
      );
      setOfficialUpdatePayload(null);
      setOfficialUpdatePreview(null);
      setOfficialUpdateFile(null);
    } catch (cause) {
      setOfficialUpdateError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’appliquer la mise à jour officielle.",
      );
    } finally {
      setOfficialUpdateBusy(false);
    }
  };

  const selectedChampionship =
    championships.find((item) => item.id === championshipId) ?? null;

  return (
    <section className="admin-page admin-championship-results">
      <header className="admin-page__header admin-championship-results__header">
        <div>
          <p className="admin-page__eyebrow">Championnats</p>
          <h1>Résultats Championnats</h1>
          <p className="admin-page__lead">
            Sélectionnez un championnat et une journée pour retrouver, série par
            série, toutes les parties du club et compléter les résultats
            manquants.
          </p>
        </div>
        <button
          type="button"
          className="admin-championship-results__official-trigger"
          disabled={!championshipId}
          onClick={() => {
            setOfficialUpdateOpen((current) => !current);
            setOfficialUpdateError("");
          }}
        >
          <span aria-hidden="true">↻</span>
          Actualiser depuis la source officielle
        </button>
      </header>

      {error && (
        <p className="admin-championship-results__alert" role="alert">
          {error}
        </p>
      )}

      <div className="admin-card admin-championship-results__filters">
        <label>
          <span>Championnat</span>
          <select
            value={championshipId}
            onChange={(event) => setChampionshipId(event.target.value)}
            disabled={loadingChampionships}
          >
            {championships.length === 0 && (
              <option value="">Aucun championnat</option>
            )}
            {championships.map((championship) => (
              <option key={championship.id} value={championship.id}>
                {championship.name} · {championship.specialty}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Journée</span>
          <select
            value={selectedDay}
            onChange={(event) => {
              setSelectedDay(event.target.value);
              setEditingMatchId(null);
            }}
            disabled={loadingResults || days.length === 0}
          >
            {days.length === 0 && <option value="">Aucune journée</option>}
            {days.map((day, index) => (
              <option key={day} value={day}>
                Journée {index + 1} · {formatShortDate(day)}
              </option>
            ))}
          </select>
        </label>

        <div className="admin-championship-results__selection-summary">
          <span>{selectedChampionship?.seasonLabel || "Saison"}</span>
          <strong>
            {selectedDay
              ? formatDate(selectedDay)
              : "Sélectionnez une journée"}
          </strong>
          <small>{matchesForDay.length} partie(s) du club</small>
        </div>
      </div>

      {officialUpdateOpen && selectedChampionship && (
        <section className="admin-card admin-championship-results__official-update">
          <div className="admin-championship-results__official-update-head">
            <div>
              <p className="admin-page__eyebrow">Source officielle</p>
              <h2>Actualiser les résultats officiels</h2>
              <p>
                Téléchargez le nouveau <strong>parties.xlsx</strong>, puis
                comparez-le avant d’appliquer les changements. Aucun résultat
                n’est modifié pendant l’analyse.
              </p>
            </div>
            {selectedChampionship.sourceUrl && (
              <a
                href={selectedChampionship.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="admin-championship-results__source-link"
              >
                Ouvrir la source officielle ↗
              </a>
            )}
          </div>

          <div className="admin-championship-results__official-controls">
            <label className="admin-championship-results__file-picker">
              <span>Nouveau fichier officiel parties.xlsx</span>
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={selectOfficialUpdateFile}
                disabled={officialUpdateBusy}
              />
              <strong>
                {officialUpdateFile?.name ?? "Choisir le fichier officiel"}
              </strong>
            </label>
            <button
              type="button"
              onClick={() => void analyseOfficialUpdate()}
              disabled={!officialUpdateFile || officialUpdateBusy}
            >
              {officialUpdateBusy ? "Analyse en cours…" : "Comparer les résultats"}
            </button>
          </div>

          {officialUpdateError && (
            <p className="admin-championship-results__alert" role="alert">
              {officialUpdateError}
            </p>
          )}

          {officialUpdateMessage && (
            <p className="admin-championship-results__official-success">
              {officialUpdateMessage}
            </p>
          )}

          {officialUpdatePreview && (
            <div className="admin-championship-results__official-preview">
              <div className="admin-championship-results__official-kpis">
                <div className="primary">
                  <strong>{officialUpdatePreview.summary.resultAddedCount}</strong>
                  <span>nouveaux résultats officiels</span>
                </div>
                <div>
                  <strong>{officialUpdatePreview.summary.changedCount}</strong>
                  <span>rencontres modifiées</span>
                </div>
                <div>
                  <strong>{officialUpdatePreview.summary.rescheduledCount}</strong>
                  <span>dates / reports modifiés</span>
                </div>
                <div>
                  <strong>{officialUpdatePreview.summary.newCount}</strong>
                  <span>nouvelles rencontres</span>
                </div>
                <div>
                  <strong>{officialUpdatePreview.summary.unchangedCount}</strong>
                  <span>inchangées</span>
                </div>
              </div>

              {officialUpdatePreview.alreadyImported && (
                <p className="admin-championship-results__official-info">
                  Ce fichier a déjà été appliqué. Il ne sera pas importé une
                  seconde fois.
                </p>
              )}

              {officialUpdatePreview.issues.length > 0 && (
                <div className="admin-championship-results__official-issues">
                  {officialUpdatePreview.issues.map((issue, index) => (
                    <p key={`${issue.code}-${index}`}>{issue.message}</p>
                  ))}
                </div>
              )}

              {officialUpdatePreview.changes.length > 0 && (
                <div className="admin-championship-results__official-changes">
                  <h3>Changements détectés</h3>
                  {officialUpdatePreview.changes.slice(0, 30).map((change, index) => (
                    <div key={`${change.kind}-${index}`}>
                      <div>
                        <strong>
                          {change.category} · {change.phase}
                        </strong>
                        <span>
                          {change.team1} {change.team1Number} — {change.team2}{" "}
                          {change.team2Number}
                        </span>
                      </div>
                      <div className="admin-championship-results__official-change-detail">
                        {change.score && <strong>{change.score}</strong>}
                        <small>{change.fields.join(" · ")}</small>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                className="admin-championship-results__official-apply"
                onClick={() => void applyOfficialUpdate()}
                disabled={
                  officialUpdateBusy ||
                  !officialUpdatePreview.valid ||
                  officialUpdatePreview.alreadyImported
                }
              >
                {officialUpdateBusy
                  ? "Mise à jour…"
                  : `Appliquer la mise à jour officielle${officialUpdatePreview.summary.resultAddedCount > 0 ? ` · ${officialUpdatePreview.summary.resultAddedCount} résultat(s)` : ""}`}
              </button>
            </div>
          )}
        </section>
      )}

      {loadingResults && (
        <div className="admin-card">Chargement des parties du club…</div>
      )}

      {!loadingChampionships && championships.length === 0 && !error && (
        <div className="admin-card admin-championship-results__empty">
          Aucun championnat n’est encore disponible.
        </div>
      )}

      {!loadingResults && championshipId && days.length === 0 && !error && (
        <div className="admin-card admin-championship-results__empty">
          Aucune partie du club n’a été trouvée pour ce championnat.
        </div>
      )}

      {!loadingResults && selectedDay && divisions.length > 0 && (
        <div
          className="admin-championship-results__columns"
          aria-label="Résultats par série"
        >
          {divisions.map((division) => {
            const divisionMatches = matchesForDay.filter(
              (match) => match.divisionId === division.id,
            );
            return (
              <section
                className="admin-championship-results__division"
                key={division.id}
              >
                <header>
                  <div>
                    <span>Série</span>
                    <h2>{division.name}</h2>
                  </div>
                  <strong>{divisionMatches.length}</strong>
                </header>

                <div className="admin-championship-results__cards">
                  {divisionMatches.length === 0 && (
                    <p className="admin-championship-results__no-match">
                      Aucune partie du club cette journée.
                    </p>
                  )}

                  {divisionMatches.map((match) => {
                    const official = hasOfficialResult(match);
                    const proposed = hasPlayerProposal(match);
                    const started = matchHasStarted(match);
                    const displayedScore1 = official
                      ? match.officialScoreTeam1
                      : match.proposedScoreTeam1;
                    const displayedScore2 = official
                      ? match.officialScoreTeam2
                      : match.proposedScoreTeam2;
                    const editorOpen = editingMatchId === match.matchId;
                    return (
                      <article
                        className={`admin-championship-results__match${
                          official
                            ? " admin-championship-results__match--official"
                            : proposed
                              ? " admin-championship-results__match--proposed"
                              : " admin-championship-results__match--missing"
                        }`}
                        key={match.matchId}
                      >
                        <div className="admin-championship-results__match-meta">
                          <span>
                            {match.poolCode
                              ? `Poule ${match.poolCode}`
                              : "Championnat"}
                          </span>
                          <span>
                            {match.actualOn && match.actualOn !== match.dayOn
                              ? `${formatShortDate(match.actualOn)} · `
                              : ""}
                            {formatTime(match.actualTime) ??
                              "Horaire à confirmer"}
                          </span>
                        </div>

                        <div className="admin-championship-results__teams">
                          <div className={match.team1IsClub ? "club-team" : ""}>
                            <strong>{match.team1Label}</strong>
                            {match.team1Players.length > 0 && (
                              <small>{match.team1Players.join(" · ")}</small>
                            )}
                          </div>
                          <span>contre</span>
                          <div className={match.team2IsClub ? "club-team" : ""}>
                            <strong>{match.team2Label}</strong>
                            {match.team2Players.length > 0 && (
                              <small>{match.team2Players.join(" · ")}</small>
                            )}
                          </div>
                        </div>

                        <div className="admin-championship-results__result">
                          {displayedScore1 !== null &&
                          displayedScore2 !== null ? (
                            <strong>
                              {displayedScore1} <span>—</span> {displayedScore2}
                            </strong>
                          ) : (
                            <strong className="missing">
                              Résultat non saisi
                            </strong>
                          )}
                          {official ? (
                            <span className="admin-championship-results__status official">
                              Résultat officiel
                            </span>
                          ) : proposed ? (
                            <span className="admin-championship-results__status proposed">
                              Résultat proposé
                            </span>
                          ) : !started ? (
                            <span className="admin-championship-results__status future">
                              Partie à venir
                            </span>
                          ) : (
                            <span className="admin-championship-results__status missing">
                              À compléter
                            </span>
                          )}
                        </div>

                        {!official && started && !editorOpen && (
                          <button
                            type="button"
                            className="admin-championship-results__submit-button"
                            onClick={() => setEditingMatchId(match.matchId)}
                          >
                            {proposed
                              ? "Modifier le résultat"
                              : "Saisir le résultat"}
                          </button>
                        )}

                        {editorOpen && (
                          <ResultEditor
                            match={match}
                            settings={settings}
                            isEditing={proposed}
                            onCancel={() => setEditingMatchId(null)}
                            onSaved={refresh}
                          />
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
