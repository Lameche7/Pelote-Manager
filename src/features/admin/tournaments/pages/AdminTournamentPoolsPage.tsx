import { useEffect, useMemo, useState } from "react";
import {
  adminTournamentPoolService,
  type TournamentPoolTeam,
  type TournamentPoolWorkspace,
} from "@/features/admin/tournaments/services/adminTournamentPoolService";
import {
  tournamentAdminService,
  type TournamentSummary,
} from "@/features/admin/tournaments/services/tournamentAdminService";
import {
  buildClubAffiliationMap,
  buildCompatibilityMap,
  commonSlots,
  generateOptimizedPools,
  getPoolClubMetric,
  getPoolMetric,
  getSeriesClubMetric,
  getSeriesMetric,
  movePoolTeam,
  poolSizesAreValidFor,
  poolSizesFor,
  swapPoolTeams,
  type PoolDraft,
} from "@/features/tournaments/domain/poolEngine";
import "./AdminTournamentPoolsPage.css";

const statusLabels: Record<string, string> = {
  preparation: "Préparation",
  configuration: "Configuration",
  registrations_open: "Inscriptions ouvertes",
  registrations_closed: "Inscriptions fermées",
  pools_generated: "Poules générées",
  pools_validated: "Poules validées",
  planning_generated: "Planning généré",
  planning_published: "Planning publié",
  in_progress: "En cours",
  completed: "Terminé",
  archived: "Archivé",
  cancelled: "Annulé",
};

type PoolSizeCounts = {
  4: number;
  5: number;
  6: number;
};

const emptyPoolSizeCounts = (): PoolSizeCounts => ({ 4: 0, 5: 0, 6: 0 });

const poolSizeCountsFromSizes = (sizes: readonly number[]): PoolSizeCounts => {
  const result = emptyPoolSizeCounts();
  for (const size of sizes) {
    if (size === 4 || size === 5 || size === 6) result[size] += 1;
  }
  return result;
};

const poolSizesFromCounts = (counts: PoolSizeCounts): (4 | 5 | 6)[] => [
  ...Array.from({ length: Math.max(counts[4], 0) }, () => 4 as const),
  ...Array.from({ length: Math.max(counts[5], 0) }, () => 5 as const),
  ...Array.from({ length: Math.max(counts[6], 0) }, () => 6 as const),
];

const formatPoolSizes = (sizes: readonly number[]) => {
  const counts = poolSizeCountsFromSizes(sizes);
  return ([4, 5, 6] as const)
    .filter((size) => counts[size] > 0)
    .map((size) => `${counts[size]} × ${size}`)
    .join(" · ");
};

const poolName = (index: number) => {
  let current = index;
  let result = "";
  do {
    result = String.fromCharCode(65 + (current % 26)) + result;
    current = Math.floor(current / 26) - 1;
  } while (current >= 0);
  return `Poule ${result}`;
};

const teamName = (team: TournamentPoolTeam) =>
  team.players
    .map((player) => `${player.firstName} ${player.lastName}`.trim())
    .join(" / ");

const teamClubs = (team: TournamentPoolTeam) =>
  team.clubNames.length > 0 ? team.clubNames.join(" · ") : "Club non renseigné";

const signature = (pools: PoolDraft[]) =>
  JSON.stringify(
    pools.map((pool) => ({
      seriesId: pool.seriesId,
      displayOrder: pool.displayOrder,
      targetSize: pool.teams.length,
      teams: pool.teams.map((team) => team.teamId),
    })),
  );

const clonePools = (pools: PoolDraft[]) =>
  pools.map((pool) => ({
    ...pool,
    teams: pool.teams.map((team) => ({ ...team })),
  }));

const clubMetricLabel = (
  maxTeamsPerClub: number,
  duplicatePairCount: number,
) =>
  duplicatePairCount === 0
    ? "Clubs parfaitement répartis"
    : `Max ${maxTeamsPerClub} équipes d’un même club · ${duplicatePairCount} rapprochement${duplicatePairCount > 1 ? "s" : ""}`;

