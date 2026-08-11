import { useMemo } from "react";
import type {
  TournamentAvailabilitySlot,
  TournamentPhase,
} from "@/features/tournaments/types";
import "./TournamentAvailabilityGrid.css";

const slotKey = (slot: TournamentAvailabilitySlot) =>
  `${slot.date}|${slot.startsAt}|${slot.endsAt}`;

const slotPhase = (slot: TournamentAvailabilitySlot): TournamentPhase =>
  slot.phase ?? "pools";

const dateWeekday = (value: string) =>
  new Date(`${value}T12:00:00Z`).getUTCDay();

const isWeekend = (value: string) => {
  const weekday = dateWeekday(value);
  return weekday === 0 || weekday === 6;
};

const isoWeek = (value: string) => {
  const source = new Date(`${value}T12:00:00Z`);
  const date = new Date(
    Date.UTC(
      source.getUTCFullYear(),
      source.getUTCMonth(),
      source.getUTCDate(),
    ),
  );
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return { week, year: isoYear };
};

const dayFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const formatDay = (value: string) =>
  dayFormatter.format(new Date(`${value}T12:00:00Z`)).replace(".", ".");

type DayGroup = {
  date: string;
  slots: TournamentAvailabilitySlot[];
};

type WeekGroup = {
  key: string;
  phase: TournamentPhase;
  week: number;
  year: number;
  days: DayGroup[];
  times: string[];
};

const buildWeeks = (slots: TournamentAvailabilitySlot[]): WeekGroup[] => {
  const ordered = [...slots].sort((left, right) => {
    const phaseOrder = slotPhase(left) === slotPhase(right)
      ? 0
      : slotPhase(left) === "pools"
        ? -1
        : 1;
    if (phaseOrder !== 0) return phaseOrder;
    return `${left.date}|${left.startsAt}|${left.endsAt}`.localeCompare(
      `${right.date}|${right.startsAt}|${right.endsAt}`,
    );
  });
  const weeks = new Map<
    string,
    {
      phase: TournamentPhase;
      week: number;
      year: number;
      days: Map<string, TournamentAvailabilitySlot[]>;
      times: Set<string>;
    }
  >();

  for (const slot of ordered) {
    const phase = slotPhase(slot);
    const { week, year } = isoWeek(slot.date);
    const key = `${phase}-${year}-${String(week).padStart(2, "0")}`;
    const group = weeks.get(key) ?? {
      phase,
      week,
      year,
      days: new Map<string, TournamentAvailabilitySlot[]>(),
      times: new Set<string>(),
    };
    group.days.set(slot.date, [...(group.days.get(slot.date) ?? []), slot]);
    group.times.add(slot.startsAt);
    weeks.set(key, group);
  }

  return [...weeks.entries()].map(([key, group]) => ({
    key,
    phase: group.phase,
    week: group.week,
    year: group.year,
    days: [...group.days.entries()].map(([date, daySlots]) => ({
      date,
      slots: daySlots,
    })),
    times: [...group.times].sort(),
  }));
};

type AvailabilityTournament = {
  availableSlots: TournamentAvailabilitySlot[];
  minimumAvailabilitySlots: number;
  minimumWeekendAvailabilitySlots: number;
};

type Props = {
  tournament: AvailabilityTournament;
  value: TournamentAvailabilitySlot[];
  disabled?: boolean;
  variant?: "registration" | "admin";
  onChange: (slots: TournamentAvailabilitySlot[]) => void;
};

