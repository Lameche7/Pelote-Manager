import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminAccessService } from "@/features/admin/access/adminAccessService";
import { ADMIN_PERMISSIONS } from "@/features/admin/config/adminPermissions";
import {
  loadAdminCalendarMatchContacts,
  type MatchContact,
} from "../services/adminCalendarMatchContactsService";
import { adminTournamentUnprogrammedService } from "@/features/admin/tournaments/services/adminTournamentUnprogrammedService";
import { ROUTES } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";
import {
  refereeingService,
  type RefereeCandidate,
} from "@/features/refereeing/services/refereeingService";
import type { CalendarSlot } from "../domain/calendar";
import { resolveCalendarPlayerActions } from "../services/calendarPlayerActionsService";
import { resolveCalendarCompetition } from "../services/calendarCompetitionService";

export function PlanningMatchActions({
  slot,
  clubSlug,
  clubId,
  onUpdated,
}: {
  slot: CalendarSlot;
  clubSlug: string | null;
  clubId: string | null;
  onUpdated: () => void;
}) {
  const { isAuthenticated } = useAuth();
  const [identity, setIdentity] =
    useState<Awaited<ReturnType<typeof resolveCalendarPlayerActions>>>(null);
  const [competition, setCompetition] =
    useState<Awaited<ReturnType<typeof resolveCalendarCompetition>>>(null);
  const [contacts, setContacts] = useState<MatchContact[] | null>(null);
  const [candidates, setCandidates] = useState<RefereeCandidate[] | null>(null);
  const [selectedReferee, setSelectedReferee] = useState("");
  const [adminClub, setAdminClub] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setAdminClub(null);
    setCandidates(null);
    setSelectedReferee("");
    setContacts(null);
    if (isAuthenticated && clubId) {
      void adminAccessService
        .getAccessForClub(clubId)
        .then((access) => {
          if (!active || access.clubId !== clubId) return;
          if (access.permissions.includes(ADMIN_PERMISSIONS.tournaments))
            setAdminClub(clubId);
        })
        .catch(() => {
          if (active) setAdminClub(null);
        });
    }
    return () => {
      active = false;
    };
  }, [clubId, isAuthenticated]);
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
      isAuthenticated
        ? resolveCalendarPlayerActions(slot)
        : Promise.resolve(null),
    ])
      .then(([match, actions]) => {
        if (!active) return;
        if (match?.kind === "tournament") {
          setCompetition(match);
          if (
            actions?.kind === "tournament" &&
            actions.matchId === match.matchId
          )
            setIdentity(actions);
        }
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Actions indisponibles.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slot, isAuthenticated]);
  const url = (path: string, matchId?: string) => {
    const params = new URLSearchParams();
    if (clubSlug) params.set("club", clubSlug);
    if (clubId && path.startsWith("/admin")) params.set("adminClubId", clubId);
    if (matchId) params.set("match", matchId);
    return params.size ? path + "?" + params.toString() : path;
  };
  const referee = async (withdraw: boolean) => {
    if (
      !isAuthenticated ||
      !identity ||
      busy ||
      (withdraw
        ? !identity.isAssignedReferee
        : !identity.actions.volunteerReferee)
    )
      return;
    if (withdraw && !window.confirm("Te retirer de cet arbitrage ?")) return;
    setBusy(true);
    setError("");
    try {
      const matches = await refereeingService.list();
      const match = matches.find(
        (item) =>
          item.match_id === identity.matchId &&
          item.source_type === "tournament" &&
          (withdraw ? item.is_mine : !item.referee_profile_id),
      );
      if (!match) throw new Error("Cet arbitrage n’est plus disponible.");
      if (withdraw) await refereeingService.withdraw(match);
      else await refereeingService.volunteer(match);
      onUpdated();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Modification de l’arbitrage impossible.",
      );
    } finally {
      setBusy(false);
    }
  };
  const openContacts = async () => {
    if (!isAuthenticated || !clubId || adminClub !== clubId || busy) return;
    setBusy(true);
    setError("");
    try {
      setContacts(await loadAdminCalendarMatchContacts(slot, clubId));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Contacts indisponibles.",
      );
    } finally {
      setBusy(false);
    }
  };
  const openReferees = async () => {
    if (!clubId || adminClub !== clubId || !competition || busy) return;
    setBusy(true);
    setError("");
    try {
      setCandidates(await refereeingService.tournamentCandidates(clubId));
      setSelectedReferee("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Arbitres indisponibles.");
    } finally {
      setBusy(false);
    }
  };
  const assignReferee = async (profileId: string | null) => {
    if (!clubId || adminClub !== clubId || !competition || busy) return;
    if (!window.confirm(profileId ? "Affecter cet arbitre ?" : "Retirer l’arbitre ?"))
      return;
    setBusy(true);
    setError("");
    try {
      const current = await resolveCalendarCompetition(slot);
      if (current?.kind !== "tournament" || current.matchId !== competition.matchId)
        throw new Error("La rencontre a changé.");
      await refereeingService.assignTournamentReferee(clubId, current.matchId, profileId);
      setCandidates(null);
      setSelectedReferee("");
      onUpdated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Affectation impossible.");
    } finally {
      setBusy(false);
    }
  };
  const unprogram = async () => {
    if (
      !isAuthenticated ||
      !clubId ||
      adminClub !== clubId ||
      !competition ||
      busy
    )
      return;
    if (!window.confirm("Déprogrammer cette partie de tournoi ?")) return;
    setBusy(true);
    setError("");
    try {
      await adminAccessService.getAccessForClub(clubId).then((access) => {
        if (!access.permissions.includes(ADMIN_PERMISSIONS.tournaments))
          throw new Error("Accès refusé.");
      });
      const current = await resolveCalendarCompetition(slot);
      if (
        current?.kind !== "tournament" ||
        current.matchId !== competition.matchId
      )
        throw new Error("La rencontre a changé.");
      await adminTournamentUnprogrammedService.unprogram(
        current.matchId,
        "Déprogrammation administrateur depuis le planning",
        clubId,
      );
      onUpdated();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Déprogrammation impossible.",
      );
    } finally {
      setBusy(false);
    }
  };
  if (loading) return <p role="status">Vérification des droits…</p>;
  return (
    <div className="reservation-slot-actions">
      {error && <p role="alert">{error}</p>}
      {competition && (
        <Link
          className="reservation-slot-actions__button"
          to={url(
            ROUTES.tournaments +
              "/" +
              encodeURIComponent(competition.competitionId),
          )}
        >
          Voir la compétition
        </Link>
      )}
      {isAuthenticated && clubId && adminClub === clubId && competition && (
        <div className="reservation-slot-actions reservation-slot-actions--admin">
          <h3>Actions administrateur</h3>
          <Link
            className="reservation-slot-actions__button"
            to={url(ROUTES.adminTournamentResults, competition.matchId)}
          >
            Gérer le résultat
          </Link>
          <Link
            className="reservation-slot-actions__button"
            to={url(ROUTES.adminTournamentReschedules, competition.matchId)}
          >
            Gérer le report
          </Link>
          <button
            className="reservation-slot-actions__button"
            type="button"
            disabled={busy || Boolean(slot.resultDisplay)}
            onClick={() => void unprogram()}
          >
            Déprogrammer la partie
          </button>
        </div>
      )}
      {isAuthenticated && clubId && adminClub === clubId && competition && (
        <div className="reservation-slot-actions">
          <button
            className="reservation-slot-actions__button"
            type="button"
            disabled={busy}
            onClick={() => void openContacts()}
          >
            Contacter les joueurs
          </button>
          {contacts?.map((contact, index) => (
            <p key={`${contact.team}-${index}`}>
              {contact.name} :{" "}
              {contact.phone ? (
                <a href={`tel:${contact.phone.replace(/[^+0-9]/g, "")}`}>
                  {contact.phone}
                </a>
              ) : (
                "Numéro non renseigné"
              )}
            </p>
          ))}
          {contacts?.length === 0 && <p>Aucun joueur identifié.</p>}
        </div>
      )}
      {isAuthenticated && clubId && adminClub === clubId && competition && (
        <div className="reservation-slot-actions">
          <button
            type="button"
            className="reservation-slot-actions__button"
            disabled={busy}
            onClick={() => void openReferees()}
          >
            Gérer l’arbitrage
          </button>
          {candidates && (
            <>
              <label>
                Arbitre
                <select
                  value={selectedReferee}
                  onChange={(event) => setSelectedReferee(event.target.value)}
                  disabled={busy}
                >
                  <option value="">Choisir un arbitre</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" disabled={busy || !selectedReferee} onClick={() => void assignReferee(selectedReferee)}>
                Affecter l’arbitre
              </button>
              <button type="button" disabled={busy} onClick={() => void assignReferee(null)}>
                Retirer l’arbitre
              </button>
            </>
          )}
        </div>
      )}
      {identity?.actions.submitResult && (
        <Link
          className="reservation-slot-actions__button"
          to={url(
            identity.isAssignedReferee && !identity.isParticipant
              ? ROUTES.myRefereeing
              : ROUTES.myTournaments,
            identity.matchId,
          )}
        >
          Saisir le résultat
        </Link>
      )}
      {identity?.actions.volunteerReferee && (
        <button
          className="reservation-slot-actions__button"
          type="button"
          disabled={busy}
          onClick={() => void referee(false)}
        >
          Je peux arbitrer
        </button>
      )}
      {identity?.isAssignedReferee && (
        <button
          className="reservation-slot-actions__button"
          type="button"
          disabled={busy}
          onClick={() => void referee(true)}
        >
          Me retirer de l’arbitrage
        </button>
      )}
      {identity?.actions.requestReportInMySpace && (
        <Link
          className="reservation-slot-actions__button"
          to={url(ROUTES.myTournaments, identity.matchId)}
        >
          Demander un report
        </Link>
      )}
    </div>
  );
}
