import { useEffect, useState } from "react";
import {
  adminReservationService,
  type CalendarClosure,
} from "@/features/admin/services/adminReservationService";
import { reservationCalendarService } from "@/features/reservations/services/reservationCalendarService";
import type { ReservableResource } from "@/features/reservations/domain/calendar";
import "./ClubPages.css";

const empty = { title: "", startsAt: "", endsAt: "" };
export function ClubClosuresPage() {
  const [resources, setResources] = useState<ReservableResource[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [items, setItems] = useState<CalendarClosure[]>([]);
  const [draft, setDraft] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function load(id: string) {
    setItems(await adminReservationService.listClosures(id));
  }
  useEffect(() => {
    reservationCalendarService
      .listResources()
      .then(async (list) => {
        setResources(list);
        const id = list[0]?.id ?? "";
        setResourceId(id);
        if (id) await load(id);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Chargement impossible."),
      )
      .finally(() => setLoading(false));
  }, []);
  async function submit() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (!draft.title || !draft.startsAt || !draft.endsAt)
        throw new Error("Renseignez le motif, le début et la fin.");
      const value = {
        resourceId,
        title: draft.title,
        startsAt: new Date(draft.startsAt).toISOString(),
        endsAt: new Date(draft.endsAt).toISOString(),
      };
      if (editingId)
        await adminReservationService.updateClosure({
          id: editingId,
          ...value,
        });
      else await adminReservationService.createClosure(value);
      await load(resourceId);
      setDraft(empty);
      setEditingId(null);
      setMessage(
        editingId ? "Fermeture modifiée." : "Fermeture ajoutée au calendrier.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opération impossible.");
    } finally {
      setSaving(false);
    }
  }
  if (loading)
    return (
      <section className="admin-page">
        <p role="status">Chargement des fermetures…</p>
      </section>
    );
  return (
    <section className="admin-page">
      <header className="admin-page__header">
        <p className="admin-page__eyebrow">Club</p>
        <h1>Fermetures</h1>
        <p className="admin-page__lead">
          Ces périodes bloquent automatiquement les créneaux et apparaissent
          dans le calendrier public.
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
              void load(e.target.value);
            }}
          >
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <div className="club-inline">
          <input
            placeholder="Motif : travaux, compétition…"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <input
            type="datetime-local"
            aria-label="Début"
            value={draft.startsAt}
            onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })}
          />
          <input
            type="datetime-local"
            aria-label="Fin"
            value={draft.endsAt}
            onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })}
          />
          <button
            disabled={saving || !resourceId}
            onClick={() => void submit()}
          >
            {editingId ? "Enregistrer" : "Ajouter"}
          </button>
          {editingId && (
            <button
              onClick={() => {
                setEditingId(null);
                setDraft(empty);
              }}
            >
              Annuler
            </button>
          )}
        </div>
        <ul className="club-list">
          {items.map((item) => (
            <li key={item.id}>
              <span>
                <strong>{item.title}</strong>
                <small>
                  {new Date(item.startsAt).toLocaleString("fr-FR")} —{" "}
                  {new Date(item.endsAt).toLocaleString("fr-FR")}
                </small>
              </span>
              <div>
                <button
                  onClick={() => {
                    setEditingId(item.id);
                    setDraft({
                      title: item.title,
                      startsAt: item.startsAt.slice(0, 16),
                      endsAt: item.endsAt.slice(0, 16),
                    });
                  }}
                >
                  Modifier
                </button>
                <button
                  onClick={() => {
                    if (confirm("Supprimer cette fermeture ?")) {
                      setSaving(true);
                      adminReservationService
                        .deleteClosure(item.id)
                        .then(() => load(resourceId))
                        .then(() => setMessage("Fermeture supprimée."))
                        .catch((e: unknown) =>
                          setError(
                            e instanceof Error
                              ? e.message
                              : "Suppression impossible.",
                          ),
                        )
                        .finally(() => setSaving(false));
                    }
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
