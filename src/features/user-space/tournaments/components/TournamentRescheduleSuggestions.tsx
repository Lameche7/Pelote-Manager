import { useEffect, useState } from "react";
import {
  tournamentRescheduleService,
  type TournamentRescheduleFreeSlot,
  type TournamentRescheduleOptions,
  type TournamentRescheduleSwap,
} from "@/features/user-space/tournaments/services/tournamentRescheduleService";
import "./TournamentRescheduleSuggestions.css";

type Props = {
  matchId: string;
  teamId: string;
  onClose: () => void;
};

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

const dateLabel = (value: string) =>
  dateFormatter.format(new Date(`${value}T12:00:00`));

const preferenceLabel = (
  option: TournamentRescheduleFreeSlot | TournamentRescheduleSwap,
) =>
  option.preference === "recommended"
    ? "Recommandé"
    : "Compromis pour votre équipe";

function RequesterWarnings({
  option,
  availabilityUnknown = false,
}: {
  option: TournamentRescheduleFreeSlot | TournamentRescheduleSwap;
  availabilityUnknown?: boolean;
}) {
  if (
    option.requesterSameDayPenalty === 0 &&
    !option.requesterOutsideDeclaredAvailability
  ) {
    return availabilityUnknown ? (
      <span>
        Les disponibilités d’inscription sont inconnues : ce créneau devra être
        confirmé par les deux équipes.
      </span>
    ) : (
      <span>Aucune contrainte supplémentaire détectée pour votre équipe.</span>
    );
  }

  return (
    <ul>
      {option.requesterSameDayPenalty > 0 && (
        <li>
          Cette solution ajoute {option.requesterSameDayPenalty} autre
          {option.requesterSameDayPenalty > 1 ? "s" : ""} partie
          {option.requesterSameDayPenalty > 1 ? "s" : ""} le même jour pour
          votre équipe.
        </li>
      )}
      {option.requesterOutsideDeclaredAvailability && (
        <li>
          Ce créneau est hors des disponibilités déclarées de votre équipe.
        </li>
      )}
      {availabilityUnknown && (
        <li>
          Les disponibilités d’inscription n’ont pas été importées : l’accord
          des deux équipes sera nécessaire.
        </li>
      )}
    </ul>
  );
}

function FreeSlotCard({
  option,
  availabilityUnknown,
}: {
  option: TournamentRescheduleFreeSlot;
  availabilityUnknown: boolean;
}) {
  return (
    <article className="tournament-reschedule__option">
      <div className="tournament-reschedule__option-heading">
        <div>
          <strong>
            {dateLabel(option.playDate)} · {option.startsAt}–{option.endsAt}
          </strong>
          <span>{option.resourceName}</span>
        </div>
        <span
          className={`tournament-reschedule__badge tournament-reschedule__badge--${option.preference}`}
        >
          {preferenceLabel(option)}
        </span>
      </div>
      <p>
        Créneau libre : seul votre match change. Le moteur a vérifié que ce
        déplacement n’augmente pas la charge de parties le même jour pour vos
        adversaires.
      </p>
      <RequesterWarnings
        option={option}
        availabilityUnknown={availabilityUnknown}
      />
    </article>
  );
}

function SwapCard({ option }: { option: TournamentRescheduleSwap }) {
  return (
    <article className="tournament-reschedule__option">
      <div className="tournament-reschedule__option-heading">
        <div>
          <strong>
            {dateLabel(option.playDate)} · {option.startsAt}–{option.endsAt}
          </strong>
          <span>{option.resourceName}</span>
        </div>
        <span
          className={`tournament-reschedule__badge tournament-reschedule__badge--${option.preference}`}
        >
          {preferenceLabel(option)}
        </span>
      </div>
      <div className="tournament-reschedule__swap">
        <p>
          <strong>Votre match</strong> prend le créneau de :
          <span>
            {option.swapTeamALabel} — {option.swapTeamBLabel}
          </span>
        </p>
        <p>
          <strong>Leur match</strong> reprend votre créneau actuel :
          <span>
            {dateLabel(option.swapMovesToPlayDate)} ·{" "}
            {option.swapMovesToStartsAt}–{option.swapMovesToEndsAt} ·{" "}
            {option.swapMovesToResourceName}
          </span>
        </p>
      </div>
      <p>
        Les trois équipes qui ne sont pas à l’origine de la demande ne gagnent
        pas de partie supplémentaire le même jour avec cet échange.
      </p>
      <RequesterWarnings option={option} />
    </article>
  );
}

