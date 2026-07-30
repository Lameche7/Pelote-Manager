import { RotateCcw } from "lucide-react";
import {
  EMPTY_ADMIN_RESERVATION_FILTERS,
  type AdminReservationFilters,
} from "../domain/adminReservations";
import type { ReservableResource } from "@/features/reservations/domain/calendar";

export function ReservationFilters({
  value,
  resources,
  onChange,
}: {
  value: AdminReservationFilters;
  resources: ReservableResource[];
  onChange: (filters: AdminReservationFilters) => void;
}) {
  const set = (change: Partial<AdminReservationFilters>) =>
    onChange({ ...value, ...change });
  return (
    <div className="reservation-operations__filters">
      <label>
        Recherche
        <input
          aria-label="Recherche"
          type="search"
          value={value.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder="Nom ou adresse email"
        />
      </label>
      <label>
        Terrain
        <select
          value={value.resourceId}
          onChange={(e) => set({ resourceId: e.target.value })}
        >
          <option value="all">Tous</option>
          {resources.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Statut
        <select
          value={value.status}
          onChange={(e) => set({ status: e.target.value })}
        >
          <option value="all">Tous</option>
          <option value="pending">En attente</option>
          <option value="confirmed">Confirmée</option>
          <option value="cancelled">Annulée</option>
          <option value="expired">Expirée</option>
          <option value="completed">Terminée</option>
        </select>
      </label>
      <label>
        Type de compte
        <select
          value={value.accountType}
          onChange={(e) =>
            set({
              accountType: e.target
                .value as AdminReservationFilters["accountType"],
            })
          }
        >
          <option value="all">Tous</option>
          <option value="licensee">Licencié</option>
          <option value="account">Visiteur</option>
          {value.period === "history" && (
            <option value="guest">Ancienne réservation invitée</option>
          )}
        </select>
      </label>
      <label>
        Période
        <select
          value={value.period}
          onChange={(e) =>
            set({ period: e.target.value as AdminReservationFilters["period"] })
          }
        >
          <option value="today">Aujourd’hui</option>
          <option value="upcoming">À venir</option>
          <option value="history">Historique récent</option>
          <option value="all">Toutes</option>
        </select>
      </label>
      <button
        type="button"
        className="reservation-operations__secondary"
        onClick={() => onChange(EMPTY_ADMIN_RESERVATION_FILTERS)}
      >
        <RotateCcw size={16} /> Réinitialiser
      </button>
    </div>
  );
}
