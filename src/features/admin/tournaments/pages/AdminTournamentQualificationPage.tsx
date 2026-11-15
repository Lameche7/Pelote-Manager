import { useEffect, useMemo, useState } from "react";
import { buildFinalStagePlan } from "@/features/tournaments/domain/finalStageEngine";
import { tournamentFinalStageAdminService } from "@/features/admin/tournaments/services/tournamentFinalStageAdminService";
import { AdminTournamentFinalStageControl } from "@/features/admin/tournaments/components/AdminTournamentFinalStageControl";
import {
  tournamentAdminService,
  type TournamentDetail,
  type TournamentSummary,
} from "@/features/admin/tournaments/services/tournamentAdminService";
import { tournamentQualificationAdminService } from "@/features/admin/tournaments/services/tournamentQualificationAdminService";
import "./AdminTournamentQualificationPage.css";

const crossPoolSeedLabels: Record<number, string> = {
  1: "1re poule 1",
  2: "1re poule 2",
  3: "2e poule 2",
  4: "2e poule 1",
  5: "3e poule 2",
  6: "3e poule 1",
};

const sideLabel = (
  side: ReturnType<
    typeof buildFinalStagePlan
  >["firstRoundMatches"][number]["sideA"],
  crossPools: boolean,
) =>
  side.kind === "seed"
    ? crossPools
      ? (crossPoolSeedLabels[side.seed] ?? `N°${side.seed}`)
      : `N°${side.seed}`
    : crossPools
      ? `Vainqueur (${crossPoolSeedLabels[side.seedA]} / ${crossPoolSeedLabels[side.seedB]})`
      : `Vainqueur ${side.seedA}–${side.seedB}`;

