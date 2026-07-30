import type {
  CalendarSlot,
  ReservableResource,
} from "@/features/reservations/domain/calendar";

export function SlotPicker({
  resources,
  resourceId,
  date,
  slots,
  loading,
  selected,
  onResource,
  onDate,
  onSelect,
}: {
  resources: ReservableResource[];
  resourceId: string;
  date: string;
  slots: CalendarSlot[];
  loading: boolean;
  selected: string;
  onResource: (id: string) => void;
  onDate: (date: string) => void;
  onSelect: (startsAt: string) => void;
}) {
  return (
    <fieldset className="slot-picker">
      <legend>Choisir un créneau disponible</legend>
      <div className="slot-picker__controls">
        <label>
          Terrain
          <select
            value={resourceId}
            onChange={(e) => onResource(e.target.value)}
          >
            {resources.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input
            type="date"
            min={new Date().toISOString().slice(0, 10)}
            value={date}
            onChange={(e) => onDate(e.target.value)}
          />
        </label>
      </div>
      {loading ? (
        <p>Chargement des créneaux…</p>
      ) : (
        <div className="slot-picker__slots">
          {slots.map((slot) => (
            <button
              type="button"
              key={slot.startsAt}
              className={selected === slot.startsAt ? "is-selected" : ""}
              onClick={() => onSelect(slot.startsAt)}
            >
              {new Date(slot.startsAt).toLocaleTimeString("fr-FR", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              –{" "}
              {new Date(slot.endsAt).toLocaleTimeString("fr-FR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </button>
          ))}
        </div>
      )}
      {!loading && slots.length === 0 && (
        <p>Aucun créneau disponible pour cette date.</p>
      )}
    </fieldset>
  );
}
