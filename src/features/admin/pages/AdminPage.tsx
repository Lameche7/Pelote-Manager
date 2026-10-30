import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  BellRing,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarX2,
  Trophy,
  Swords,
  CircleAlert,
  CreditCard,
  Megaphone,
  RefreshCw,
  UserCheck,
  Users,
} from "lucide-react";
import { useAdminAccess } from "@/features/admin/access/AdminAccessProvider";
import {
  ADMIN_PERMISSIONS,
  type AdminPermission,
} from "@/features/admin/config/adminPermissions";
import {
  adminDashboardService,
  type AdminDashboard,
  type DashboardActivity,
} from "@/features/admin/services/adminDashboardService";
import { ROUTES } from "@/shared/config";
import "./AdminDashboard.css";

const dateTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
});

const priorityLabels = {
  normal: "Normale",
  important: "Importante",
  urgent: "Urgente",
} as const;

const formatDateTime = (value: string) =>
  value ? dateTimeFormatter.format(new Date(value)) : "—";

const formatPeriod = (startsAt: string, endsAt: string) =>
  `${formatDateTime(startsAt)} – ${timeFormatter.format(new Date(endsAt))}`;

const activityPermission: Record<
  DashboardActivity["kind"],
  AdminPermission
> = {
  reservation: ADMIN_PERMISSIONS.reservations,
  event: ADMIN_PERMISSIONS.events,
  communication: ADMIN_PERMISSIONS.communication,
};

