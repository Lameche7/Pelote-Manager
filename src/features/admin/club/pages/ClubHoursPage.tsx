import { useEffect, useMemo, useState } from "react";
import {
  adminReservationService,
  type OpeningHour,
} from "@/features/admin/services/adminReservationService";
import { reservationCalendarService } from "@/features/reservations/services/reservationCalendarService";
import type { ReservableResource } from "@/features/reservations/domain/calendar";
import "./ClubPages.css";

const DAYS = [
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
];

function messageOf(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return fallback;
}

export function ClubHoursPage() {
  const [resources, setResources] = useState<ReservableResource[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [hours, setHours] = useState<OpeningHour[]>([]);
  const [draft, setDraft] = useState({
    weekday: 1,
    opensAt: "09:00",
    closesAt: "22:00",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedResource = useMemo(
    () => resources.find((resource) => resource.id === resourceId),
    [resourceId, resources],
  );

  async function loadHours(id: string) {
    if (!id) {
      setHours([]);
      return;
    }
    setHours(await adminReservationService.listOpeningHours(id));
  }

  useEffect(() => {
    reservationCalendarService
      .listResources()
      .then(async (list) => {
        setResources(list);
        const id = list[0]?.id ?? "";
        setResourceId(id);
        await loadHours(id);
      })
      .catch((loadError: unknown) =>
        setError(messageOf(loadError, "Chargement des horaires impossible.")),
      )
      .finally(() => setLoading(false));
  }, []);

  async function selectResource(id: string) {
    setResourceId(id);
    setError("");
    setMessage("");
    try {
      await loadHours(id);
    } catch (loadError) {
      setError(messageOf(loadError, "Chargement des horaires impossible."));
    }
  }

  async function run(action: () => Promise<void>, success: string) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await action();
      await loadHours(resourceId);
      setMessage(success);
    } catch (actionError) {
      setError(messageOf(actionError, "Opération impossible."));
    } finally {
      setSaving(false);
    }
  }

  async function addHour() {
    if (draft.closesAt <= draft.opensAt) {
      setError("L’heure de fin doit être postérieure à l’heure de début.");
      return;
    }

    await run(
      () =>
        adminReservationService.saveOpeningHour({
          resourceId,
          ...draft,
          isActive: true,
        }),
      "La plage horaire a été ajoutée au calendrier des réservations.",
    );
  }

  if (loading)
    return (
      <section className="admin-page">
        <p role="status">Chargement des horaires…</p>
      </section>
    );

  return (
    <section className="admin-page">
      <header className="admin-page__header">
        <p className="admin-page__eyebrow">Club</p>
        <h1>Horaires de réservation</h1>
        <p className="admin-page__lead">
          Chaque terrain possède son propre planning hebdomadaire. Les créneaux
          proposés aux utilisateurs durent toujours 60 minutes.
        </p>
      </header>

      {error && (
        <p className="club-alert club-alert--error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="club-alert" role="status">
          {message}
        </p>
      )}

      <div className="admin-card club-stack">
        <label>
          Terrain
          <select
            value={resourceId}
            onChange={(event) => void selectResource(event.target.value)}
          >
            {resources.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}
              </option>
            ))}
          </select>
        </label>

        <div className="club-hours-summary">
          <strong>Réglage appliqué</strong>
          <span>1 réservation = 1 heure · départs toutes les heures</span>
          <small>
            Les changements concernent{" "}
            {selectedResource?.name ?? "le terrain sélectionné"} et apparaissent
            directement dans le calendrier utilisateur.
          </small>
        </div>

        <div>
          <h2>Ajouter une plage</h2>
          <div className="club-hours-form">
            <label>
              Jour
              <select
                value={draft.weekday}
                onChange={(event) =>
                  setDraft({ ...draft, weekday: Number(event.target.value) })
                }
              >
                {DAYS.map((day, index) => (
                  <option key={day} value={index + 1}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ouverture
              <input
                type="time"
                value={draft.opensAt}
                onChange={(event) =>
                  setDraft({ ...draft, opensAt: event.target.value })
                }
              />
            </label>
            <label>
              Fermeture
              <input
                type="time"
                value={draft.closesAt}
                onChange={(event) =>
                  setDraft({ ...draft, closesAt: event.target.value })
                }
              />
            </label>
            <button
              disabled={saving || !resourceId}
              onClick={() => void addHour()}
            >
              Ajouter la plage
            </button>
          </div>
        </div>

        <div className="club-hours-week" aria-label="Planning hebdomadaire">
          {DAYS.map((day, index) => {
            const dayHours = hours.filter(
              (hour) => hour.weekday === index + 1,
            );
            return (
              <article className="club-hours-day" key={day}>
                <header>
                  <h3>{day}</h3>
                  <span>
                    {dayHours.some((hour) => hour.isActive)
                      ? "Ouvert"
                      : "Fermé"}
                  </span>
                </header>

                {dayHours.length === 0 ? (
                  <p>Aucune plage de réservation.</p>
                ) : (
                  <ul>
                    {dayHours.map((hour) => (
                      <li key={hour.id}>
                        <span>
                          <strong>
                            {hour.opensAt.slice(0, 5)} –{" "}
                            {hour.closesAt.slice(0, 5)}
                          </strong>
                          <small>
                            {hour.isActive
                              ? "Visible dans le calendrier"
                              : "Désactivée"}
                          </small>
                        </span>
                        <div>
                          <button
                            disabled={saving}
                            onClick={() =>
                              void run(
                                () =>
                                  adminReservationService.saveOpeningHour({
                                    ...hour,
                                    isActive: !hour.isActive,
                                  }),
                                hour.isActive
                                  ? "La plage a été désactivée."
                                  : "La plage a été réactivée.",
                              )
                            }
                          >
                            {hour.isActive ? "Désactiver" : "Activer"}
                          </button>
                          <button
                            disabled={saving}
                            onClick={() => {
                              if (confirm("Supprimer cette plage horaire ?"))
                                void run(
                                  () =>
                                    adminReservationService.deleteOpeningHour(
                                      hour.id,
                                    ),
                                  "La plage horaire a été supprimée.",
                                );
                            }}
                          >
                            Supprimer
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
