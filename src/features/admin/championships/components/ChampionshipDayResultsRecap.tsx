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
  const [selectedDivisionId, setSelectedDivisionId] = useState("");
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

        const divisions = [
          ...new Map(
            items.map((item) => [
              item.divisionId,
              {
                id: item.divisionId,
                name: item.divisionName,
                order: item.divisionDisplayOrder,
              },
            ]),
          ).values(),
        ].sort((left, right) => left.order - right.order);

        const preferredDivision =
          divisions.find((division) =>
            items.some(
              (item) =>
                item.divisionId === division.id &&
                item.proposedScoreTeam1 !== null &&
                item.proposedScoreTeam2 !== null,
            ),
          ) ?? divisions[0];

        setSelectedDivisionId(preferredDivision?.id ?? "");
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

  const divisions = useMemo(
    () =>
      [
        ...new Map(
          rows.map((row) => [
            row.divisionId,
            {
              id: row.divisionId,
              name: row.divisionName,
              order: row.divisionDisplayOrder,
            },
          ]),
        ).values(),
      ].sort((left, right) => left.order - right.order),
    [rows],
  );

  const divisionRows = useMemo(
    () => rows.filter((row) => row.divisionId === selectedDivisionId),
    [rows, selectedDivisionId],
  );

  const days = useMemo(
    () =>
      [
        ...new Set(
          divisionRows
            .map((row) => row.dayOn)
            .filter(Boolean) as string[],
        ),
      ].sort(),
    [divisionRows],
  );

  useEffect(() => {
    if (days.length === 0) {
      setSelectedDay("");
      return;
    }

    const dayWithProposal =
      [...days]
        .reverse()
        .find((day) =>
          divisionRows.some(
            (item) =>
              item.dayOn === day &&
              item.proposedScoreTeam1 !== null &&
              item.proposedScoreTeam2 !== null,
          ),
        ) ?? null;

    const today = new Date().toISOString().slice(0, 10);
    const nextDay = days.find((day) => day >= today) ?? null;
    setSelectedDay(dayWithProposal ?? nextDay ?? days.at(-1) ?? "");
  }, [days, divisionRows]);

  const selectedRows = useMemo(
    () =>
      divisionRows
        .filter((row) => row.dayOn === selectedDay)
        .sort((left, right) => {
          if (left.clubIsHome !== right.clubIsHome) {
            return left.clubIsHome ? -1 : 1;
          }
          return left.team1Label.localeCompare(right.team1Label, "fr", {
            numeric: true,
          });
        }),
    [divisionRows, selectedDay],
  );

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

    const selectedDivision = divisions.find(
      (division) => division.id === selectedDivisionId,
    );
    if (selectedDivision) {
      lines.push(selectedDivision.name, "");
    }
    for (const row of selectedRows) {
      const score = scoreFor(row);
      const scoreText =
        score.left !== null && score.right !== null
          ? `${score.left} - ${score.right}`
          : "Résultat manquant";
      lines.push(
        `${row.clubIsHome ? "[DOMICILE] " : ""}${row.team1Label}  ${scoreText}  ${row.team2Label}`,
      );
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
            Choisissez une série puis une journée. Les matchs à domicile, que
            le club doit saisir, sont mis en évidence.
          </p>
        </div>
        <div className="admin-championships__day-results-actions">
          <label>
            Série
            <select
              value={selectedDivisionId}
              onChange={(event) => setSelectedDivisionId(event.target.value)}
              disabled={loading || divisions.length === 0}
            >
              {divisions.map((division) => (
                <option key={division.id} value={division.id}>
                  {division.name}
                </option>
              ))}
            </select>
          </label>
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
            <section className="admin-championships__day-results-series">
              <h3>
                {divisions.find(
                  (division) => division.id === selectedDivisionId,
                )?.name ?? "Série"}
              </h3>
              <div>
                {selectedRows.map((row) => {
                  const score = scoreFor(row);
                  return (
                    <article
                      key={row.matchId}
                      className={[
                        "admin-championships__day-result-row",
                        row.clubIsHome ? "is-home" : "is-away",
                      ].join(" ")}
                    >
                      <div
                        className={
                          row.team1IsClub
                            ? "admin-championships__day-result-team is-club"
                            : "admin-championships__day-result-team"
                        }
                      >
                        <strong>{row.team1Label}</strong>
                        {row.team1Players.length > 0 && (
                          <small>{row.team1Players.join(" / ")}</small>
                        )}
                        {row.poolCode && <small>Poule {row.poolCode}</small>}
                      </div>

                      <div className="admin-championships__day-result-score">
                        {row.clubIsHome && (
                          <strong className="admin-championships__home-badge">
                            À DOMICILE · À SAISIR
                          </strong>
                        )}
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
                        {row.team2Players.length > 0 && (
                          <small>{row.team2Players.join(" / ")}</small>
                        )}
                        {row.actualOn && row.actualOn !== row.dayOn && (
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
          </div>
        </>
      )}
    </section>
  );
}
