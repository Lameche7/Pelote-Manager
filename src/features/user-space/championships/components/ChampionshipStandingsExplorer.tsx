import { useEffect, useMemo, useState } from "react";
import { BarChart3, Trophy } from "lucide-react";
import {
  championshipStandingsService,
  type ChampionshipStandingBrowserRow,
} from "@/features/user-space/championships/services/championshipStandingsService";
import "./ChampionshipStandingsExplorer.css";

type Props = {
  championshipId: string;
  preferredDivisionId?: string | null;
  preferredPoolId?: string | null;
};

type DivisionOption = {
  id: string;
  name: string;
  order: number;
  isMine: boolean;
};

type PoolOption = {
  id: string;
  code: string;
  name: string | null;
  order: number;
  isMine: boolean;
};

export function ChampionshipStandingsExplorer({
  championshipId,
  preferredDivisionId,
  preferredPoolId,
}: Props) {
  const [rows, setRows] = useState<ChampionshipStandingBrowserRow[]>([]);
  const [selectedDivisionId, setSelectedDivisionId] = useState("");
  const [selectedPoolId, setSelectedPoolId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setRows([]);
    setSelectedDivisionId("");
    setSelectedPoolId("");

    championshipStandingsService
      .list(championshipId)
      .then((items) => {
        if (active) setRows(items);
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Impossible de charger les classements.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [championshipId]);

  const divisions = useMemo<DivisionOption[]>(() => {
    const values = new Map<string, DivisionOption>();
    for (const row of rows) {
      values.set(row.divisionId, {
        id: row.divisionId,
        name: row.divisionName,
        order: row.divisionDisplayOrder,
        isMine: row.isMyDivision,
      });
    }
    return [...values.values()].sort((left, right) => left.order - right.order);
  }, [rows]);

  useEffect(() => {
    if (divisions.length === 0) return;
    const preferred =
      divisions.find((division) => division.id === preferredDivisionId) ??
      divisions.find((division) => division.isMine) ??
      divisions[0];
    setSelectedDivisionId((current) =>
      divisions.some((division) => division.id === current)
        ? current
        : preferred.id,
    );
  }, [divisions, preferredDivisionId]);

  const pools = useMemo<PoolOption[]>(() => {
    const values = new Map<string, PoolOption>();
    for (const row of rows) {
      if (row.divisionId !== selectedDivisionId) continue;
      values.set(row.poolId, {
        id: row.poolId,
        code: row.poolCode,
        name: row.poolName,
        order: row.poolDisplayOrder,
        isMine: row.isMyPool,
      });
    }
    return [...values.values()].sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      return left.code.localeCompare(right.code, "fr", { numeric: true });
    });
  }, [rows, selectedDivisionId]);

  useEffect(() => {
    if (pools.length === 0) {
      setSelectedPoolId("");
      return;
    }
    const preferred =
      pools.find((pool) => pool.id === preferredPoolId) ??
      pools.find((pool) => pool.isMine) ??
      pools[0];
    setSelectedPoolId((current) =>
      pools.some((pool) => pool.id === current) ? current : preferred.id,
    );
  }, [pools, preferredPoolId]);

  const standings = useMemo(
    () =>
      rows
        .filter((row) => row.poolId === selectedPoolId)
        .sort((left, right) => {
          if (left.standingRank !== null && right.standingRank !== null) {
            return left.standingRank - right.standingRank;
          }
          if (left.standingRank !== null) return -1;
          if (right.standingRank !== null) return 1;
          return left.teamLabel.localeCompare(right.teamLabel, "fr", {
            numeric: true,
          });
        }),
    [rows, selectedPoolId],
  );

  const selectedDivision = divisions.find(
    (division) => division.id === selectedDivisionId,
  );
  const selectedPool = pools.find((pool) => pool.id === selectedPoolId);
  const hasOfficialStanding = standings.some((row) => row.hasOfficialStanding);

  return (
    <section
      className="championship-standings-browser"
      aria-labelledby="championship-standings-browser-title"
    >
      <header className="championship-standings-browser__heading">
        <div className="championship-standings-browser__icon">
          <BarChart3 aria-hidden="true" />
        </div>
        <div>
          <p>Classements par poule</p>
          <h2 id="championship-standings-browser-title">Classements</h2>
          <span>
            Votre série et votre poule sont ouvertes par défaut. Vous pouvez
            parcourir toutes les autres séries du championnat.
          </span>
        </div>
      </header>

      {loading ? (
        <div className="championship-standings-browser__state">
          Chargement des classements…
        </div>
      ) : error ? (
        <div
          className="championship-standings-browser__state is-error"
          role="alert"
        >
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="championship-standings-browser__state">
          Aucun classement disponible pour ce championnat.
        </div>
      ) : (
        <>
          <div className="championship-standings-browser__filters">
            <label>
              <span>Série</span>
              <select
                value={selectedDivisionId}
                onChange={(event) => {
                  setSelectedDivisionId(event.target.value);
                  setSelectedPoolId("");
                }}
              >
                {divisions.map((division) => (
                  <option key={division.id} value={division.id}>
                    {division.name}
                    {division.isMine ? " · Ma série" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div
            className="championship-standings-browser__pool-tabs"
            role="tablist"
            aria-label="Poules"
          >
            {pools.map((pool) => (
              <button
                type="button"
                key={pool.id}
                role="tab"
                aria-selected={pool.id === selectedPoolId}
                className={pool.id === selectedPoolId ? "is-active" : undefined}
                onClick={() => setSelectedPoolId(pool.id)}
              >
                Poule {pool.code}
                {pool.isMine && <small>Ma poule</small>}
              </button>
            ))}
          </div>

          <div className="championship-standings-browser__summary">
            <div>
              <strong>{selectedDivision?.name ?? "Série"}</strong>
              <span>
                {selectedPool?.name ??
                  (selectedPool ? `Poule ${selectedPool.code}` : "Poule")}
              </span>
            </div>
            <strong>
              {hasOfficialStanding ? "Classement comité" : "En attente du comité"}
            </strong>
          </div>

          {!hasOfficialStanding && (
            <div className="championship-standings-browser__pending">
              Le classement officiel n’a pas encore été importé. Il se mettra à
              jour ici lors de la mise à jour des résultats du comité.
            </div>
          )}

          <div className="championship-standings-browser__list">
            {standings.map((team, index) => (
              <article
                key={team.teamId}
                className={`championship-standings-browser__row${
                  team.isMyTeam ? " is-mine" : ""
                }`}
              >
                <div className="championship-standings-browser__rank">
                  {team.standingRank !== null ? (
                    <strong>{team.standingRank}</strong>
                  ) : (
                    <strong>—</strong>
                  )}
                  {team.standingRank === 1 && <Trophy aria-label="Premier" />}
                  {!hasOfficialStanding && <small>{index + 1}</small>}
                </div>

                <div className="championship-standings-browser__team">
                  <strong>
                    {team.players.length > 0
                      ? team.players.join(" / ")
                      : team.teamLabel}
                  </strong>
                  <span>{team.clubName}</span>
                  <small>{team.teamLabel}</small>
                </div>

                <div className="championship-standings-browser__stats">
                  <span>
                    <strong>{team.points ?? "—"}</strong>
                    Pts
                  </span>
                  <span>
                    <strong>{team.played}</strong>J
                  </span>
                  <span>
                    <strong>{team.wins}</strong>V
                  </span>
                  <span>
                    <strong>{team.losses}</strong>D
                  </span>
                  <span>
                    <strong>
                      {team.scoreDifference > 0 ? "+" : ""}
                      {team.scoreDifference}
                    </strong>
                    +/-
                  </span>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