export function TournamentRescheduleSuggestions({
  matchId,
  teamId,
  onClose,
}: Props) {
  const [options, setOptions] = useState<TournamentRescheduleOptions | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    tournamentRescheduleService
      .getOptions(matchId, teamId)
      .then((result) => {
        if (active) setOptions(result);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Impossible de rechercher des solutions de report.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [matchId, teamId]);

  const freeSlots = options?.freeSlots ?? [];
  const swaps = options?.swaps ?? [];
  const swapsEnabled = options?.policy.swapsEnabled ?? true;
  const availabilityUnknown =
    options?.policy.availabilitySource === "unknown_from_errebot";
  const visibleFreeSlots = freeSlots.slice(0, 6);
  const visibleSwaps = swaps.slice(0, 6);

  return (
    <div
      className="tournament-reschedule"
      role="region"
      aria-label="Solutions de report"
    >
      <header>
        <div>
          <span className="tournament-reschedule__eyebrow">
            Report de partie
          </span>
          <h4>Solutions possibles</h4>
        </div>
        <button type="button" onClick={onClose}>
          Fermer
        </button>
      </header>

      <p className="tournament-reschedule__policy">
        Pelote Manager protège les équipes qui ne demandent pas le report. Aucun
        temps de repos minimum n’est imposé : si une contrainte supplémentaire
        est nécessaire, elle reste du côté de votre équipe.
      </p>

      {loading && <p role="status">Recherche des meilleures solutions…</p>}
      {error && (
        <p className="tournament-reschedule__error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && options && (
        <>
          {availabilityUnknown && !swapsEnabled && (
            <p className="tournament-reschedule__policy" role="status">
              Errebot n’a pas fourni les créneaux choisis par les équipes lors
              de l’inscription. Ces disponibilités sont donc inconnues : les
              échanges de matchs sont désactivés et seuls les créneaux
              réellement libres sont proposés, sous réserve d’accord des deux
              équipes.
            </p>
          )}

          <div className="tournament-reschedule__summary">
            <span>
              <strong>{freeSlots.length}</strong> créneau
              {freeSlots.length > 1 ? "x" : ""} libre
              {freeSlots.length > 1 ? "s" : ""}
            </span>
            {swapsEnabled ? (
              <span>
                <strong>{swaps.length}</strong> échange
                {swaps.length > 1 ? "s" : ""} possible
                {swaps.length > 1 ? "s" : ""}
              </span>
            ) : (
              <span>
                <strong>—</strong> échanges désactivés
              </span>
            )}
          </div>

          {freeSlots.length === 0 && (!swapsEnabled || swaps.length === 0) ? (
            <p className="tournament-reschedule__empty">
              {swapsEnabled
                ? "Aucune solution compatible n’a été trouvée pour le moment."
                : "Aucun créneau libre compatible n’a été trouvé pour le moment."}
            </p>
          ) : (
            <div className="tournament-reschedule__groups">
              {visibleFreeSlots.length > 0 && (
                <section>
                  <h5>Créneaux libres</h5>
                  <div className="tournament-reschedule__list">
                    {visibleFreeSlots.map((option) => (
                      <FreeSlotCard
                        key={`${option.resourceId}-${option.playDate}-${option.startsAt}`}
                        option={option}
                        availabilityUnknown={availabilityUnknown}
                      />
                    ))}
                  </div>
                  {freeSlots.length > visibleFreeSlots.length && (
                    <small>
                      + {freeSlots.length - visibleFreeSlots.length} autre
                      {freeSlots.length - visibleFreeSlots.length > 1
                        ? "s"
                        : ""}{" "}
                      solution
                      {freeSlots.length - visibleFreeSlots.length > 1
                        ? "s"
                        : ""}
                    </small>
                  )}
                </section>
              )}

              {swapsEnabled && visibleSwaps.length > 0 && (
                <section>
                  <h5>Échanges de créneaux</h5>
                  <div className="tournament-reschedule__list">
                    {visibleSwaps.map((option) => (
                      <SwapCard key={option.swapMatchId} option={option} />
                    ))}
                  </div>
                  {swaps.length > visibleSwaps.length && (
                    <small>
                      + {swaps.length - visibleSwaps.length} autre
                      {swaps.length - visibleSwaps.length > 1 ? "s" : ""}{" "}
                      échange
                      {swaps.length - visibleSwaps.length > 1 ? "s" : ""}
                    </small>
                  )}
                </section>
              )}
            </div>
          )}

          <p className="tournament-reschedule__preview-note">
            Cette étape est une prévisualisation : aucune partie n’est déplacée
            tant que le circuit d’accord des équipes n’est pas activé.
          </p>
        </>
      )}
    </div>
  );
}
