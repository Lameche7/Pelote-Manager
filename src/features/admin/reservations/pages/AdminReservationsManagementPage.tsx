import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, ExternalLink, Move, XCircle } from "lucide-react";
import { reservationCalendarService } from "@/features/reservations/services/reservationCalendarService";
import type { ReservableResource } from "@/features/reservations/domain/calendar";
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
import { ReservationFilters } from "../components/ReservationFilters";
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

export function AdminReservationsManagementPage() {
  const [filters, setFilters] = useState<AdminReservationFilters>(
    EMPTY_ADMIN_RESERVATION_FILTERS,
  );
  const [items, setItems] = useState<ManagedReservation[]>([]);
  const [resources, setResources] = useState<ReservableResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [users, setUsers] = useState<ReservationUser[]>([]);
  const [form, setForm] = useState({
    userId: "",
    resourceId: "",
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
    if (userQuery.trim().length < 2) {
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
  }, [userQuery]);
  async function cancel(item: ManagedReservation) {
    if (
      !window.confirm(
        `Annuler la réservation de ${item.customerName} — ${item.resourceName}, le ${dateTime(item.startsAt)} ?`,
      )
    )
      return;
    const reason =
      window.prompt(
        "Motif de l’annulation (facultatif)",
        "Annulation administrateur",
      ) ?? "";
    try {
      await adminReservationsService.cancel(item.id, reason);
      setMessage("La réservation a été annulée et le créneau libéré.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Annulation impossible.");
    }
  }
  async function move(item: ManagedReservation) {
    const startsAt = window.prompt(
      "Nouveau début (date ISO)",
      item.startsAt.slice(0, 16),
    );
    if (!startsAt) return;
    try {
      await adminReservationsService.move(
        item.id,
        item.resourceId,
        new Date(startsAt).toISOString(),
      );
      setMessage("La réservation a été déplacée.");
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Ce créneau n’est plus disponible.",
      );
    }
  }
  async function create() {
    try {
      await adminReservationsService.create(
        form.userId,
        form.resourceId,
        new Date(form.startsAt).toISOString(),
      );
      setCreateOpen(false);
      setMessage("La réservation a été créée pour le compte sélectionné.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Création impossible.");
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
        <button type="button" onClick={() => setCreateOpen(!createOpen)}>
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
      {createOpen && (
        <div className="reservation-operations__editor">
          <h2>Nouvelle réservation</h2>
          <label>
            Utilisateur existant
            <input
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              placeholder="Nom, prénom, email ou licence"
            />
          </label>
          <select
            aria-label="Compte sélectionné"
            value={form.userId}
            onChange={(e) => setForm({ ...form, userId: e.target.value })}
          >
            <option value="">Sélectionnez un compte</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {u.email}
                {u.licenseNumber ? ` — ${u.licenseNumber}` : ""}
              </option>
            ))}
          </select>
          <label>
            Terrain
            <select
              value={form.resourceId}
              onChange={(e) => setForm({ ...form, resourceId: e.target.value })}
            >
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Créneau
            <input
              type="datetime-local"
              value={form.startsAt}
              onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            />
          </label>
          <p>
            Le tarif est calculé et validé côté serveur selon le compte
            sélectionné.
          </p>
          <button
            disabled={!form.userId || !form.resourceId || !form.startsAt}
            onClick={() => void create()}
          >
            Confirmer la création
          </button>
        </div>
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
                      onClick={() =>
                        window.alert(
                          `${item.customerName}\n${item.resourceName}\n${dateTime(item.startsAt)}`,
                        )
                      }
                    >
                      <ExternalLink size={16} />
                    </button>
                    {canManageReservation(item.status, item.customerType) && (
                      <>
                        <button
                          title="Déplacer"
                          onClick={() => void move(item)}
                        >
                          <Move size={16} />
                        </button>
                        <button
                          title="Annuler"
                          onClick={() => void cancel(item)}
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
    </section>
  );
}
