import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ROUTES } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";
import { refereeingService } from "@/features/refereeing/services/refereeingService";
import type { CalendarSlot } from "../domain/calendar";
import { resolveCalendarPlayerActions } from "../services/calendarPlayerActionsService";
import { resolveCalendarCompetition } from "../services/calendarCompetitionService";

export function PlanningMatchActions({
  slot,
  clubSlug,
  onUpdated,
}: {
  slot: CalendarSlot;
  clubSlug: string | null;
  onUpdated: () => void;
}) {
  const { isAuthenticated } = useAuth();
  const [identity, setIdentity] = useState<Awaited<ReturnType<typeof resolveCalendarPlayerActions>>>(null);
  const [competition, setCompetition] = useState<Awaited<ReturnType<typeof resolveCalendarCompetition>>>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setIdentity(null);
    setCompetition(null);
    setLoading(true);
    setError("");
    if (slot.status !== "occupied" || slot.occupationType !== "match") {
      setLoading(false);
      return;
    }
    void Promise.all([
      resolveCalendarCompetition(slot),
      isAuthenticated ? resolveCalendarPlayerActions(slot) : Promise.resolve(null),
    ]).then(([match, actions]) => {
      if (!active) return;
      if (match?.kind === "tournament") {
        setCompetition(match);
        if (actions?.kind === "tournament" && actions.matchId === match.matchId) setIdentity(actions);
      }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Actions indisponibles.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [slot, isAuthenticated]);
  const url = (path: string, matchId?: string) => {
    const params = new URLSearchParams();
    if (clubSlug) params.set("club", clubSlug);
    if (matchId) params.set("match", matchId);
    return params.size ? path + "?" + params.toString() : path;
  };
  const referee = async (withdraw: boolean) => {
    if (!identity || busy || (withdraw ? !identity.isAssignedReferee : !identity.actions.volunteerReferee)) return;
    if (withdraw && !window.confirm("Te retirer de cet arbitrage ?")) return;
    setBusy(true);
    setError("");
    try {
      const matches = await refereeingService.list();
      const match = matches.find((item) => item.match_id === identity.matchId && item.source_type === "tournament" && (withdraw ? item.is_mine : !item.referee_profile_id));
      if (!match) throw new Error("Cet arbitrage n’est plus disponible.");
      if (withdraw) await refereeingService.withdraw(match);
      else await refereeingService.volunteer(match);
      onUpdated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Modification de l’arbitrage impossible.");
    } finally {
      setBusy(false);
    }
  };
  if (loading) return <p role="status">Vérification des droits…</p>;
  return (
    <div className="reservation-slot-actions">
      {error && <p role="alert">{error}</p>}
      {competition && (
        <Link className="reservation-slot-actions__button" to={url(ROUTES.tournaments + "/" + encodeURIComponent(competition.competitionId))}>Voir la compétition</Link>
      )}
      {identity?.actions.submitResult && (
        <Link className="reservation-slot-actions__button" to={url(identity.isAssignedReferee && !identity.isParticipant ? ROUTES.myRefereeing : ROUTES.myTournaments, identity.matchId)}>Saisir le résultat</Link>
      )}
      {identity?.actions.volunteerReferee && (
        <button className="reservation-slot-actions__button" type="button" disabled={busy} onClick={() => void referee(false)}>Je peux arbitrer</button>
      )}
      {identity?.isAssignedReferee && (
        <button className="reservation-slot-actions__button" type="button" disabled={busy} onClick={() => void referee(true)}>Me retirer de l’arbitrage</button>
      )}
      {identity?.actions.requestReportInMySpace && (
        <Link className="reservation-slot-actions__button" to={url(ROUTES.myTournaments, identity.matchId)}>Demander un report</Link>
      )}
    </div>
  );
}
