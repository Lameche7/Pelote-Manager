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
  buildCompatibilityMap,
  commonSlots,
  generateOptimizedPools,
  getPoolMetric,
  getSeriesMetric,
  movePoolTeam,
  setTeamLock,
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

const signature = (pools: PoolDraft[]) =>
  JSON.stringify(
    pools.map((pool) => ({
      seriesId: pool.seriesId,
      displayOrder: pool.displayOrder,
      targetSize: pool.teams.length,
      isLocked: pool.isLocked,
      teams: pool.teams.map((team) => ({
        teamId: team.teamId,
        isLocked: team.isLocked,
      })),
    })),
  );

const clonePools = (pools: PoolDraft[]) =>
  pools.map((pool) => ({
    ...pool,
    teams: pool.teams.map((team) => ({ ...team })),
  }));

export function AdminTournamentPoolsPage() {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [workspace, setWorkspace] = useState<TournamentPoolWorkspace | null>(
    null,
  );
  const [pools, setPools] = useState<PoolDraft[]>([]);
  const [persistedPools, setPersistedPools] = useState<PoolDraft[]>([]);
  const [activeSeriesId, setActiveSeriesId] = useState("");
  const [draggedTeamId, setDraggedTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const hydrate = (loaded: TournamentPoolWorkspace) => {
    const loadedPools = clonePools(loaded.pools);
    setWorkspace(loaded);
    setPools(loadedPools);
    setPersistedPools(clonePools(loadedPools));
    setActiveSeriesId((current) =>
      loaded.series.some((series) => series.id === current)
        ? current
        : (loaded.series[0]?.id ?? ""),
    );
  };

  const loadWorkspace = async (tournamentId: string) => {
    const loaded = await adminTournamentPoolService.get(tournamentId);
    hydrate(loaded);
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

  const chooseTournament = async (id: string) => {
    setSelectedId(id);
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await loadWorkspace(id);
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
        .map((team) => ({ id: team.id, seriesId: team.seriesId })),
    }));

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
      const generated = generateOptimizedPools({
        series: buildSeriesInputs(),
        pairings: workspace.pairings,
        existingPools: pools,
      });
      setPools(generated);
      setMessage(
        pools.length === 0
          ? "Proposition générée. Vous pouvez maintenant l’ajuster avant de l’enregistrer."
          : "Les équipes non verrouillées ont été rééquilibrées.",
      );
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "Impossible de générer les poules.",
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
      setMessage("Brouillon des poules enregistré.");
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
      setError("Enregistrez vos dernières modifications avant de valider les poules.");
      return;
    }
    if (
      !window.confirm(
        "Valider définitivement les poules ? Elles seront verrouillées pour passer à la génération des matchs.",
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
      setMessage("Poules validées. Elles sont maintenant prêtes pour les matchs.");
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

  const togglePoolLock = (poolKey: string) => {
    if (!editable) return;
    setPools((current) =>
      current.map((pool) =>
        pool.key === poolKey ? { ...pool, isLocked: !pool.isLocked } : pool,
      ),
    );
  };

  const toggleTeamLock = (teamId: string) => {
    if (!editable) return;
    const current = pools
      .flatMap((pool) => pool.teams)
      .find((team) => team.teamId === teamId);
    if (!current) return;
    setPools((value) => setTeamLock(value, teamId, !current.isLocked));
  };

  const dropOnTeam = (targetTeamId: string) => {
    if (!draggedTeamId || draggedTeamId === targetTeamId || !editable) return;
    setPools((current) =>
      swapPoolTeams(current, draggedTeamId, targetTeamId),
    );
    setDraggedTeamId(null);
  };

  const dropOnPool = (targetPoolKey: string) => {
    if (!draggedTeamId || !editable) return;
    setPools((current) => movePoolTeam(current, draggedTeamId, targetPoolKey));
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
            Générez des poules de 4 ou 5 équipes, optimisez les disponibilités,
            échangez les équipes par glisser-déposer puis verrouillez votre
            composition avant de la valider.
          </p>
        </div>
      </header>

      {error && (
        <p className="admin-tournament-pools__alert admin-tournament-pools__alert--error" role="alert">
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
                    {tournament.name} · {statusLabels[tournament.status] ?? tournament.status}
                  </option>
                ))}
              </select>
            </label>

            {workspace && (
              <div className="admin-tournament-pools__toolbar-actions">
                {editable && (
                  <button type="button" disabled={saving} onClick={generate}>
                    {pools.length === 0
                      ? "Générer les poules"
                      : "Rééquilibrer les équipes libres"}
                  </button>
                )}
                {editable && pools.length > 0 && (
                  <button
                    type="button"
                    disabled={saving || !dirty}
                    onClick={() => setPools(clonePools(persistedPools))}
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
                    Enregistrer le brouillon
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
              </div>
            )}
          </div>

          {workspace && !editable && !validated && (
            <div className="admin-card admin-tournament-pools__notice">
              <strong>{statusLabels[workspace.tournament.status] ?? workspace.tournament.status}</strong>
              <span>
                Fermez les inscriptions avant de générer les poules. Après
                validation, elles deviennent en lecture seule.
              </span>
            </div>
          )}

          {validated && (
            <div className="admin-card admin-tournament-pools__notice admin-tournament-pools__notice--success">
              <strong>✅ Poules validées</strong>
              <span>
                La composition est verrouillée et prête pour la génération des
                matchs.
              </span>
            </div>
          )}

          {workspace && workspace.tournament.pendingCount > 0 && editable && (
            <div className="admin-card admin-tournament-pools__notice">
              <strong>Équipes en attente : {workspace.tournament.pendingCount}</strong>
              <span>
                Elles doivent être acceptées ou refusées dans Équipes &
                inscriptions avant la génération.
              </span>
            </div>
          )}

          {workspace && (
            <div className="admin-tournament-pools__series-tabs" role="tablist" aria-label="Séries du tournoi">
              {workspace.series.map((series) => {
                const seriesPools = pools.filter(
                  (pool) => pool.seriesId === series.id,
                );
                const metric = getSeriesMetric(seriesPools, compatibility);
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
                      {series.acceptedCount} équipes · {seriesPools.length} poule
                      {seriesPools.length > 1 ? "s" : ""}
                    </span>
                    {seriesPools.length > 0 && (
                      <small>
                        Pire duel {metric.minimum} · moyenne {metric.average.toFixed(1)}
                      </small>
                    )}
                  </button>
                );
              })}
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
                  Glissez une équipe sur une autre pour les échanger. Un déplacement
                  direct est possible d’une poule de 5 vers une poule de 4. Les
                  compteurs de créneaux communs sont recalculés immédiatement.
                </span>
              </div>

              <div className="admin-tournament-pools__board">
                {activePools.map((pool, poolIndex) => {
                  const metric = getPoolMetric(pool, compatibility);
                  return (
                    <article
                      className={
                        pool.isLocked
                          ? "admin-tournament-pool admin-tournament-pool--locked"
                          : "admin-tournament-pool"
                      }
                      key={pool.key}
                      onDragOver={(event) => {
                        if (editable && !pool.isLocked) event.preventDefault();
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
                            {pool.teams.length} équipes · pire duel {metric.minimum} ·
                            moyenne {metric.average.toFixed(1)}
                          </small>
                        </div>
                        {editable && (
                          <button
                            type="button"
                            onClick={() => togglePoolLock(pool.key)}
                            title={
                              pool.isLocked
                                ? "Déverrouiller toute la poule"
                                : "Conserver toute la poule au prochain rééquilibrage"
                            }
                          >
                            {pool.isLocked ? "🔒 Poule" : "🔓 Poule"}
                          </button>
                        )}
                      </header>

                      <div className="admin-tournament-pool__teams">
                        {pool.teams.map((assignment) => {
                          const team = teamById.get(assignment.teamId);
                          if (!team) return null;
                          const effectiveLocked = pool.isLocked || assignment.isLocked;
                          const opponents = pool.teams
                            .filter((other) => other.teamId !== assignment.teamId)
                            .map((other) => ({
                              team: teamById.get(other.teamId),
                              count: commonSlots(
                                compatibility,
                                assignment.teamId,
                                other.teamId,
                              ),
                            }))
                            .filter(
                              (item): item is { team: TournamentPoolTeam; count: number } =>
                                Boolean(item.team),
                            )
                            .sort((left, right) => left.count - right.count);

                          return (
                            <div
                              className={
                                effectiveLocked
                                  ? "admin-tournament-pool-team admin-tournament-pool-team--locked"
                                  : "admin-tournament-pool-team"
                              }
                              key={assignment.teamId}
                              draggable={Boolean(editable && !effectiveLocked)}
                              onDragStart={() => setDraggedTeamId(assignment.teamId)}
                              onDragEnd={() => setDraggedTeamId(null)}
                              onDragOver={(event) => {
                                if (editable && !effectiveLocked) {
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
                                  <small>
                                    {team.poolAvailabilityCount} disponibilités poules
                                  </small>
                                </div>
                                {editable && !pool.isLocked && (
                                  <button
                                    type="button"
                                    onClick={() => toggleTeamLock(assignment.teamId)}
                                    title="Conserver cette équipe dans sa poule au prochain rééquilibrage"
                                  >
                                    {assignment.isLocked ? "🔒" : "🔓"}
                                  </button>
                                )}
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
                                    <small>avec {teamName(opponent.team)}</small>
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
