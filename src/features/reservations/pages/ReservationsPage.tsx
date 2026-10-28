import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PushActivationNudge } from "@/features/notifications/components/PushActivationNudge";
import { ReservationSplitPaymentFields } from "@/features/reservations/components/ReservationSplitPaymentFields";
import {
  formatPrice,
  getBookingErrorMessage,
  type ReservationTerms,
} from "@/features/reservations/domain/booking";
import {
  addDays,
  buildWeekDays,
  formatTime,
  groupSlotsByLocalDate,
  startOfIsoWeek,
  toDateInputValue,
  type CalendarSlot,
  type ReservableResource,
} from "@/features/reservations/domain/calendar";
import {
  reservationBookingService,
  type ReservationPaymentPlayer,
} from "@/features/reservations/services/reservationBookingService";
import { reservationCalendarService } from "@/features/reservations/services/reservationCalendarService";
import {
  championshipMatchReservationService,
  type ChampionshipMatchReservationContext,
} from "@/features/user-space/championships/services/championshipMatchReservationService";
import { ROUTES } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";
import { CalendarWeekGrid } from "../components/CalendarWeekGrid";
import { resolveCalendarPlayerActions } from "../services/calendarPlayerActionsService";
import { resolveCalendarCompetition } from "../services/calendarCompetitionService";
import { refereeingService } from "@/features/refereeing/services/refereeingService";
import { adminTournamentUnprogrammedService } from "@/features/admin/tournaments/services/adminTournamentUnprogrammedService";
import { loadAdminCalendarMatchContacts, type MatchContact } from "@/features/reservations/services/adminCalendarMatchContactsService";
import { adminCalendarChampionshipService, type ChampionshipCalendarCandidate } from "@/features/reservations/services/adminCalendarChampionshipService";
import { tournamentAdminService } from "@/features/admin/tournaments/services/tournamentAdminService";
import { adminAccessService, type ClubAccess } from "@/features/admin/access/adminAccessService";
import { ADMIN_PERMISSIONS } from "@/features/admin/config/adminPermissions";
import "./ReservationsPage.css";
import "./ReservationsResponsive.css";
import "./ReservationLockedSlots.css";
import "./ReservationPaymentChoice.css";

const fullDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const rangeFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const initialAnchorDate = (value: string | null) => {
  if (!value) return startOfIsoWeek(new Date());
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? startOfIsoWeek(new Date())
    : startOfIsoWeek(parsed);
};

function CalendarSkeleton() {
  return (
    <div
      className="reservation-calendar__skeleton"
      aria-label="Chargement du calendrier"
    >
      {Array.from({ length: 7 }, (_, index) => (
        <div className="reservation-calendar__skeleton-column" key={index} />
      ))}
    </div>
  );
}

function ChampionshipMatchRequiredModal({
  onClose,
}: {
  onClose: () => void;
}) {
  return (
    <div className="booking-modal" role="presentation" onMouseDown={onClose}>
      <section
        className="booking-modal__panel booking-modal__account-required"
        role="dialog"
        aria-modal="true"
        aria-labelledby="championship-match-required-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="booking-modal__close"
          aria-label="Fermer"
          onClick={onClose}
        >
          ×
        </button>
        <p className="booking-modal__eyebrow">Créneau championnat</p>
        <h2 id="championship-match-required-title">
          Choisissez d’abord votre rencontre
        </h2>
        <p>
          Ce créneau est réservé aux rencontres de championnat. Pour le
          réserver, ouvrez « Mes championnats », choisissez la partie concernée,
          puis utilisez « Réserver un terrain pour cette rencontre ».
        </p>
        <div className="booking-modal__actions">
          <button
            type="button"
            className="booking-modal__secondary"
            onClick={onClose}
          >
            Retour au calendrier
          </button>
          <Link to={ROUTES.myChampionships}>Choisir ma rencontre</Link>
        </div>
      </section>
    </div>
  );
}

function AccountRequiredModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="booking-modal" role="presentation" onMouseDown={onClose}>
      <section
        className="booking-modal__panel booking-modal__account-required"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-required-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="booking-modal__close"
          aria-label="Fermer"
          onClick={onClose}
        >
          ×
        </button>
        <p className="booking-modal__eyebrow">Compte utilisateur</p>
        <h2 id="account-required-title">Réserver un terrain</h2>
        <p>Pour réserver un terrain, vous devez disposer d’un compte.</p>
        <div className="booking-modal__actions">
          <Link className="booking-modal__secondary" to={ROUTES.login}>
            Se connecter
          </Link>
          <Link to={ROUTES.register}>Créer un compte</Link>
        </div>
      </section>
    </div>
  );
}

