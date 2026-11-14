import { useCallback, useEffect, useMemo, useState } from "react";
import {
  TournamentScoreEditor,
  type TournamentScorePayload,
} from "@/features/tournaments/components/TournamentScoreEditor";
import { TournamentRankings } from "@/features/tournaments/components/TournamentRankings";
import {
  tournamentRankingService,
  type TournamentRankings as TournamentRankingsPayload,
} from "@/features/tournaments/services/tournamentRankingService";
import {
  tournamentResultsAdminService,
  type AdminTournamentResultMatch,
  type AdminTournamentResultsWorkspace,
} from "@/features/admin/tournaments/services/tournamentResultsAdminService";
import { Link } from "react-router-dom";
import { ROUTES } from "@/shared/config/routes";
import {
  adminTournamentUnprogrammedService,
  type UnprogrammedTournamentMatch,
} from "@/features/admin/tournaments/services/adminTournamentUnprogrammedService";
import "./AdminTournamentResultsPage.css";

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const roundLabels: Record<string, string> = {
  preliminary: "Barrage",
  round_of_32: "1/16 de finale",
  round_of_16: "1/8 de finale",
  quarterfinal: "Quart de finale",
  semifinal: "Demi-finale",
  final: "Finale",
};

type ResultsView = "todo" | "remaining" | "today" | "pending" | "all";
type ResultsTab = "scores" | "rankings";

const matchStageLabel = (match: AdminTournamentResultMatch) =>
  match.phase === "finals"
    ? (roundLabels[match.finalRound ?? ""] ?? "Phase finale")
    : `Poule ${match.poolNumber ?? "—"}`;

const scoreLabel = (match: AdminTournamentResultMatch) =>
  match.result?.score.sets
    .map((set) => `${set.teamA}-${set.teamB}`)
    .join(" · ") ?? "—";

const localDateKey = (date = new Date()) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

const localTimeKey = (date = new Date()) =>
  [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ].join(":");

const matchHasFinished = (
  match: AdminTournamentResultMatch,
  now = new Date(),
) => {
  const today = localDateKey(now);
  if (match.playDate < today) return true;
  if (match.playDate > today) return false;
  return match.endsAt <= localTimeKey(now);
};

const normalizeSearch = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const matchesSearch = (
  match: AdminTournamentResultMatch,
  rawSearch: string,
) => {
  const search = normalizeSearch(rawSearch);
  if (!search) return true;

  return normalizeSearch(
    [
      match.teamALabel,
      match.teamBLabel,
      match.seriesName,
      matchStageLabel(match),
      match.resourceName,
    ].join(" "),
  ).includes(search);
};

const sortMatches = (
  matches: AdminTournamentResultMatch[],
  view: ResultsView,
  now = new Date(),
) =>
  [...matches].sort((left, right) => {
    if (view === "todo") {
      const leftPriority =
        left.result?.status === "pending_validation"
          ? 0
          : !left.result && matchHasFinished(left, now)
            ? 1
            : 2;
      const rightPriority =
        right.result?.status === "pending_validation"
          ? 0
          : !right.result && matchHasFinished(right, now)
            ? 1
            : 2;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    }

    const dateDifference = left.playDate.localeCompare(right.playDate);
    if (dateDifference !== 0) return dateDifference;
    return left.startsAt.localeCompare(right.startsAt);
  });

