import type { CSSProperties } from "react";
import { WhistleIcon } from "@/features/refereeing/components/WhistleIcon";
import {
  formatBookingOpening,
  formatTime,
  type CalendarSlot,
} from "@/features/reservations/domain/calendar";

function getContrastTextColor(color: string): "#111827" | "#ffffff" {
  const hex = color.trim().replace("#", "");
  const normalized =
    hex.length === 3
      ? hex
          .split("")
          .map((value) => value + value)
          .join("")
      : hex;

  if (!/^[0-9a-f]{6}$/i.test(normalized)) return "#111827";

  const channels = [0, 2, 4].map(
    (offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const contrastWithDark = (luminance + 0.05) / 0.05;
  const contrastWithWhite = 1.05 / (luminance + 0.05);

  return contrastWithDark >= contrastWithWhite ? "#111827" : "#ffffff";
}

const tournamentFinalRoundLabels: Record<string, string> = {
  preliminary: "Barrage",
  round_of_32: "1/16 de finale",
  round_of_16: "1/8 de finale",
  quarterfinal: "Quart de finale",
  semifinal: "Demi-finale",
  final: "Finale",
};

export function SlotCard({
  slot,
  timezone,
  championshipMatchSelected,
  onBook,
  onInspect,
  canInspectLocked,
  resourceLabel,
  readOnly = false,
}: {
  slot: CalendarSlot;
  timezone: string;
  championshipMatchSelected: boolean;
  onBook: (slot: CalendarSlot) => void;
  onInspect: (slot: CalendarSlot) => void;
  canInspectLocked: boolean;
  resourceLabel?: string;
  readOnly?: boolean;
}) {
  const slotTime = formatTime(slot.startsAt, timezone);
  const isChampionship = slot.reservationAccess === "championship";
  const isFinalsHold = slot.occupationType === "tournament_finals_hold";
  const isFinalDayProgram =
    slot.occupationType === "tournament_final_day_program";

  if (slot.status === "occupied") {
    const bookedBy = slot.bookedByName ?? "Réservation";
    const isProjection = slot.occupationType === "tournament_finals_projection";
    const isTournamentMatch =
      slot.occupationType === "match" && Boolean(slot.displayColor);
    const isChampionshipMatch = slot.occupationType === "championship_match";
    const isColoredMatch =
      isTournamentMatch || isChampionshipMatch || isProjection;
    const bookedByDetails = slot.resultDisplay
      ? isChampionshipMatch
        ? bookedBy.split("\\n").slice(0, 2).join("\\n")
        : isTournamentMatch
          ? bookedBy.split(" · ")[0]
          : bookedBy
      : bookedBy;
    const style = slot.displayColor
      ? ({
          "--tournament-series-color": slot.displayColor,
          "--tournament-series-contrast": getContrastTextColor(
            slot.displayColor,
          ),
        } as CSSProperties)
      : undefined;
    return (
      <button
        type="button"
        onClick={() => onInspect(slot)}
        className={`reservation-slot reservation-slot--occupied${isColoredMatch ? " reservation-slot--tournament" : ""}`}
        style={style}
        aria-label={`${slotTime} : occupé par ${bookedBy}`}
      >
        <strong>{slotTime}</strong>
        {resourceLabel && <small>{resourceLabel}</small>}
        <span
          className={
            isColoredMatch ? "reservation-slot__match-badge" : undefined
          }
        >
          {isChampionshipMatch
            ? "Partie championnat"
            : isProjection
              ? "Phase finale · prévisionnel"
              : isTournamentMatch
                ? slot.tournamentFinalRound
                  ? `Tournoi · ${tournamentFinalRoundLabels[slot.tournamentFinalRound] ?? "Phase finale"}`
                  : "Partie tournoi"
                : "Occupé"}
        </span>
        <small>{bookedByDetails}</small>
        {(isChampionshipMatch || isTournamentMatch) && slot.hasReferee && (
          <span
            className="reservation-slot__referee"
            title={
              slot.refereeName
                ? `Arbitre : ${slot.refereeName}`
                : "Partie arbitrée"
            }
          >
            <WhistleIcon aria-label="Partie arbitrée" width="18" height="18" />
            {slot.refereeName && <span>{slot.refereeName}</span>}
          </span>
        )}
        {slot.resultDisplay && (
          <span className="reservation-slot__result">{slot.resultDisplay}</span>
        )}
      </button>
    );
  }

  if (slot.status === "locked") {
    const openingLabel = slot.bookingOpensAt
      ? formatBookingOpening(slot.bookingOpensAt, timezone)
      : "prochainement";
    const previewStyle =
      isFinalDayProgram && slot.displayColor
        ? ({
            "--tournament-series-color": slot.displayColor,
            "--tournament-series-contrast": getContrastTextColor(
              slot.displayColor,
            ),
          } as CSSProperties)
        : undefined;
    const LockedContainer = canInspectLocked && !readOnly ? "button" : "div";
    return (
      <LockedContainer
        {...(canInspectLocked && !readOnly
          ? { type: "button" as const, onClick: () => onInspect(slot) }
          : {})}
        className={`reservation-slot reservation-slot--locked${isChampionship ? " reservation-slot--championship" : ""}${isFinalsHold ? " reservation-slot--finals-hold" : ""}${isFinalDayProgram ? " reservation-slot--tournament reservation-slot--final-day-program" : ""}`}
        style={previewStyle}
        aria-label={
          isFinalDayProgram
            ? `${slotTime} : ${slot.bookedByName ?? "Finale du tournoi"}`
            : isFinalsHold
              ? `${slotTime} : réservé aux phases finales du tournoi`
              : `${slotTime} : ${isChampionship ? "créneau championnat, " : ""}réservable à partir du ${openingLabel}`
        }
      >
        <strong>{slotTime}</strong>
        {resourceLabel && <small>{resourceLabel}</small>}
        <span>
          {isFinalDayProgram ? (
            <>
              <strong>Finale du tournoi</strong>
              <small>{slot.bookedByName}</small>
            </>
          ) : isFinalsHold ? (
            "Réservé · Phases finales du tournoi"
          ) : (
            <>
              {isChampionship ? "Championnat · " : ""}Réservable dès le{" "}
              {openingLabel}
            </>
          )}
        </span>
      </LockedContainer>
    );
  }

  if (readOnly) return null;

  return (
    <button
      type="button"
      className={`reservation-slot reservation-slot--available${isChampionship ? " reservation-slot--championship" : ""}`}
      aria-label={
        isChampionship && !championshipMatchSelected
          ? `Choisir une rencontre avant de réserver le créneau de ${slotTime}`
          : `Réserver le créneau de ${slotTime}${isChampionship ? " pour la rencontre de championnat sélectionnée" : ""}`
      }
      onClick={() => onBook(slot)}
    >
      <strong>{slotTime}</strong>
      {resourceLabel && <small>{resourceLabel}</small>}
      <span>
        {isChampionship
          ? championshipMatchSelected
            ? "Réserver · Championnat"
            : "Choisir une rencontre"
          : "Réserver"}
      </span>
    </button>
  );
}
