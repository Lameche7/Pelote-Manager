import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarRange,
  CircleDollarSign,
  Clock3,
  RefreshCw,
  UserRoundCheck,
  UsersRound,
  XCircle,
} from "lucide-react";
import {
  statisticsAdminService,
  type ClubStatistics,
  type StatisticsBreakdown,
} from "../services/statisticsAdminService";
import "./AdminStatisticsPage.css";

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

const startOfMonth = () => {
  const date = new Date();
  return isoDate(new Date(date.getFullYear(), date.getMonth(), 1));
};

const currency = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});

const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

function Breakdown({
  title,
  subtitle,
  rows,
  suffix = " réservation(s)",
}: {
  title: string;
  subtitle: string;
  rows: StatisticsBreakdown[];
  suffix?: string;
}) {
  const maximum = Math.max(...rows.map((row) => row.value), 1);

  return (
    <article className="admin-card statistics-panel">
      <header>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <BarChart3 aria-hidden="true" />
      </header>
      {rows.length === 0 ? (
        <p className="statistics-empty">Aucune donnée sur cette période.</p>
      ) : (
        <ul className="statistics-bars">
          {rows.map((row) => (
            <li key={row.label}>
              <div>
                <span>{row.label}</span>
                <strong>
                  {number.format(row.value)}
                  {suffix}
                </strong>
              </div>
              <div className="statistics-bars__track" aria-hidden="true">
                <span
                  style={{
                    width: `${Math.max((row.value / maximum) * 100, 2)}%`,
                  }}
                />
              </div>
              {row.secondaryValue !== undefined && (
                <small>
                  {number.format(row.secondaryValue)} h occupée(s)
                </small>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function AdminStatisticsPage() {
  const [periodStart, setPeriodStart] = useState(startOfMonth);
  const [periodEnd, setPeriodEnd] = useState(() => isoDate(new Date()));
  const [statistics, setStatistics] = useState<ClubStatistics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setStatistics(
        await statisticsAdminService.getStatistics(periodStart, periodEnd),
      );
    } catch (loadError: unknown) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger les statistiques.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const cancellationRate = useMemo(() => {
    if (!statistics) return 0;
    const total = statistics.summary.reservations + statistics.summary.cancelled;
    return total ? (statistics.summary.cancelled / total) * 100 : 0;
  }, [statistics]);

  return (
    <section className="admin-page statistics-page">
      <header className="admin-page__header statistics-page__header">
        <div>
          <p className="admin-page__eyebrow">Pilotage</p>
          <h1>Statistiques du club</h1>
          <p className="admin-page__lead">
            Analysez l’activité de réservation, la fréquentation et le chiffre
            d’affaires théorique de cette instance.
          </p>
        </div>
        <button
          type="button"
          className="statistics-refresh"
          onClick={() => void load()}
          disabled={isLoading}
        >
          <RefreshCw aria-hidden="true" /> Actualiser
        </button>
      </header>

      <form
        className="admin-card statistics-period"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <CalendarRange aria-hidden="true" />
        <label>
          Du
          <input
            type="date"
            value={periodStart}
            max={periodEnd}
            onChange={(event) => setPeriodStart(event.target.value)}
          />
        </label>
        <label>
          Au
          <input
            type="date"
            value={periodEnd}
            min={periodStart}
            onChange={(event) => setPeriodEnd(event.target.value)}
          />
        </label>
        <button type="submit" disabled={isLoading}>
          Appliquer
        </button>
      </form>

      {error && (
        <p className="statistics-error" role="alert">
          {error}
        </p>
      )}
      {isLoading && !statistics && (
        <p className="statistics-loading">Chargement des statistiques…</p>
      )}

      {statistics && (
        <>
          <div className="statistics-metrics">
            <article className="admin-card">
              <CalendarRange aria-hidden="true" />
              <span>Réservations</span>
              <strong>{statistics.summary.reservations}</strong>
              <small>hors annulations</small>
            </article>
            <article className="admin-card">
              <Clock3 aria-hidden="true" />
              <span>Occupation</span>
              <strong>
                {number.format(statistics.summary.occupiedHours)} h
              </strong>
              <small>temps réservé</small>
            </article>
            <article className="admin-card">
              <UserRoundCheck aria-hidden="true" />
              <span>Licenciés</span>
              <strong>{statistics.summary.licensees}</strong>
              <small>réservations au tarif licencié</small>
            </article>
            <article className="admin-card">
              <UsersRound aria-hidden="true" />
              <span>Visiteurs</span>
              <strong>{statistics.summary.visitors}</strong>
              <small>comptes et invités</small>
            </article>
            <article className="admin-card">
              <XCircle aria-hidden="true" />
              <span>Annulations</span>
              <strong>{statistics.summary.cancelled}</strong>
              <small>{number.format(cancellationRate)} % des demandes</small>
            </article>
            <article className="admin-card">
              <CircleDollarSign aria-hidden="true" />
              <span>Chiffre d’affaires théorique</span>
              <strong>
                {currency.format(statistics.summary.revenueCents / 100)}
              </strong>
              <small>réservations confirmées ou réalisées</small>
            </article>
          </div>

          <div className="statistics-grid">
            <Breakdown
              title="Activité par terrain"
              subtitle="Réservations et heures occupées"
              rows={statistics.byResource}
            />
            <Breakdown
              title="Jours les plus fréquentés"
              subtitle="Répartition par jour de la semaine"
              rows={statistics.byWeekday}
            />
            <Breakdown
              title="Créneaux les plus demandés"
              subtitle="Heures de début des réservations"
              rows={statistics.byHour}
            />
          </div>
          <p className="statistics-footnote">
            Données générées le{" 