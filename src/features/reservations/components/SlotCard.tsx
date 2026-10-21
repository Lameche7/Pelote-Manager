import type { CSSProperties } from "react";
import { WhistleIcon } from "@/features/refereeing/components/WhistleIcon";
import { formatBookingOpening, formatTime, type CalendarSlot } from "@/features/reservations/domain/calendar";

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

  const channels = [0, 2, 4].map((offset) =>
    Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const contrastWithDark = (luminance + 0.05) / 0.05;
  const contrastWithWhite = 1.05 / (luminance + 0.05);

  return contrastWithDark >= contrastWithWhite ? "#111827" : "#ffffff";
}

export function SlotCard({
  slot,
  timezone,
  championshipMatchSelected,
  onBook,
  onInspect,
  canInspectLocked,
}: {
  slot: CalendarSlot;
  timezone: string;
  championshipMatchSelected: boolean;
  onBook: (slot: CalendarSlot) => void;
  onInspect: (slot: CalendarSlot) => void;
  canInspectLocked: boolean;
}) {
  const slotTime = formatTime(slot.startsAt, timezone);
  const isChampionship = slot.reservationAccess === "championship";

  if (slot.status === "occupied") {
    const bookedBy = slot.bookedByName ?? "Réservation";
    const isTournamentMatch =
      slot.occupationType === "match" && Boolean(slot.displayColor);
    const isChampionshipMatch = slot.occupationType === "championship_match";
    const isColoredMatch = isTournamentMatch || isChampionshipMatch;
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
          "--tournament-series-contrast": getContrastTextColor(slot.displayColor),
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
        <span className={isColoredMatch ? "reservation-slot__match-badge" : undefined}>
          {isChampionshipMatch
            ? "Partie championnat"
            : isTournamentMatch
              ? "Partie tournoi"
              : "Occupé"}
        </span>
        <small>{bookedByDetails}</small>
        {(isChampionshipMatch || isTournamentMatch) && slot.hasReferee && <span className="reservation-slot__referee" title={slot.refereeName ? `Arbitre : ${slot.refereeName}` : "Partie arbitrée"}><WhistleIcon aria-label="Partie arbitrée" width="18" height="18" />{slot.refereeName && <span>{slot.refereeName}</span>}</span>}
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
    const LockedContainer = canInspectLocked ? "button" : "div";
    return (
      <LockedContainer
        {...(canInspectLocked ? { type: "button" as const, onClick: () => onInspect(slot) } : {})}
        className={`reservation-slot reservation-slot--locked${isChampionship ? " reservation-slot--championship" : ""}`}
        aria-label={`${slotTime} : ${isChampionship ? "créneau championnat, " : ""}réservable à partir du ${openingLabel}`}
      >
        <strong>{slotTime}</strong>
        <span>
          {isChampionship ? "Championnat · " : ""}Réservable dès le{" "}
          {openingLabel}
        </span>
      </LockedContainer>
    );
  }

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