function BookingModal({
  slot,
  resource,
  championshipContext,
  onClose,
  onSuccess,
}: {
  slot: CalendarSlot;
  resource: ReservableResource;
  championshipContext: ChampionshipMatchReservationContext | null;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [terms, setTerms] = useState<ReservationTerms | null>(null);
  const [paymentEnabled, setPaymentEnabled] = useState<boolean | null>(null);
  const [paymentChoice, setPaymentChoice] = useState<"full" | "split">(
    "full",
  );
  const [selectedPlayers, setSelectedPlayers] = useState<
    ReservationPaymentPlayer[]
  >([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const isFreeChampionshipMatch =
    championshipContext?.matchPaymentMode === "free";

  useEffect(() => {
    let isCurrent = true;
    setTerms(null);
    setPaymentEnabled(null);

    if (isFreeChampionshipMatch) {
      setPaymentEnabled(false);
      return () => {
        isCurrent = false;
      };
    }

    const requests: Promise<unknown>[] = [
      reservationBookingService.getTerms(resource.id, slot.startsAt),
    ];
    if (!championshipContext) {
      requests.push(reservationBookingService.getPaymentConfig(resource.id));
    }

    void Promise.all(requests)
      .then((values) => {
        if (!isCurrent) return;
        setTerms(values[0] as ReservationTerms);
        if (championshipContext) {
          setPaymentEnabled(championshipContext.onlinePaymentEnabled);
        } else {
          setPaymentEnabled(
            (values[1] as { enabled: boolean } | undefined)?.enabled ?? false,
          );
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) setErrorMessage(getBookingErrorMessage(error));
      });
    return () => {
      isCurrent = false;
    };
  }, [
    championshipContext,
    isFreeChampionshipMatch,
    resource.id,
    slot.startsAt,
  ]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (championshipContext) {
      setIsSubmitting(true);
      try {
        await championshipMatchReservationService.create(
          championshipContext,
          resource.id,
          slot.startsAt,
        );
        setIsConfirmed(true);
        await onSuccess();
      } catch (error) {
        setErrorMessage(getBookingErrorMessage(error));
        await onSuccess();
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (paymentEnabled && paymentChoice === "split") {
      if (selectedPlayers.length !== 3) {
        setErrorMessage(
          "Sélectionnez exactement 3 autres joueurs avant de continuer.",
        );
        return;
      }

      setIsSubmitting(true);
      try {
        const payment = await reservationBookingService.createSplit(
          resource.id,
          slot.startsAt,
          selectedPlayers.map((player) => player.profileId),
        );
        window.location.assign(
          `${ROUTES.reservationSharePayment}?paymentId=${encodeURIComponent(payment.paymentId)}`,
        );
      } catch (error) {
        setErrorMessage(getBookingErrorMessage(error));
        await onSuccess();
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    setIsSubmitting(true);
    try {
      await reservationBookingService.create(resource.id, slot.startsAt);
      setIsConfirmed(true);
      await onSuccess();
    } catch (error) {
      setErrorMessage(getBookingErrorMessage(error));
      await onSuccess();
    } finally {
      setIsSubmitting(false);
    }
  }

  const partnerShare = terms ? Math.floor(terms.priceCents / 4) : 0;
  const ownerShare = terms ? terms.priceCents - partnerShare * 3 : 0;
  const championshipMatchLabel = championshipContext
    ? `${championshipContext.team1Label} – ${championshipContext.team2Label}`
    : null;

  return (
    <div className="booking-modal" role="presentation" onMouseDown={onClose}>
      <section
        className="booking-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="booking-modal__close"
          aria-label="Fermer"
          onClick={onClose}
        >
          ×
        </button>

        {isConfirmed ? (
          <div className="booking-modal__success" role="status">
            <span aria-hidden="true">✓</span>
            <h2 id="booking-modal-title">Réservation confirmée</h2>
            <p>
              {championshipContext ? "La rencontre" : "Votre créneau"} au{" "}
              {resource.name} est enregistré pour le{" "}
              {fullDateFormatter.format(new Date(slot.startsAt))} à{" "}
              {formatTime(slot.startsAt, resource.timezone)}.
            </p>
            {championshipMatchLabel && <strong>{championshipMatchLabel}</strong>}
            {championshipContext && (
              <PushActivationNudge context="championship" compact />
            )}
            <button type="button" onClick={onClose}>
              Retour au calendrier
            </button>
          </div>
        ) : (
          <form onSubmit={(event) => void handleSubmit(event)}>
            <p className="booking-modal__eyebrow">
              {championshipContext ? "Rencontre de championnat" : "Votre réservation"}
            </p>
            <h2 id="booking-modal-title">Réserver {resource.name}</h2>

            {championshipContext && (
              <div className="booking-modal__championship-summary">
                <strong>{championshipMatchLabel}</strong>
                <span>
                  {championshipContext.championshipName} ·{" "}
                  {championshipContext.divisionName}
                </span>
              </div>
            )}

            <dl className="booking-modal__summary">
              <div>
                <dt>Date</dt>
                <dd>{fullDateFormatter.format(new Date(slot.startsAt))}</dd>
              </div>
              <div>
                <dt>Horaire</dt>
                <dd>
                  {formatTime(slot.startsAt, resource.timezone)} –{" "}
                  {formatTime(slot.endsAt, resource.timezone)}
                </dd>
              </div>
              <div>
                <dt>Tarif</dt>
                <dd>
                  {isFreeChampionshipMatch
                    ? "Sans paiement"
                    : terms
                      ? formatPrice(terms.priceCents)
                      : "Calcul en cours…"}
                </dd>
              </div>
            </dl>

            {isFreeChampionshipMatch && (
              <p className="booking-modal__terms">
                Le club a configuré les réservations de rencontres de championnat
                sans paiement.
              </p>
            )}

            {!isFreeChampionshipMatch && terms && (
              <p className="booking-modal__terms">
                {terms.customerType === "licensee"
                  ? "Profil licencié actif : conditions licencié appliquées."
                  : "Compte non licencié : conditions public appliquées."}
              </p>
            )}

            {!championshipContext && paymentEnabled && terms && (
              <fieldset className="booking-modal__payment-choice">
                <legend>Comment souhaitez-vous payer ?</legend>
                <label className="booking-modal__payment-option">
                  <input
                    type="radio"
                    name="payment-choice"
                    value="full"
                    checked={paymentChoice === "full"}
                    onChange={() => {
                      setPaymentChoice("full");
                      setSelectedPlayers([]);
                    }}
                  />
                  <strong>Payer la totalité — {formatPrice(terms.priceCents)}</strong>
                  <small>Vous réglez la réservation pour les 4 joueurs.</small>
                </label>
                <label className="booking-modal__payment-option">
                  <input
                    type="radio"
                    name="payment-choice"
                    value="split"
                    checked={paymentChoice === "split"}
                    onChange={() => setPaymentChoice("split")}
                  />
                  <strong>Payer ma part — {formatPrice(ownerShare)}</strong>
                  <small>
                    Les 3 autres joueurs recevront chacun une demande de{" "}
                    {formatPrice(partnerShare)}.
                  </small>
                </label>
              </fieldset>
            )}

            {!championshipContext && paymentEnabled && paymentChoice === "split" && (
              <ReservationSplitPaymentFields
                resourceId={resource.id}
                selectedPlayers={selectedPlayers}
                onChange={setSelectedPlayers}
              />
            )}

            {!championshipContext && paymentEnabled === false && (
              <p className="booking-modal__account">
                Le paiement en ligne est désactivé : votre réservation sera
                enregistrée immédiatement.
              </p>
            )}

            {championshipContext &&
              championshipContext.matchPaymentMode === "standard" &&
              paymentEnabled === false && (
                <p className="booking-modal__account">
                  La tarification habituelle du club s’applique. Le paiement en
                  ligne est désactivé : la réservation sera enregistrée
                  immédiatement.
                </p>
              )}

            {errorMessage && (
              <div className="booking-modal__error" role="alert">
                {errorMessage}
              </div>
            )}

            <div className="booking-modal__actions">
              <button
                type="button"
                className="booking-modal__secondary"
                onClick={onClose}
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  paymentEnabled === null ||
                  (!isFreeChampionshipMatch && !terms) ||
                  (!championshipContext &&
                    paymentEnabled &&
                    paymentChoice === "split" &&
                    selectedPlayers.length !== 3)
                }
              >
                {isSubmitting
                  ? "Réservation en cours…"
                  : championshipContext
                    ? isFreeChampionshipMatch
                      ? "Réserver la rencontre"
                      : paymentEnabled
                        ? `Continuer vers le paiement — ${terms ? formatPrice(terms.priceCents) : "…"}`
                        : `Réserver — ${terms ? formatPrice(terms.priceCents) : "…"}`
                    : paymentEnabled
                      ? paymentChoice === "split"
                        ? `Continuer — ma part ${formatPrice(ownerShare)}`
                        : `Payer la totalité — ${terms ? formatPrice(terms.priceCents) : "…"}`
                      : "Réserver"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

export function ReservationsPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [searchParams] = useSearchParams();
  const championshipMatchId = searchParams.get("championshipMatch");
  const requestedDate = searchParams.get("date");
  const [resources, setResources] = useState<ReservableResource[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [anchorDate, setAnchorDate] = useState(() =>
    initialAnchorDate(requestedDate),
  );
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<CalendarSlot | null>(null);
  const [inspectedSlot, setInspectedSlot] = useState<CalendarSlot | null>(null);
  const [inspectedActions, setInspectedActions] = useState<Awaited<ReturnType<typeof resolveCalendarPlayerActions>>>(null);
  const [inspectionLoading, setInspectionLoading] = useState(false);
  const [inspectionError, setInspectionError] = useState("");
  const [competitionBusy, setCompetitionBusy] = useState(false);
  const [competitionError, setCompetitionError] = useState("");
  const openInspectedCompetition = async () => {
    if (!inspectedSlot || competitionBusy) return;
    setCompetitionBusy(true);
    setCompetitionError("");
    try {
      const match = await resolveCalendarCompetition(inspectedSlot);
      if (!match) throw new Error("Compétition introuvable pour cette partie.");
      navigate(match.kind === "tournament" ? `${ROUTES.tournaments}/${encodeURIComponent(match.competitionId)}` : `${ROUTES.myChampionships}?match=${encodeURIComponent(match.matchId)}`);
    } catch (cause) {
      setCompetitionError(cause instanceof Error ? cause.message : "Impossible d’ouvrir la compétition.");
    } finally { setCompetitionBusy(false); }
  };
  const [matchContacts, setMatchContacts] = useState<MatchContact[] | null>(null);
  const [contactBusy, setContactBusy] = useState(false);
  const [contactError, setContactError] = useState("");
  const [copiedContacts, setCopiedContacts] = useState(false);
  useEffect(() => {
    setMatchContacts(null);
    setContactError("");
    setCopiedContacts(false);
  }, [inspectedSlot]);
  const openMatchContacts = async () => {
    if (!inspectedSlot || !canAdminReservations || inspectedSlot.status !== "occupied") return;
    setContactBusy(true);
    setMatchContacts(null);
    setContactError("");
    setCopiedContacts(false);
    try {
      setMatchContacts(await loadAdminCalendarMatchContacts(inspectedSlot));
    } catch (cause) {
      setContactError(cause instanceof Error ? cause.message : "Coordonnées indisponibles.");
    } finally {
      setContactBusy(false);
    }
  };
  const copyMatchPhones = async () => {
    const phones = [...new Set((matchContacts ?? []).map((contact) => contact.phone?.trim()).filter((phone): phone is string => Boolean(phone)))];
    if (!phones.length) return;
    try {
      await navigator.clipboard.writeText(phones.join(", "));
      setCopiedContacts(true);
      setContactError("");
    } catch {
      setContactError("Copie automatique indisponible : sélectionne les numéros ci-dessous.");
    }
  };
  const [unprogramBusy, setUnprogramBusy] = useState(false);
  const [unprogramError, setUnprogramError] = useState("");
  const unprogramInspectedMatch = async () => {
    if (!inspectedSlot || !canAdminTournaments || unprogramBusy || inspectedSlot.status !== "occupied" || inspectedSlot.occupationType !== "match") return;
    setUnprogramBusy(true);
    setUnprogramError("");
    try {
      // Resolve against the precise selected interval; never infer identity from a displayed name.
      const identity = await resolveCalendarPlayerActions(inspectedSlot);
      if (identity?.kind !== "tournament" || !identity.matchId) {
        throw new Error("Impossible d'identifier de manière certaine cette partie.");
      }
      if (!window.confirm("Déprogrammer cette partie et libérer son créneau ? Elle apparaîtra dans « Parties à programmer ».")) return;
      await adminTournamentUnprogrammedService.unprogram(identity.matchId, "Déprogrammation administrateur depuis le calendrier");
      setInspectedSlot(null);
      setInspectedActions(null);
      navigate(`${ROUTES.adminTournamentReschedules}?match=${encodeURIComponent(identity.matchId)}#parties-a-programmer`);
    } catch (cause) {
      setUnprogramError(cause instanceof Error ? cause.message : "Déprogrammation impossible.");
    } finally {
      setUnprogramBusy(false);
    }
  };

  const [volunteering, setVolunteering] = useState(false);
  const loadGeneration = useRef(0);
  useEffect(() => {
    let active = true;
    setInspectedActions(null);
    setInspectionError("");
    if (!inspectedSlot || !isAuthenticated) return;
    setInspectionLoading(true);
    resolveCalendarPlayerActions(inspectedSlot).then((result) => {
      if (active) setInspectedActions(result);
    }).catch((error: unknown) => {
      if (active) setInspectionError(error instanceof Error ? error.message : "Impossible de vérifier les droits.");
    }).finally(() => { if (active) setInspectionLoading(false); });
    return () => { active = false; };
  }, [inspectedSlot, isAuthenticated]);
  const withdrawOnCalendar = async () => {
    if (!inspectedActions?.isAssignedReferee || volunteering) return;
    if (!window.confirm("Te retirer de cet arbitrage ?")) return;
    setVolunteering(true);
    setInspectionError("");
    try {
      const matches = await refereeingService.list();
      const match = matches.find((item) =>
        item.match_id === inspectedActions.matchId &&
        item.source_type === inspectedActions.kind &&
        item.is_mine
      );
      if (!match) throw new Error("Cet arbitrage n'est plus associé à ton compte.");
      await refereeingService.withdraw(match);
      await loadSlots();
      setInspectedActions(null);
      setInspectedSlot(null);
    } catch (error) {
      setInspectionError(error instanceof Error ? error.message : "Impossible de se retirer de cet arbitrage.");
    } finally {
      setVolunteering(false);
    }
  };
  const volunteerOnCalendar = async () => {
    if (!inspectedActions?.actions.volunteerReferee || volunteering) return;
    setVolunteering(true);
    setInspectionError("");
    try {
      const matches = await refereeingService.list();
      const match = matches.find((item) =>
        item.match_id === inspectedActions.matchId &&
        item.source_type === inspectedActions.kind &&
        !item.referee_profile_id
      );
      if (!match) throw new Error("Cet arbitrage n'est plus disponible.");
      await refereeingService.volunteer(match);
      await loadSlots();
      setInspectedActions(null);
      setInspectedSlot(null);
    } catch (error) {
      setInspectionError(error instanceof Error ? error.message : "Impossible de prendre cet arbitrage.");
    } finally {
      setVolunteering(false);
    }
  };

  const [isLoading, setIsLoading] = useState(true);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [adminAccess, setAdminAccess] = useState<ClubAccess | null>(null);
  const [championshipCandidates, setChampionshipCandidates] = useState<ChampionshipCalendarCandidate[] | null>(null);
  const [chosenAdminMatch, setChosenAdminMatch] = useState("");
  const [convertReservationId, setConvertReservationId] = useState<string | null>(null);
  const [adminBookingBusy, setAdminBookingBusy] = useState(false);
  const [adminBookingError, setAdminBookingError] = useState("");
  const openAdminChampionship = async () => {
    if (!inspectedSlot || (inspectedSlot.status !== "locked" && inspectedSlot.status !== "available") || !canAdminReservations || !canAdminChampionships) return;
    setAdminBookingError("");
    setChosenAdminMatch("");
    setConvertReservationId(null);
    setChampionshipCandidates(null);
    try {
      const candidates = await adminCalendarChampionshipService.candidates(inspectedSlot);
      setChampionshipCandidates(candidates);
    } catch (cause) {
      setAdminBookingError(cause instanceof Error ? cause.message : "Rencontres indisponibles.");
    }
  };
  const openConvertChampionship = async () => {
    if (!inspectedSlot || inspectedSlot.status !== "occupied" || !canAdminReservations || !canAdminChampionships || inspectedSlot.occupationType !== "reservation") return;
    setAdminBookingError("");
    setChosenAdminMatch("");
    setChampionshipCandidates(null);
    setConvertReservationId(null);
    try {
      const id = await adminCalendarChampionshipService.occupiedReservationId(inspectedSlot);
      const candidates = await adminCalendarChampionshipService.conversionCandidates(id);
      setConvertReservationId(id);
      setChampionshipCandidates(candidates);
    } catch (cause) { setAdminBookingError(cause instanceof Error ? cause.message : "Réservation indisponible."); }
  };
  const confirmAdminChampionship = async () => {
    if (!inspectedSlot || !chosenAdminMatch || adminBookingBusy || !canAdminReservations || !canAdminChampionships) return;
    const chosen = championshipCandidates?.find((m) => m.id === chosenAdminMatch);
    if (!chosen || !window.confirm(`Programmer « ${chosen.label} » sur ce créneau ?`)) return;
    setAdminBookingBusy(true);
    setAdminBookingError("");
    try {
      if (convertReservationId) await adminCalendarChampionshipService.convertReservation(convertReservationId, chosenAdminMatch);
      else await adminCalendarChampionshipService.book(inspectedSlot, chosenAdminMatch);
      setInspectedSlot(null);
      setChampionshipCandidates(null);
      await loadSlots();
    } catch (cause) {
      setAdminBookingError(cause instanceof Error ? cause.message : "Programmation impossible.");
    } finally {
      setAdminBookingBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    setAdminAccess(null);
    if (!isAuthenticated) return;
    void adminAccessService.getOptionalAccess()
      .then((access) => { if (active) setAdminAccess(access); })
      .catch(() => { if (active) setAdminAccess(null); });
    return () => { active = false; };
  }, [isAuthenticated]);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [championshipContext, setChampionshipContext] =
    useState<ChampionshipMatchReservationContext | null>(null);
  const [championshipContextLoading, setChampionshipContextLoading] =
    useState(Boolean(championshipMatchId));

  const selectedResource = resources.find(
    (resource) => resource.id === resourceId,
  );
  const adminPermissions = adminAccess?.clubId === selectedResource?.clubId
    ? (adminAccess?.permissions ?? [])
    : [];
  const canAdminReservations = adminPermissions.includes(ADMIN_PERMISSIONS.reservations);
  const canAdminTournaments = adminPermissions.includes(ADMIN_PERMISSIONS.tournaments);
  const canAdminChampionships = adminPermissions.includes(ADMIN_PERMISSIONS.championships);
  const [hasActiveTournament, setHasActiveTournament] = useState(false);
  useEffect(() => {
    let alive = true;
    setHasActiveTournament(false);
    if (!canAdminTournaments || !selectedResource) return;
    void tournamentAdminService.list().then((items) => {
      if (!alive) return;
      setHasActiveTournament(items.some((tournament) =>
        !["preparation", "configuration", "completed", "archived", "cancelled"].includes(tournament.status)
        && tournament.resourceCount > 0
        && tournament.startsOn <= toDateInputValue(new Date())
        && tournament.endsOn >= toDateInputValue(new Date())
      ));
    }).catch(() => { if (alive) setHasActiveTournament(false); });
    return () => { alive = false; };
  }, [canAdminTournaments, selectedResource?.clubId]);



  const weekDays = useMemo(() => buildWeekDays(anchorDate), [anchorDate]);
  const weekStart = weekDays[0];
  const weekEnd = weekDays[6];
  const weekStartValue = toDateInputValue(weekStart);
  const weekEndValue = toDateInputValue(weekEnd);
  const slotsByDay = useMemo(
    () =>
      groupSlotsByLocalDate(
        slots,
        selectedResource?.timezone ?? "Europe/Paris",
      ),
    [slots, selectedResource?.timezone],
  );
  const hasChampionshipSlots = useMemo(
    () => slots.some((slot) => slot.reservationAccess === "championship"),
    [slots],
  );

  useEffect(() => {
    let isCurrent = true;
    void reservationCalendarService
      .listResources()
      .then((availableResources) => {
        if (!isCurrent) return;
        setResources(availableResources);
        setResourceId((current) => current || availableResources[0]?.id || "");
      })
      .catch(() => {
        if (isCurrent)
          setErrorMessage("Le calendrier est momentanément indisponible.");
      })
      .finally(() => {
        if (isCurrent) setResourcesLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  const loadChampionshipContext = async () => {
    if (!championshipMatchId || !isAuthenticated) {
      setChampionshipContext(null);
      setChampionshipContextLoading(false);
      return;
    }
    setChampionshipContextLoading(true);
    try {
      setChampionshipContext(
        await championshipMatchReservationService.getContext(
          championshipMatchId,
        ),
      );
    } catch (caught) {
      setErrorMessage(
        caught instanceof Error
          ? caught.message
          : "Impossible de préparer cette rencontre.",
      );
      setChampionshipContext(null);
    } finally {
      setChampionshipContextLoading(false);
    }
  };

  useEffect(() => {
    void loadChampionshipContext();
  }, [championshipMatchId, isAuthenticated]);

  async function loadSlots(): Promise<void> {
    if (!resourceId) return;
    const generation = ++loadGeneration.current;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const nextSlots = await reservationCalendarService.listSlots(
        resourceId,
        weekStartValue,
        weekEndValue,
      );
      if (generation === loadGeneration.current) setSlots(nextSlots);
    } catch {
      if (generation === loadGeneration.current) {
        setSlots([]);
        setErrorMessage("Impossible de charger les disponibilités.");
      }
    } finally {
      if (generation === loadGeneration.current) setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadSlots();
  }, [resourceId, weekEndValue, weekStartValue]);

  const refreshAfterBooking = async () => {
    await Promise.all([loadSlots(), loadChampionshipContext()]);
  };

  return (
    <section className="reservation-calendar">
      <div className="reservation-calendar__header">
        <div>
          <p className="reservation-calendar__eyebrow">
            Réservations du trinquet
          </p>
          <h1>Calendrier des disponibilités</h1>
          <p>
            Les règles habituelles restent inchangées. Les joueurs engagés en
            championnat peuvent bénéficier d’un accès anticipé sur les plages
            réservées par le club.
          </p>
        </div>
        {resources.length > 1 && (
          <label>
            Terrain
            <select
              value={resourceId}
              onChange={(event) => setResourceId(event.target.value)}
            >
              {resources.map((resource) => (
                <option value={resource.id} key={resource.id}>
                  {resource.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {championshipMatchId && (
        <div className="reservation-calendar__championship-context" role="status">
          {championshipContextLoading ? (
            <strong>Préparation de la rencontre…</strong>
          ) : championshipContext ? (
            <>
              <div>
                <span>Réservation pour une rencontre</span>
                <strong>
                  {championshipContext.team1Label} –{" "}
                  {championshipContext.team2Label}
                </strong>
                <small>
                  {championshipContext.championshipName} ·{" "}
                  {championshipContext.divisionName}
                </small>
              </div>
              <div>
                {championshipContext.existingReservation ? (
                  <strong>Cette rencontre est déjà réservée.</strong>
                ) : championshipContext.matchPaymentMode === "free" ? (
                  <strong>Sans paiement</strong>
                ) : (
                  <strong>Tarification habituelle du club</strong>
                )}
              </div>
            </>
          ) : (
            <strong>Cette rencontre ne peut pas être réservée ici.</strong>
          )}
        </div>
      )}

      <div
        className="reservation-calendar__toolbar"
        aria-label="Navigation du calendrier"
      >
        <button
          type="button"
          onClick={() => setAnchorDate(addDays(anchorDate, -7))}
        >
          Semaine précédente
        </button>
        <button
          type="button"
          onClick={() => setAnchorDate(startOfIsoWeek(new Date()))}
        >
          Aujourd’hui
        </button>
        <strong>
          {rangeFormatter.format(weekStart)} – {rangeFormatter.format(weekEnd)}
        </strong>
        <button
          type="button"
          onClick={() => setAnchorDate(addDays(anchorDate, 7))}
        >
          Semaine suivante
        </button>
      </div>

      {hasChampionshipSlots && (
        <div className="reservation-calendar__championship-notice" role="status">
          <strong>Accès championnat actif</strong>
          <span>
            Les créneaux marqués « Championnat » sont réservés aux rencontres
            de championnat. Si aucune rencontre n’est sélectionnée, choisissez
            d’abord votre partie dans « Mes championnats ».
          </span>
        </div>
      )}

      {errorMessage && (
        <div
          className="reservation-calendar__message reservation-calendar__message--error"
          role="alert"
        >
          {errorMessage}
        </div>
      )}

      {isLoading || resourcesLoading ? (
        <CalendarSkeleton />
      ) : resources.length === 0 ? (
        <div className="reservation-calendar__message">
          Aucun terrain n’est encore ouvert à la réservation.
        </div>
      ) : (
        <CalendarWeekGrid
          weekDays={weekDays}
          slotsByDay={slotsByDay}
          timezone={selectedResource?.timezone ?? "Europe/Paris"}
          championshipMatchSelected={Boolean(championshipContext)}
          onInspect={setInspectedSlot}
          canInspectLocked={canAdminReservations}
          onBook={(nextSlot) => {
            if (championshipContext?.existingReservation || championshipContextLoading) return;
            if (nextSlot.reservationAccess === "championship" && !championshipContext && canAdminReservations && canAdminChampionships) {
              setInspectedSlot(nextSlot);
              return;
            }
            setSelectedSlot(nextSlot);
          }}
        />
      )}

      {inspectedSlot && (
        <div className="booking-modal" role="presentation" onMouseDown={() => setInspectedSlot(null)}>
          <section className="booking-modal__panel" role="dialog" aria-modal="true" aria-label="Informations du créneau" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="booking-modal__close" aria-label="Fermer" onClick={() => setInspectedSlot(null)}>×</button>
            <h2>Informations du créneau</h2>
            <p>{new Date(inspectedSlot.startsAt).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short", timeZone: selectedResource?.timezone ?? "Europe/Paris" })}</p>
            <p>{inspectedSlot.status === "locked" ? "Créneau pas encore ouvert à la réservation" : inspectedSlot.bookedByName ?? "Créneau occupé"}</p>
            {inspectedSlot.resultDisplay && <p>Résultat : {inspectedSlot.resultDisplay}</p>}
            {inspectedSlot.refereeName && <p>Arbitre : {inspectedSlot.refereeName}</p>}
            {inspectionLoading && <p role="status">Vérification des droits…</p>}
            {inspectionError && <p role="alert">{inspectionError}</p>}
            {unprogramError && <p role="alert">{unprogramError}</p>}
            {competitionError && <p role="alert">{competitionError}</p>}
            {inspectedSlot.status === "occupied" && (inspectedSlot.occupationType === "match" || inspectedSlot.occupationType === "championship_match") && (
              <div className="reservation-slot-actions">
                <button className="reservation-slot-actions__button" type="button" disabled={competitionBusy} onClick={() => void openInspectedCompetition()}>
                  {competitionBusy ? "Ouverture…" : "Voir la compétition"}
                </button>
              </div>
            )}
            {(inspectedActions?.actions.submitResult || inspectedActions?.actions.volunteerReferee || inspectedActions?.actions.requestReportInMySpace || inspectedActions?.isAssignedReferee) && (
              <div className="reservation-slot-actions">
                <h3>Actions disponibles</h3>
                <div className="reservation-slot-actions__list">
            {inspectedActions?.actions.submitResult && (
              <Link className="reservation-slot-actions__button" to={`${inspectedActions.isAssignedReferee && !inspectedActions.isParticipant ? ROUTES.myRefereeing : inspectedActions.kind === "championship" ? ROUTES.myChampionships : ROUTES.myTournaments}?match=${encodeURIComponent(inspectedActions.matchId)}`}>
                Saisir le résultat
              </Link>
            )}
            {inspectedActions?.actions.volunteerReferee && (
              <button className="reservation-slot-actions__button" type="button" disabled={volunteering} onClick={() => void volunteerOnCalendar()}>
                {volunteering ? "Enregistrement…" : "Je peux arbitrer"}
              </button>
            )}
            {inspectedActions?.isAssignedReferee && (
              <button className="reservation-slot-actions__button" type="button" disabled={volunteering} onClick={() => void withdrawOnCalendar()}>
                {volunteering ? "Enregistrement…" : "Me retirer de l’arbitrage"}
              </button>
            )}
            {inspectedActions?.actions.requestReportInMySpace && (
              <Link className="reservation-slot-actions__button" to={`${inspectedActions.kind === "championship" ? ROUTES.myChampionships : ROUTES.myTournaments}?match=${encodeURIComponent(inspectedActions.matchId)}`}>
                Demander un report
              </Link>
            )}
                </div>
              </div>
            )}
            {inspectedSlot.status === "occupied" && (canAdminReservations || canAdminTournaments || canAdminChampionships) && (
              <div className="reservation-slot-actions reservation-slot-actions--admin">
                <h3>Actions administrateur</h3>
                <div className="reservation-slot-actions__list">
                  {canAdminTournaments && hasActiveTournament && inspectedSlot.occupationType === "reservation" && (
                    <Link className="reservation-slot-actions__button" to={`${ROUTES.adminTournamentReschedules}?resource=${encodeURIComponent(inspectedSlot.resourceId)}&startsAt=${encodeURIComponent(inspectedSlot.startsAt)}&endsAt=${encodeURIComponent(inspectedSlot.endsAt)}#parties-a-programmer`}>Programmer une partie de tournoi</Link>
                  )}
                  {canAdminReservations && canAdminChampionships && inspectedSlot.occupationType === "reservation" && (
                    <button className="reservation-slot-actions__button" type="button" onClick={() => void openConvertChampionship()}>Programmer une partie de championnat</button>
                  )}
                  {canAdminReservations && (
                    <>
                      <Link className="reservation-slot-actions__button" to={`${ROUTES.adminSlotExchange}?resource=${encodeURIComponent(inspectedSlot.resourceId)}&startsAt=${encodeURIComponent(inspectedSlot.startsAt)}&endsAt=${encodeURIComponent(inspectedSlot.endsAt)}`}>Échanger des créneaux</Link>
                      {(inspectedSlot.occupationType === "match" || inspectedSlot.occupationType === "championship_match") && (
                        <button className="reservation-slot-actions__button" type="button" disabled={contactBusy} onClick={() => void openMatchContacts()}>
                          {contactBusy ? "Chargement…" : "Contacter"}
                        </button>
                      )}

                    </>
                  )}
                  {canAdminTournaments && inspectedSlot.occupationType === "match" && (
                    <button className="reservation-slot-actions__button" type="button" disabled={unprogramBusy} onClick={() => void unprogramInspectedMatch()}>{unprogramBusy ? "Traitement…" : "Déprogrammer la partie"}</button>
                  )}
                  {canAdminChampionships &&
                    (inspectedSlot.occupationType === "match" || inspectedSlot.occupationType === "championship_match") && (
                    <Link className="reservation-slot-actions__button" to={ROUTES.adminRefereeing}>Gérer l'arbitrage</Link>
                  )}
                </div>
              </div>
            )}
            {contactError && <p role="alert">{contactError}</p>}
            {matchContacts && inspectedSlot.status === "occupied" && (
              <section className="reservation-slot-actions">
                <h3>Contacter les joueurs</h3>
                {matchContacts.length === 0 && <p>Aucun joueur identifié.</p>}
                {matchContacts.map((contact, index) => (
                  <p key={`${contact.team}-${contact.name}-${index}`}>
                    {contact.name} : {contact.phone ? <a href={`tel:${contact.phone.replace(/[^+0-9]/g, "")}`}>{contact.phone}</a> : "Numéro non renseigné"}
                  </p>
                ))}
                {matchContacts.some((contact) => contact.phone) && (
                  <>
                    <a
                      className="reservation-slot-actions__button"
                      href={`sms:${[...new Set(matchContacts.map((c) => c.phone?.replace(/[^+0-9]/g, "")).filter((phone): phone is string => Boolean(phone)))].join(",")}`}
                    >
                      Préparer un SMS collectif
                    </a>
                    <p>Vérifie que tous les destinataires sont présents dans Google Messages avant l’envoi. Selon Android, le lien peut ne reprendre que le premier numéro.</p>
                    <button className="reservation-slot-actions__button" type="button" onClick={() => void copyMatchPhones()}>
                      {copiedContacts ? "Numéros copiés" : "Copier tous les numéros"}
                    </button>
                    <textarea readOnly aria-label="Numéros à copier" value={[...new Set(matchContacts.map((c) => c.phone?.trim()).filter((phone): phone is string => Boolean(phone)))].join(", ")} rows={2} />
                  </>
                )}
              </section>
            )}
            {(inspectedSlot.status === "locked" || (inspectedSlot.status === "available" && inspectedSlot.reservationAccess === "championship")) && canAdminReservations && (
              <div className="reservation-slot-actions reservation-slot-actions--admin">
                <h3>Actions administrateur</h3>
                <div className="reservation-slot-actions__list">
                  <Link className="reservation-slot-actions__button" to={ROUTES.adminReservations}>Gérer la réservation</Link>
                  {canAdminTournaments && hasActiveTournament && (
                    <Link className="reservation-slot-actions__button" to={`${ROUTES.adminTournamentReschedules}?resource=${encodeURIComponent(inspectedSlot.resourceId)}&startsAt=${encodeURIComponent(inspectedSlot.startsAt)}&endsAt=${encodeURIComponent(inspectedSlot.endsAt)}#parties-a-programmer`}>
                      Programmer une partie de tournoi
                    </Link>
                  )}
                  {canAdminChampionships && (
                    <button className="reservation-slot-actions__button" type="button" onClick={() => void openAdminChampionship()}>
                      Programmer une partie de championnat
                    </button>
                  )}
                </div>
              </div>
            )}

            {(inspectedSlot.status === "locked" || inspectedSlot.status === "available" || (inspectedSlot.status === "occupied" && convertReservationId)) && championshipCandidates && (
              <div className="reservation-slot-actions reservation-slot-actions--admin">
                <h3>{convertReservationId ? "Convertir cette réservation en partie de championnat" : "Choisir la rencontre"}</h3>
                <select aria-label="Rencontre de championnat" value={chosenAdminMatch} onChange={(event) => setChosenAdminMatch(event.target.value)}>
                  <option value="">Sélectionner une rencontre…</option>
                  {championshipCandidates.map((match) => (
                    <option value={match.id} key={match.id}>{match.label}{match.plannedDate ? ` · ${match.plannedDate}` : ""}</option>
                  ))}
                </select>
                {championshipCandidates.length === 0 && <p>Aucune rencontre disponible pour ce club.</p>}
                <button className="reservation-slot-actions__button" type="button" disabled={!chosenAdminMatch || adminBookingBusy} onClick={() => void confirmAdminChampionship()}>
                  {adminBookingBusy ? "Programmation…" : "Confirmer la programmation"}
                </button>
              </div>
            )}
            {adminBookingError && <p role="alert">{adminBookingError}</p>}
            {!inspectionLoading && !inspectionError && !inspectedActions?.actions.submitResult && !inspectedActions?.actions.volunteerReferee && !inspectedActions?.actions.requestReportInMySpace && !inspectedActions?.isAssignedReferee && !canAdminReservations && !canAdminTournaments && !canAdminChampionships && (
              <p>Aucune action disponible pour ce créneau.</p>
            )}
          </section>
        </div>
      )}

      <div className="reservation-calendar__legend" aria-label="Légende">
        <span>
          <i className="reservation-calendar__dot reservation-calendar__dot--available" />{" "}
          Libre
        </span>
        <span>
          <i className="reservation-calendar__dot reservation-calendar__dot--championship" />{" "}
          Championnat
        </span>
        <span>
          <i className="reservation-calendar__dot reservation-calendar__dot--locked" />{" "}
          Pas encore ouvert
        </span>
        <span>
          <i className="reservation-calendar__dot reservation-calendar__dot--occupied" />{" "}
          Occupé
        </span>
        <span>
          <i className="reservation-calendar__dot reservation-calendar__dot--closed" />{" "}
          Fermé
        </span>
      </div>

      {selectedSlot &&
        selectedResource &&
        (selectedSlot.reservationAccess === "championship" &&
        !championshipContext ? (
          isAuthenticated ? (
            <ChampionshipMatchRequiredModal
              onClose={() => setSelectedSlot(null)}
            />
          ) : (
            <AccountRequiredModal onClose={() => setSelectedSlot(null)} />
          )
        ) : isAuthenticated ? (
          <BookingModal
            slot={selectedSlot}
            resource={selectedResource}
            championshipContext={championshipContext}
            onClose={() => setSelectedSlot(null)}
            onSuccess={refreshAfterBooking}
          />
        ) : (
          <AccountRequiredModal onClose={() => setSelectedSlot(null)} />
        ))}
    </section>
  );
}
