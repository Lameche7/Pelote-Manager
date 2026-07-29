import { useEffect, useState } from "react";
import {
  adminReservationService,
  type CalendarClosure,
  type OpeningHour,
  type ReservationAdminSettings,
} from "@/features/admin/services/adminReservationService";
import { reservationCalendarService } from "@/features/reservations/services/reservationCalendarService";
import type { ReservableResource } from "@/features/reservations/domain/calendar";
import "./AdminReservationsPage.css";

const WEEKDAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

function eurosToCents(value: string): number {
  return Math.round(Number(value.replace(",", ".")) * 100);
}

function centsToEuros(value: number): string {
  return (value / 100).toFixed(2);
}

export function AdminReservationsPage() {
  const [resources, setResources] = useState<ReservableResource[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [settings, setSettings] = useState<ReservationAdminSettings | null>(null);
  const [openingHours, setOpeningHours] = useState<OpeningHour[]>([]);
  const [closures, setClosures] = useState<CalendarClosure[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newHour, setNewHour] = useState({ weekday: 1, opensAt: "17:30", closesAt: "21:30" });
  const [newClosure, setNewClosure] = useState({ title: "", startsAt: "", endsAt: "" });

  async function loadResourceData(selectedResourceId: string) {
    const [hours, loadedClosures] = await Promise.all([
      adminReservationService.listOpeningHours(selectedResourceId),
      adminReservationService.listClosures(selectedResourceId),
    ]);
    setOpeningHours(hours);
    setClosures(loadedClosures);
  }

  useEffect(() => {
    let mounted = true;

    Promise.all([
      reservationCalendarService.listResources(),
      adminReservationService.getSettings(),
    ])
      .then(async ([loadedResources, loadedSettings]) => {
        if (!mounted) return;
        setResources(loadedResources);
        setSettings(loadedSettings);
        const firstResourceId = loadedResources[0]?.id ?? "";
        setResourceId(firstResourceId);
        if (firstResourceId) await loadResourceData(firstResourceId);
      })
      .catch((loadError: unknown) => {
        if (mounted) setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function changeResource(nextResourceId: string) {
    setResourceId(nextResourceId);
    setError(null);
    await loadResourceData(nextResourceId);
  }

  async function saveSettings() {
    if (!settings) return;
    setIsSaving(true);
    setError(null);
    setMessage(null);
    try {
      await adminReservationService.updateSettings(settings);
      setMessage("Les paramètres de réservation ont été enregistrés.");
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : "Enregistrement impossible.");
    } finally {
      setIsSaving(false);
    }
  }

  async function addOpeningHour() {
    if (!resourceId) return;
    setError(null);
    await adminReservationService.saveOpeningHour({
      resourceId,
      weekday: newHour.weekday,
      opensAt: newHour.opensAt,
      closesAt: newHour.closesAt,
      isActive: true,
    });
    await loadResourceData(resourceId);
    setMessage("L’horaire d’ouverture a été ajouté.");
  }

  async function removeOpeningHour(id: string) {
    await adminReservationService.deleteOpeningHour(id);
    await loadResourceData(resourceId);
  }

  async function addClosure() {
    if (!resourceId || !newClosure.title || !newClosure.startsAt || !newClosure.endsAt) return;
    setError(null);
    await adminReservationService.createClosure({
      resourceId,
      title: newClosure.title,
      startsAt: new Date(newClosure.startsAt).toISOString(),
      endsAt: new Date(newClosure.endsAt).toISOString(),
    });
    setNewClosure({ title: "", startsAt: "", endsAt: "" });
    await loadResourceData(resourceId);
    setMessage("La fermeture a été ajoutée au calendrier.");
  }

  async function removeClosure(id: string) {
    await adminReservationService.deleteClosure(id);
    await loadResourceData(resourceId);
  }

  if (isLoading || !settings) return <section className="admin-reservations"><p>Chargement…</p></section>;

  return (
    <section className="admin-reservations" aria-labelledby="admin-reservations-title">
      <header>
        <p className="admin-reservations__eyebrow">Administration</p>
        <h1 id="admin-reservations-title">Paramètres des réservations</h1>
        <p>Configurez les tarifs, délais, quotas, horaires et fermetures sans modifier le code.</p>
      </header>

      {error && <p className="admin-reservations__alert admin-reservations__alert--error" role="alert">{error}</p>}
      {message && <p className="admin-reservations__alert" role="status">{message}</p>}

      <div className="admin-reservations__panel">
        <h2>Règles générales</h2>
        {settings.paymentMode === "test" && (
          <p className="admin-reservations__alert" role="status">
            MODE TEST — aucun paiement réel n’est effectué.
          </p>
        )}
        <div className="admin-reservations__form-grid">
          <label>Mode de paiement<select value={settings.paymentMode} onChange={(event) => setSettings({ ...settings, paymentMode: event.target.value as "test" | "helloasso" })}><option value="test">Test — paiement simulé</option><option value="helloasso">Production — HelloAsso</option></select></label>
          <label>Anticipation licencié (heures)<input type="number" min="0" value={settings.licenseeAdvanceHours} onChange={(event) => setSettings({ ...settings, licenseeAdvanceHours: Number(event.target.value) })} /></label>
          <label>Anticipation public (heures)<input type="number" min="0" value={settings.publicAdvanceHours} onChange={(event) => setSettings({ ...settings, publicAdvanceHours: Number(event.target.value) })} /></label>
          <label>Tarif licencié (€)<input inputMode="decimal" value={centsToEuros(settings.licenseePriceCents)} onChange={(event) => setSettings({ ...settings, licenseePriceCents: eurosToCents(event.target.value) })} /></label>
          <label>Tarif public (€)<input inputMode="decimal" value={centsToEuros(settings.publicPriceCents)} onChange={(event) => setSettings({ ...settings, publicPriceCents: eurosToCents(event.target.value) })} /></label>
          <label>Durée d’un créneau (minutes)<input type="number" min="1" value={settings.defaultDurationMinutes} onChange={(event) => setSettings({ ...settings, defaultDurationMinutes: Number(event.target.value) })} /></label>
          <label>Pas du calendrier (minutes)<input type="number" min="1" value={settings.bookingStepMinutes} onChange={(event) => setSettings({ ...settings, bookingStepMinutes: Number(event.target.value) })} /></label>
          <label>Délai minimum (minutes)<input type="number" min="0" value={settings.minimumNoticeMinutes} onChange={(event) => setSettings({ ...settings, minimumNoticeMinutes: Number(event.target.value) })} /></label>
          <label>Quota licencié<input type="number" min="1" value={settings.licenseeMaxActiveReservations} onChange={(event) => setSettings({ ...settings, licenseeMaxActiveReservations: Number(event.target.value) })} /></label>
          <label>Quota public<input type="number" min="1" value={settings.publicMaxActiveReservations} onChange={(event) => setSettings({ ...settings, publicMaxActiveReservations: Number(event.target.value) })} /></label>
        </div>
        <button type="button" disabled={isSaving} onClick={() => void saveSettings()}>{isSaving ? "Enregistrement…" : "Enregistrer les paramètres"}</button>
      </div>

      <div className="admin-reservations__panel">
        <label className="admin-reservations__resource">Terrain<select value={resourceId} onChange={(event) => void changeResource(event.target.value)}>{resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}</select></label>

        <h2>Horaires d’ouverture</h2>
        <div className="admin-reservations__inline-form">
          <select aria-label="Jour" value={newHour.weekday} onChange={(event) => setNewHour({ ...newHour, weekday: Number(event.target.value) })}>{WEEKDAYS.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select>
          <input aria-label="Heure d’ouverture" type="time" value={newHour.opensAt} onChange={(event) => setNewHour({ ...newHour, opensAt: event.target.value })} />
          <input aria-label="Heure de fermeture" type="time" value={newHour.closesAt} onChange={(event) => setNewHour({ ...newHour, closesAt: event.target.value })} />
          <button type="button" onClick={() => void addOpeningHour()}>Ajouter</button>
        </div>
        <ul className="admin-reservations__list">{openingHours.map((hour) => <li key={hour.id}><span>{WEEKDAYS[hour.weekday - 1]} : {hour.opensAt.slice(0, 5)}–{hour.closesAt.slice(0, 5)}</span><button type="button" onClick={() => void removeOpeningHour(hour.id)}>Supprimer</button></li>)}</ul>

        <h2>Fermetures ponctuelles</h2>
        <div className="admin-reservations__inline-form">
          <input placeholder="Motif" value={newClosure.title} onChange={(event) => setNewClosure({ ...newClosure, title: event.target.value })} />
          <input aria-label="Début de fermeture" type="datetime-local" value={newClosure.startsAt} onChange={(event) => setNewClosure({ ...newClosure, startsAt: event.target.value })} />
          <input aria-label="Fin de fermeture" type="datetime-local" value={newClosure.endsAt} onChange={(event) => setNewClosure({ ...newClosure, endsAt: event.target.value })} />
          <button type="button" onClick={() => void addClosure()}>Ajouter</button>
        </div>
        <ul className="admin-reservations__list">{closures.map((closure) => <li key={closure.id}><span>{closure.title} — {new Date(closure.startsAt).toLocaleString("fr-FR")} au {new Date(closure.endsAt).toLocaleString("fr-FR")}</span><button type="button" onClick={() => void removeClosure(closure.id)}>Supprimer</button></li>)}</ul>
      </div>
    </section>
  );
}
