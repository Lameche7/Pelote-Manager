import { useEffect, useState } from "react";
import { supabase } from "@/infrastructure/supabase/client";

type SeriesFinance = {
  id: string;
  name: string;
  registered_teams: number;
  capacity: number;
  received_cents: number;
  expected_cents: number;
  maximum_cents: number;
  outstanding_cents: number;
};

type Finance = Omit<SeriesFinance, "id" | "name"> & {
  active_received_cents: number;
  paid_teams: number;
  unpaid_teams: number;
  series: SeriesFinance[];
};

const euros = (cents: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);

const percent = (part: number, total: number) =>
  total > 0 ? Math.min(100, Math.max(0, Math.round((100 * part) / total))) : 0;

export function AdminTournamentFinancePanel({
  clubId,
  tournamentId,
  revision,
}: {
  clubId: string;
  tournamentId: string;
  revision: object;
}) {
  const [summary, setSummary] = useState<Finance | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setSummary(null);
    setError("");
    void supabase
      .rpc("admin_get_tournament_financial_summary_for_club", {
        target_club_id: clubId,
        target_tournament_id: tournamentId,
      })
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data) {
          setError("Suivi financier indisponible.");
          return;
        }
        setSummary(data as Finance);
      });
    return () => {
      active = false;
    };
  }, [clubId, tournamentId, revision, refresh]);

  if (!summary) {
    return (
      <section className="admin-card">
        <h2>Suivi financier</h2>
        <p role="status">{error || "Chargement des règlements…"}</p>
        {error && (
          <button type="button" onClick={() => setRefresh((n) => n + 1)}>
            Réessayer
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="admin-card">
      <header>
        <h2>Suivi financier du tournoi</h2>
        <button type="button" onClick={() => setRefresh((n) => n + 1)}>
          Actualiser les règlements
        </button>
      </header>
      <div className="admin-tournament-teams__series">
        {[
          ["Encaissé", summary.received_cents],
          ["Attendu à ce jour", summary.expected_cents],
          ["Reste à encaisser", summary.outstanding_cents],
          ["Recette à tournoi complet", summary.maximum_cents],
        ].map(([label, amount]) => (
          <div className="admin-card admin-tournament-series-card" key={label}>
            <span>{label}</span>
            <strong>{euros(Number(amount))}</strong>
          </div>
        ))}
      </div>
      <p>
        {summary.paid_teams} équipe(s) réglée(s) · {summary.unpaid_teams} à
        régler
      </p>
      <label>
        Encaissements des inscriptions actives :{" "}
        {percent(summary.active_received_cents, summary.expected_cents)} %
        <progress
          max={100}
          value={percent(summary.active_received_cents, summary.expected_cents)}
        />
      </label>
      <label>
        Remplissage : {summary.registered_teams}/{summary.capacity} équipes
        <progress
          max={100}
          value={percent(summary.registered_teams, summary.capacity)}
        />
      </label>
      {summary.received_cents !== summary.active_received_cents && (
        <p>
          Dont {euros(summary.received_cents - summary.active_received_cents)}{" "}
          reçus pour des inscriptions inactives.
        </p>
      )}
      <div className="admin-tournament-team-table-wrap">
        <table className="admin-tournament-team-table">
          <thead>
            <tr>
              <th scope="col">Série</th>
              <th scope="col">Encaissé</th>
              <th scope="col">Attendu</th>
              <th scope="col">Reste dû</th>
              <th scope="col">Complet</th>
            </tr>
          </thead>
          <tbody>
            {summary.series.map((series) => (
              <tr key={series.id}>
                <th scope="row">{series.name}</th>
                <td>{euros(series.received_cents)}</td>
                <td>{euros(series.expected_cents)}</td>
                <td>{euros(series.outstanding_cents)}</td>
                <td>{euros(series.maximum_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small>
        Montants bruts des règlements confirmés Stripe et manuels enregistrés
        dans Pilotoki. Hors frais et remboursements non intégrés.
      </small>
    </section>
  );
}