export function TournamentAvailabilityGrid({
  tournament,
  value,
  disabled = false,
  variant = "registration",
  onChange,
}: Props) {
  const weeks = useMemo(
    () => buildWeeks(tournament.availableSlots),
    [tournament.availableSlots],
  );
  const selectedKeys = useMemo(() => new Set(value.map(slotKey)), [value]);
  const validSelected = useMemo(
    () =>
      tournament.availableSlots.filter((slot) =>
        selectedKeys.has(slotKey(slot)),
      ),
    [selectedKeys, tournament.availableSlots],
  );
  const poolSelected = useMemo(
    () => validSelected.filter((slot) => slotPhase(slot) === "pools"),
    [validSelected],
  );
  const finalsSelected = useMemo(
    () => validSelected.filter((slot) => slotPhase(slot) === "finals"),
    [validSelected],
  );
  const poolWeekendCount = useMemo(
    () => poolSelected.filter((slot) => isWeekend(slot.date)).length,
    [poolSelected],
  );
  const minimumReached =
    poolSelected.length >= tournament.minimumAvailabilitySlots &&
    poolWeekendCount >= tournament.minimumWeekendAvailabilitySlots;

  const emitKeys = (keys: Set<string>) => {
    onChange(
      tournament.availableSlots.filter((slot) => keys.has(slotKey(slot))),
    );
  };

  const toggleSlot = (slot: TournamentAvailabilitySlot, checked: boolean) => {
    const next = new Set(selectedKeys);
    if (checked) next.add(slotKey(slot));
    else next.delete(slotKey(slot));
    emitKeys(next);
  };

  const toggleDay = (day: DayGroup, checked: boolean) => {
    const next = new Set(selectedKeys);
    for (const slot of day.slots) {
      if (checked) next.add(slotKey(slot));
      else next.delete(slotKey(slot));
    }
    emitKeys(next);
  };

  const duplicateWeek = (sourceIndex: number) => {
    const source = weeks[sourceIndex];
    const target = weeks[sourceIndex + 1];
    if (!source || !target || source.phase !== target.phase) return;

    const selectedPatterns = new Set(
      source.days.flatMap((day) =>
        day.slots
          .filter((slot) => selectedKeys.has(slotKey(slot)))
          .map(
            (slot) =>
              `${dateWeekday(slot.date)}|${slot.startsAt}|${slot.endsAt}`,
          ),
      ),
    );
    const next = new Set(selectedKeys);

    for (const day of target.days) {
      for (const slot of day.slots) {
        const key = slotKey(slot);
        const pattern = `${dateWeekday(slot.date)}|${slot.startsAt}|${slot.endsAt}`;
        next.delete(key);
        if (selectedPatterns.has(pattern)) next.add(key);
      }
    }

    emitKeys(next);
  };

  const admin = variant === "admin";
  const hasFinals = tournament.availableSlots.some(
    (slot) => slotPhase(slot) === "finals",
  );

  return (
    <section className="tournament-availability-grid">
      <header className="tournament-availability-grid__heading">
        <div>
          <p>{admin ? "Administration" : "Étape 3 / 5"}</p>
          <h3>
            {admin
              ? "Disponibilités datées de l’équipe"
              : "Créneaux disponibles — poules & phase finale"}
          </h3>
        </div>
        <strong>
          {validSelected.length} créneau{validSelected.length > 1 ? "x" : ""}
          {" sélectionné"}
          {validSelected.length > 1 ? "s" : ""}
        </strong>
      </header>

      <p
        className={`tournament-availability-grid__requirement${
          minimumReached
            ? " tournament-availability-grid__requirement--success"
            : ""
        }`}
        role="status"
      >
        {minimumReached ? "✅" : "⚠️"}{" "}
        {admin
          ? "Pour les poules, l’équipe doit conserver au moins "
          : "Pour les poules, vous devez cocher au moins "}
        <strong>{tournament.minimumAvailabilitySlots}</strong> créneaux dont{" "}
        <strong>{tournament.minimumWeekendAvailabilitySlots}</strong> le
        week-end. Les disponibilités de phase finale sont enregistrées
        séparément.
      </p>

      <div className="tournament-availability-grid__stats">
        <span>
          Poules : <strong>{poolSelected.length}</strong> créneaux — Week-end :{" "}
          <strong>{poolWeekendCount}</strong>
        </span>
        {hasFinals && (
          <span>
            Phase finale : <strong>{finalsSelected.length}</strong> créneau
            {finalsSelected.length > 1 ? "x" : ""}
          </span>
        )}
        <span>
          Minimum poules — Total :{" "}
          <strong>{tournament.minimumAvailabilitySlots}</strong> / Week-end :{" "}
          <strong>{tournament.minimumWeekendAvailabilitySlots}</strong>
        </span>
      </div>

      {weeks.length === 0 ? (
        <p className="tournament-availability-grid__empty">
          Aucun créneau daté n’est disponible sur les phases configurées de ce
          tournoi.
        </p>
      ) : (
        <div className="tournament-availability-grid__weeks">
          {weeks.map((week, weekIndex) => {
            const canDuplicate =
              weekIndex < weeks.length - 1 &&
              weeks[weekIndex + 1]?.phase === week.phase;
            return (
              <article className="tournament-availability-week" key={week.key}>
                <header>
                  <h4>
                    {week.phase === "pools" ? "Phase de poules" : "Phase finale"}
                    {" · "}Semaine {week.week} — {week.year}
                  </h4>
                  {canDuplicate && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => duplicateWeek(weekIndex)}
                    >
                      Dupliquer cette semaine → suivante
                    </button>
                  )}
                </header>

                <div className="tournament-availability-week__scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Jour</th>
                        {week.times.map((time) => (
                          <th scope="col" key={`${week.key}-${time}`}>
                            {time}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {week.days.map((day) => {
                        const allSelected = day.slots.every((slot) =>
                          selectedKeys.has(slotKey(slot)),
                        );
                        return (
                          <tr key={day.date}>
                            <th scope="row">
                              <div className="tournament-availability-day">
                                <strong>{formatDay(day.date)}</strong>
                                <label>
                                  <input
                                    type="checkbox"
                                    disabled={disabled}
                                    checked={allSelected}
                                    onChange={(event) =>
                                      toggleDay(day, event.target.checked)
                                    }
                                  />
                                  <span>Tout</span>
                                </label>
                              </div>
                            </th>
                            {week.times.map((time) => {
                              const slot = day.slots.find(
                                (candidate) => candidate.startsAt === time,
                              );
                              return (
                                <td key={`${day.date}-${time}`}>
                                  {slot ? (
                                    <input
                                      type="checkbox"
                                      aria-label={`${formatDay(day.date)} à ${time}`}
                                      disabled={disabled}
                                      checked={selectedKeys.has(slotKey(slot))}
                                      onChange={(event) =>
                                        toggleSlot(slot, event.target.checked)
                                      }
                                    />
                                  ) : (
                                    <span aria-hidden="true">—</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
