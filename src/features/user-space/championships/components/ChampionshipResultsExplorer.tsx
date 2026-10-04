import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Trophy } from "lucide-react";
import {
  championshipResultsService,
  type ChampionshipBrowserMatch,
  type ChampionshipResultsCatalogItem,
} from "@/features/user-space/championships/services/championshipResultsService";
import "./ChampionshipResultsExplorer.css";

type Props = {
  preferredChampionshipId?: string | null;
  preferredDivisionId?: string | null;
  preferredPoolId?: string | null;
  focusDay?: string | null;
};

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "2-digit",
  month: "short",
});

const compactDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
});

const displayDate = (value: string | null) => {
  if (!value) return "Date à définir";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
};

const displayCompactDate = (value: string) => {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : compactDateFormatter.format(date);
};

const displayTime = (value: string | null) =>
  value ? value.slice(0, 5) : null;

const playersLabel = (players: string[], fallback: string) =>
  players.length > 0 ? players.join(" / ") : fallback;

function MatchCard({ match }: { match: ChampionshipBrowserMatch }) {
  const left = match.displayedScoreTeam1;
  const right = match.displayedScoreTeam2;
  const leftWins = left !== null && right !== null && left > right;
  const rightWins = left !== null && right !== null && right > left;
  const hasScore = left !== null && right !== null;
  const actualDiffers =
    Boolean(match.effectiveOn) && match.effectiveOn !== match.theoreticalOn;

  return (
    <article className="championship-results__match-card">
      <div className="championship-results__match-meta">
        {actualDiffers ? (
          <span>
            Programmée le {displayDate(match.effectiveOn)}
            {displayTime(match.effectiveTime)
              ? ` · ${displayTime(match.effectiveTime)}`
              : ""}
          </span>
        ) : displayTime(match.effectiveTime) ? (
          <span>{displayTime(match.effectiveTime)}</span>
        ) : (
          <span>Horaire à définir</span>
        )}
        {match.venue && <span>{match.venue}</span>}
      </div>

      <div className="championship-results__versus">
        <div
          className={`championship-results__side${
            match.team1IsMyTeam ? " is-mine" : ""
          }${match.team1IsMyClub ? " is-my-club" : ""}`}
        >
          <div>
            <strong>{playersLabel(match.team1Players, match.team1Label)}</strong>
            <span>{match.team1ClubName}</span>
            <small>{match.team1Label}</small>
          </div>
          <strong className={leftWins ? "is-winner" : undefined}>
            {left ?? "—"}
          </strong>
        </div>

        <div className="championship-results__versus-separator">
          <span>VS</span>
        </div>

        <div
          className={`championship-results__side${
            match.team2IsMyTeam ? " is-mine" : ""
          }${match.team2IsMyClub ? " is-my-club" : ""}`}
        >
          <div>
            <strong>{playersLabel(match.team2Players, match.team2Label)}</strong>
            <span>{match.team2ClubName}</span>
            <small>{match.team2Label}</small>
          </div>
          <strong className={rightWins ? "is-winner" : undefined}>
            {right ?? "—"}
          </strong>
        </div>
      </div>

      <footer className="championship-results__result-state">
        {match.resultSource === "official" ? (
          <strong className="is-official">
            <Trophy aria-hidden="true" /> Résultat officiel
          </strong>
        ) : match.resultSource === "proposed" ? (
          <strong className="is-proposed">
            Résultat saisi · en attente de la mise à jour du comité
          </strong>
        ) : hasScore ? (
          <strong>Résultat à vérifier</strong>
        ) : (
          <span>Résultat non saisi</span>
        )}
      </footer>
    </article>
  );
}

