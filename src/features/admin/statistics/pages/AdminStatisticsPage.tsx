import {
  BarChart3,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  RefreshCw,
  Users,
  XCircle,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  adminStatisticsService,
  type ClubStatistics,
  type DistributionStatistics,
} from "../services/adminStatisticsService";
import "./AdminStatisticsPage.css";

type Period = {
  startDate: string;
  endDate: string;
};

type BarStyle = CSSProperties & {
  "--statistics-bar-size": string;
};

const dateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const defaultPeriod = (): Period => {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return { startDate: dateInputValue(start), endDate: dateInputValue(end) };
};

const currencyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const compactDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
});

const formatCurrency = (cents: number) => currencyFormatter.format(cents / 100);
const formatDate = (value: string) =>
  value ? dateFormatter.format(new Date(`${value}T12:00:00`)) : "—";
const formatCompactDate = (value: string) =>
  value ? compactDateFormatter.format(new Date(`${value}T12:00:00`)) : "—";

const paymentLabels: Record<string, string> = {
  pending: "En attente",
  authorized: "Autorisé",
  paid: "Payé",
  failed: "Échoué",
  cancelled: "Annulé",
  refunded: "Remboursé",
  expired: "Expiré",
};

function DistributionBars({
  rows,
  emptyMessage,
}: {
  rows: DistributionStatistics[];
  emptyMessage: string;
}) {
  const visibleRows = rows.filter((row) => row.reservations > 0);
  const maximum = Math.max(1, ...visibleRows.map((row) => row.reservations));

  if (visibleRows.length === 0) {
    return <p className="admin-statistics__empty">{emptyMessage}</p>;
  }

  return (
    <div className="admin-statistics__bar-list">
      {visibleRows.map((row) => {
        const style: BarStyle = {
          "--statistics-bar-size": `${Math.max(5, (row.reservations / maximum) * 100)}%`,
        };
        return (
          <div className="admin-statistics__bar-row" key={row.key}>
            <span>{row.label}</span>
            <div aria-hidden="true">
              <i style={style} />
            </div>
            <strong>{row.reservations}</strong>
          </div>
        );
      })}
    </div>
  );
}

