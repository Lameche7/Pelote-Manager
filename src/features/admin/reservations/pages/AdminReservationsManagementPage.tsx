import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, ExternalLink, Move, XCircle } from "lucide-react";
import type {
  CalendarSlot,
  ReservableResource,
} from "@/features/reservations/domain/calendar";
import { reservationCalendarService } from "@/features/reservations/services/reservationCalendarService";
import {
  EMPTY_ADMIN_RESERVATION_FILTERS,
  canManageReservation,
  type AdminReservationFilters,
} from "../domain/adminReservations";
import {
  adminReservationsService,
  type ManagedReservation,
  type ReservationUser,
} from "../services/adminReservationsService";
import { AdminDialog } from "../components/AdminDialog";
import { BlockManager } from "../components/BlockManager";
import { ReservationFilters } from "../components/ReservationFilters";
import { SlotPicker } from "../components/SlotPicker";
import "../../pages/AdminReservationOperationsPage.css";

const labels: Record<string, string> = {
  draft: "Brouillon",
  pending: "En attente",
  confirmed: "Confirmée",
  completed: "Terminée",
  cancelled: "Annulée",
  refused: "Refusée",
  expired: "Expirée",
  no_show: "Absent",
};
const euros = (cents: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
const dateTime = (value: string) =>
  new Date(value).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  });
const today = () => new Date().toISOString().slice(0, 10);
type Dialog =
  | { kind: "detail" | "cancel" | "move"; item: ManagedReservation }
  | { kind: "create" }
  | null;

