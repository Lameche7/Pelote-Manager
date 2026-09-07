import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ADMIN_RESCHEDULE_APPLY_LABEL,
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
    stale: "Expiré / obsolète",
    applied: "Appliqué",
  };

const decisionLabels = {
  pending: "En attente",
  approved: "Accepté",
  rejected: "Refusé",
} as const;

const staleReasonLabels: Record<string, string> = {
  request_expired: "La demande a dépassé son délai d’application.",
  tournament_stage_changed: "Le tournoi a changé d’étape.",
  source_planning_changed: "Le créneau d’origine a changé depuis la demande.",
  swap_planning_changed:
    "Le match proposé pour l’échange a changé depuis la demande.",
  match_has_result: "La partie possède désormais un résultat.",
  swap_match_has_result:
    "Le match proposé pour l’échange possède désormais un résultat.",
  match_unpublished: "La partie n’est plus publiée.",
  swap_match_unpublished:
    "Le match proposé pour l’échange n’est plus publié.",
  target_slot_invalid: "Le créneau demandé n’est plus disponible dans le tournoi.",
  target_slot_started: "Le créneau demandé a déjà commencé.",
  target_slot_conflict: "Le créneau demandé est désormais occupé.",
  swap_return_slot_conflict:
    "Le créneau de retour de l’échange est désormais occupé.",
  calendar_conflict: "Une occupation du calendrier est apparue sur le créneau.",
  calendar_or_planning_conflict:
    "Un conflit est apparu au moment de synchroniser le planning et le calendrier.",
  team_overlap: "Une équipe concernée aurait deux parties qui se chevauchent.",
  other_team_daily_load_increased:
    "Le déplacement augmenterait la charge quotidienne d’une autre équipe.",
  affected_team_unavailable:
    "Une équipe concernée n’est plus disponible sur le créneau proposé.",
  final_grid_changed: "La grille de phase finale a changé depuis la demande.",
  final_grid_slot_reserved:
    "Le créneau est désormais réservé par la grille de phase finale.",
  another_reschedule_started:
    "Un autre report concernant l’un des matchs a été engagé.",
};

const staleReasonLabel = (reason: string | null) =>
  reason
    ? (staleReasonLabels[reason] ??
      "La proposition n’est plus applicable dans le planning actuel.")
    : "La proposition n’est plus applicable dans le planning actuel.";

