import { useEffect, useMemo, useState } from "react";
import { adminPermanentSlotService } from "@/features/admin/reservations/services/adminPermanentSlotService";
import { adminReservationService } from "@/features/admin/services/adminReservationService";
import type { ReservableResource } from "@/features/reservations/domain/calendar";
import "./AdminPermanentSlotsPage.css";

const WEEKDAYS = [
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addMinutes(time: string, minutes: number): string {
  const [hours, mins] = time.split(":").map(Number);
  const total = hours * 60 + mins + minutes;
  const endHours = Math.floor(total / 60) % 24;
  const endMinutes = total % 60;
  return `${String(endHours).padStart(2, "0")}:${String(endMinutes).padStart(2, "0")}`;
}

export function AdminPermanentSlotsPage() {
  const [slots, setSlots] = useState<Awaited<ReturnType<typeof adminPermanentSlotService.listSlots>>>([]);
  const [resources, setResources] = useState<ReservableResource[]>([]);
  const [candidates, setCandidates] = useState<Awaited<ReturnType<typeof adminPermanentSlotService.listCandidates>>>([]);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    label: "",
    resourceId: "",
    weekday: 1,
    startsAt: "18:00",
    validFrom: todayIso(),
    validUntil: "",
    managementWindowHours: 48,
    primaryProfileId: "",
    managerProfileIds: [] as string[],
  });

  async function loadData() {
    setError(null);
    try {
      const [loadedSlots, loadedResources, loadedCandidates, settings] =
        await Promise.all([
          adminPermanentSlotService.listSlots(),
          adminPermanentSlotService.listResources(),
          adminPermanentSlotService.listCandidates(),
          adminReservationService.getSettings(),
        ]);
      setSlots(loadedSlots);
      setResources(loadedResources);
      setCandidates(loadedCandidates);
      setDurationMinutes(settings.defaultDurationMinutes);
      setForm((current) => ({
        ...current,
        resourceId: current.resourceId || loadedResources[0]?.id || "",
        primaryProfileId:
          current.primaryProfileId || loadedCandidates[0]?.profileId || "",
      }));
    } catch (loadError: unknown) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Chargement impossible.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const endsAt = useMemo(
    () => addMinutes(form.startsAt, durationMinutes),
    [durationMinutes, form.startsAt],
  );

  async function createSlot() {
    if (
      !form.label.trim() ||
      !form.resourceId ||
      !form.primaryProfileId ||
      !form.validFrom ||
      !form.validUntil
    ) {
      setError("Complétez tous les champs obligatoires.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);
    try {
      await adminPermanentSlotService.createSlot({
        ...form,
        label: form.label.trim(),
        endsAt,
      });
      setMessage("Le créneau permanent a été créé.");
      setForm((current) => ({
        ...current,
        label: "",
        managerProfileIds: [],
      }));
      await loadData();
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Création impossible.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function deactivateSlot(slotId: string) {
    if (!window.confirm("Désactiver ce créneau permanent et ses occurrences futures ?")) return;
    setError(null);
    setMessage(null);
    try {
      await adminPermanentSlotService.deactivateSlot(slotId);
      setMessage("Le créneau permanent a été désactivé.");
      await loadData();
    } catch (deactivateError: unknown) {
      setError(
        deactivateError instanceof Error
          ? deactivateError.message
          : "Désactivation impossible.",
      );
    }
  }

  return (
    <section className="admin-permanent-slots" aria-labelledby="permanent-slots-title">
      <header>
        <p className="admin-permanent-slots__eyebrow">Réservations</p>
        <h1 id="permanent-slots-title">Créneaux permanents</h1>
        <p>
          Réservez un horaire récurrent à un titulaire. Chaque occurrence reste
          bloquée par défaut et pourra être libérée ponctuellement par ses gestionnaires.
        </p>
      </header>

      {error && <p className="admin-permanent-slots__alert admin-permanent-slots__alert--error" role="alert">{error}</p>}
      {message && <p className="admin-permanent-slots__alert" role="status">{message}</p>}

      <div className="admin-permanent-slots__panel">
        <h2>Nouveau créneau permanent</h2>
        <div className="admin-permanent-slots__grid">
          <label>
            <span>Libellé</span>
            <input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="Ex. Groupe du mardi" />
          </label>
          <label>
            <span>Terrain</span>
            <select value={form.resourceId} onChange={(event) => setForm({ ...form, resourceId: event.target.value })}>
              {resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
            </select>
          </label>
          <label>
            <span>Jour</span>
            <select value={form.weekday} onChange={(event) => setForm({ ...form, weekday: Number(event.target.value) })}>
              {WEEKDAYS.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}
            </select>
          </label>
          <label>
            <span>Début</span>
            <input type="time" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} />
            <small>Fin automatique : {endsAt} ({durationMinutes} min)</small>
          </label>
          <label>
            <span>Du</span>
            <input type="date" value={form.validFrom} onChange={(event) => setForm({ ...form, validFrom: event.target.value })} />
          </label>
          <label>
            <span>Au</span>
            <input type="date" min={form.validFrom} value={form.validUntil} onChange={(event) => setForm({ ...form, validUntil: event.target.value })} />
          </label>
          <label>
            <span>Gestion ouverte avant</span>
            <select value={form.managementWindowHours} onChange={(event) => setForm({ ...form, managementWindowHours: Number(event.target.value) })}>
              <option value={24}>24 heures</option>
              <option value={48}>48 heures</option>
              <option value={72}>72 heures</option>
            </select>
          </label>
          <label>
            <span>Titulaire principal</span>
            <select value={form.primaryProfileId} onChange={(event) => setForm({ ...form, primaryProfileId: event.target.value })}>
              {candidates.map((candidate) => <option key={candidate.profileId} value={candidate.profileId}>{candidate.displayName} · {candidate.email}</option>)}
            </select>
          </label>
          <label className="admin-permanent-slots__wide">
            <span>Autres gestionnaires (facultatif)</span>
            <select
              multiple
              value={form.managerProfileIds}
              onChange={(event) =>
                setForm({
                  ...form,
                  managerProfileIds: Array.from(event.currentTarget.selectedOptions, (option) => option.value),
                })
              }
            >
              {candidates
                .filter((candidate) => candidate.profileId !== form.primaryProfileId)
                .map((candidate) => <option key={candidate.profileId} value={candidate.profileId}>{candidate.displayName} · {candidate.email}</option>)}
            </select>
            <small>Ctrl/Cmd + clic pour sélectionner plusieurs personnes.</small>
          </label>
        </div>
        <button type="button" disabled={isSaving || isLoading} onClick={() => void createSlot()}>
          {isSaving ? "Création…" : "Créer le créneau permanent"}
        </button>
      </div>

      <div className="admin-permanent-slots__panel">
        <h2>Créneaux existants</h2>
        {isLoading ? <p>Chargement…</p> : slots.length === 0 ? <p>Aucun créneau permanent.</p> : (
          <div className="admin-permanent-slots__list">
            {slots.map((slot) => (
              <article key={slot.id} className={!slot.isActive ? "admin-permanent-slots__slot admin-permanent-slots__slot--inactive" : "admin-permanent-slots__slot"}>
                <div>
                  <strong>{slot.label}</strong>
                  <p>{WEEKDAYS[slot.weekday - 1]} · {slot.startsAt}–{slot.endsAt} · {slot.resourceName}</p>
                  <small>Du {new Date(`${slot.validFrom}T12:00:00`).toLocaleDateString("fr-FR")} au {new Date(`${slot.validUntil}T12:00:00`).toLocaleDateString("fr-FR")} · gestion {slot.managementWindowHours} h avant</small>
                  <small>Titulaire : {slot.managers.find((manager) => manager.isPrimary)?.displayName ?? "Non défini"}</small>
                </div>
                {slot.isActive ? <button type="button" className="admin-permanent-slots__danger" onClick={() => void deactivateSlot(slot.id)}>Désactiver</button> : <span>Inactif</span>}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