export function AdminTournamentQualificationPage() {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [crossPoolsBySeries, setCrossPoolsBySeries] = useState<
    Record<string, boolean>
  >({});
  const [finalsStartsOn, setFinalsStartsOn] = useState("");
  const [finalsEndsOn, setFinalsEndsOn] = useState("");
  const [savingDates, setSavingDates] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    tournamentAdminService
      .list()
      .then((items) => {
        setTournaments(items);
        const first =
          items.find(
            (item) =>
              !["completed", "archived", "cancelled"].includes(item.status),
          ) ?? items[0];
        if (first) setSelectedId(first.id);
      })
      .catch((loadError: unknown) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Impossible de charger les tournois.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setCounts({});
      setCrossPoolsBySeries({});
      setFinalsStartsOn("");
      setFinalsEndsOn("");
      return;
    }

    let active = true;
    setLoading(true);
    setError("");
    Promise.all([
      tournamentAdminService.get(selectedId),
      tournamentQualificationAdminService.get(selectedId),
      tournamentFinalStageAdminService.getState(selectedId),
    ])
      .then(([loadedDetail, qualifiers, stage]) => {
        if (!active) return;
        setDetail(loadedDetail);
        setCrossPoolsBySeries(
          Object.fromEntries(
            stage.series.map((series) => [series.seriesId, series.crossPools]),
          ),
        );
        setFinalsStartsOn(loadedDetail.finalsStartsOn ?? "");
        setFinalsEndsOn(loadedDetail.finalsEndsOn ?? "");
        setCounts(
          Object.fromEntries(
            loadedDetail.series.map((series) => [
              series.id ?? "",
              qualifiers.get(series.id ?? "") ?? 0,
            ]),
          ),
        );
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Impossible de charger les qualifications.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedId]);

  const activeSeries = useMemo(
    () => detail?.series.filter((series) => series.enabled) ?? [],
    [detail],
  );

  const saveFinalsDates = async () => {
    if (!detail) return;
    setError("");
    setMessage("");

    if (!finalsStartsOn || !finalsEndsOn) {
      setError(
        "Renseignez la date de début et la date de fin de la phase finale.",
      );
      return;
    }
    if (finalsStartsOn <= detail.poolEndsOn || finalsEndsOn < finalsStartsOn) {
      setError(
        "La phase finale doit commencer après les poules et sa date de fin doit suivre son début.",
      );
      return;
    }

    setSavingDates(true);
    try {
      await tournamentAdminService.setFinalsDates(
        detail.id,
        finalsStartsOn,
        finalsEndsOn,
      );
      const refreshed = await tournamentAdminService.get(detail.id);
      setDetail(refreshed);
      setFinalsStartsOn(refreshed.finalsStartsOn ?? "");
      setFinalsEndsOn(refreshed.finalsEndsOn ?? "");
      setMessage("Dates de la phase finale enregistrées.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Impossible d'enregistrer les dates de la phase finale.",
      );
    } finally {
      setSavingDates(false);
    }
  };

  const save = async () => {
    if (!detail) return;
    setError("");
    setMessage("");

    const invalid = activeSeries.find((series) => {
      const count = counts[series.id ?? ""] ?? 0;
      return (
        !Number.isInteger(count) ||
        count < 0 ||
        count === 1 ||
        count > series.capacity
      );
    });

    if (invalid) {
      setError(
        `Pour ${invalid.name}, choisissez 0 (non configuré) ou entre 2 et ${invalid.capacity} qualifiés.`,
      );
      return;
    }

    setSaving(true);
    try {
      await tournamentQualificationAdminService.save(
        detail.id,
        activeSeries.flatMap((series) =>
          series.id
            ? [
                {
                  seriesId: series.id,
                  finalsQualifierCount: counts[series.id] ?? 0,
                },
              ]
            : [],
        ),
      );
      setMessage(
        "Nombre de qualifiés enregistré. Le classement général et les scénarios joueurs utilisent désormais cette règle.",
      );
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

  return (
    <section className="admin-page tournament-qualification-page">
      <header className="admin-page__header">
        <div>
          <p className="admin-page__eyebrow">Tournois</p>
          <h1>Qualifications & phase finale</h1>
          <p className="admin-page__lead">
            Définissez le nombre de qualifiés par série. Pelote Manager déduit
            automatiquement les exemptions, les barrages et le tableau principal
            à partir du classement général toutes poules confondues.
          </p>
        </div>
      </header>

      {error && (
        <p
          className="qualification-alert qualification-alert--error"
          role="alert"
        >
          {error}
        </p>
      )}
      {message && (
        <p className="qualification-alert" role="status">
          {message}
        </p>
      )}

      <section className="admin-card qualification-selector">
        <label>
          Tournoi
          <select
            value={selectedId}
            disabled={loading || saving}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setMessage("");
            }}
          >
            <option value="">Choisir un tournoi</option>
            {tournaments.map((tournament) => (
              <option key={tournament.id} value={tournament.id}>
                {tournament.name} · {tournament.seasonName}
              </option>
            ))}
          </select>
        </label>
      </section>

      {loading && <p role="status">Chargement…</p>}

      {!loading && detail && (
        <div className="qualification-series-list">
          <section
            className="admin-card qualification-series"
            aria-label="Dates de la phase finale"
          >
            <header>
              <div>
                <p>Calendrier du tournoi</p>
                <h2>Dates de la phase finale</h2>
              </div>
            </header>
            <p>Modifiez les dates même après la génération des poules.</p>
            <p>Les disponibilités enregistrées restent conservées.</p>
            <p>Les parties déjà programmées doivent rester dans la période.</p>
            <p>Fin des poules : {detail.poolEndsOn}</p>
            <div className="qualification-preview__numbers">
              <label>
                Début de la phase finale
                <input
                  type="date"
                  min={detail.poolEndsOn}
                  value={finalsStartsOn}
                  disabled={savingDates || saving}
                  onChange={(event) => setFinalsStartsOn(event.target.value)}
                />
              </label>
              <label>
                Fin de la phase finale
                <input
                  type="date"
                  min={finalsStartsOn || detail.poolEndsOn}
                  value={finalsEndsOn}
                  disabled={savingDates || saving}
                  onChange={(event) => setFinalsEndsOn(event.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              className="qualification-save"
              disabled={
                savingDates ||
                saving ||
                ["completed", "archived", "cancelled"].includes(detail.status)
              }
              onClick={() => void saveFinalsDates()}
            >
              {savingDates
                ? "Enregistrement…"
                : "Enregistrer les dates de phase finale"}
            </button>
          </section>
          {activeSeries.map((series) => {
            const seriesId = series.id ?? "";
            const qualifierCount = counts[seriesId] ?? 0;
            const plan =
              qualifierCount >= 2
                ? buildFinalStagePlan(
                    qualifier...[truncated]
                : null;

            return (
              <section
                className="admin-card qualification-series"
                key={seriesId}
              >
                <header>
                  <div>
                    <p>Série</p>
                    <h2>{series.name}</h2>
                  </div>
                  <span>Capacité : {series.capacity} équipes</span>
                </header>

                <label className="qualification-series__count">
                  Nombre d’équipes qualifiées
                  <input
                    type="number"
                    min="0"
                    max={series.capacity}
                    step="1"
                    value={qualifierCount}
                    disabled={saving}
                    onChange={(event) =>
                      setCounts((current) => ({
                        ...current,
                        [seriesId]: Number(event.target.value),
                      }))
                    }
                  />
                  <small>
                    0 = non configuré. Sinon, choisissez au moins 2 équipes.
                  </small>
                  {crossPoolsBySeries[seriesId] && (
                    <small>
                      Mode « Tableau croisé entre poules » actif : les premières de
                      chaque poule entrent directement en demi-finale.
                    </small>
                  )}
                </label>

                {plan ? (
                  <div className="qualification-preview">
                    <div className="qualification-preview__numbers">
                      <span>
                        <strong>{plan.qualifierCount}</strong>
                        qualifiés
                      </span>
                      <span>
                        <strong>{plan.mainBracketSize}</strong>
                        tableau principal
                      </span>
                      <span>
                        <strong>{plan.directEntryCount}</strong>
                        accès directs
                      </span>
                      <span>
                        <strong>{plan.preliminaryMatches.length}</strong>
                        barrages
                      </span>
                    </div>

                    {plan.preliminaryMatches.length > 0 && (
                      <div>
                        <h3>Barrages</h3>
                        <div className="qualification-pairings">
                          {plan.preliminaryMatches.map((match) => (
                            <span key={match.matchIndex}>
                              {crossPoolsBySeries[seriesId]
                                ? crossPoolSeedLabels[match.seedA]
                                : match.seedA}{" "}
                              vs{" "}
                              {crossPoolsBySeries[seriesId]
                                ? crossPoolSeedLabels[match.seedB]
                                : match.seedB}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <h3>Premier tour du tableau principal</h3>
                      <div className="qualification-pairings">
                        {plan.firstRoundMatches.map((match) => (
                          <span key={match.matchIndex}>
                            {sideLabel(match.sideA, crossPoolsBySeries[seriesId] ?? false)} vs{" "}
                            {sideLabel(match.sideB, crossPoolsBySeries[seriesId] ?? false)}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="qualification-series__empty">
                    Configurez le nombre de qualifiés pour afficher le tableau
                    prévisionnel.
                  </p>
                )}
              </section>
            );
          })}

          {activeSeries.length === 0 && (
            <div className="admin-card">
              <p>Aucune série active n’est configurée sur ce tournoi.</p>
            </div>
          )}

          {activeSeries.length > 0 && (
            <button
              className="qualification-save"
              type="button"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "Enregistrement…" : "Enregistrer les qualifications"}
            </button>
          )}

          {selectedId && (
            <AdminTournamentFinalStageControl
              tournamentId={selectedId}
              onCrossPoolsChanged={(seriesId, enabled) =>
                setCrossPoolsBySeries((current) => ({
                  ...current,
                  [seriesId]: enabled,
                }))
              }
            />
          )}
        </div>
      )}
    </section>
  );
}
