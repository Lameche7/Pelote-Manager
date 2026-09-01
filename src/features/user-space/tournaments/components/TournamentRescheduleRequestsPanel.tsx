import { useCallback, useEffect, useMemo, useState } from "react";
import {
  tournamentRescheduleService,
  type TournamentRescheduleApproval,
  type TournamentRescheduleRequest,
} from "@/features/user-space/tournaments/services/tournamentRescheduleService";
import "./TournamentRescheduleRequestsPanel.css";

const shortDate = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

const dateLabel = (value: string) =>
  shortDate.format(new Date(`${value}T12:00:00`));

const statusLabels: Record<TournamentRescheduleRequest["status"], string> = {
  pending: "Accords en cours",
  approved: "Tous les accords réunis",
  rejected: "Refusée",
  cancelled: "Annulée",
  stale: "Expirée",
  applied: "Report appliqué",
};

const decisionLabel = (approval: TournamentRescheduleApproval) => {
  if (approval.decision === "approved") return "Accepté";
  if (approval.decision === "rejected") return "Refusé";
  return "En attente";
};

function RequestCard({
  request,
  busy,
  onDecide,
  onCancel,
}: {
  request: TournamentRescheduleRequest;
  busy: string;
  onDecide: (
    requestId: string,
    teamId: string,
    decision: "approved" | "rejected",
  ) => Promise<void>;
  onCancel: (requestId: string) => Promise<void>;
}) {
  const proposal = request.proposal;
  const actionableApprovals = request.approvals.filter(
    (approval) => approval.canAct && approval.decision === "pending",
  );
  const missingActors = request.approvals.filter(
    (approval) =>
      !approval.isRequester &&
      approval.decision === "pending" &&
      approval.appActorCount === 0,
  );

  return (
    <article
      className={`tournament-reschedule-requests__card tournament-reschedule-requests__card--${request.status}`}
    >
      <header>
        <div>
          <span>{request.tournamentName}</span>
          <strong>{statusLabels[request.status]}</strong>
        </div>
        <span>
          {request.proposalKind === "swap"
            ? "Échange de matchs"
            : "Créneau libre"}
        </span>
      </header>

      <div className="tournament-reschedule-requests__move">
        <div>
          <small>Partie actuelle</small>
          <strong>
            {dateLabel(request.match.playDate)} · {request.match.startsAt}–
            {request.match.endsAt}
          </strong>
          <span>{request.match.resourceName}</span>
        </div>
        <span aria-hidden="true">→</span>
        <div>
          <small>Proposition</small>
          <strong>
            {dateLabel(proposal.playDate)} · {proposal.startsAt}–
            {proposal.endsAt}
          </strong>
          <span>{proposal.resourceName}</span>
        </div>
      </div>

      <p>
        <strong>{request.requesterLabel}</strong> demande le report de la partie
        contre <strong>{request.match.opponentLabel}</strong>.
      </p>

      {proposal.kind === "swap" && (
        <div className="tournament-reschedule-requests__swap">
          <strong>Échange proposé</strong>
          <span>
            {proposal.swapTeamALabel} / {proposal.swapTeamBLabel} prendraient le
            créneau initial du match demandeur :{" "}
            {dateLabel(proposal.swapMovesToPlayDate)} ·{" "}
            {proposal.swapMovesToStartsAt}–{proposal.swapMovesToEndsAt} ·{" "}
            {proposal.swapMovesToResourceName}.
          </span>
        </div>
      )}

      <div className="tournament-reschedule-requests__approvals">
        <strong>Accords des équipes</strong>
        {request.approvals.map((approval) => (
          <div key={approval.teamId}>
            <span>
              {approval.teamLabel}
              {approval.isRequester ? " · demandeur" : ""}
            </span>
            <strong data-decision={approval.decision}>
              {decisionLabel(approval)}
            </strong>
          </div>
        ))}
      </div>

      {missingActors.length > 0 && request.status === "pending" && (
        <p className="tournament-reschedule-requests__warning" role="status">
          {missingActors.map((approval) => approval.teamLabel).join(", ")} :
          aucun compte Pelote Manager relié à cette équipe. L’organisation devra
          la contacter hors application avant toute suite.
        </p>
      )}

      {actionableApprovals.map((approval) => (
        <div
          className="tournament-reschedule-requests__decision"
          key={`decision-${approval.teamId}`}
        >
          <strong>Répondre pour {approval.teamLabel}</strong>
          <div>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() =>
                void onDecide(request.id, approval.teamId, "approved")
              }
            >
              Accepter
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() =>
                void onDecide(request.id, approval.teamId, "rejected")
              }
            >
              Refuser
            </button>
          </div>
        </div>
      ))}

      {request.status === "approved" && (
        <p className="tournament-reschedule-requests__ready" role="status">
          Tous les accords sont réunis. Le planning n’a pas encore été modifié :
          la demande attend l’application par l’organisation.
        </p>
      )}

      {request.canCancel && (
        <button
          className="tournament-reschedule-requests__cancel"
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void onCancel(request.id)}
        >
          Annuler ma demande
        </button>
      )}
    </article>
  );
}

export function TournamentRescheduleRequestsPanel({
  refreshKey = 0,
}: {
  refreshKey?: number;
}) {
  const [requests, setRequests] = useState<TournamentRescheduleRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const items = await tournamentRescheduleService.listRequests();
    setRequests(items);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    tournamentRescheduleService
      .listRequests()
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
  }, [refreshKey]);

  const decide = async (
    requestId: string,
    teamId: string,
    decision: "approved" | "rejected",
  ) => {
    setBusy(`${requestId}:${teamId}`);
    setError("");
    try {
      await tournamentRescheduleService.decideRequest(
        requestId,
        teamId,
        decision,
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’enregistrer votre réponse.",
      );
    } finally {
      setBusy("");
    }
  };

  const cancel = async (requestId: string) => {
    if (!window.confirm("Annuler cette demande de report ?")) return;
    setBusy(requestId);
    setError("");
    try {
      await tournamentRescheduleService.cancelRequest(requestId);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’annuler cette demande.",
      );
    } finally {
      setBusy("");
    }
  };

  const current = useMemo(
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

  if (loading) return null;
  if (requests.length === 0 && !error) return null;

  return (
    <section
      className="tournament-reschedule-requests"
      aria-labelledby="tournament-reschedule-requests-title"
    >
      <header>
        <div>
          <p>Reports de parties</p>
          <h2 id="tournament-reschedule-requests-title">Reports à traiter</h2>
        </div>
        {current.length > 0 && (
          <span>
            {current.length} demande{current.length > 1 ? "s" : ""} active
            {current.length > 1 ? "s" : ""}
          </span>
        )}
      </header>

      {error && (
        <p className="tournament-reschedule-requests__error" role="alert">
          {error}
        </p>
      )}

      {current.length > 0 ? (
        <div className="tournament-reschedule-requests__list">
          {current.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              busy={busy}
              onDecide={decide}
              onCancel={cancel}
            />
          ))}
        </div>
      ) : (
        <p className="tournament-reschedule-requests__empty">
          Aucune demande de report active.
        </p>
      )}

      {history.length > 0 && (
        <details>
          <summary>Historique des demandes ({history.length})</summary>
          <div className="tournament-reschedule-requests__list">
            {history.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                busy={busy}
                onDecide={decide}
                onCancel={cancel}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