export function AdminPage() {
  const { hasPermission } = useAdminAccess();
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = async () => {
    setLoading(true);
    setError("");
    try {
      setDashboard(await adminDashboardService.getDashboard());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Chargement du tableau de bord impossible.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  const metrics = dashboard
    ? [
        {
          label: "Réservations du jour",
          value: dashboard.metrics.reservationsToday,
          detail: "Créneaux actifs aujourd’hui",
          icon: CalendarCheck,
          permission: ADMIN_PERMISSIONS.reservations,
          to: ROUTES.adminReservations,
        },
        {
          label: "À venir",
          value: dashboard.metrics.reservationsNext7Days,
          detail: "Réservations sur 7 jours",
          icon: CalendarClock,
          permission: ADMIN_PERMISSIONS.reservations,
          to: ROUTES.adminReservations,
        },
        {
          label: "Tournois · parties jouées",
          value: dashboard.metrics.tournamentMatches,
          detail: "Résultats validés à ce jour",
          icon: Trophy,
          permission: ADMIN_PERMISSIONS.tournaments,
          to: ROUTES.adminTournaments,
        },
        {
          label: "Championnats · parties jouées",
          value: dashboard.metrics.championshipMatches,
          detail: "Jouées au trinquet Robert Cathala",
          secondary: `Cette saison : ${dashboard.metrics.championshipMatchesTotal} · Victoires : ${dashboard.metrics.championshipWinRate.toLocaleString("fr-FR")}%`,
          icon: Swords,
          permission: ADMIN_PERMISSIONS.championships,
          to: ROUTES.adminChampionships,
        },
        {
          label: "Licenciés actifs",
          value: dashboard.metrics.activeMembers,
          detail: "Registre du club",
          icon: Users,
          permission: ADMIN_PERMISSIONS.members,
          to: ROUTES.adminMembers,
        },
        {
          label: "Comptes rattachés",
          value: dashboard.metrics.linkedAccounts,
          detail: "Licenciés disposant d’un compte",
          icon: UserCheck,
          permission: ADMIN_PERMISSIONS.members,
          to: ROUTES.adminMembers,
        },
        {
          label: "Alertes paiement",
          value: dashboard.metrics.paymentAlerts,
          detail: "Échecs ou paiements expirés",
          icon: CreditCard,
          permission: ADMIN_PERMISSIONS.paymentsRead,
          to: ROUTES.adminPayments,
          alert: dashboard.metrics.paymentAlerts > 0,
        },
        {
          label: "Fermetures à venir",
          value: dashboard.metrics.upcomingClosures,
          detail: "Dans les 30 prochains jours",
          icon: CalendarX2,
          permission: ADMIN_PERMISSIONS.reservations,
          to: ROUTES.adminClubClosures,
        },
        {
          label: "Évènements à venir",
          value: dashboard.metrics.upcomingEvents,
          detail: "Évènements publiés",
          icon: CalendarDays,
          permission: ADMIN_PERMISSIONS.events,
          to: ROUTES.adminEvents,
        },
        {
          label: "Messages actifs",
          value: dashboard.metrics.activeCommunications,
          detail: `${dashboard.metrics.unreadDeliveries} lecture(s) en attente`,
          icon: Megaphone,
          permission: ADMIN_PERMISSIONS.communication,
          to: ROUTES.adminCommunication,
        },
      ].filter((metric) => hasPermission(metric.permission))
    : [];

  const recentActivity =
    dashboard?.recentActivity.filter((activity) =>
      hasPermission(activityPermission[activity.kind]),
    ) ?? [];

  return (
    <section
      className="admin-page admin-dashboard"
      aria-labelledby="admin-title"
    >
      <header className="admin-page__header admin-dashboard__header">
        <div>
          <p className="admin-page__eyebrow">Vue d’ensemble</p>
          <h1 id="admin-title">Tableau de bord</h1>
          <p className="admin-page__lead">
            Les informations essentielles du club et les actions à traiter.
          </p>
          {dashboard?.generatedAt && (
            <small>
              Actualisé le {new Date(dashboard.generatedAt).toLocaleString("fr-FR")}
            </small>
          )}
        </div>
        <button
          type="button"
          className="admin-dashboard__refresh"
          disabled={loading}
          onClick={() => void loadDashboard()}
        >
          <RefreshCw aria-hidden="true" />
          Actualiser
        </button>
      </header>

      {error && (
        <div className="admin-dashboard__error" role="alert">
          <CircleAlert aria-hidden="true" />
          <div>
            <strong>Tableau de bord indisponible</strong>
            <span>{error}</span>
          </div>
        </div>
      )}

      {loading && !dashboard ? (
        <div className="admin-dashboard__loading" role="status">
          Chargement des données du club…
        </div>
      ) : dashboard ? (
        <>
          <div className="admin-dashboard__metrics">
            {metrics.map((metric) => {
              const Icon = metric.icon;
              return (
                <article
                  className={`admin-card admin-dashboard__metric${metric.alert ? " admin-dashboard__metric--alert" : ""}`}
                  key={metric.label}
                >
                  <Icon aria-hidden="true" />
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                  <small>{metric.detail}</small>
                  {"secondary" in metric && metric.secondary && (
                    <small>{metric.secondary}</small>
                  )}
                  <Link to={metric.to}>Ouvrir →</Link>
                </article>
              );
            })}
          </div>

          {(hasPermission(ADMIN_PERMISSIONS.tournaments) ||
            hasPermission(ADMIN_PERMISSIONS.championships)) &&
            dashboard.monthlyMatches.length > 0 && (
              <article className="admin-card admin-dashboard__panel">
                <header>
                  <div>
                    <span className="admin-dashboard__section-icon">
                      <CalendarDays aria-hidden="true" />
                    </span>
                    <div>
                      <h2>Bilan mensuel des parties jouées</h2>
                      <p>Douze derniers mois, jusqu’à aujourd’hui.</p>
                    </div>
                  </div>
                </header>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "right" }}>
                    <thead>
                      <tr>
                        <th scope="col" style={{ textAlign: "left", padding: "0.5rem" }}>Mois</th>
                        {hasPermission(ADMIN_PERMISSIONS.tournaments) && <th scope="col" style={{ padding: "0.5rem" }}>Tournois</th>}
                        {hasPermission(ADMIN_PERMISSIONS.championships) && <th scope="col" style={{ padding: "0.5rem" }}>Championnats · Robert Cathala</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.monthlyMatches.map((item) => (
                        <tr key={item.month}>
                          <th scope="row" style={{ textAlign: "left", padding: "0.5rem" }}>
                            {new Date(item.month + "-01T12:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
                          </th>
                          {hasPermission(ADMIN_PERMISSIONS.tournaments) && <td style={{ padding: "0.5rem" }}>{item.tournamentMatches}</td>}
                          {hasPermission(ADMIN_PERMISSIONS.championships) && <td style={{ padding: "0.5rem" }}>{item.championshipMatches}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            )}

          <div className="admin-dashboard__columns">
            {hasPermission(ADMIN_PERMISSIONS.reservations) && (
              <article className="admin-card admin-dashboard__panel">
                <header>
                  <div>
                    <span className="admin-dashboard__section-icon">
                      <CalendarClock aria-hidden="true" />
                    </span>
                    <div>
                      <h2>Prochaines réservations</h2>
                      <p>Les six prochains créneaux des sept jours à venir.</p>
                    </div>
                  </div>
                  <Link to={ROUTES.adminReservations}>Tout voir →</Link>
                </header>
                {dashboard.nextReservations.length === 0 ? (
                  <p className="admin-dashboard__empty">
                    Aucune réservation programmée dans les sept prochains jours.
                  </p>
                ) : (
                  <ul className="admin-dashboard__schedule">
                    {dashboard.nextReservations.map((reservation) => (
                      <li key={reservation.id}>
                        <time dateTime={reservation.startsAt}>
                          {formatPeriod(
                            reservation.startsAt,
                            reservation.endsAt,
                          )}
                        </time>
                        <strong>{reservation.resourceName}</strong>
                        <span>{reservation.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            )}

            <article className="admin-card admin-dashboard__panel admin-dashboard__watch">
              <header>
                <div>
                  <span className="admin-dashboard__section-icon">
                    <CircleAlert aria-hidden="true" />
                  </span>
                  <div>
                    <h2>À surveiller</h2>
                    <p>Les points qui demandent une attention particulière.</p>
                  </div>
                </div>
              </header>
              <ul>
                {hasPermission(ADMIN_PERMISSIONS.paymentsRead) && (
                  <li>
                    <CreditCard aria-hidden="true" />
                    <span>
                      <strong>{dashboard.metrics.paymentAlerts}</strong>
                      paiement(s) en anomalie
                    </span>
                    <Link to={ROUTES.adminPayments}>Voir</Link>
                  </li>
                )}
                {hasPermission(ADMIN_PERMISSIONS.reservations) && (
                  <li>
                    <CalendarX2 aria-hidden="true" />
                    <span>
                      <strong>{dashboard.metrics.upcomingClosures}</strong>
                      fermeture(s) à venir
                    </span>
                    <Link to={ROUTES.adminClubClosures}>Voir</Link>
                  </li>
                )}
                {hasPermission(ADMIN_PERMISSIONS.communication) && (
                  <li>
                    <BellRing aria-hidden="true" />
                    <span>
                      <strong>{dashboard.metrics.unreadDeliveries}</strong>
                      notification(s) non lue(s)
                    </span>
                    <Link to={ROUTES.adminCommunication}>Voir</Link>
                  </li>
                )}
              </ul>
            </article>
          </div>

          <div className="admin-dashboard__detail-grid">
            {hasPermission(ADMIN_PERMISSIONS.events) && (
              <article className="admin-card admin-dashboard__panel">
                <header>
                  <div>
                    <span className="admin-dashboard__section-icon">
                      <CalendarDays aria-hidden="true" />
                    </span>
                    <div>
                      <h2>Prochains évènements</h2>
                      <p>Évènements actuellement publiés.</p>
                    </div>
                  </div>
                  <Link to={ROUTES.adminEvents}>Gérer →</Link>
                </header>
                {dashboard.upcomingEvents.length === 0 ? (
                  <p className="admin-dashboard__empty">Aucun évènement à venir.</p>
                ) : (
                  <ul className="admin-dashboard__compact-list">
                    {dashboard.upcomingEvents.map((event) => (
                      <li key={event.id}>
                        <span
                          className="admin-dashboard__event-dot"
                          style={{ background: event.color }}
                          aria-hidden="true"
                        />
                        <div>
                          <strong>{event.name}</strong>
                          <small>
                            {event.typeName} · {formatDateTime(event.startsAt)}
                          </small>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            )}

            {hasPermission(ADMIN_PERMISSIONS.communication) && (
              <article className="admin-card admin-dashboard__panel">
                <header>
                  <div>
                    <span className="admin-dashboard__section-icon">
                      <Megaphone aria-hidden="true" />
                    </span>
                    <div>
                      <h2>Communications actives</h2>
                      <p>Messages actuellement diffusés aux licenciés.</p>
                    </div>
                  </div>
                  <Link to={ROUTES.adminCommunication}>Gérer →</Link>
                </header>
                {dashboard.activeCommunications.length === 0 ? (
                  <p className="admin-dashboard__empty">
                    Aucune communication active.
                  </p>
                ) : (
                  <ul className="admin-dashboard__compact-list">
                    {dashboard.activeCommunications.map((communication) => (
                      <li key={communication.id}>
                        <span
                          className={`admin-dashboard__priority admin-dashboard__priority--${communication.priority}`}
                        >
                          {priorityLabels[communication.priority]}
                        </span>
                        <div>
                          <strong>{communication.title}</strong>
                          <small>
                            {communication.unreadCount} non lue(s) sur{" "}
                            {communication.recipientCount}
                          </small>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            )}

            {hasPermission(ADMIN_PERMISSIONS.reservations) && (
              <article className="admin-card admin-dashboard__panel">
                <header>
                  <div>
                    <span className="admin-dashboard__section-icon">
                      <CalendarX2 aria-hidden="true" />
                    </span>
                    <div>
                      <h2>Fermetures programmées</h2>
                      <p>Fermetures et maintenances des 30 prochains jours.</p>
                    </div>
                  </div>
                  <Link to={ROUTES.adminClubClosures}>Gérer →</Link>
                </header>
                {dashboard.upcomingClosures.length === 0 ? (
                  <p className="admin-dashboard__empty">
                    Aucune fermeture programmée.
                  </p>
                ) : (
                  <ul className="admin-dashboard__compact-list">
                    {dashboard.upcomingClosures.map((closure) => (
                      <li key={closure.id}>
                        <CalendarX2 aria-hidden="true" />
                        <div>
                          <strong>{closure.title}</strong>
                          <small>
                            {closure.resourceName} ·{" "}
                            {formatDateTime(closure.startsAt)}
                          </small>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            )}
          </div>

          {recentActivity.length > 0 && (
            <article className="admin-card admin-dashboard__panel admin-dashboard__activity">
              <header>
                <div>
                  <span className="admin-dashboard__section-icon">
                    <Activity aria-hidden="true" />
                  </span>
                  <div>
                    <h2>Activité récente</h2>
                    <p>Dernières opérations enregistrées dans le club.</p>
                  </div>
                </div>
              </header>
              <ul>
                {recentActivity.map((activity) => (
                  <li key={`${activity.kind}-${activity.entityId}`}>
                    <span>{activity.label}</span>
                    <time dateTime={activity.occurredAt}>
                      {formatDateTime(activity.occurredAt)}
                    </time>
                    <Link to={activity.targetPath}>Ouvrir →</Link>
                  </li>
                ))}
              </ul>
            </article>
          )}
        </>
      ) : null}
    </section>
  );
}
