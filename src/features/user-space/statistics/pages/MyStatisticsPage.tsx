import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  ListFilter,
  Minus,
  RotateCcw,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { UserSpaceShell } from "@/features/user-space/components/UserSpaceShell";
import {
  myChampionshipsService,
  type MyChampionship,
} from "@/features/user-space/championships/services/myChampionshipsService";
import {
  buildChampionshipStatisticsDashboard,
  emptyChampionshipStatisticsFilters,
  type ChampionshipStatisticsFilters,
  type StatisticsBreakdown,
  type StatisticsOutcome,
} from "@/features/user-space/statistics/domain/championshipStatistics";
import "./MyStatisticsPage.css";

const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const outcomeLabel: Record<StatisticsOutcome, string> = {
  win: "Victoire",
  draw: "Nul",
  loss: "Défaite",
};

const displayDate = (value: string | null) => {
  if (!value) return "Date non renseignée";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
};

function Breakdown({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: StatisticsBreakdown[];
}) {
  return (
    <article className="my-statistics__panel">
      <header>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <BarChart3 aria-hidden="true" />
      </header>
      {rows.length === 0 ? (
        <p className="my-statistics__empty">Aucun match dans cette sélection.</p>
      ) : (
        <ul className="my-statistics__bars">
          {rows.map((row) => (
            <li key={row.label}>
              <div className="my-statistics__bar-label">
                <strong>{row.label}</strong>
                <span>
                  {row.wins} V · {row.draws} N · {row.losses} D ·{" "}
                  {number.format(row.winRate)} %
                </span>
              </div>
              <div className="my-statistics__bar-track" aria-hidden="true">
                <span
                  style={{
                    width: `${Math.max(row.winRate, row.played ? 3 : 0)}%`,
                  }}
                />
              </div>
              <small>
                {row.played} match{row.played > 1 ? "s" : ""}
              </small>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function MyStatisticsPage() {
  const [championships, setChampionships] = useState<MyChampionship[]>([]);
  const [filters, setFilters] = useState<ChampionshipStatisticsFilters>(
    emptyChampionshipStatisticsFilters,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void myChampionshipsService
      .list()
      .then((items) => {
        if (active) setChampionships(items);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Impossible de charger vos statistiques.",
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

  const dashboard = useMemo(
    () => buildChampionshipStatisticsDashboard(championships, filters),
    [championships, filters],
  );

  const setFilter = <K extends keyof ChampionshipStatisticsFilters>(
    key: K,
    value: ChampionshipStatisticsFilters[K],
  ) => setFilters((current) => ({ ...current, [key]: value }));

  const streak = dashboard.summary.currentStreak;
  const lossRate = dashboard.summary.played
    ? (dashboard.summary.losses / dashboard.summary.played) * 100
    : 0;
  const scoreMetricAvailable =
    dashboard.summary.singleSpecialty && dashboard.summary.played > 0;

  return (
    <UserSpaceShell>
      <section className="my-statistics">
        <header className="my-statistics__header">
          <div>
            <p className="my-statistics__eyebrow">Historique sportif</p>
            <h1>Mes statistiques</h1>
            <p>
              Explorez votre historique championnat comme un tableau de bord :
              filtrez par saison, discipline, compétition ou phase et tous les
              indicateurs se recalculent instantanément.
            </p>
          </div>
          <Trophy aria-hidden="true" />
        </header>

        <div className="my-statistics__filters">
          <div className="my-statistics__filters-title">
            <ListFilter aria-hidden="true" />
            <div>
              <strong>Filtres</strong>
              <span>{dashboard.rows.length} match(s) dans la sélection</span>
            </div>
            <button
              type="button"
              onClick={() => setFilters(emptyChampionshipStatisticsFilters())}
            >
              <RotateCcw aria-hidden="true" /> Réinitialiser
            </button>
          </div>

          <div className="my-statistics__filter-grid">
            <label>
              Saison
              <select
                value={filters.season}
                onChange={(event) => setFilter("season", event.target.value)}
              >
                <option value="">Toutes</option>
                {dashboard.options.seasons.map((season) => (
                  <option key={season} value={season}>
                    {season}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Discipline
              <select
                value={filters.specialty}
                onChange={(event) => setFilter("specialty", event.target.value)}
              >
                <option value="">Toutes</option>
                {dashboard.options.specialties.map((specialty) => (
                  <option key={specialty} value={specialty}>
                    {specialty}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Championnat
              <select
                value={filters.championshipId}
                onChange={(event) =>
                  setFilter("championshipId", event.target.value)
                }
              >
                <option value="">Tous</option>
                {dashboard.options.championships.map((championship) => (
                  <option key={championship.value} value={championship.value}>
                    {championship.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Série
              <select
                value={filters.divisionId}
                onChange={(event) => setFilter("divisionId", event.target.value)}
              >
                <option value="">Toutes</option>
                {dashboard.options.divisions.map((division) => (
                  <option key={division.value} value={division.value}>
                    {division.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Phase
              <select
                value={filters.phase}
                onChange={(event) => setFilter("phase", event.target.value)}
              >
                <option value="">Toutes</option>
                {dashboard.options.phases.map((phase) => (
                  <option key={phase} value={phase}>
                    {phase}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Position sur la feuille
              <select
                value={filters.teamSide}
                onChange={(event) =>
                  setFilter(
                    "teamSide",
                    event.target.value as ChampionshipStatisticsFilters["teamSide"],
                  )
                }
              >
                <option value="all">Toutes</option>
                <option value="a">Équipe 1</option>
                <option value="b">Équipe 2</option>
              </select>
              <small>
                Les sources actuelles ne garantissent pas encore l’équivalence
                domicile / extérieur.
              </small>
            </label>
          </div>
        </div>

        {error && <p className="my-statistics__error">{error}</p>}
        {loading && (
          <p className="my-statistics__loading">Chargement de votre historique…</p>
        )}

        {!loading && !error && dashboard.summary.played === 0 && (
          <div className="my-statistics__empty-state">
            <Target aria-hidden="true" />
            <h2>Aucun résultat pour cette sélection</h2>
            <p>
              Les statistiques se rempliront automatiquement à mesure que vos
              championnats et résultats historiques seront importés.
            </p>
          </div>
        )}

        {dashboard.summary.played > 0 && (
          <>
            <div className="my-statistics__metrics">
              <article>
                <Target aria-hidden="true" />
                <span>Matchs joués</span>
                <strong>{dashboard.summary.played}</strong>
                <small>{dashboard.summary.draws} nul(s)</small>
              </article>
              <article>
                <Trophy aria-hidden="true" />
                <span>Victoires</span>
                <strong>{dashboard.summary.wins}</strong>
                <small>
                  {number.format(dashboard.summary.winRate)} % de réussite
                </small>
              </article>
              <article>
                <TrendingDown aria-hidden="true" />
                <span>Défaites</span>
                <strong>{dashboard.summary.losses}</strong>
                <small>{number.format(lossRate)} % des matchs</small>
              </article>
              <article>
                <TrendingUp aria-hidden="true" />
                <span>Série actuelle</span>
                <strong>
                  {streak
                    ? `${streak.length} ${outcomeLabel[streak.outcome]}`
                    : "—"}
                </strong>
                <small>sur les matchs datés les plus récents</small>
              </article>
              <article>
                <BarChart3 aria-hidden="true" />
                <span>Score moyen pour</span>
                <strong>
                  {scoreMetricAvailable
                    ? number.format(dashboard.summary.averageFor)
                    : "—"}
                </strong>
                <small>
                  {scoreMetricAvailable
                    ? `contre ${number.format(dashboard.summary.averageAgainst)}`
                    : "sélectionnez une seule discipline"}
                </small>
              </article>
              <article>
                <Minus aria-hidden="true" />
                <span>Différence cumulée</span>
                <strong>
                  {scoreMetricAvailable
                    ? `${dashboard.summary.scoreDifference >= 0 ? "+" : ""}${dashboard.summary.scoreDifference}`
                    : "—"}
                </strong>
                <small>
                  {scoreMetricAvailable
                    ? `${dashboard.summary.scoreFor} pour · ${dashboard.summary.scoreAgainst} contre`
                    : "les barèmes diffèrent selon la discipline"}
                </small>
              </article>
            </div>

            <div className="my-statistics__breakdowns">
              <Breakdown
                title="Par discipline"
                subtitle="Volume et taux de victoire"
                rows={dashboard.bySpecialty}
              />
              <Breakdown
                title="Par saison"
                subtitle="Évolution de vos résultats"
                rows={dashboard.bySeason}
              />
              <Breakdown
                title="Par phase"
                subtitle="Poules, phases finales et autres étapes"
                rows={dashboard.byPhase}
              />
              <Breakdown
                title="Par championnat"
                subtitle="Comparaison de vos compétitions"
                rows={dashboard.byChampionship}
              />
            </div>

            <article className="my-statistics__panel my-statistics__history">
              <header>
                <div>
                  <h2>Derniers résultats de la sélection</h2>
                  <p>Les 12 rencontres datées les plus récentes.</p>
                </div>
              </header>
              <div className="my-statistics__table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Discipline</th>
                      <th>Adversaire</th>
                      <th>Phase</th>
                      <th>Score</th>
                      <th>Résultat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.recent.map((row) => (
                      <tr key={row.matchId}>
                        <td>{displayDate(row.date)}</td>
                        <td>
                          <strong>{row.specialty}</strong>
                          <span>{row.seasonLabel}</span>
                        </td>
                        <td>{row.opponentLabel}</td>
                        <td>{row.phase}</td>
                        <td>
                          {row.scoreMine} – {row.scoreOpponent}
                        </td>
                        <td>
                          <span
                            className={`my-statistics__outcome my-statistics__outcome--${row.outcome}`}
                          >
                            {outcomeLabel[row.outcome]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </>
        )}
      </section>
    </UserSpaceShell>
  );
}
