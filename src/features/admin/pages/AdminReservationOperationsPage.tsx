import { useCallback, useEffect, useState } from "react";
import {
  adminReservationOperationsService,
  type AdminReservation,
  type ReservationDashboard,
  type ReservationStatus,
} from "@/features/admin/services/adminReservationOperationsService";
import "./AdminReservationOperationsPage.css";

const STATUS_LABELS: Record<ReservationStatus, string> = {
  draft: "Brouillon",
  pending: "En attente",
  confirmed: "Confirmée",
  completed: "Terminée",
  cancelled: "Annulée",
  refused: "Refusée",
  expired: "Expirée",
  no_show: "Absent",
};

const OPERATIONAL_STATUSES: ReservationStatus[] = [
  "confirmed",
  "completed",
  "cancelled",
  "refused",
  "expired",
  "no_show",
];

function dateInput(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function euros(cents: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
}

export function AdminReservationOperationsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ReservationStatus | "all">("all");
  const [from, setFrom] = useState(dateInput(-30));
  const [to, setTo] = useState(dateInput(60));
  const [reservations, setReservations] = useState<AdminReservation[]>([]);
  const [dashboard, setDashboard] = useState<ReservationDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [items, stats] = await Promise.all([
        adminReservationOperationsService.list({ search, status, from, to }),
        adminReservationOperationsService.getDashboard(from, to),
      ]);
      setReservations(items);
      setDashboard(stats);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
    } finally {
      setIsLoading(false);
    }
  }, [from, search, status, to]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeStatus(reservation: AdminReservation, nextStatus: ReservationStatus) {
    setBusyId(reservation.id);
    setError(null);
    setMessage(null);
    try {
      await adminReservationOperationsService.setStatus(reservation.id, nextStatus);
      setMessage(`La réservation de ${reservation.customerName} est maintenant ${STATUS_LABELS[nextStatus].toLowerCase()}.`);
      await load();
    } catch (updateError: unknown) {
      setError(updateError instanceof Error ? updateError.message : "Mise à jour impossible.");
    } finally {
      setBusyId(null);
    }
  }

  async function expirePending() {
    setError(null);
    const count = await adminReservationOperationsService.expirePastPending();
    setMessage(`${count} réservation(s) en attente ont été expirées.`);
    await load();
  }

  return (
    <section className="reservation-operations" aria-labelledby="reservation-operations-title">
      <header>
        <p className="reservation-operations__eyebrow">Exploitation</p>
        <h1 id="reservation-operations-title">Suivi des réservations</h1>
        <p>Recherchez, contrôlez les statuts et suivez l’activité du trinquet.</p>
      </header>

      {error && <p className="reservation-operations__alert reservation-operations__alert--error" role="alert">{error}</p>}
      {message && <p className="reservation-operations__alert" role="status">{message}</p>}

      {dashboard && (
        <div className="reservation-operations__stats">
          <article><span>Réservations</span><strong>{dashboard.totalReservations}</strong></article>
          <article><span>Confirmées / terminées</span><strong>{dashboard.confirmedReservations}</strong></article>
          <article><span>Annulations</span><strong>{dashboard.cancelledReservations}</strong></article>
          <article><span>Absences</span><strong>{dashboard.noShowReservations}</strong></article>
          <article><span>Licenciés</span><strong>{dashboard.licenseeReservations}</strong></article>
          <article><span>Recette théorique</span><strong>{euros(dashboard.theoreticalRevenueCents)}</strong></article>
        </div>
      )}

      <div className="reservation-operations__filters">
        <label>Recherche<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nom, e-mail ou terrain" /></label>
        <label>Statut<select value={status} onChange={(event) => setStatus(event.target.value as ReservationStatus | "all")}><option value="all">Tous</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Du<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>Au<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <button type="button" onClick={() => void expirePending()}>Expirer les attentes passées</button>
      </div>

      {isLoading ? <p>Chargement…</p> : (
        <div className="reservation-operations__table-wrap">
          <table>
            <thead><tr><th>Client</th><th>Terrain</th><th>Créneau</th><th>Type</th><th>Tarif</th><th>Statut</th><th>Action</th></tr></thead>
            <tbody>
              {reservations.map((reservation) => (
                <tr key={reservation.id}>
                  <td><strong>{reservation.customerName}</strong><small>{reservation.customerEmail}</small></td>
                  <td>{reservation.resourceName}</td>
                  <td>{new Date(reservation.startsAt).toLocaleString("fr-FR")}</td>
                  <td>{reservation.customerType === "licensee" ? "Licencié" : "Public"}</td>
                  <td>{euros(reservation.priceCents)}</td>
                  <td><span className={`reservation-operations__status reservation-operations__status--${reservation.status}`}>{STATUS_LABELS[reservation.status]}</span></td>
                  <td>
                    <select aria-label={`Modifier le statut de ${reservation.customerName}`} value={reservation.status} disabled={busyId === reservation.id} onChange={(event) => void changeStatus(reservation, event.target.value as ReservationStatus)}>
                      <option value={reservation.status}>{STATUS_LABELS[reservation.status]}</option>
                      {OPERATIONAL_STATUSES.filter((value) => value !== reservation.status).map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {reservations.length === 0 && <p>Aucune réservation ne correspond aux critères.</p>}
        </div>
      )}
    </section>
  );
}
