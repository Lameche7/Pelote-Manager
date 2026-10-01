import { useEffect, useMemo, useState } from "react";
import {
  adminChampionshipDayResultsService,
  type AdminChampionshipDayResult,
} from "@/features/admin/championships/services/adminChampionshipDayResultsService";

type Props = {
  championshipId: string;
};

const formatDay = (value: string) => {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
};

const shortDay = (value: string) => {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
};

const scoreFor = (row: AdminChampionshipDayResult) => {
  if (
    row.proposedScoreTeam1 !== null &&
    row.proposedScoreTeam2 !== null
  ) {
    return {
      left: row.proposedScoreTeam1,
      right: row.proposedScoreTeam2,
      label:
        row.proposalStatus === "confirmed_official"
          ? "Vérifié"
          : row.proposalStatus === "conflict_official"
            ? "À vérifier"
            : "Proposé",
      kind:
        row.proposalStatus === "confirmed_official"
          ? "confirmed"
          : row.proposalStatus === "conflict_official"
            ? "conflict"
            : "proposed",
    };
  }

  if (
    row.officialScoreTeam1 !== null &&
    row.officialScoreTeam2 !== null
  ) {
    return {
      left: row.officialScoreTeam1,
      right: row.officialScoreTeam2,
      label: "Officiel",
      kind: "official",
    };
  }

  return {
    left: null,
    right: null,
    label: "Manquant",
    kind: "missing",
  };
};

export function ChampionshipDayResultsRecap({ championshipId }: Props) {
  const [rows, setRows] = useState<AdminChampionshipDayResult[]>([]);
  const [selectedDay, setSelectedDay] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    adminChampionshipDayResultsService
      .list(championshipId)
      .then((items) => {
        if (!active) return;
        setRows(items);

        const days = [...new Set(items.map((item) => item.dayOn).filter(Boolean))] as string[];
        days.sort();

        const dayWithProposal =
          [...days]
            .reverse()
            .find((day) =>
              items.some(
                (item) =>
                  item.dayOn === day &&
                  item.proposedScoreTeam1 !== null &&
                  item.proposedScoreTeam2 !== null,
              ),
            ) ?? null;

        const today = new Date().toISOString().slice(0, 10);
        const nextDay = days.find((day) => day >= today) ?? null;
        setSelectedDay(dayWithProposal ?? nextDay ?? days.at(-1) ?? "");
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Impossible de charger le récapitulatif.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [championshipId]);

  const days = useMemo(
    () =>
      [...new Set(rows.map((row) => row.dayOn).filter(Boolean) as string[])].sort(),
    [rows],
  );

  const selectedRows = useMemo(
    () => rows.filter((row) => row.dayOn === selectedDay),
    [rows, selectedDay],
  );

  const grouped = useMemo(() => {
    const groups = new Map<
      string,
      { order: number; rows: AdminChampionshipDayResult[] }
    >();
    for (const row of selectedRows) {
      const current = groups.get(row.divisionName) ?? {
        order: row.divisionDisplayOrder,
        rows: [],
      };
      current.rows.push(row);
      groups.set(row.divisionName, current);
    }
    return [...groups.entries()].sort(
      (left, right) => left[1].order - right[1].order,
    );
  }, [selectedRows]);

  const receivedCount = selectedRows.filter((row) => {
    const score = scoreFor(row);
    return score.left !== null && score.right !== null;
  }).length;

  const copyRecap = async () => {
    if (!selectedDay) return;
    const lines = [
      `Résultats championnat — journée du ${shortDay(selectedDay)}`,
      "",
    ];

    for (const [divisionName, group] of grouped) {
      lines.push(divisionName);
      for (const row of group.rows) {
        const score = scoreFor(row);
        const scoreText =
          score.left !== null && score.right !== null
            ? `${score.left} - ${score.right}`
            : "Résultat manquant";
        lines.push(
          `${row.team1Label}  ${scoreText}  ${row.team2Label}`,
        );
      }
      lines.push("");
    }

    try {
      await navigator.clipboard.writeText(lines.join("\n").trim());
      setCopyMessage("Récap copié");
      window.setTimeout(() => setCopyMessage(""), 1800);
    } catch {
      setCopyMessage("Copie impossible");
    }
  };

  return (
    <section className="admin-card admin-championships__day-results">
      <header className="admin-championships__day-results-head">
        <div>
          <p className="admin-page__eyebrow">Transmission ligue</p>
          <h2>Résultats de la journée</h2>
          <p>
            Toutes les parties du club, regroupées par série, avec les scores
            proposés par les équipes.
          </p>
        </div>
        <div className="admin-championships__day-results-actions">
          <label>
            Journée
            <select
              value={selectedDay}
              onChange={(event) => setSelectedDay(event.target.value)}
              disabled={loading || days.length === 0}
            >
              {days.map((day) => (
                <option key={day} value={day}>
                  {formatDay(day)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void copyRecap()}
            disabled={!selectedDay || selectedRows.length === 0}
          >
            Copier le récap
          </button>
        </div>
      </header>

      {copyMessage && (
        <p className="admin-championships__day-results-copy">{copyMessage}</p>
      )}

      {loading ? (
        <div className="admin-championships__day-results-empty">
          Chargement des résultats…
        </div>
      ) : error ? (
        <div className="admin-championships__alert" role="alert">
          {error}
        </div>
      ) : selectedRows.length === 0 ? (
        <div className="admin-championships__day-results-empty">
          Aucune partie du club pour cette journée.
        </div>
      ) : (
        <>
          <div className="admin-championships__day-results-summary">
            <strong>
              {receivedCount} résultat{receivedCount > 1 ? "s" : ""} reçu
              {receivedCount > 1 ? "s" : ""} sur {selectedRows.length} partie
              {selectedRows.length > 1 ? "s" : ""}
            </strong>
            <span>{formatDay(selectedDay)}</span>
          </div>

          <div className="admin-championships__day-results-groups">
            {grouped.map(([divisionName, group]) => (
              <section
                key={divisionName}
                className="admin-championships__day-results-series"
              >
                <h3>{divisionName}</h3>
                <div>
                  {group.rows.map((row) => {
                    const score = scoreFor(row);
                    return (
                      <article
                        key={row.matchId}
                        className="admin-championships__day-result-row"
                      >
                        <div
                          className={
                            row.team1IsClub
                              ? "admin-championships__day-result-team is-club"
                              : "admin-championships__day-result-team"
                          }
                        >
                          <strong>{row.team1Label}</strong>
                          {row.poolCode && <small>Poule {row.poolCode}</small>}
                        </div>

                        <div className="admin-championships__day-result-score">
                          <strong>
                            {score.left ?? "—"} <span>–</span>{" "}
                            {score.right ?? "—"}
                          </strong>
                          <small className={`is-${score.kind}`}>
                            {score.label}
                          </small>
                        </div>

                        <div
                          className={
                            row.team2IsClub
                              ? "admin-championships__day-result-team is-club"
                              : "admin-championships__day-result-team"
                          }
                        >
                          <strong>{row.team2Label}</strong>
                          {row.actualOn &&
                            row.actualOn !== row.dayOn && (
                              <small>
                                Jouée le {shortDay(row.actualOn)}
                                {row.actualTime
                                  ? ` à ${row.actualTime.slice(0, 5)}`
                                  : ""}
                              </small>
                            )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
