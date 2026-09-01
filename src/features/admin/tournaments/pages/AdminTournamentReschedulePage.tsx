import { useEffect, useMemo, useState } from "react";
import {
  adminTournamentRescheduleService,
  type AdminTournamentRescheduleRequest,
} from "@/features/admin/tournaments/services/adminTournamentRescheduleService";
import "./AdminTournamentReschedulePage.css";

const shortDate = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

const dateLabel = (value: string) =>
  shortDate.format(new Date(`${value}T12:00:00`));

const statusLabels: Record<AdminTournamentRescheduleRequest["status"], string> =
  {
    pending: "Accords en cours",
    approved: "Prêt à appliquer",
    rejected: "Refusé",
    cancelled: "Annulé",
    stale: "Expiré",
    applied: "Appliqué",
  };

const decisionLabels = {
  pending: "En attente",
  approved: "Accepté",
  rejected: "Refusé",
} as const;

export function AdminTournamentReschedulePage() {
  const [requests, setRequests] = useState<AdminTournamentRescheduleRequest[]>(
    [],
  );
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    adminTournamentRescheduleService
      .list()
      .then((items) => {
        if (active) setRequests(items);
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Impossible de charger les demandes de report.",
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

  const active = useMemo(
    () =>
      requests.filter((request) =>
        ["pending", "approved"].includes(request.status),
      ),
    [requests],
  );
  const history = useMemo(
    () =>
      requests.filter(
        (request) => !["pending", "approved"].includes(request.status),
      ),
    [requests],
  );
  const visible = showHistory ? requests : active;
  const readyCount = active.filter(
    (request) => request.status === "approved",
  ).length;
  const blockedCount = active.filter((request) =>
    request.approvals.some(
      (approval) =>
        approval.decision === "pending" && approval.appActorCount === 0,
    ),
  ).length;

  return (
    <section className="admin-reschedules">
      <header className="admin-reschedules__header">
        <div>
          <p className="admin-page__eyebrow">Tournois</p>
          <h1>Reports de parties</h1>
          <p>
            Suivez les demandes initiées par les joueurs et les accords des
            équipes concernées. Aucun déplacement n’est encore appliqué depuis
            cet écran.
          </p>
        </div>
        <div className="admin-reschedules__summary">
          <span>
            <strong>{active.length}</strong> actives
          </span>
          <span>
            <strong>{readyCount}</strong> prêtes
          </span>
          <span>
            <strong>{blockedCount}</strong> sans interlocuteur app
          </span>
        </div>
      </header>

      <div className="admin-reschedules__toolbar">
        <button
          type="button"
          aria-pressed={!showHistory}
          onClick={() => setShowHistory(false)}
        >
          Demandes actives ({active.length})
        </button>
        <button
          type="button"
          aria-pressed={showHistory}
          onClick={() => setShowHistory(true)}
        >
          Tout l’historique ({requests.length})
        </button>
      </div>

      {loading && <p role="status">Chargement des reports…</p>}
      {error && (
        <p className="admin-reschedules__error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && visible.length === 0 && (
        <div className="admin-reschedules__empty">
          <strong>Aucune demande de report.</strong>
          <span>
            Les demandes créées depuis l’espace joueur apparaîtront ici.
          </span>
        </div>
      )}

      <div className="admin-reschedules__list">
        {visible.map((request) => {
          const missingActors = request.approvals.filter(
            (approval) =>
              approval.decision === "pending" && approval.appActorCount === 0,
          );
          return (
            <article
              className={`admin-reschedules__card admin-reschedules__card--${request.status}`}
              key={request.id}
            >
              <header>
                <div>
                  <span>{request.tournamentName}</span>
                  <h2>
                    {request.requesterLabel} vs {request.original.opponentLabel}
                  </h2>
                </div>
                <strong>{statusLabels[request.status]}</strong>
              </header>

              <div className="admin-reschedules__move">
                <div>
                  <small>Créneau actuel</small>
                  <strong>
                    {dateLabel(request.original.playDate)} ·{" "}
                    {request.original.startsAt}–{request.original.endsAt}
                  </strong>
                  <span>{request.original.resourceName}</span>
                </div>
                <span aria-hidden="true">→</span>
                <div>
                  <small>Créneau demandé</small>
                  <strong>
                    {dateLabel(request.target.playDate)} ·{" "}
                    {request.target.startsAt}–{request.target.endsAt}
                  </strong>
                  <span>{request.target.resourceName}</span>
                </div>
              </div>

              {request.swap && (
                <div className="admin-reschedules__swap">
                  <strong>Échange avec un autre match</strong>
                  <span>
                    {request.swap.teamALabel} / {request.swap.teamBLabel}{" "}
                    seraient déplacés vers{" "}
                    {dateLabel(request.swap.returnPlayDate)} ·{" "}
                    {request.swap.returnStartsAt}–{request.swap.returnEndsAt} ·{" "}
                    {request.swap.returnResourceName}.
                  </span>
                </div>
              )}

              <div className="admin-reschedules__approvals">
                <strong>Accords nécessaires</strong>
                {request.approvals.map((approval) => (
                  <div key={approval.teamId}>
                    <span>
                      {approval.teamLabel}
                      {approval.isRequester ? " · demandeur" : ""}
                    </span>
                    <span>
                      <strong data-decision={approval.decision}>
                        {decisionLabels[approval.decision]}
                      </strong>
                      {!approval.isRequester && (
                        <small>
                          {approval.appActorCount > 0
                            ? `${approval.appActorCount} compte${approval.appActorCount > 1 ? "s" : ""} relié${approval.appActorCount > 1 ? "s" : ""}`
                            : "aucun compte relié"}
                        </small>
                      )}
                    </span>
                  </div>
                ))}
              </div>

              {missingActors.length > 0 && (
                <p className="admin-reschedules__warning">
                  À contacter hors application :{" "}
                  {missingActors
                    .map((approval) => approval.teamLabel)
                    .join(", ")}
                  . Pelote Manager ne considère pas ces équipes comme ayant
                  donné leur accord.
                </p>
              )}

              {request.status === "approved" && (
                <p className="admin-reschedules__ready">
                  Tous les accords sont réunis. L’application transactionnelle
                  du report sera activée dans l’étape suivante de la PR127.
                </p>
              )}
            </article>
          );
        })}
      </div>

      {!showHistory && history.length > 0 && (
        <small className="admin-reschedules__history-hint">
          {history.length} demande{history.length > 1 ? "s" : ""} terminée
          {history.length > 1 ? "s" : ""} disponible
          {history.length > 1 ? "s" : ""} dans l’historique.
        </small>
      )}
    </section>
  );
}
