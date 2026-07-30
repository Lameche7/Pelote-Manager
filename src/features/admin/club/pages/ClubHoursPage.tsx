import { useEffect, useState } from "react";
import {
  adminReservationService,
  type OpeningHour,
  type ReservationAdminSettings,
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

export function ClubHoursPage() {
  const [resources, setResources] = useState<ReservableResource[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [hours, setHours] = useState<OpeningHour[]>([]);
  const [settings, setSettings] = useState<ReservationAdminSettings | null>(
    null,
  );
  const [draft, setDraft] = useState({
    weekday: 1,
    opensAt: "08:00",
    closesAt: "22:00",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadHours(id: string) {
    setHours(await adminReservationService.listOpeningHours(id));
  }
  useEffect(() => {
    Promise.all([
      reservationCalendarService.listResources(),
      adminReservationService.getSettings(),
    ])
      .then(async ([list, value]) => {
        setResources(list);
        setSettings(value);
        const id = list[0]?.id ?? "";
        setResourceId(id);
        if (id) await loadHours(id);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Chargement impossible."),
      )
      .finally(() => setLoading(false));
  }, []);

  async function run(action: () => Promise<void>, success: string) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await action();
      await loadHours(resourceId);
      setMessage(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opération impossible.");
    } finally {
      setSaving(false);
    }
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
          Définissez les plages d’ouverture, la durée des créneaux et le pas de
          réservation.
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
            onChange={(e) => {
              setResourceId(e.target.value);
              void loadHours(e.target.value);
            }}
          >
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        {settings && (
          <div className="club-inline">
            <label>
              Durée du créneau
              <input
                type="number"
                min="1"
                value={settings.defaultDurationMinutes}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    defaultDurationMinutes: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Pas de réservation
              <input
                type="number"
                min="1"
                value={settings.bookingStepMinutes}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    bookingStepMinutes: Number(e.target.value),
                  })
                }
              />
            </label>
            <button
              disabled={saving}
              onClick={() =>
                void run(
                  () => adminReservationService.updateSettings(settings),
                  "Configuration enregistrée.",
                )
              }
            >
              Enregistrer
            </button>
          </div>
        )}
        <h2>Plages hebdomadaires</h2>
        <div className="club-inline">
          <select
            value={draft.weekday}
            onChange={(e) =>
              setDraft({ ...draft, weekday: Number(e.target.value) })
            }
          >
            {DAYS.map((d, i) => (
              <option key={d} value={i + 1}>
                {d}
              </option>
            ))}
          </select>
          <input
            type="time"
            aria-label="Ouverture"
            value={draft.opensAt}
            onChange={(e) => setDraft({ ...draft, opensAt: e.target.value })}
          />
          <input
            type="time"
            aria-label="Fermeture"
            value={draft.closesAt}
            onChange={(e) => setDraft({ ...draft, closesAt: e.target.value })}
          />
          <button
            disabled={saving || !resourceId}
            onClick={() =>
              void run(
                () =>
                  adminReservationService.saveOpeningHour({
                    resourceId,
                    ...draft,
                    isActive: true,
                  }),
                "Horaire ajouté.",
              )
            }
          >
            Ajouter
          </button>
        </div>
        <ul className="club-list">
          {hours.map((h) => (
            <li key={h.id}>
              <span>
                <strong>{DAYS[h.weekday - 1]}</strong>
                <small>
                  {h.opensAt.slice(0, 5)}–{h.closesAt.slice(0, 5)} ·{" "}
                  {h.isActive ? "Réservations activées" : "Désactivées"}
                </small>
              </span>
              <div>
                <button
                  onClick={() =>
                    void run(
                      () =>
                        adminReservationService.saveOpeningHour({
                          ...h,
                          isActive: !h.isActive,
                        }),
                      h.isActive
                        ? "Réservations désactivées."
                        : "Réservations activées.",
                    )
                  }
                >
                  {h.isActive ? "Désactiver" : "Activer"}
                </button>
                <button
                  onClick={() => {
                    if (confirm("Supprimer cette plage horaire ?"))
                      void run(
                        () => adminReservationService.deleteOpeningHour(h.id),
                        "Horaire supprimé.",
                      );
                  }}
                >
                  Supprimer
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
