import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ReservationSplitPaymentFields } from "@/features/reservations/components/ReservationSplitPaymentFields";
import {
  formatPrice,
  getBookingErrorMessage,
  type ReservationTerms,
} from "@/features/reservations/domain/booking";
import {
  addDays,
  buildWeekDays,
  formatBookingOpening,
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
import "./ReservationsPage.css";
import "./ReservationLockedSlots.css";
import "./ReservationPaymentChoice.css";

const dayFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

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

function SlotCard({
  slot,
  timezone,
  onBook,
}: {
  slot: CalendarSlot;
  timezone: string;
  onBook: (slot: CalendarSlot) => void;
}) {
  const slotTime = formatTime(slot.startsAt, timezone);
  const isChampionship = slot.reservationAccess === "championship";

  if (slot.status === "occupied") {
    const bookedBy = slot.bookedByName ?? "Réservation";
    const isTournamentMatch =
      slot.occupationType === "match" && Boolean(slot.displayColor);
    const isChampionshipMatch = slot.occupationType === "championship_match";
    const isColoredMatch = isTournamentMatch || isChampionshipMatch;
    const style = slot.displayColor
      ? ({ "--tournament-series-color": slot.displayColor } as CSSProperties)
      : undefined;
    return (
      <div
        className={`reservation-slot reservation-slot--occupied${isColoredMatch ? " reservation-slot--tournament" : ""}`}
        style={style}
        aria-label={`${slotTime} : occupé par ${bookedBy}`}
      >
        <strong>{slotTime}</strong>
        <span>
          {isChampionshipMatch
            ? "Match championnat"
            : isTournamentMatch
              ? "Match tournoi"
              : "Occupé"}
        </span>
        <small>{bookedBy}</small>
      </div>
    );
  }

  if (slot.status === "locked") {
    const openingLabel = slot.bookingOpensAt
      ? formatBookingOpening(slot.bookingOpensAt, timezone)
      : "prochainement";
    return (
      <div
        className={`reservation-slot reservation-slot--locked${isChampionship ? " reservation-slot--championship" : ""}`}
        aria-label={`${slotTime} : ${isChampionship ? "créneau championnat, " : ""}réservable à partir du ${openingLabel}`}
      >
        <strong>{slotTime}</strong>
        <span>
          {isChampionship ? "Championnat · " : ""}Réservable dès le{" "}
          {openingLabel}
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`reservation-slot reservation-slot--available${isChampionship ? " reservation-slot--championship" : ""}`}
      aria-label={`Réserver le créneau de ${slotTime}${isChampionship ? " réservé aux joueurs de championnat" : ""}`}
      onClick={() => onBook(slot)}
    >
      <strong>{slotTime}</strong>
      <span>{isChampionship ? "Réserver · Championnat" : "Réserver"}</span>
    </button>
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
      reservationBookingService.getTerms(slot.startsAt),
    ];
    if (!championshipContext) {
      requests.push(reservationBookingService.getPaymentConfig());
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
  }, [championshipContext, isFreeChampionshipMatch, slot.startsAt]);

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
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [championshipContext, setChampionshipContext] =
    useState<ChampionshipMatchReservationContext | null>(null);
  const [championshipContextLoading, setChampionshipContextLoading] =
    useState(Boolean(championshipMatchId));

  const selectedResource = resources.find(
    (resource) => resource.id === resourceId,
  );
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
        if (isCurrent) setIsLoading(false);
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
    setIsLoading(true);
    setErrorMessage(null);
    try {
      setSlots(
        await reservationCalendarService.listSlots(
          resourceId,
          weekStartValue,
          weekEndValue,
        ),
      );
    } catch {
      setErrorMessage("Impossible de charger les disponibilités.");
    } finally {
      setIsLoading(false);
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
            Les créneaux marqués « Championnat » sont ouverts en avance grâce à
            votre inscription dans un effectif du club.
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

      {isLoading ? (
        <CalendarSkeleton />
      ) : resources.length === 0 ? (
        <div className="reservation-calendar__message">
          Aucun terrain n’est encore ouvert à la réservation.
        </div>
      ) : (
        <div className="reservation-calendar__grid">
          {weekDays.map((day) => {
            const dayKey = toDateInputValue(day);
            const daySlots = slotsByDay.get(dayKey) ?? [];
            return (
              <article className="reservation-calendar__day" key={dayKey}>
                <h2>{dayFormatter.format(day)}</h2>
                {daySlots.length > 0 ? (
                  <div className="reservation-calendar__slots">
                    {daySlots.map((slot) => (
                      <SlotCard
                        key={`${slot.startsAt}-${slot.endsAt}`}
                        slot={slot}
                        timezone={
                          selectedResource?.timezone ?? "Europe/Paris"
                        }
                        onBook={(nextSlot) => {
                          if (
                            championshipContext?.existingReservation ||
                            championshipContextLoading
                          ) {
                            return;
                          }
                          setSelectedSlot(nextSlot);
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="reservation-calendar__closed">Fermé</p>
                )}
              </article>
            );
          })}
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
        (isAuthenticated ? (
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
