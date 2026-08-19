import { useEffect, useMemo, useState } from "react";
import { buildFinalStagePlan } from "@/features/tournaments/domain/finalStageEngine";
import {
  tournamentAdminService,
  type TournamentDetail,
  type TournamentSummary,
} from "@/features/admin/tournaments/services/tournamentAdminService";
import {
  tournamentQualificationAdminService,
} from "@/features/admin/tournaments/services/tournamentQualificationAdminService";
import "./AdminTournamentQualificationPage.css";

const sideLabel = (
  side: ReturnType<
    typeof buildFinalStagePlan
  >["firstRoundMatches"][number]["sideA"],
) =>
  side.kind === "seed"
    ? `N°${side.seed}`
    : `Vainqueur ${side.seedA}–${side.seedB}`;

export function AdminTournamentQualificationPage() {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
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
      return;
    }

    let active = true;
    setLoading(true);
    setError("");
    Promise.all([
      tournamentAdminService.get(selectedId),
      tournamentQualificationAdminService.get(selectedId),
    ])
      .then(([loadedDetail, qualifiers]) => {
        if (!active) return;
        setDetail(loadedDetail);
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
          {activeSeries.map((series) => {
            const seriesId = series.id ?? "";
            const qualifierCount = counts[seriesId] ?? 0;
            const plan =
              qualifierCount >= 2 ? buildFinalStagePlan(qualifierCount) : null;

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
                              {match.seedA} vs {match.seedB}
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
                            {sideLabel(match.sideA)} vs{" "}
                            {sideLabel(match.sideB)}
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
        </div>
      )}
    </section>
  );
}
