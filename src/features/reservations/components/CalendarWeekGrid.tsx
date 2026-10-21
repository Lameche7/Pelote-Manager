import type { CalendarSlot } from "@/features/reservations/domain/calendar";
import { toDateInputValue } from "@/features/reservations/domain/calendar";
import { SlotCard } from "./SlotCard";

const dayFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short", day: "numeric", month: "short",
});

type CalendarWeekGridProps = {
  weekDays: Date[];
  slotsByDay: Map<string, CalendarSlot[]>;
  timezone: string;
  championshipMatchSelected: boolean;
  onBook: (slot: CalendarSlot) => void;
  onInspect: (slot: CalendarSlot) => void;
};

export function CalendarWeekGrid({ weekDays, slotsByDay, timezone, championshipMatchSelected, onBook, onInspect }: CalendarWeekGridProps) {
  return (
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
                    timezone={timezone}
                    championshipMatchSelected={championshipMatchSelected}
                    onBook={onBook}
                    onInspect={onInspect}
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
  );
}