export function ChampionshipResultsExplorer({
  preferredChampionshipId,
  preferredDivisionId,
  preferredPoolId,
  focusDay,
}: Props) {
  const [catalog, setCatalog] = useState<ChampionshipResultsCatalogItem[]>([]);
  const [matches, setMatches] = useState<ChampionshipBrowserMatch[]>([]);
  const [selectedChampionshipId, setSelectedChampionshipId] = useState("");
  const [selectedDivisionId, setSelectedDivisionId] = useState("");
  const [selectedPoolId, setSelectedPoolId] = useState("all");
  const [selectedDay, setSelectedDay] = useState("");
  const [loading, setLoading] = useState(true);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    championshipResultsService
      .listCatalog()
      .then((items) => {
        if (!active) return;
        setCatalog(items);
        const preferred =
          items.find((item) => item.championshipId === preferredChampionshipId) ??
          items.find(
            (item) => item.championshipStatus === "active" && item.hasMyTeam,
          ) ??
          items.find((item) => item.championshipStatus === "active") ??
          items[0];
        if (preferred) setSelectedChampionshipId(preferred.championshipId);
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Impossible de charger les championnats.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [preferredChampionshipId]);

  const selectedChampionship = useMemo(
    () =>
      catalog.find((item) => item.championshipId === selectedChampionshipId) ??
      null,
    [catalog, selectedChampionshipId],
  );

  useEffect(() => {
    if (!selectedChampionship) return;
    const division =
      selectedChampionship.divisions.find(
        (item) =>
          selectedChampionship.championshipId === preferredChampionshipId &&
          item.id === preferredDivisionId,
      ) ??
      selectedChampionship.divisions.find((item) =>
        selectedChampionship.myDivisionIds.includes(item.id),
      ) ??
      selectedChampionship.divisions[0];
    setSelectedDivisionId(division?.id ?? "");
    setSelectedPoolId("all");
    setSelectedDay("");
  }, [selectedChampionship, preferredChampionshipId, preferredDivisionId]);

  useEffect(() => {
    if (!selectedChampionshipId) return;
    let active = true;
    setMatchesLoading(true);
    setError("");
    championshipResultsService
      .listMatches(selectedChampionshipId)
      .then((items) => {
        if (active) setMatches(items);
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Impossible de charger les rencontres.",
        );
      })
      .finally(() => {
        if (active) setMatchesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedChampionshipId]);

  const divisionMatches = useMemo(
    () => matches.filter((match) => match.divisionId === selectedDivisionId),
    [matches, selectedDivisionId],
  );

  const poolOptions = useMemo(() => {
    const pools = new Map<
      string,
      { id: string; label: string; code: string; isMine: boolean }
    >();
    for (const match of divisionMatches) {
      if (!match.poolId) continue;
      const current = pools.get(match.poolId);
      pools.set(match.poolId, {
        id: match.poolId,
        label: match.poolName ?? `Poule ${match.poolCode ?? "—"}`,
        code: match.poolCode ?? "",
        isMine:
          Boolean(current?.isMine) || match.team1IsMyTeam || match.team2IsMyTeam,
      });
    }
    return [...pools.values()].sort((left, right) =>
      left.code.localeCompare(right.code, "fr", { numeric: true }),
    );
  }, [divisionMatches]);

  useEffect(() => {
    if (poolOptions.length === 0) {
      setSelectedPoolId("all");
      return;
    }
    const preferred =
      poolOptions.find(
        (pool) =>
          selectedChampionshipId === preferredChampionshipId &&
          selectedDivisionId === preferredDivisionId &&
          pool.id === preferredPoolId,
      ) ?? poolOptions.find((pool) => pool.isMine);
    setSelectedPoolId(preferred?.id ?? "all");
  }, [
    poolOptions,
    preferredChampionshipId,
    preferredDivisionId,
    preferredPoolId,
    selectedChampionshipId,
    selectedDivisionId,
  ]);

  const poolFilteredMatches = useMemo(
    () =>
      divisionMatches.filter(
        (match) => selectedPoolId === "all" || match.poolId === selectedPoolId,
      ),
    [divisionMatches, selectedPoolId],
  );

  const divisionDays = useMemo(
    () =>
      [
        ...new Set(
          divisionMatches
            .map((match) => match.theoreticalOn)
            .filter((day): day is string => Boolean(day)),
        ),
      ].sort(),
    [divisionMatches],
  );

  const availableDays = useMemo(
    () =>
      [
        ...new Set(
          poolFilteredMatches
            .map((match) => match.theoreticalOn)
            .filter((day): day is string => Boolean(day)),
        ),
      ].sort(),
    [poolFilteredMatches],
  );

  useEffect(() => {
    if (availableDays.length === 0) {
      setSelectedDay("");
      return;
    }
    const preferred =
      (focusDay && availableDays.includes(focusDay) ? focusDay : null) ??
      availableDays.find((day) => !focusDay || day >= focusDay) ??
      availableDays.at(-1) ??
      "";
    setSelectedDay((current) =>
      availableDays.includes(current) ? current : preferred,
    );
  }, [availableDays, focusDay]);

  const visibleMatches = useMemo(
    () =>
      poolFilteredMatches.filter(
        (match) => !selectedDay || match.theoreticalOn === selectedDay,
      ),
    [poolFilteredMatches, selectedDay],
  );

  const groups = useMemo(() => {
    const map = new Map<
      string,
      { id: string; label: string; code: string; matches: ChampionshipBrowserMatch[] }
    >();
    for (const match of visibleMatches) {
      const key = match.poolId ?? "no-pool";
      const group = map.get(key) ?? {
        id: key,
        label: match.poolName ?? (match.poolCode ? `Poule ${match.poolCode}` : match.phase),
        code: match.poolCode ?? "",
        matches: [],
      };
      group.matches.push(match);
      map.set(key, group);
    }
    return [...map.values()].sort((left, right) =>
      left.code.localeCompare(right.code, "fr", { numeric: true }),
    );
  }, [visibleMatches]);

  if (loading || catalog.length === 0) {
    return loading ? (
      <section className="championship-results">
        <div className="championship-results__state">
          Chargement des championnats…
        </div>
      </section>
    ) : null;
  }

  return (
    <section
      className="championship-results"
      aria-labelledby="championship-results-title"
    >
      <header className="championship-results__heading">
        <div className="championship-results__heading-icon">
          <CalendarRange aria-hidden="true" />
        </div>
        <div>
          <p>Explorer le championnat</p>
          <h2 id="championship-results-title">Rencontres par journée</h2>
          <span>
            Choisissez une série, une poule et une journée. Les résultats saisis
            par les équipes restent visibles jusqu’à leur remplacement par le
            résultat officiel du comité.
          </span>
        </div>
      </header>

      <div className="championship-results__filters">
        <label>
          <span>Championnat</span>
          <select
            value={selectedChampionshipId}
            onChange={(event) => setSelectedChampionshipId(event.target.value)}
          >
            {catalog.map((item) => (
              <option key={item.championshipId} value={item.championshipId}>
                {item.seasonLabel} · {item.championshipName}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Série</span>
          <select
            value={selectedDivisionId}
            onChange={(event) => {
              setSelectedDivisionId(event.target.value);
              setSelectedPoolId("all");
              setSelectedDay("");
            }}
          >
            {selectedChampionship?.divisions.map((division) => (
              <option key={division.id} value={division.id}>
                {division.name}
                {selectedChampionship.myDivisionIds.includes(division.id)
                  ? " · Ma série"
                  : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Poule</span>
          <select
            value={selectedPoolId}
            onChange={(event) => {
              setSelectedPoolId(event.target.value);
              setSelectedDay("");
            }}
          >
            <option value="all">Toutes les poules</option>
            {poolOptions.map((pool) => (
              <option key={pool.id} value={pool.id}>
                {pool.label}{pool.isMine ? " · Ma poule" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="championship-results__days" role="tablist">
        {availableDays.map((day) => {
          const dayIndex = divisionDays.indexOf(day);
          return (
            <button
              type="button"
              role="tab"
              key={day}
              aria-selected={selectedDay === day}
              className={selectedDay === day ? "is-active" : undefined}
              onClick={() => setSelectedDay(day)}
            >
              <strong>{dayIndex >= 0 ? `J${dayIndex + 1}` : "Journée"}</strong>
              <span>{displayCompactDate(day)}</span>
              {day === focusDay && <small>Week-end affiché</small>}
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="championship-results__state is-error" role="alert">
          {error}
        </div>
      ) : matchesLoading ? (
        <div className="championship-results__state">
          Chargement des rencontres…
        </div>
      ) : groups.length === 0 ? (
        <div className="championship-results__state">
          Aucune rencontre pour cette journée.
        </div>
      ) : (
        <div className="championship-results__groups">
          {groups.map((group) => (
            <section key={group.id} className="championship-results__pool-group">
              <header>
                <div>
                  <strong>{group.label}</strong>
                  <span>{displayDate(selectedDay)}</span>
                </div>
                <strong>{group.matches.length} partie(s)</strong>
              </header>
              <div>
                {group.matches.map((match) => (
                  <MatchCard key={match.matchId} match={match} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
