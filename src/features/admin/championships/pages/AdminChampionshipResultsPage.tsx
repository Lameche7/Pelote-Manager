import { useEffect, useMemo, useState } from "react";
import { ChampionshipSourceUrlEditor } from "@/features/admin/championships/components/ChampionshipSourceUrlEditor";
import {
  adminChampionshipDayResultsService,
  type AdminChampionshipDayResult,
} from "@/features/admin/championships/services/adminChampionshipDayResultsService";
import {
  championshipImportService,
  type AdminChampionshipSummary,
} from "@/features/admin/championships/services/championshipImportService";
import {
  championshipOfficialResultsSyncService,
  type OfficialResultConflict,
} from "@/features/admin/championships/services/championshipOfficialResultsSyncService";
import {
  championshipResultSettingsService,
  type ChampionshipResultSettings,
} from "@/features/admin/championships/services/championshipResultSettingsService";
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
  const [officialUpdateBusy, setOfficialUpdateBusy] = useState(false);
  const [officialUpdateError, setOfficialUpdateError] = useState("");
  const [officialUpdateMessage, setOfficialUpdateMessage] = useState("");
  const [officialConflicts, setOfficialConflicts] = useState<OfficialResultConflict[]>([]);

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
    setOfficialUpdateError("");
    setOfficialUpdateMessage("");
    setOfficialConflicts([]);
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

  const selectedChampionship =
    championships.find((item) => item.id === championshipId) ?? null;

  const updateSelectedSourceUrl = (sourceUrl: string | null) => {
    setChampionships((current) =>
      current.map((championship) =>
        championship.id === championshipId
          ? { ...championship, sourceUrl }
          : championship,
      ),
    );
    setOfficialUpdateError("");
    setOfficialUpdateMessage("");
    setOfficialConflicts([]);
  };

  const verifyOfficialSource = async () => {
    if (!selectedChampionship?.sourceUrl || divisions.length === 0) return;
    setOfficialUpdateBusy(true);
    setOfficialUpdateError("");
    setOfficialUpdateMessage("");
    setOfficialConflicts([]);
    try {
      const source = await championshipOfficialResultsSyncService.read({
        sourceUrl: selectedChampionship.sourceUrl,
        seasonLabel: selectedChampionship.seasonLabel,
        competitionName: selectedChampionship.name,
        specialty: selectedChampionship.specialty,
        divisions: divisions.map((division) => division.name),
      });
      const applied =
        source.results.length > 0
          ? await championshipOfficialResultsSyncService.apply(
              selectedChampionship.id,
              source.results,
            )
          : {
              processedCount: 0,
              updatedCount: 0,
              unchangedCount: 0,
              issueCount: 0,
              issues: [],
              confirmedProposalCount: 0,
              conflictProposalCount: 0,
              conflicts: [],
            };
      await refresh();
      setOfficialConflicts(applied.conflicts);

      const warningCount = source.warnings.length + applied.issueCount;
      const warningSuffix =
        warningCount > 0
          ? ` · ${warningCount} correspondance(s) à vérifier`
          : "";
      const proposalSuffix =
        applied.confirmedProposalCount > 0 || applied.conflictProposalCount > 0
          ? ` · ${applied.confirmedProposalCount} proposition(s) confirmée(s) · ${applied.conflictProposalCount} divergente(s)`
          : "";
      setOfficialUpdateMessage(
        `FFPB vérifiée : ${source.summary.officialResultCount} résultat(s) officiel(s) trouvé(s) · ${applied.updatedCount} mis à jour · ${applied.unchangedCount} déjà à jour${proposalSuffix}${warningSuffix}.`,
      );
    } catch (cause) {
      setOfficialUpdateError(
        cause instanceof Error
          ? cause.message
          : "Impossible de synchroniser les résultats FFPB.",
      );
    } finally {
      setOfficialUpdateBusy(false);
    }
  };

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
          disabled={
            !selectedChampionship?.sourceUrl ||
            divisions.length === 0 ||
            officialUpdateBusy
          }
          onClick={() => void verifyOfficialSource()}
        >
          <span aria-hidden="true">↻</span>
          {officialUpdateBusy ? "Vérification…" : "Vérifier maintenant"}
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

      {selectedChampionship && (
        <section className="admin-card admin-championship-results__official-update">
          <div className="admin-championship-results__official-update-head">
            <div>
              <p className="admin-page__eyebrow">Source officielle FFPB</p>
              <h2>Synchronisation automatique activée</h2>
              <p>
                Du jeudi au dimanche, PILOTOKI vérifiera directement la source
                fédérale chaque soir vers 23 h. Les résultats identifiés sans
                ambiguïté seront appliqués automatiquement et resteront
                prioritaires sur les résultats proposés dans l’application.
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

          <ChampionshipSourceUrlEditor
            championshipId={selectedChampionship.id}
            sourceUrl={selectedChampionship.sourceUrl}
            onSaved={updateSelectedSourceUrl}
          />

          <div className="admin-championship-results__official-controls">
            <div className="admin-championship-results__file-picker">
              <span>Planification</span>
              <strong>Jeudi → dimanche · vérification vers 23 h</strong>
            </div>
            <button
              type="button"
              onClick={() => void verifyOfficialSource()}
              disabled={
                officialUpdateBusy ||
                !selectedChampionship.sourceUrl ||
                divisions.length === 0
              }
            >
              {officialUpdateBusy
                ? "Synchronisation en cours…"
                : "Vérifier maintenant"}
            </button>
          </div>

          {!selectedChampionship.sourceUrl && (
            <p className="admin-championship-results__alert" role="alert">
              Renseignez l’URL officielle FFPB ci-dessus pour activer la
              synchronisation.
            </p>
          )}

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

          {officialConflicts.length > 0 && (
            <div className="admin-championship-results__alert" role="alert">
              <strong>
                ⚠️ {officialConflicts.length} résultat(s) proposé(s) diffèrent de la FFPB
              </strong>
              {officialConflicts.map((conflict, index) => (
                <p key={`${conflict.division}-${conflict.team1Label}-${conflict.team2Label}-${index}`}>
                  <strong>{conflict.division}</strong> · {conflict.team1Label} – {conflict.team2Label} · proposé {conflict.proposedScoreTeam1}–{conflict.proposedScoreTeam2} → officiel {conflict.officialScoreTeam1}–{conflict.officialScoreTeam2}
                </p>
              ))}
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
