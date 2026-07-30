import { useEffect, useState } from "react";
import { Ban, Pencil, Trash2 } from "lucide-react";
import type { ReservableResource } from "@/features/reservations/domain/calendar";
import {
  adminReservationsService,
  type CalendarBlock,
} from "../services/adminReservationsService";
import { AdminDialog } from "./AdminDialog";
import { validateCalendarBlock } from "../domain/adminReservations";

const reasons = [
  "Entretien",
  "Compétition",
  "Entraînement",
  "Animation",
  "Indisponibilité exceptionnelle",
  "Autre",
];
export function BlockManager({
  resources,
  onChanged,
}: {
  resources: ReservableResource[];
  onChanged: (message: string) => void;
}) {
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [editing, setEditing] = useState<CalendarBlock | "new" | null>(null);
  const [deleting, setDeleting] = useState<CalendarBlock | null>(null);
  const [form, setForm] = useState({
    resourceId: "",
    title: reasons[0],
    startsAt: "",
    endsAt: "",
  });
  const [error, setError] = useState("");
  async function load() {
    try {
      setBlocks(await adminReservationsService.listBlocks());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  function openNew() {
    setForm({
      resourceId: resources[0]?.id ?? "",
      title: reasons[0],
      startsAt: "",
      endsAt: "",
    });
    setEditing("new");
  }
  function openEdit(block: CalendarBlock) {
    setForm({
      resourceId: block.resourceId,
      title: block.title,
      startsAt: block.startsAt.slice(0, 16),
      endsAt: block.endsAt.slice(0, 16),
    });
    setEditing(block);
  }
  async function save() {
    try {
      if (editing === "new") {
        const validation = validateCalendarBlock(
          form.startsAt,
          form.endsAt,
          form.title,
        );
        if (validation) {
          setError(validation);
          return;
        }
      }
      if (editing === "new")
        await adminReservationsService.createBlock({
          ...form,
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
        });
      else if (editing)
        await adminReservationsService.updateBlock(editing.id, form.title);
      setEditing(null);
      await load();
      onChanged(
        editing === "new"
          ? "Le blocage a été créé."
          : "Le motif a été modifié.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    }
  }
  async function remove(block: CalendarBlock) {
    try {
      await adminReservationsService.deleteBlock(block.id);
      await load();
      onChanged("Le blocage a été supprimé et le créneau libéré.");
      setDeleting(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible.");
    }
  }
  return (
    <section className="reservation-operations__blocks">
      <div className="section-heading">
        <div>
          <h2>Blocages administratifs</h2>
          <p>
            Indisponibilités affichées comme occupées dans le calendrier public.
          </p>
        </div>
        <button type="button" onClick={openNew}>
          <Ban size={17} /> Bloquer un créneau
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="reservation-operations__alert reservation-operations__alert--error"
        >
          {error}
        </p>
      )}
      <div className="block-list">
        {blocks.map((block) => (
          <article key={block.id}>
            <div>
              <strong>{block.title}</strong>
              <span>
                {block.resourceName} —{" "}
                {new Date(block.startsAt).toLocaleString("fr-FR")} à{" "}
                {new Date(block.endsAt).toLocaleTimeString("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <button title="Modifier le motif" onClick={() => openEdit(block)}>
              <Pencil size={16} />
            </button>
            <button title="Supprimer" onClick={() => setDeleting(block)}>
              <Trash2 size={16} />
            </button>
          </article>
        ))}
      </div>
      {editing && (
        <AdminDialog
          title={editing === "new" ? "Bloquer un créneau" : "Modifier le motif"}
          onClose={() => setEditing(null)}
        >
          <div className="admin-dialog__form">
            {editing === "new" && (
              <>
                <label>
                  Terrain
                  <select
                    value={form.resourceId}
                    onChange={(e) =>
                      setForm({ ...form, resourceId: e.target.value })
                    }
                  >
                    {resources.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Début
                  <input
                    type="datetime-local"
                    value={form.startsAt}
                    onChange={(e) =>
                      setForm({ ...form, startsAt: e.target.value })
                    }
                  />
                </label>
                <label>
                  Fin
                  <input
                    type="datetime-local"
                    value={form.endsAt}
                    onChange={(e) =>
                      setForm({ ...form, endsAt: e.target.value })
                    }
                  />
                </label>
              </>
            )}
            <label>
              Motif
              <select
                value={reasons.includes(form.title) ? form.title : "Autre"}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              >
                {reasons.map((reason) => (
                  <option key={reason}>{reason}</option>
                ))}
              </select>
            </label>
            {form.title === "Autre" && (
              <label>
                Précision
                <input
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </label>
            )}
            <div className="admin-dialog__actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setEditing(null)}
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={
                  !form.title ||
                  (editing === "new" &&
                    (!form.resourceId || !form.startsAt || !form.endsAt))
                }
                onClick={() => void save()}
              >
                Enregistrer
              </button>
            </div>
          </div>
        </AdminDialog>
      )}
      {deleting && (
        <AdminDialog
          title="Supprimer le blocage"
          onClose={() => setDeleting(null)}
        >
          <p>
            Confirmez la suppression du blocage{" "}
            <strong>{deleting.title}</strong> sur {deleting.resourceName}. Le
            créneau sera de nouveau disponible.
          </p>
          <div className="admin-dialog__actions">
            <button className="secondary" onClick={() => setDeleting(null)}>
              Conserver
            </button>
            <button onClick={() => void remove(deleting)}>
              Supprimer le blocage
            </button>
          </div>
        </AdminDialog>
      )}
    </section>
  );
}