export function AdminTournamentResultsPage() {
  const [unprogrammed, setUnprogrammed] = useState<
    UnprogrammedTournamentMatch[]
  >([]);
  const [workspaces, setWorkspaces] = useState<
    AdminTournamentResultsWorkspace[]
  >([]);
  const [rankingsByTournament, setRankingsByTournament] = useState<
    Record<string, TournamentRankingsPayload | null>
  >({});
  const [selectedId, setSelectedId] = useState("");
  const [tab, setTab] = useState<ResultsTab>("scores");
  const [view, setView] = useState<ResultsView>("todo");
  const [search, setSearch] = useState("");
  const [seriesFilter, setSeriesFilter] = useState("");
  const [poolFilter, setPoolFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [editingUnprogrammedId, setEditingUnprogrammedId] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [loaded, waiting] = await Promise.all([
      tournamentResultsAdminService.getWorkspace(),
      adminTournamentUnprogrammedService.list(),
    ]);
    setUnprogrammed(waiting);
    const rankingEntries = await Promise.all(
      loaded.map(
        async (workspace) =>
          [
            workspace.id,
            await tournamentRankingService.get(workspace.id),
          ] as const,
      ),
    );
    setWorkspaces(loaded);
    setRankingsByTournament(Object.fromEntries(rankingEntries));
    setSelectedId((current) =>
      current && loaded.some((workspace) => workspace.id === current)
        ? current
        : (loaded[0]?.id ?? ""),
    );
  }, []);

  useEffect(() => {
    load()
      .catch((loadError: unknown) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Chargement des résultats impossible.",
        ),
      )
      .finally(() => setLoading(false));
  }, [load]);

  const selected = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedId) ?? null,
    [selectedId, workspaces],
  );
  const selectedRankings = rankingsByTournament[selectedId] ?? null;
  const unprogrammedForTournament = unprogrammed.filter(
    (match) => match.tournamentId === selectedId,
  );
  const now = new Date();
  const today = localDateKey(now);

  const pendingCount =
    selected?.matches.filter(
      (match) => match.result?.status === "pending_validation",
    ).length ?? 0;

  const validatedCount =
    (selected?.matches.filter((match) => match.result?.status === "validated")
      .length ?? 0) +
    unprogrammedForTournament.filter(
      (match) => match.result?.status === "validated",
    ).length;

  const missingFinishedCount =
    selected?.matches.filter(
      (match) => !match.result && matchHasFinished(match, now),
    ).length ?? 0;

  const todoCount = pendingCount + missingFinishedCount;

  const remainingScheduledCount =
    selected?.matches.filter((match) => !match.result).length ?? 0;
  const remainingCount =
    remainingScheduledCount +
    unprogrammedForTournament.filter((match) => !match.result).length;
  const totalCount =
    (selected?.matches.length ?? 0) + unprogrammedForTournament.length;
  const completedPercent =
    totalCount > 0 ? Math.round((validatedCount / totalCount) * 100) : 0;

  const todayCount =
    selected?.matches.filter((match) => match.playDate === today).length ?? 0;

  const seriesOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...(selected?.matches.map((match) => match.seriesName) ?? []),
          ...unprogrammedForTournament.map((match) => match.seriesName),
        ]),
      ).sort((left, right) => left.localeCompare(right, "fr")),
    [selected, unprogrammed],
  );

  const poolOptions = useMemo(
    () =>
      Array.from(
        new Set(
          selected?.matches
            .filter((match) => match.phase === "pools")
            .map((match) => match.poolNumber)
            .filter((pool): pool is number => pool !== null) ?? [],
        ),
      ).sort((left, right) => left - right),
    [selected],
  );

  const filteredMatches = useMemo(() => {
    if (!selected) return [];

    const referenceNow = new Date();
    const referenceToday = localDateKey(referenceNow);

    return sortMatches(
      selected.matches.filter((match) => {
        if (
          view === "todo" &&
          !(
            match.result?.status === "pending_validation" ||
            (!match.result && matchHasFinished(match, referenceNow))
          )
        ) {
          return false;
        }

        if (view === "remaining" && match.result) return false;

        if (view === "today" && match.playDate !== referenceToday) {
          return false;
        }

        if (
          view === "pending" &&
          match.result?.status !== "pending_validation"
        ) {
          return false;
        }

        if (seriesFilter && match.seriesName !== seriesFilter) {
          return false;
        }

        if (
          poolFilter &&
          (match.phase !== "pools" ||
            String(match.poolNumber ?? "") !== poolFilter)
        ) {
          return false;
        }

        if (dateFilter && match.playDate !== dateFilter) {
          return false;
        }

        return matchesSearch(match, search);
      }),
      view,
      referenceNow,
    );
  }, [dateFilter, poolFilter, search, selected, seriesFilter, view]);

  const editingUnprogrammed =
    unprogrammedForTournament.find(
      (match) => match.matchId === editingUnprogrammedId,
    ) ?? null;

  const editingMatch = useMemo(
    () =>
      selected?.matches.find((match) => match.id === editingMatchId) ?? null,
    [editingMatchId, selected],
  );

  const resetFilters = () => {
    setSearch("");
    setSeriesFilter("");
    setPoolFilter("");
    setDateFilter("");
  };

  const validate = async (matchId: string) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await tournamentResultsAdminService.validate(matchId);
      await load();
      setMessage("Résultat validé.");
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Validation impossible.",
      );
    } finally {
      setSaving(false);
    }
  };

  const save = async (matchId: string, score: TournamentScorePayload) => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await tournamentResultsAdminService.save(matchId, score);
      setEditingMatchId(null);
      setEditingUnprogrammedId(null);
      await load();
      setMessage("Résultat enregistré.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Enregistrement impossible.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="admin-page tournament-results-page">
        <p role="status">Chargement du Result Engine…</p>
      </section>
    );
  }

  return (
    <section className="admin-page tournament-results-page">
      <header className="admin-page__header tournament-results-heading">
        <div>
          <p className="admin-page__eyebrow">Tournois</p>
          <h1>Résultats</h1>
          <p className="admin-page__lead">
            Traitez d’abord les scores qui demandent une action, puis retrouvez
            instantanément une partie par joueur, série, poule ou date.
          </p>
        </div>
      </header>

      {error && (
        <p
          className="tournament-results-alert tournament-results-alert--error"
          role="alert"
        >
          {error}
        </p>
      )}
      {message && (
        <p className="tournament-results-alert" role="status">
          {message}
        </p>
      )}

      {workspaces.length === 0 ? (
        <div className="admin-card tournament-results-empty">
          <h2>Aucun planning publié</h2>
          <p>
            Les résultats deviennent disponibles dès qu’un tournoi possède un
            planning publié.
          </p>
        </div>
      ) : (
        <>
          <div className="admin-card tournament-results-toolbar">
            <label>
              Tournoi
              <select
                value={selectedId}
                onChange={(event) => {
                  setSelectedId(event.target.value);
                  setEditingMatchId(null);
                  resetFilters();
                  setView("todo");
                }}
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <strong>{todoCount}</strong>
              <span>à traiter</span>
            </div>
            <div>
              <strong>{pendingCount}</strong>
              <span>à valider</span>
            </div>
            <div>
              <strong>{validatedCount}</strong>
              <span>validés</span>
            </div>
          </div>

          <section className="admin-card" aria-label="Pilotage du tournoi">
            <h2>Suivi du tournoi</h2>
            <p>
              Avancement basé sur les résultats validés. Les parties sans
              créneau sont incluses dans les parties restantes.
            </p>
            <div className="tournament-results-toolbar">
              <div>
                <strong>{totalCount}</strong>
                <span>parties au total</span>
              </div>
              <div>
                <strong>{validatedCount}</strong>
                <span>résultats validés</span>
              </div>
              <div>
                <strong>{remainingCount}</strong>
                <span>parties restantes sans résultat</span>
              </div>
              <div>
                <strong>{unprogrammedForTournament.length}</strong>
                <span>à reprogrammer</span>
              </div>
              <div>
                <strong>{completedPercent} %</strong>
                <span>avancement</span>
              </div>
            </div>
            <progress
              value={validatedCount}
              max={Math.max(totalCount, 1)}
              style={{ width: "100%" }}
              aria-label="Parties avec résultat validé"
            />
            <h3>Avancement par série</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", textAlign: "left" }}>
                <thead>
                  <tr>
                    <th>Série</th>
                    <th>Validées</th>
                    <th>Restantes</th>
                    <th>À reprogrammer</th>
                  </tr>
                </thead>
                <tbody>
                  {seriesOptions.map((series) => {
                    const seriesMatches =
                      selected?.matches.filter(
                        (match) => match.seriesName === series,
                      ) ?? [];
                    const seriesUnprogrammed = unprogrammedForTournament.filter(
                      (match) => match.seriesName === series && !match.result,
                    );
                    return (
                      <tr key={series}>
                        <th scope="row">{series}</th>
                        <td>
                          {
                            seriesMatches.filter(
                              (match) => match.result?.status === "validated",
                            ).length
                          }
                        </td>
                        <td>
                          {seriesMatches.filter((match) => !match.result)
                            .length +
                            seriesUnprogrammed.length
                          }
                        </td>
                        <td>
                          {
                            seriesUnprogrammed.filter((match) => !match.result)
                              .length
                          }
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p>
              <Link to={ROUTES.adminTournamentReschedules}>
                Gérer les parties à reprogrammer
              </Link>
            </p>
          </section>

          <section
            className="admin-card tournament-results-unprogrammed"
            aria-label="Parties en attente de programmation"
          >
            <div className="tournament-results-unprogrammed__heading">
              <div>
                <strong>
                  {unprogrammedForTournament.length} partie(s) à programmer
                </strong>
                <p>
                  Ces parties n'ont plus de créneau. Si une rencontre a déjà été
                  jouée, vous pouvez saisir directement son score sans la
                  programmer.
                </p>
              </div>
              <Link to={ROUTES.adminTournamentReschedules}>
                Gérer les programmations
              </Link>
            </div>
            {unprogrammedForTournament.length > 0 && (
              <details>
                <summary>
                  Afficher les {unprogrammedForTournament.length} parties à
                  reprogrammer
                </summary>
                <ul>
                  {unprogrammedForTournament.map((match) => (
                    <li key={match.matchId}>
                      <strong>
                        {match.teamA} — {match.teamB}
                      </strong>
                      <span>
                        {match.seriesName} · Ancien créneau :{" "}
                        {match.previousDate} à {match.previousStart}
                        {match.result
                          ? " · Résultat validé"
                          : " · Sans résultat"}
                      </span>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => setEditingUnprogrammedId(match.matchId)}
                      >
                        {match.result ? "Modifier le score" : "Saisir le score"}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          <div className="tournament-results-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "scores"}
              className={tab === "scores" ? "is-active" : ""}
              onClick={() => setTab("scores")}
            >
              Gestion des scores
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "rankings"}
              className={tab === "rankings" ? "is-active" : ""}
              onClick={() => {
                setTab("rankings");
                setEditingMatchId(null);
              }}
            >
              Classements
            </button>
          </div>

          {tab === "rankings" ? (
            selectedRankings ? (
              <div className="admin-card">
                <TournamentRankings rankings={selectedRankings} compact />
              </div>
            ) : (
              <div className="admin-card tournament-results-empty">
                <h2>Classement indisponible</h2>
                <p>Aucun classement n’est encore calculable pour ce tournoi.</p>
              </div>
            )
          ) : (
            <>
              <div
                className="tournament-results-quick-filters"
                aria-label="Filtres rapides des résultats"
              >
                <button
                  type="button"
                  className={view === "todo" ? "is-active" : ""}
                  onClick={() => setView("todo")}
                >
                  <strong>{todoCount}</strong>
                  <span>À traiter</span>
                </button>
                <button
                  type="button"
                  className={view === "remaining" ? "is-active" : ""}
                  onClick={() => setView("remaining")}
                >
                  <strong>{remainingCount}</strong>
                  <span>Restantes</span>
                </button>
                <button
                  type="button"
                  className={view === "today" ? "is-active" : ""}
                  onClick={() => setView("today")}
                >
                  <strong>{todayCount}</strong>
                  <span>Aujourd’hui</span>
                </button>
                <button
                  type="button"
                  className={view === "pending" ? "is-active" : ""}
                  onClick={() => setView("pending")}
                >
                  <strong>{pendingCount}</strong>
                  <span>À valider</span>
                </button>
                <button
                  type="button"
                  className={view === "all" ? "is-active" : ""}
                  onClick={() => setView("all")}
                >
                  <strong>{selected?.matches.length ?? 0}</strong>
                  <span>Tous les parties</span>
                </button>
              </div>

              <div className="admin-card tournament-results-filters">
                <label className="tournament-results-search">
                  <span>Joueur ou équipe</span>
                  <input
                    type="search"
                    value={search}
                    placeholder="Rechercher un nom…"
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>

                <label>
                  <span>Série</span>
                  <select
                    value={seriesFilter}
                    onChange={(event) => setSeriesFilter(event.target.value)}
                  >
                    <option value="">Toutes les séries</option>
                    {seriesOptions.map((series) => (
                      <option key={series} value={series}>
                        {series}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>Poule</span>
                  <select
                    value={poolFilter}
                    onChange={(event) => setPoolFilter(event.target.value)}
                  >
                    <option value="">Toutes les poules</option>
                    {poolOptions.map((pool) => (
                      <option key={pool} value={String(pool)}>
                        Poule {pool}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>Date</span>
                  <input
                    type="date"
                    value={dateFilter}
                    onChange={(event) => setDateFilter(event.target.value)}
                  />
                </label>

                <button
                  type="button"
                  className="tournament-results-reset"
                  onClick={resetFilters}
                  disabled={
                    !search && !seriesFilter && !poolFilter && !dateFilter
                  }
                >
                  Effacer les filtres
                </button>
              </div>

              <div className="tournament-results-list-heading">
                <strong>
                  {filteredMatches.length}{" "}
                  {filteredMatches.length > 1 ? "parties" : "partie"}
                </strong>
                <span>
                  {view === "todo"
                    ? "Scores nécessitant une action"
                    : view === "remaining"
                      ? "Parties programmées sans résultat (hors parties à recaler)"
                      : view === "today"
                        ? "Parties du jour"
                        : view === "pending"
                          ? "Scores transmis à valider"
                          : "Tous les parties"}
                </span>
              </div>

              {filteredMatches.length === 0 ? (
                <div className="admin-card tournament-results-empty">
                  <h2>Aucune partie à afficher</h2>
                  <p>
                    Modifiez les filtres ou choisissez une autre vue pour
                    retrouver une partie.
                  </p>
                </div>
              ) : (
                <div className="tournament-results-list">
                  {filteredMatches.map((match) => {
                    const finished = matchHasFinished(match);
                    const status =
                      match.result?.status === "validated"
                        ? "validated"
                        : match.result?.status === "pending_validation"
                          ? "pending_validation"
                          : finished
                            ? "missing"
                            : "upcoming";
                    const statusLabel =
                      status === "validated"
                        ? "Validé"
                        : status === "pending_validation"
                          ? "À valider"
                          : status === "missing"
                            ? "Score manquant"
                            : "À venir";

                    return (
                      <article
                        className="admin-card tournament-result-card"
                        key={match.id}
                      >
                        <div className="tournament-result-card__time">
                          <strong>{match.startsAt}</strong>
                          <span>
                            {dateFormatter.format(
                              new Date(`${match.playDate}T12:00:00`),
                            )}
                          </span>
                        </div>

                        <div className="tournament-result-card__main">
                          <span className="tournament-result-card__stage">
                            {match.seriesName} · {matchStageLabel(match)}
                          </span>
                          <strong>
                            {match.teamALabel} — {match.teamBLabel}
                          </strong>
                          <small>{match.resourceName}</small>
                        </div>

                        <div className="tournament-result-card__status">
                          {match.result && <strong>{scoreLabel(match)}</strong>}
                          <span data-status={status}>{statusLabel}</span>
                        </div>

                        <div className="tournament-result-card__actions">
                          {match.result?.status === "pending_validation" && (
                            <button
                              className="tournament-results-primary"
                              type="button"
                              disabled={saving}
                              onClick={() => void validate(match.id)}
                            >
                              Valider
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => setEditingMatchId(match.id)}
                          >
                            {match.result ? "Modifier" : "Saisir"}
                          </button>
                        </div>

                        {match.result && match.phase === "pools" && (
                          <p className="tournament-result-card__calculation">
                            Points : {match.teamALabel}{" "}
                            <strong>{match.result.teamARankingPoints}</strong> ·{" "}
                            {match.teamBLabel}{" "}
                            <strong>{match.result.teamBRankingPoints}</strong>
                          </p>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}

      {selected && (editingMatch || editingUnprogrammed) && (
        <div
          className="tournament-results-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !saving) {
              setEditingMatchId(null);
              setEditingUnprogrammedId(null);
            }
          }}
        >
          <div
            className="admin-card tournament-results-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tournament-score-editor-title"
          >
            <header>
              <div>
                <span>
                  {editingMatch
                    ? `${editingMatch.seriesName} · ${matchStageLabel(editingMatch)}`
                    : `${editingUnprogrammed?.seriesName} · Partie sans créneau`}
                </span>
                <h2 id="tournament-score-editor-title">
                  {editingMatch?.result || editingUnprogrammed?.result
                    ? "Modifier le score"
                    : "Saisir le score"}
                </h2>
                <p>
                  {editingMatch
                    ? `${editingMatch.teamALabel} — ${editingMatch.teamBLabel}`
                    : `${editingUnprogrammed?.teamA} — ${editingUnprogrammed?.teamB}`}
                </p>
                <small>
                  {editingMatch
                    ? `${dateFormatter.format(
                        new Date(`${editingMatch.playDate}T12:00:00`),
                      )} · ${editingMatch.startsAt}`
                    : "Sans créneau programmé"}
                </small>
              </div>
              <button
                type="button"
                className="tournament-results-modal__close"
                disabled={saving}
                aria-label="Fermer la saisie du score"
                onClick={() => {
                  setEditingMatchId(null);
                  setEditingUnprogrammedId(null);
                }}
              >
                ×
              </button>
            </header>

            <TournamentScoreEditor
              rules={selected.sportingRules}
              teamSide="a"
              leftLabel={
                editingMatch?.teamALabel ?? editingUnprogrammed?.teamA ?? ""
              }
              rightLabel={
                editingMatch?.teamBLabel ?? editingUnprogrammed?.teamB ?? ""
              }
              initialScore={
                editingMatch?.result?.score ??
                editingUnprogrammed?.result?.score ??
                null
              }
              disabled={saving}
              submitLabel={
                saving ? "Enregistrement…" : "Enregistrer et valider"
              }
              onCancel={() => {
                setEditingMatchId(null);
                setEditingUnprogrammedId(null);
              }}
              onSubmit={(score) =>
                save(
                  (editingMatch?.id ?? editingUnprogrammed?.matchId)!,
                  score,
                )
              }
            />
          </div>
        </div>
      )}
    </section>
  );
}