export function AdminTournamentReschedulePage() {
  const [requests, setRequests] = useState<AdminTournamentRescheduleRequest[]>(
    [],
  );
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [offlineNotes, setOfflineNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const items = await adminTournamentRescheduleService.list();
    setRequests(items);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
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

  const recordOfflineDecision = async (
    request: AdminTournamentRescheduleRequest,
    teamId: string,
    decision: "approved" | "rejected",
  ) => {
    const key = `${request.id}:${teamId}`;
    const note = (offlineNotes[key] ?? "").trim();
    if (note.length < 3) {
      setError(
        "Indiquez comment la réponse a été recueillie : téléphone, échange au club, message…",
      );
      return;
    }
    if (
      decision === "rejected" &&
      !window.confirm(
        "Enregistrer le refus de cette équipe et clôturer la demande ?",
      )
    ) {
      return;
    }

    setBusy(key);
    setError("");
    setSuccess("");
    try {
      await adminTournamentRescheduleService.recordOfflineDecision(
        request.id,
        teamId,
        decision,
        note,
      );
      setOfflineNotes((current) => ({ ...current, [key]: "" }));
      setSuccess(
        decision === "approved"
          ? "Accord hors application enregistré et audité."
          : "Refus hors application enregistré et audité.",
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’enregistrer cette réponse.",
      );
    } finally {
      setBusy("");
    }
  };

  const applyRequest = async (request: AdminTournamentRescheduleRequest) => {
    const message = request.swap
      ? "Appliquer cet échange de deux matchs ? Le planning, la grille finale éventuelle et le calendrier seront synchronisés dans une seule transaction."
      : "Appliquer ce report ? Le planning, la grille finale éventuelle et le calendrier seront synchronisés dans une seule transaction.";
    if (!window.confirm(message)) return;

    setBusy(`apply:${request.id}`);
    setError("");
    setSuccess("");
    try {
      const result = await adminTournamentRescheduleService.apply(request.id);
      if (result.status === "stale") {
        setError(staleReasonLabel(result.reason));
      } else {
        setSuccess(
          request.swap
            ? "Échange appliqué : les deux matchs et le calendrier sont à jour."
            : "Report appliqué : le planning et le calendrier sont à jour.",
        );
      }
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Impossible d’appliquer ce report.",
      );
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="admin-reschedules">
      <header className="admin-reschedules__header">
        <div>
          <p className="admin-page__eyebrow">Tournois</p>
          <h1>Reports de parties</h1>
          <p>
            Suivez les demandes, recueillez si nécessaire une réponse hors
            application, puis appliquez uniquement les reports acceptés par toutes
            les équipes concernées.
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
            <strong>{blockedCount}</strong> à contacter
          </span>
        </div>
      </header>

      <p className="admin-reschedules__ready" role="status">
        L’application est atomique : planning, éventuel échange, grille finale et
        calendrier sont modifiés ensemble, ou aucun changement n’est conservé.
      </p>

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
      {success && (
        <p className="admin-reschedules__success" role="status">
          {success}
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
                  <small>
                    {request.status === "applied"
                      ? "Ancien créneau"
                      : "Créneau actuel"}
                  </small>
                  <strong>
                    {dateLabel(request.original.playDate)} ·{" "}
                    {request.original.startsAt}–{request.original.endsAt}
                  </strong>
                  <span>{request.original.resourceName}</span>
                </div>
                <span aria-hidden="true">→</span>
                <div>
                  <small>
                    {request.status === "applied"
                      ? "Nouveau créneau"
                      : "Créneau demandé"}
                  </small>
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
                    {request.status === "applied" ? "ont été" : "seraient"}{" "}
                    déplacés vers {dateLabel(request.swap.returnPlayDate)} ·{" "}
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
                      {approval.decisionSource === "offline_admin" ? (
                        <small title={approval.decisionNote ?? undefined}>
                          réponse recueillie hors application
                        </small>
                      ) : !approval.isRequester ? (
                        <small>
                          {approval.appActorCount > 0
                            ? `${approval.appActorCount} compte${approval.appActorCount > 1 ? "s" : ""} relié${approval.appActorCount > 1 ? "s" : ""}`
                            : "aucun compte relié"}
                        </small>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>

              {missingActors.length > 0 && request.status === "pending" && (
                <div className="admin-reschedules__offline">
                  <strong>À contacter hors application</strong>
                  <p>
                    Pelote Manager n’invente aucun accord. Après avoir réellement
                    contacté l’équipe, enregistrez sa réponse et le moyen de
                    contact utilisé.
                  </p>
                  {missingActors.map((approval) => {
                    const key = `${request.id}:${approval.teamId}`;
                    return (
                      <div className="admin-reschedules__offline-row" key={key}>
                        <label>
                          <span>{approval.teamLabel}</span>
                          <input
                            type="text"
                            maxLength={500}
                            value={offlineNotes[key] ?? ""}
                            placeholder="Ex. accord par téléphone avec le joueur"
                            onChange={(event) =>
                              setOfflineNotes((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <div>
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void recordOfflineDecision(
                                request,
                                approval.teamId,
                                "approved",
                              )
                            }
                          >
                            Accord recueilli
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() =>
                              void recordOfflineDecision(
                                request,
                                approval.teamId,
                                "rejected",
                              )
                            }
                          >
                            Refus recueilli
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {request.status === "approved" && (
                <div className="admin-reschedules__apply">
                  <p>
                    <strong>Tous les accords sont réunis.</strong> Le moteur va
                    recontrôler le planning au moment exact de l’application. Si
                    le créneau est devenu impossible, la demande sera classée
                    obsolète sans déplacement partiel.
                  </p>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void applyRequest(request)}
                  >
                    {busy === `apply:${request.id}`
                      ? "Application…"
                      : ADMIN_RESCHEDULE_APPLY_LABEL}
                  </button>
                </div>
              )}

              {request.status === "applied" && (
                <p className="admin-reschedules__applied" role="status">
                  Planning et calendrier synchronisés. Les équipes reliées ont été
                  notifiées du nouveau créneau.
                </p>
              )}

              {request.status === "stale" && (
                <p className="admin-reschedules__warning">
                  {staleReasonLabel(request.staleReason)}
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
