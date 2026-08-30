import { useEffect, useMemo, useState } from "react";
import {
  reservationBookingService,
  type ReservationPaymentPlayer,
} from "@/features/reservations/services/reservationBookingService";
import "./ReservationSplitPaymentFields.css";

type Props = {
  resourceId: string;
  selectedPlayers: ReservationPaymentPlayer[];
  onChange: (players: ReservationPaymentPlayer[]) => void;
};

export function ReservationSplitPaymentFields({
  resourceId,
  selectedPlayers,
  onChange,
}: Props) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ReservationPaymentPlayer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedIds = useMemo(
    () => new Set(selectedPlayers.map((player) => player.profileId)),
    [selectedPlayers],
  );

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      setError(null);
      void reservationBookingService
        .searchPaymentPlayers(resourceId, search)
        .then((players) => {
          if (current) setResults(players);
        })
        .catch((loadError: unknown) => {
          if (!current) return;
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Recherche des joueurs impossible.",
          );
        })
        .finally(() => {
          if (current) setIsLoading(false);
        });
    }, 200);

    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [resourceId, search]);

  function addPlayer(player: ReservationPaymentPlayer) {
    if (selectedPlayers.length >= 3 || selectedIds.has(player.profileId)) return;
    onChange([...selectedPlayers, player]);
  }

  function removePlayer(profileId: string) {
    onChange(
      selectedPlayers.filter((player) => player.profileId !== profileId),
    );
  }

  return (
    <div className="split-payment-fields">
      <div className="split-payment-fields__heading">
        <strong>Choisissez les 3 autres joueurs</strong>
        <span>{selectedPlayers.length}/3 sélectionnés</span>
      </div>
      <p>
        Seuls les joueurs possédant déjà un compte Pelote Manager peuvent être
        sélectionnés. Chacun recevra sa demande de paiement personnelle.
      </p>

      {selectedPlayers.length > 0 && (
        <div className="split-payment-fields__selected" aria-label="Joueurs sélectionnés">
          {selectedPlayers.map((player) => (
            <button
              type="button"
              key={player.profileId}
              onClick={() => removePlayer(player.profileId)}
              aria-label={`Retirer ${player.displayName}`}
            >
              {player.displayName} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}

      <label className="split-payment-fields__search">
        <span>Rechercher un joueur</span>
        <input
          type="search"
          value={search}
          placeholder="Nom ou prénom"
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>

      {error && <p className="split-payment-fields__error" role="alert">{error}</p>}

      <div className="split-payment-fields__results" aria-live="polite">
        {isLoading ? (
          <span>Recherche…</span>
        ) : results.length === 0 ? (
          <span>Aucun autre joueur avec un compte trouvé.</span>
        ) : (
          results.map((player) => {
            const selected = selectedIds.has(player.profileId);
            return (
              <button
                type="button"
                key={player.profileId}
                disabled={selected || (selectedPlayers.length >= 3 && !selected)}
                onClick={() => addPlayer(player)}
              >
                <span>{player.displayName}</span>
                <small>{selected ? "Sélectionné" : "Ajouter"}</small>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