export function AdminStatisticsPage() {
  const initialPeriod = useMemo(defaultPeriod, []);
  const [formPeriod, setFormPeriod] = useState<Period>(initialPeriod);
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [statistics, setStatistics] = useState<ClubStatistics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStatistics = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const nextStatistics = await adminStatisticsService.getStatistics(
        period.startDate,
        period.endDate,
      );
      setStatistics(nextStatistics);
    } catch (loadError: unknown) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Chargement des statistiques impossible.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [period.endDate, period.startDate]);

  useEffect(() => {
    void loadStatistics();
  }, [loadStatistics]);

  const applyPeriod = (event: FormEvent) => {
    event.preventDefault();
    if (!formPeriod.startDate || !formPeriod.endDate) {
      setError("Sélectionnez une date de début et une date de fin.");
      return;
    }
    if (formPeriod.endDate < formPeriod.startDate) {
      setError("La date de fin doit être postérieure à la date de début.");
      return;
    }
    setPeriod(formPeriod);
  };

  const applyRollingPeriod = (days: number) => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));
    const nextPeriod = {
      startDate: dateInputValue(start),
      endDate: dateInputValue(end),
    };
    setFormPeriod(nextPeriod);
    setPeriod(nextPeriod);
  };

  const applyActiveSeason = () => {
    if (!statistics?.activeSeason) return;
    const nextPeriod = {
      startDate: statistics.activeSeason.startsOn,
      endDate: statistics.activeSeason.endsOn,
    };
    setFormPeriod(nextPeriod);
    setPeriod(nextPeriod);
  };

  const dailyMaximum = Math.max(
    1,
    ...(statistics?.byDay.map((row) => row.reservations) ?? []),
  );
  const outstandingRevenue = statistics
    ? Math.max(
        0,
        statistics.summary.expectedRevenueCents -
          statistics.summary.paidRevenueCents,
      )
    : 0;

  return (
    <section className="admin-page admin-statistics">
      <header className="admin-page__header admin-statistics__header">
        <div>
          <p className="admin-page__eyebrow">Pilotage</p>
          <h1>Statistiques du club</h1>
          <p className="admin-page__lead">
            Occupation des terrains, fréquentation et suivi financier sur la
            période de votre choix.
          </p>
        </div>
        <button
          className="admin-statistics__refresh"
          type="button"
          disabled={isLoading}
          onClick={() => void loadStatistics()}
        >
          <RefreshCw aria-hidden="true" />
          Actualiser
        </button>
      </header>

      <form className="admin-card admin-statistics__filters" onSubmit={applyPeriod}>
        <div className="admin-statistics__quick-periods">
          <button type="button" onClick={() => applyRollingPeriod(7)}>
            7 jours
          </button>
          <button type="button" onClick={() => applyRollingPeriod(30)}>
            30 jours
          </button>
          {statistics?.activeSeason && (
            <button type="button" onClick={applyActiveSeason}>
              Saison {statistics.activeSeason.name}
            </button>
          )}
        </div>
        <label>
          Du
          <input
            type="date"
            value={formPeriod.startDate}
            onChange={(event) =>
              setFormPeriod((current) => ({
                ...current,
                startDate: event.target.value,
              }))
            }
          />
        </label>
        <label>
          Au
          <input
            type="date"
            value={formPeriod.endDate}
            onChange={(event) =>
              setFormPeriod((current) => ({
                ...current,
                endDate: event.target.value,
              }))
            }
          />
        </label>
        <button className="admin-statistics__apply" type="submit">
          Appliquer
        </button>
      </form>

      {error && (
        <p className="admin-statistics__error" role="alert">
          {error}
        </p>
      )}

      {isLoading && !statistics && (
        <p className="admin-card admin-statistics__loading" role="status">
          Chargement des statistiques…
        </p>
      )}

      {statistics && (
        <>
          <p className="admin-statistics__period">
            {statistics.clubName} · du {formatDate(statistics.startDate)} au{" "}
            {formatDate(statistics.endDate)}
          </p>

          <div className="admin-statistics__metrics">
            <article className="admin-card admin-statistics__metric">
              <BarChart3 aria-hidden="true" />
              <span>Taux d’occupation</span>
              <strong>{statistics.summary.occupancyRate.toFixed(1)} %</strong>
              <small>
                {statistics.summary.occupiedSlots} créneaux occupés sur{" "}
                {statistics.summary.capacitySlots}
              </small>
            </article>
            <article className="admin-card admin-statistics__metric">
              <CalendarDays aria-hidden="true" />
              <span>Réservations confirmées</span>
              <strong>{statistics.summary.validReservations}</strong>
              <small>
                {statistics.summary.totalReservations} demandes enregistrées
              </small>
            </article>
            <article className="admin-card admin-statistics__metric">
              <CircleDollarSign aria-hidden="true" />
              <span>Montant encaissé</span>
              <strong>
                {formatCurrency(statistics.summary.paidRevenueCents)}
              </strong>
              <small>{formatCurrency(outstandingRevenue)} restant attendu</small>
            </article>
            <article className="admin-card admin-statistics__metric admin-statistics__metric--alert">
              <XCircle aria-hidden="true" />
              <span>Taux d’annulation</span>
              <strong>{statistics.summary.cancellationRate.toFixed(1)} %</strong>
              <small>
                {statistics.summary.cancelledReservations} annulation(s) ·{" "}
                {statistics.summary.noShowReservations} absence(s)
              </small>
            </article>
          </div>

          <div className="admin-statistics__audiences">
            <article className="admin-card">
              <Users aria-hidden="true" />
              <div>
                <span>Licenciés</span>
                <strong>{statistics.summary.licenseeReservations}</strong>
              </div>
            </article>
            <article className="admin-card">
              <Users aria-hidden="true" />
              <div>
                <span>Comptes visiteurs</span>
                <strong>{statistics.summary.accountReservations}</strong>
              </div>
            </article>
            <article className="admin-card">
              <Users aria-hidden="true" />
              <div>
                <span>Réservations invitées</span>
                <strong>{statistics.summary.guestReservations}</strong>
              </div>
            </article>
          </div>

          <article className="admin-card admin-statistics__panel">
            <header>
              <div>
                <CalendarDays aria-hidden="true" />
                <div>
                  <h2>Activité quotidienne</h2>
                  <p>Nombre de réservations confirmées par jour.</p>
                </div>
              </div>
            </header>
            <div className="admin-statistics__daily-chart">
              {statistics.byDay.map((row) => {
                const style: BarStyle = {
                  "--statistics-bar-size": `${Math.max(
                    row.reservations > 0 ? 7 : 0,
                    (row.reservations / dailyMaximum) * 100,
                  )}%`,
                };
                return (
                  <div key={row.day} title={`${row.reservations} réservation(s)`}>
                    <strong>{row.reservations}</strong>
                    <span aria-hidden="true">
                      <i style={style} />
                    </span>
                    <small>{formatCompactDate(row.day)}</small>
                  </div>
                );
              })}
            </div>
          </article>

          <div className="admin-statistics__two-columns">
            <article className="admin-card admin-statistics__panel">
              <header>
                <div>
                  <CalendarDays aria-hidden="true" />
                  <div>
                    <h2>Jours les plus fréquentés</h2>
                    <p>Réservations confirmées par jour de la semaine.</p>
                  </div>
                </div>
              </header>
              <DistributionBars
                rows={statistics.byWeekday}
                emptyMessage="Aucune fréquentation sur cette période."
              />
            </article>

            <article className="admin-card admin-statistics__panel">
              <header>
                <div>
                  <Clock3 aria-hidden="true" />
                  <div>
                    <h2>Horaires les plus demandés</h2>
                    <p>Heure de début des réservations confirmées.</p>
                  </div>
                </div>
              </header>
              <DistributionBars
                rows={statistics.byHour}
                emptyMessage="Aucun horaire fréquenté sur cette période."
              />
            </article>
          </div>

          <article className="admin-card admin-statistics__panel">
            <header>
              <div>
                <BarChart3 aria-hidden="true" />
                <div>
                  <h2>Résultats par terrain</h2>
                  <p>Capacité théorique, occupation et recettes.</p>
                </div>
              </div>
            </header>
            <div className="admin-statistics__table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Terrain</th>
                    <th>Réservations</th>
                    <th>Occupation</th>
                    <th>Annulations</th>
                    <th>Attendu</th>
                    <th>Encaissé</th>
                  </tr>
                </thead>
                <tbody>
                  {statistics.byResource.map((resource) => (
                    <tr key={resource.id}>
                      <th>{resource.name}</th>
                      <td>{resource.reservations}</td>
                      <td>
                        <strong>{resource.occupancyRate.toFixed(1)} %</strong>
                        <small>
                          {resource.occupiedSlots}/{resource.capacitySlots}
                        </small>
                      </td>
                      <td>{resource.cancellations}</td>
                      <td>{formatCurrency(resource.expectedRevenueCents)}</td>
                      <td>{formatCurrency(resource.paidRevenueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="admin-card admin-statistics__panel">
            <header>
              <div>
                <CircleDollarSign aria-hidden="true" />
                <div>
                  <h2>État des paiements</h2>
                  <p>Toutes les tentatives liées aux réservations de la période.</p>
                </div>
              </div>
            </header>
            <div className="admin-statistics__payments">
              {statistics.paymentStatuses
                .filter((payment) => payment.count > 0)
                .map((payment) => (
                  <div key={payment.status}>
                    <span>{paymentLabels[payment.status] ?? payment.status}</span>
                    <strong>{payment.count}</strong>
                    <small>{formatCurrency(payment.amountCents)}</small>
                  </div>
                ))}
              {statistics.paymentStatuses.every(
                (payment) => payment.count === 0,
              ) && (
                <p className="admin-statistics__empty">
                  Aucun paiement sur cette période.
                </p>
              )}
            </div>
          </article>
        </>
      )}
    </section>
  );
}
