import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/infrastructure/supabase/client";
import "./AdminBlockedFinalsAlerts.css";

type FinalAlert = {
  kind: "unpublished" | "engine_error";
  tournamentId: string;
  tournamentName: string;
  seriesName: string;
  matchId: string;
  round: string | null;
  teamA: string | null;
  teamB: string | null;
  playDate: string | null;
  startsAt: string | null;
  reason: string;
};

const issueLabels: Record<string, string> = {
  no_slot: "Aucun créneau réservé",
  past_slot: "Créneau dépassé",
  incompatible_availability: "Disponibilités incompatibles avec le créneau",
  occupied: "Créneau occupé ou déjà préaffecté",
  publication_pending: "Publication non terminée, vérification nécessaire",
  engine_error: "Échec technique de la progression automatique",
};

const toAlert = (raw: Record<string, unknown>): FinalAlert => ({
  kind: raw.kind === "engine_error" ? "engine_error" : "unpublished",
  tournamentId: String(raw.tournament_id ?? ""),
  tournamentName: String(raw.tournament_name ?? ""),
  seriesName: String(raw.series_name ?? ""),
  matchId: String(raw.match_id ?? ""),
  round: raw.round === null ? null : String(raw.round ?? ""),
  teamA: raw.team_a === null ? null : String(raw.team_a ?? ""),
  teamB: raw.team_b === null ? null : String(raw.team_b ?? ""),
  playDate: raw.play_date === null ? null : String(raw.play_date ?? ""),
  startsAt: raw.starts_at === null ? null : String(raw.starts_at ?? ""),
  reason: String(raw.reason ?? "publication_pending"),
});

export function AdminBlockedFinalsAlerts() {
  const [alerts, setAlerts] = useState<FinalAlert[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc(
      "admin_list_blocked_tournament_finals",
    );
    if (loadError) throw loadError;
    setAlerts(
      Array.isArray(data)
        ? data
            .filter(
              (item): item is Record<string, unknown> =>
                item !== null &&
                typeof item === "object" &&
                !Array.isArray(item),
            )
            .map(toAlert)
        : [],
    );
    setError(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const { data, error: loadError } = await supabase.rpc(
          "admin_list_blocked_tournament_finals",
        );
        if (loadError) throw loadError;
        if (!mounted) return;
        setAlerts(
          Array.isArray(data)
            ? data
                .filter(
                  (item): item is Record<string, unknown> =>
                    item !== null &&
                    typeof item === "object" &&
                    !Array.isArray(item),
                )
                .map(toAlert)
            : [],
        );
        setError(false);
      } catch {
        if (mounted) setError(true);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 60000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  if (!error && alerts.length === 0) return null;

  const check = async () => {
    setLoading(true);
    try {
      await refresh();
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className="admin-finals-alerts" aria-label="Alertes phases finales">
      <header className="admin-finals-alerts__header">
        <AlertTriangle aria-hidden="true" />
        <div>
          <strong>
            {alerts.length > 0
              ? `${alerts.length} rencontre${alerts.length > 1 ? "s" : ""} de phase finale à vérifier`
              : "Surveillance des phases finales indisponible"}
          </strong>
          <p>
            {error
              ? "Impossible de vérifier les rencontres en attente. Relancez le contrôle."
              : "Adversaires connus, mais programmation ou publication non confirmée."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void check()}
          disabled={loading}
          aria-label="Actualiser les alertes de phases finales"
        >
          <RefreshCw aria-hidden="true" />
        </button>
      </header>
      {alerts.length > 0 && (
        <ul>
          {alerts.slice(0, 12).map((item) => (
            <li key={`${item.tournamentId}:${item.matchId}:${item.kind}`}>
              <CalendarClock aria-hidden="true" />
              <div>
                <strong>
                  {item.tournamentName} · {item.seriesName}
                </strong>
                {item.teamA && item.teamB && (
                  <span>
                    {item.teamA} contre {item.teamB}
                  </span>
                )}
                <small>
                  {issueLabels[item.reason] ?? "Rencontre à vérifier"}
                  {item.playDate && item.startsAt
                    ? ` · ${item.playDate} à ${item.startsAt.slice(0, 5)}`
                    : ""}
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}
      {alerts.length > 0 && (
        <Link
          to={`/admin/tournois/qualifications?tournoi=${encodeURIComponent(alerts[0]?.tournamentId ?? "")}#planning-phases-finales`}
        >
          Ouvrir la planification des phases finales
        </Link>
      )}
    </aside>
  );
}