export function AdminTournamentPoolsPage() {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [workspace, setWorkspace] = useState<TournamentPoolWorkspace | null>(
    null,
  );
  const [pools, setPools] = useState<PoolDraft[]>([]);
  const [persistedPools, setPersistedPools] = useState<PoolDraft[]>([]);
  const [poolSizeCountsBySeries, setPoolSizeCountsBySeries] =
    useState<Record<string, PoolSizeCounts>>({});
  const [activeSeriesId, setActiveSeriesId] = useState("");
  const [draggedTeamId, setDraggedTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const countsForWorkspace = (
    loaded: TournamentPoolWorkspace,
    loadedPools: PoolDraft[],
  ) =>
    Object.fromEntries(
      loaded.series.map((series) => {
        const seriesPools = loadedPools.filter(
          (pool) => pool.seriesId === series.id,
        );
        const sizes =
          seriesPools.length > 0
            ? seriesPools.map((pool) => pool.teams.length)
            : poolSizesFor(series.acceptedCount);
        return [series.id, poolSizeCountsFromSizes(sizes)];
      }),
    );

  const hydrate = (loaded: TournamentPoolWorkspace) => {
    const loadedPools = clonePools(loaded.pools);
    setWorkspace(loaded);
    setPools(loadedPools);
    setPersistedPools(clonePools(loadedPools));
    setPoolSizeCountsBySeries(countsForWorkspace(loaded, loadedPools));
    setActiveSeriesId((current) =>
      loaded.series.some((series) => series.id === current)
        ? current
        : (loaded.series[0]?.id ?? ""),
    );
  };

  const refresh = async (tournamentId: string) => {
    const [items, loaded] = await Promise.all([
      tournamentAdminService.list(),
      adminTournamentPoolService.get(tournamentId),
    ]);
    setTournaments(items);
    hydrate(loaded);
  };

  useEffect(() => {
    let active = true;
    tournamentAdminService
      .list()
      .then(async (items) => {
        if (!active) return;
        setTournaments(items);
        const preferred =
          items.find((item) =>
            [
              "registrations_closed",
              "pools_generated",
              "pools_validated",
            ].includes(item.status),
          ) ?? items[0];
        if (!preferred) return;
        setSelectedId(preferred.id);
        const loaded = await adminTournamentPoolService.get(preferred.id);
        if (active) hydrate(loaded);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Impossible de charger les poules.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const teamById = useMemo(
    () => new Map((workspace?.teams ?? []).map((team) => [team.id, team])),
    [workspace?.teams],
  );
  const compatibility = useMemo(
    () => buildCompatibilityMap(workspace?.pairings ?? []),
    [workspace?.pairings],
  );
  const clubAffiliations = useMemo(
    () => buildClubAffiliationMap(workspace?.teams ?? []),
    [workspace?.teams],
  );
  const dirty = signature(pools) !== signature(persistedPools);
  const editable =
    workspace?.tournament.status === "registrations_closed" ||
    workspace?.tournament.status === "pools_generated";
  const validated = workspace?.tournament.status === "pools_validated";
  const activeSeries = workspace?.series.find(
    (series) => series.id === activeSeriesId,
  );
  const activePools = pools
    .filter((pool) => pool.seriesId === activeSeriesId)
    .sort((left, right) => left.displayOrder - right.displayOrder);
  const activePoolSizeCounts =
    poolSizeCountsBySeries[activeSeriesId] ?? emptyPoolSizeCounts();
  const activeRequestedSizes = poolSizesFromCounts(activePoolSizeCounts);
  const activeDistributionValid = activeSeries
    ? poolSizesAreValidFor(activeSeries.acceptedCount, activeRequestedSizes)
    : false;
  const activeAutomaticSizes = activeSeries
    ? poolSizesFor(activeSeries.acceptedCount)
    : [];

  const chooseTournament = async (id: string) => {
    setSelectedId(id);
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const loaded = await adminTournamentPoolService.get(id);
      hydrate(loaded);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger les poules.",
      );
    } finally {
      setLoading(false);
    }
  };

  const buildSeriesInputs = () =>
    (workspace?.series ?? []).map((series) => ({
      id: series.id,
      name: series.name,
      teams: (workspace?.teams ?? [])
        .filter((team) => team.seriesId === series.id)
        .map((team) => ({
          id: team.id,
          seriesId: team.seriesId,
          clubNames: team.clubNames,
        })),
    }));

  const autoPoolSizesBySeries = () =>
    Object.fromEntries(
      (workspace?.series ?? []).map((series) => [
        series.id,
        poolSizesFor(series.acceptedCount),
      ]),
    );

  const generate = () => {
    if (!workspace || !editable) return;
    setError("");
    setMessage("");
    if (workspace.tournament.pendingCount > 0) {
      setError(
        `Il reste ${workspace.tournament.pendingCount} équipe${workspace.tournament.pendingCount > 1 ? "s" : ""} en attente. Traitez-les avant de générer les poules.`,
      );
      return;
    }

    try {
      const sizesBySeries = autoPoolSizesBySeries();
      const generated = generateOptimizedPools({
        series: buildSeriesInputs(),
        pairings: workspace.pairings,
        poolSizesBySeries: sizesBySeries,
      });
      setPools(generated);
      setPoolSizeCountsBySeries(
        Object.fromEntries(
          Object.entries(sizesBySeries).map(([seriesId, sizes]) => [
            seriesId,
            poolSizeCountsFromSizes(sizes),
          ]),
        ),
      );
      setMessage(
        "Nouvelle proposition : poules de 4 privilégiées, clubs répartis au mieux, puis disponibilités optimisées.",
      );
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "Impossible de générer les poules.",
      );
    }
  };

  const useAutomaticDistribution = () => {
    if (!activeSeries) return;
    setPoolSizeCountsBySeries((current) => ({
      ...current,
      [activeSeries.id]: poolSizeCountsFromSizes(activeAutomaticSizes),
    }));
  };

  const changePoolSizeCount = (size: 4 | 5 | 6, value: number) => {
    if (!activeSeries) return;
    setPoolSizeCountsBySeries((current) => ({
      ...current,
      [activeSeries.id]: {
        ...(current[activeSeries.id] ?? emptyPoolSizeCounts()),
        [size]: Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)),
      },
    }));
  };

  const applyActiveDistribution = () => {
    if (!workspace || !activeSeries || !editable) return;
    setError("");
    setMessage("");
    if (!activeDistributionValid) {
      const assigned = activeRequestedSizes.reduce(
        (sum, size) => sum + size,
        0,
      );
      setError(
        `La répartition choisie représente ${assigned} équipes alors que ${activeSeries.acceptedCount} sont inscrites dans ${activeSeries.name}.`,
      );
      return;
    }

    try {
      const activeInput = buildSeriesInputs().find(
        (series) => series.id === activeSeries.id,
      );
      if (!activeInput) return;
      const generated = generateOptimizedPools({
        series: [activeInput],
        pairings: workspace.pairings,
        poolSizesBySeries: { [activeSeries.id]: activeRequestedSizes },
      });
      setPools((current) => [
        ...current.filter((pool) => pool.seriesId !== activeSeries.id),
        ...generated,
      ]);
      setMessage(
        `${activeSeries.name} : répartition ${formatPoolSizes(activeRequestedSizes)} appliquée et équipes réoptimisées.`,
      );
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "Impossible d’appliquer cette répartition.",
      );
    }
  };

  const save = async () => {
    if (!workspace || !editable || pools.length === 0) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await adminTournamentPoolService.save(workspace.tournament.id, pools);
      await refresh(workspace.tournament.id);
      setMessage("Composition des poules enregistrée.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Impossible d’enregistrer les poules.",
      );
    } finally {
      setSaving(false);
    }
  };

  const validate = async () => {
    if (!workspace || workspace.tournament.status !== "pools_generated") return;
    if (dirty) {
      setError(
        "Enregistrez vos dernières modifications avant de valider les poules.",
      );
      return;
    }
    if (
      !window.confirm(
        "Valider cette composition ? Vous pourrez encore la rouvrir tant que le planning n’a pas été généré.",
      )
    ) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      await adminTournamentPoolService.validate(workspace.tournament.id);
      await refresh(workspace.tournament.id);
      setMessage(
        "Poules validées. Elles restent réouvrables avant le planning.",
      );
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Impossible de valider les poules.",
      );
    } finally {
      setSaving(false);
    }
  };

  const reopen = async () => {
    if (!workspace || !validated) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await adminTournamentPoolService.reopen(workspace.tournament.id);
      await refresh(workspace.tournament.id);
      setMessage(
        "Poules rouvertes : vous pouvez les modifier ou les régénérer.",
      );
    } catch (reopenError) {
      setError(
        reopenError instanceof Error
          ? reopenError.message
          : "Impossible de rouvrir les poules.",
      );
    } finally {
      setSaving(false);
    }
  };

  const dropOnTeam = (targetTeamId: string) => {
    if (!draggedTeamId || draggedTeamId === targetTeamId || !editable) return;
    setPools((current) => swapPoolTeams(current, draggedTeamId, targetTeamId));
    setDraggedTeamId(null);
  };

  const dropOnPool = (targetPoolKey: string) => {
    if (!draggedTeamId || !editable) return;
    setPools((current) => {
      const moved = movePoolTeam(current, draggedTeamId, targetPoolKey);
      const sizes = moved
        .filter((pool) => pool.seriesId === activeSeriesId)
        .map((pool) => pool.teams.length);
      setPoolSizeCountsBySeries((counts) => ({
        ...counts,
        [activeSeriesId]: poolSizeCountsFromSizes(sizes),
      }));
      return moved;
    });
    setDraggedTeamId(null);
  };

  if (loading && tournaments.length === 0) {
    return (
      <section className="admin-page admin-tournament-pools">
        <p role="status">Chargement du Pool Engine…</p>
      </section>
    );
  }

  return (
    <section className="admin-page admin-tournament-pools">
      <header className="admin-page__header admin-tournament-pools__heading">
        <div>
          <p className="admin-page__eyebrow">Tournois</p>
          <h1>Poules</h1>
          <p className="admin-page__lead">
            Le moteur privilégie les poules de 4, puis répartit au mieux les
            clubs et optimise les disponibilités. L’administrateur peut imposer
            une autre répartition de poules de 4, 5 ou 6.
          </p>
        </div>
      </header>

      {error && (
        <p
          className="admin-tournament-pools__alert admin-tournament-pools__alert--error"
          role="alert"
        >
          {error}
        </p>
      )}
      {message && (
        <p className="admin-tournament-pools__alert" role="status">
          {message}
        </p>
      )}

      {tournaments.length === 0 ? (
        <div className="admin-card">
          <p>Créez d’abord un tournoi et ses inscriptions.</p>
        </div>
      ) : (
        <>
          <div className="admin-card admin-tournament-pools__toolbar">
            <label>
              Tournoi
              <select
                value={selectedId}
                disabled={saving}
                onChange={(event) => void chooseTournament(event.target.value)}
              >
                {tournaments.map((tournament) => (
                  <option key={tournament.id} value={tournament.id}>
                    {tournament.name} ·{" "}
                    {statusLabels[tournament.status] ?? tournament.status}
                  </option>
                ))}
              </select>
            </label>

            {workspace && (
              <div className="admin-tournament-pools__toolbar-actions">
                {editable && (
                  <button type="button" disabled={saving} onClick={generate}>
                    {pools.length === 0
                      ? "Générer la proposition"
                      : "Régénérer la proposition auto"}
                  </button>
                )}
                {editable && pools.length > 0 && (
                  <button
                    type="button"
                    disabled={saving || !dirty}
                    onClick={() => {
                      setPools(clonePools(persistedPools));
                      if (workspace) {
                        setPoolSizeCountsBySeries(
                          countsForWorkspace(workspace, persistedPools),
                        );
                      }
                    }}
                  >
                    Annuler les modifications
                  </button>
                )}
                {editable && pools.length > 0 && (
                  <button
                    className="admin-tournament-pools__primary"
                    type="button"
                    disabled={saving || !dirty}
                    onClick={() => void save()}
                  >
                    Enregistrer la composition
                  </button>
                )}
                {workspace.tournament.status === "pools_generated" && (
                  <button
                    className="admin-tournament-pools__validate"
                    type="button"
                    disabled={saving || dirty}
                    onClick={() => void validate()}
                  >
                    Valider les poules
                  </button>
                )}
                {validated && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void reopen()}
                  >
                    Rouvrir les poules
                  </button>
                )}
              </div>
            )}
          </div>

          {workspace && !editable && !validated && (
            <div className="admin-card admin-tournament-pools__notice">
              <strong>
                {statusLabels[workspace.tournament.status] ??
                  workspace.tournament.status}
              </strong>
              <span>
                Fermez les inscriptions avant de générer les poules. Le moteur
                utilisera uniquement les équipes réellement acceptées.
              </span>
            </div>
          )}

          {validated && (
            <div className="admin-card admin-tournament-pools__notice admin-tournament-pools__notice--success">
              <strong>✅ Poules validées</strong>
              <span>
                Cette composition est approuvée, mais elle peut encore être
                rouverte avant la génération du planning.
              </span>
            </div>
          )}

          {workspace && workspace.tournament.pendingCount > 0 && editable && (
            <div className="admin-card admin-tournament-pools__notice">
              <strong>
                Équipes en attente : {workspace.tournament.pendingCount}
              </strong>
              <span>
                Elles doivent être acceptées ou refusées dans Équipes &
                inscriptions avant la génération.
              </span>
            </div>
          )}

          {workspace && (
            <div
              className="admin-tournament-pools__series-tabs"
              role="tablist"
              aria-label="Séries du tournoi"
            >
              {workspace.series.map((series) => {
                const seriesPools = pools.filter(
                  (pool) => pool.seriesId === series.id,
                );
                const metric = getSeriesMetric(seriesPools, compatibility);
                const clubMetric = getSeriesClubMetric(
                  seriesPools,
                  clubAffiliations,
                );
                return (
                  <button
                    key={series.id}
                    type="button"
                    role="tab"
                    aria-selected={activeSeriesId === series.id}
                    className={
                      activeSeriesId === series.id
                        ? "admin-tournament-pools__series-tab admin-tournament-pools__series-tab--active"
                        : "admin-tournament-pools__series-tab"
                    }
                    onClick={() => setActiveSeriesId(series.id)}
                  >
                    <strong>{series.name}</strong>
                    <span>
                      {series.acceptedCount} équipes · {seriesPools.length}{" "}
                      poule{seriesPools.length > 1 ? "s" : ""}
                    </span>
                    {seriesPools.length > 0 && (
                      <small>
                        {clubMetricLabel(
                          clubMetric.maxTeamsPerClub,
                          clubMetric.duplicatePairCount,
                        )}
                        {" · "}Pire duel {metric.minimum} · moyenne{" "}
                        {metric.average.toFixed(1)}
                      </small>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {workspace &&
            activeSeries &&
            editable &&
            activeSeries.acceptedCount > 0 && (
              <div className="admin-card admin-tournament-pools__distribution">
                <div className="admin-tournament-pools__distribution-copy">
                  <span>Répartition des poules · {activeSeries.name}</span>
                  <strong>
                    Proposition automatique :{" "}
                    {formatPoolSizes(activeAutomaticSizes)}
                  </strong>
                  <small>
                    Priorité aux poules de 4. Vous pouvez modifier les quantités
                    ci-dessous avant de réoptimiser cette série.
                  </small>
                </div>

                <div className="admin-tournament-pools__distribution-controls">
                  {([4, 5, 6] as const).map((size) => (
                    <label key={size}>
                      Poules de {size}
                      <input
                        type="number"
                        min={0}
                        step={1}
                        disabled={saving}
                        value={activePoolSizeCounts[size]}
                        onChange={(event) =>
                          changePoolSizeCount(size, Number(event.target.value))
                        }
                      />
                    </label>
                  ))}
                </div>

                <div className="admin-tournament-pools__distribution-actions">
                  <span
                    className={
                      activeDistributionValid
                        ? "admin-tournament-pools__distribution-total admin-tournament-pools__distribution-total--valid"
                        : "admin-tournament-pools__distribution-total admin-tournament-pools__distribution-total--invalid"
                    }
                  >
                    {activeRequestedSizes.reduce(
                      (sum, size) => sum + size,
                      0,
                    )}{" "}
                    / {activeSeries.acceptedCount} équipes
                  </span>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={useAutomaticDistribution}
                  >
                    Reprendre la proposition
                  </button>
                  <button
                    className="admin-tournament-pools__primary"
                    type="button"
                    disabled={saving || !activeDistributionValid}
                    onClick={applyActiveDistribution}
                  >
                    Appliquer cette répartition
                  </button>
                </div>
              </div>
            )}

          {workspace && activeSeries && activePools.length === 0 && (
            <div className="admin-card admin-tournament-pools__empty">
              <h2>{activeSeries.name}</h2>
              <p>
                {activeSeries.acceptedCount === 0
                  ? "Aucune équipe inscrite dans cette série."
                  : "Aucune poule n’a encore été générée pour cette série."}
              </p>
              {editable && activeSeries.acceptedCount > 0 && (
                <button type="button" onClick={generate}>
                  Générer maintenant
                </button>
              )}
            </div>
          )}

          {workspace && activePools.length > 0 && (
            <>
              <div className="admin-card admin-tournament-pools__help">
                <strong>{activeSeries?.name}</strong>
                <span>
                  Le moteur limite d’abord les équipes représentant le même club
                  dans une poule, puis optimise les créneaux communs. Une équipe
                  composée de joueurs de deux clubs représente les deux. Le
                  glisser-déposer reste libre et les indicateurs clubs/dispos se
                  recalculent immédiatement.
                </span>
              </div>

              <div className="admin-tournament-pools__board">
                {activePools.map((pool, poolIndex) => {
                  const metric = getPoolMetric(pool, compatibility);
                  const clubMetric = getPoolClubMetric(pool, clubAffiliations);
                  return (
                    <article
                      className="admin-tournament-pool"
                      key={pool.key}
                      onDragOver={(event) => {
                        if (editable) event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        dropOnPool(pool.key);
                      }}
                    >
                      <header>
                        <div>
                          <span>{activeSeries?.name}</span>
                          <h2>{poolName(poolIndex)}</h2>
                          <small>
                            {pool.teams.length} équipes ·{" "}
                            {clubMetricLabel(
                              clubMetric.maxTeamsPerClub,
                              clubMetric.duplicatePairCount,
                            )}
                            {" · "}pire duel {metric.minimum} · moyenne{" "}
                            {metric.average.toFixed(1)}
                          </small>
                        </div>
                      </header>

                      <div className="admin-tournament-pool__teams">
                        {pool.teams.map((assignment) => {
                          const team = teamById.get(assignment.teamId);
                          if (!team) return null;
                          const opponents = pool.teams
                            .filter(
                              (other) => other.teamId !== assignment.teamId,
                            )
                            .map((other) => ({
                              team: teamById.get(other.teamId),
                              count: commonSlots(
                                compatibility,
                                assignment.teamId,
                                other.teamId,
                              ),
                            }))
                            .filter(
                              (
                                item,
                              ): item is {
                                team: TournamentPoolTeam;
                                count: number;
                              } => Boolean(item.team),
                            )
                            .sort((left, right) => left.count - right.count);

                          return (
                            <div
                              className="admin-tournament-pool-team"
                              key={assignment.teamId}
                              draggable={Boolean(editable)}
                              onDragStart={() =>
                                setDraggedTeamId(assignment.teamId)
                              }
                              onDragEnd={() => setDraggedTeamId(null)}
                              onDragOver={(event) => {
                                if (editable) {
                                  event.preventDefault();
                                  event.stopPropagation();
                                }
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                dropOnTeam(assignment.teamId);
                              }}
                            >
                              <header>
                                <div>
                                  <strong>{teamName(team)}</strong>
                                  <small>{teamClubs(team)}</small>
                                  <small>
                                    {team.poolAvailabilityCount} disponibilités
                                    poules
                                  </small>
                                </div>
                              </header>

                              <div className="admin-tournament-pool-team__compatibility">
                                {opponents.map((opponent) => (
                                  <span
                                    key={opponent.team.id}
                                    className={
                                      opponent.count === metric.minimum
                                        ? "admin-tournament-pool-team__duel admin-tournament-pool-team__duel--minimum"
                                        : "admin-tournament-pool-team__duel"
                                    }
                                  >
                                    <small>
                                      avec {teamName(opponent.team)}
                                    </small>
                                    <strong>{opponent.count}</strong>
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