export function AdminReservationsManagementPage() {
  const [filters, setFilters] = useState<AdminReservationFilters>(
    EMPTY_ADMIN_RESERVATION_FILTERS,
  );
  const [items, setItems] = useState<ManagedReservation[]>([]);
  const [resources, setResources] = useState<ReservableResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [users, setUsers] = useState<ReservationUser[]>([]);
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [reason, setReason] = useState("Annulation administrateur");
  const [form, setForm] = useState({
    userId: "",
    resourceId: "",
    date: today(),
    startsAt: "",
  });
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await adminReservationsService.list(filters));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [filters]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void reservationCalendarService.listResources().then((r) => {
      setResources(r);
      setForm((f) => ({ ...f, resourceId: f.resourceId || r[0]?.id || "" }));
    });
  }, []);
  useEffect(() => {
    if (
      !dialog ||
      (dialog.kind !== "create" && dialog.kind !== "move") ||
      !form.resourceId ||
      !form.date
    )
      return;
    let active = true;
    setSlotsLoading(true);
    const excluded = dialog.kind === "move" ? dialog.item.id : undefined;
    void adminReservationsService
      .listAvailableSlots(form.resourceId, form.date, excluded)
      .then((value) => {
        if (active) setSlots(value);
      })
      .catch((e: unknown) => {
        if (active)
          setError(e instanceof Error ? e.message : "Créneaux indisponibles.");
      })
      .finally(() => {
        if (active) setSlotsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [dialog, form.date, form.resourceId]);
  useEffect(() => {
    if (dialog?.kind !== "create" || userQuery.trim().length < 2) {
      setUsers([]);
      return;
    }
    const timer = window.setTimeout(
      () =>
        void adminReservationsService
          .searchUsers(userQuery)
          .then(setUsers)
          .catch(() => setUsers([])),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [dialog, userQuery]);
  useEffect(() => {
    if (dialog?.kind !== "create" || !form.userId || !form.startsAt) {
      setPrice(null);
      return;
    }
    void adminReservationsService
      .previewPrice(form.userId, form.resourceId, form.startsAt)
      .then(setPrice)
      .catch(() => setPrice(null));
  }, [dialog, form.resourceId, form.startsAt, form.userId]);
  function openCreate() {
    setForm({
      userId: "",
      resourceId: resources[0]?.id ?? "",
      date: today(),
      startsAt: "",
    });
    setUserQuery("");
    setPrice(null);
    setDialog({ kind: "create" });
  }
  function openMove(item: ManagedReservation) {
    setForm({
      userId: "",
      resourceId: item.resourceId,
      date: item.startsAt.slice(0, 10),
      startsAt: "",
    });
    setDialog({ kind: "move", item });
  }
  async function submit() {
    if (!dialog) return;
    setBusy(true);
    setError("");
    try {
      if (dialog.kind === "create") {
        await adminReservationsService.create(
          form.userId,
          form.resourceId,
          form.startsAt,
        );
        setMessage("La réservation a été créée pour le compte sélectionné.");
      } else if (dialog.kind === "move") {
        await adminReservationsService.move(
          dialog.item.id,
          form.resourceId,
          form.startsAt,
        );
        setMessage(
          "La réservation a été déplacée. Son propriétaire est conservé.",
        );
      } else if (dialog.kind === "cancel") {
        await adminReservationsService.cancel(dialog.item.id, reason);
        setMessage("La réservation a été annulée et le créneau libéré.");
      }
      setDialog(null);
      await load();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Ce créneau n’est plus disponible. Actualisez les créneaux et réessayez.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="reservation-operations"
      aria-labelledby="admin-bookings-title"
    >
      <header>
        <p className="reservation-operations__eyebrow">Administration</p>
        <h1 id="admin-bookings-title">Administration des réservations</h1>
        <p>
          Consultez et gérez les réservations et les occupations des terrains.
        </p>
        <button type="button" onClick={openCreate}>
          <CalendarPlus size={18} /> Créer une réservation
        </button>
      </header>
      {error && (
        <p
          role="alert"
          className="reservation-operations__alert reservation-operations__alert--error"
        >
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="reservation-operations__alert">
          {message}
        </p>
      )}
      <ReservationFilters
        value={filters}
        resources={resources}
        onChange={setFilters}
      />
      {loading ? (
        <p>Chargement des réservations…</p>
      ) : (
        <div className="reservation-operations__table-wrap">
          <table>
            <thead>
              <tr>
                <th>Réservant</th>
                <th>Type</th>
                <th>Terrain</th>
                <th>Début / fin</th>
                <th>Statut</th>
                <th>Paiement</th>
                <th>Montant</th>
                <th>Créée le</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.customerName}</strong>
                    <small>{item.customerEmail || "Email indisponible"}</small>
                  </td>
                  <td>
                    {item.customerType === "licensee"
                      ? "Licencié"
                      : item.customerType === "guest"
                        ? "Ancienne invitée"
                        : "Visiteur"}
                  </td>
                  <td>{item.resourceName}</td>
                  <td>
                    {dateTime(item.startsAt)}
                    <small>au {dateTime(item.endsAt)}</small>
                  </td>
                  <td>
                    <span
                      className={`reservation-operations__status reservation-operations__status--${item.status}`}
                    >
                      {labels[item.status] ?? item.status}
                    </span>
                  </td>
                  <td>{item.paymentStatus}</td>
                  <td>{euros(item.priceCents)}</td>
                  <td>{dateTime(item.createdAt)}</td>
                  <td>
                    <button
                      title="Consulter le détail"
                      onClick={() => setDialog({ kind: "detail", item })}
                    >
                      <ExternalLink size={16} />
                    </button>
                    {canManageReservation(item.status, item.customerType) && (
                      <>
                        <button title="Déplacer" onClick={() => openMove(item)}>
                          <Move size={16} />
                        </button>
                        <button
                          title="Annuler"
                          onClick={() => setDialog({ kind: "cancel", item })}
                        >
                          <XCircle size={16} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 && (
            <p className="reservation-operations__empty">
              Aucune réservation ne correspond aux critères.
            </p>
          )}
        </div>
      )}
      <BlockManager resources={resources} onChanged={setMessage} />
      {dialog?.kind === "detail" && (
        <AdminDialog
          title="Détail de la réservation"
          onClose={() => setDialog(null)}
        >
          <dl className="reservation-detail">
            <dt>Réservant</dt>
            <dd>{dialog.item.customerName}</dd>
            <dt>Email</dt>
            <dd>{dialog.item.customerEmail || "Indisponible"}</dd>
            <dt>Terrain</dt>
            <dd>{dialog.item.resourceName}</dd>
            <dt>Créneau</dt>
            <dd>
              {dateTime(dialog.item.startsAt)} au {dateTime(dialog.item.endsAt)}
            </dd>
            <dt>Statut</dt>
            <dd>{labels[dialog.item.status]}</dd>
            <dt>Paiement</dt>
            <dd>
              {dialog.item.paymentStatus} — {euros(dialog.item.priceCents)}
            </dd>
          </dl>
        </AdminDialog>
      )}
      {dialog?.kind === "cancel" && (
        <AdminDialog
          title="Annuler la réservation"
          onClose={() => setDialog(null)}
        >
          <p>
            Confirmez l’annulation de{" "}
            <strong>{dialog.item.customerName}</strong>, sur{" "}
            <strong>{dialog.item.resourceName}</strong>, le{" "}
            {dateTime(dialog.item.startsAt)}.
          </p>
          <label className="admin-dialog__field">
            Motif
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="admin-dialog__actions">
            <button className="secondary" onClick={() => setDialog(null)}>
              Conserver
            </button>
            <button disabled={busy} onClick={() => void submit()}>
              Confirmer l’annulation
            </button>
          </div>
        </AdminDialog>
      )}
      {(dialog?.kind === "create" || dialog?.kind === "move") && (
        <AdminDialog
          title={
            dialog.kind === "create"
              ? "Créer une réservation"
              : `Déplacer la réservation de ${dialog.item.customerName}`
          }
          onClose={() => setDialog(null)}
        >
          <div className="admin-dialog__form">
            {dialog.kind === "create" && (
              <>
                <label>
                  Rechercher un utilisateur
                  <input
                    type="search"
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    placeholder="Nom, prénom, email ou licence"
                  />
                </label>
                <label>
                  Compte
                  <select
                    value={form.userId}
                    onChange={(e) =>
                      setForm({ ...form, userId: e.target.value })
                    }
                  >
                    <option value="">Sélectionnez un compte existant</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} — {u.email}
                        {u.licenseNumber ? ` — ${u.licenseNumber}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <SlotPicker
              resources={resources}
              resourceId={form.resourceId}
              date={form.date}
              slots={slots}
              loading={slotsLoading}
              selected={form.startsAt}
              onResource={(resourceId) =>
                setForm({ ...form, resourceId, startsAt: "" })
              }
              onDate={(date) => setForm({ ...form, date, startsAt: "" })}
              onSelect={(startsAt) => setForm({ ...form, startsAt })}
            />
            {dialog.kind === "create" && (
              <p className="price-preview">
                Tarif calculé :{" "}
                <strong>
                  {price === null
                    ? "Sélectionnez un compte et un créneau"
                    : euros(price)}
                </strong>
              </p>
            )}
            <div className="admin-dialog__actions">
              <button className="secondary" onClick={() => setDialog(null)}>
                Annuler
              </button>
              <button
                disabled={
                  busy ||
                  !form.startsAt ||
                  (dialog.kind === "create" && (!form.userId || price === null))
                }
                onClick={() => void submit()}
              >
                {dialog.kind === "create"
                  ? "Confirmer la création"
                  : "Confirmer le déplacement"}
              </button>
            </div>
          </div>
        </AdminDialog>
      )}
    </section>
  );
}
