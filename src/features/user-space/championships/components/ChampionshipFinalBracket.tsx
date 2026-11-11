import { useEffect, useMemo, useState } from "react";
import { Trophy } from "lucide-react";
import {
  championshipResultsService,
  type ChampionshipBrowserMatch,
  type ChampionshipResultsCatalogItem,
} from "@/features/user-space/championships/services/championshipResultsService";
import {
  firstSeries2027Weekends,
  isFirstSeries2027,
} from "../domain/firstSeries2027Rules.mjs";
import {
  championshipStandingsService,
  type ChampionshipGeneralStandingBrowserRow,
} from "@/features/user-space/championships/services/championshipStandingsService";
import "./ChampionshipFinalBracket.css";

const roundNames = [
  "Barrage",
  "32es de finale",
  "16es de finale",
  "8es de finale",
  "Quarts de finale",
  "Demi-finales",
  "Finale",
];
const roundIndex = (phase: string) => {
  const p = phase
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (/barrage/.test(p)) return 0;
  if (/32/.test(p)) return 1;
  if (/16/.test(p)) return 2;
  if (/1\s*\/\s*8|8eme|huitieme/.test(p)) return 3;
  if (/1\s*\/\s*4|quart/.test(p)) return 4;
  if (/1\s*\/\s*2|demi/.test(p)) return 5;
  if (/final/.test(p) && !/phase|poule/.test(p)) return 6;
  return -1;
};
const playerNames = (players: string[], fallback: string) =>
  players.length ? players.join(" / ") : fallback;
const score = (match: ChampionshipBrowserMatch, side: 1 | 2) =>
  (side === 1 ? match.displayedScoreTeam1 : match.displayedScoreTeam2) ?? "—";

export function ChampionshipFinalBracket({
  preferredChampionshipId,
  preferredDivisionId,
}: {
  preferredChampionshipId?: string | null;
  preferredDivisionId?: string | null;
}) {
  const [catalog, setCatalog] = useState<ChampionshipResultsCatalogItem[]>([]);
  const [championshipId, setChampionshipId] = useState("");
  const [divisionId, setDivisionId] = useState("");
  const [matches, setMatches] = useState<ChampionshipBrowserMatch[]>([]);
  const [standings, setStandings] = useState<
    ChampionshipGeneralStandingBrowserRow[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ChampionshipBrowserMatch | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    championshipResultsService
      .listCatalog()
      .then((items) => {
        if (!active) return;
        setCatalog(items);
        setChampionshipId(
          items.find((x) => x.championshipId === preferredChampionshipId)
            ?.championshipId ??
            items.find((x) => x.hasMyTeam)?.championshipId ??
            items[0]?.championshipId ??
            "",
        );
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error
              ? e.message
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

  const championship = catalog.find((x) => x.championshipId === championshipId);
  useEffect(() => {
    const division =
      championship?.divisions.find((x) => x.id === preferredDivisionId) ??
      championship?.divisions.find((x) =>
        championship.myDivisionIds.includes(x.id),
      ) ??
      championship?.divisions[0];
    setDivisionId(division?.id ?? "");
  }, [championship, preferredDivisionId]);

  useEffect(() => {
    if (!championshipId) return;
    let active = true;
    setLoading(true);
    setError("");
    setMatches([]);
    setStandings([]);
    setSelected(null);
    Promise.all([
      championshipResultsService.listMatches(championshipId),
      championshipStandingsService.listGeneral(championshipId),
    ])
      .then(([items, ranking]) => {
        if (active) {
          setMatches(items);
          setStandings(ranking);
        }
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : "Impossible de charger les phases finales.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [championshipId]);

  const isFirstSeries = isFirstSeries2027(
    championship,
    championship?.divisions.find((division) => division.id === divisionId)
      ?.name ?? "",
  );
  const rounds = useMemo(
    () =>
      roundNames.map((name, index) => ({
        name,
        matches: matches
          .filter(
            (m) => m.divisionId === divisionId && roundIndex(m.phase) === index,
          )
          .sort(
            (a, b) =>
              (a.theoreticalOn ?? "").localeCompare(b.theoreticalOn ?? "") ||
              a.matchId.localeCompare(b.matchId),
          ),
      })),
    [matches, divisionId],
  );
  // Only the committee decides who skips the first knockout round.
  // For 2027 first series, ranks 4 and 5 are explicitly exempted;
  // their established seed branches meet in the quarter-finals.
  const directQuarter = useMemo(() => {
    if (!isFirstSeries) return null;
    const eighths = matches.filter(
      (match) =>
        match.divisionId === divisionId && roundIndex(match.phase) === 3,
    );
    if (eighths.length === 0) return null;
    const rank4 = standings.find(
      (team) => team.divisionId === divisionId && team.generalRank === 4,
    );
    const rank5 = standings.find(
      (team) => team.divisionId === divisionId && team.generalRank === 5,
    );
    if (!rank4 || !rank5) return null;
    const competing = new Set(
      eighths.flatMap((match) => [match.team1Id, match.team2Id]),
    );
    if (competing.has(rank4.teamId) || competing.has(rank5.teamId)) return null;
    const quarters = rounds.find((round) => round.name === "Quarts de finale");
    if (
      quarters?.matches.some(
        (match) =>
          [match.team1Id, match.team2Id].includes(rank4.teamId) ||
          [match.team1Id, match.team2Id].includes(rank5.teamId),
      )
    ) {
      return null;
    }
    return { rank4, rank5 };
  }, [isFirstSeries, matches, divisionId, standings, rounds]);
  const hasFinals = rounds.some((r) => r.matches.length > 0);

  return (
    <section
      className="championship-bracket"
      aria-label="Tableau des phases finales"
    >
      <header>
        <Trophy aria-hidden="true" />
        <div>
          <h2>Phases finales</h2>
          <p>
            Suivez toutes les rencontres de chaque série jusqu’à la finale. Les
            équipes de votre club sont mises en évidence.
          </p>
        </div>
      </header>
      <div className="championship-bracket__filters">
        <label>
          Championnat
          <select
            value={championshipId}
            onChange={(e) => setChampionshipId(e.target.value)}
          >
            {catalog.map((c) => (
              <option key={c.championshipId} value={c.championshipId}>
                {c.seasonLabel} · {c.championshipName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Série
          <select
            value={divisionId}
            onChange={(e) => {
              setDivisionId(e.target.value);
              setSelected(null);
            }}
          >
            {championship?.divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {championship.myDivisionIds.includes(d.id) ? " · Mon club" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : loading ? (
        <p>Chargement du tableau…</p>
      ) : !hasFinals ? (
        <p>
          Le tableau des phases finales n’est pas encore disponible pour cette
          série.
        </p>
      ) : (
        <>
          <div className="championship-bracket__regulation">
            <strong>Rencontres officielles du comité</strong>
            <p>
              Le classement ne détermine plus les qualifications, exemptions ni
              adversaires à la sortie des poules. Les tours suivants seront
              projetés uniquement lorsque leurs correspondances officielles
              seront connues.
            </p>
          </div>
          <p className="championship-bracket__hint">
            Faites défiler horizontalement pour parcourir les tours. Touchez une
            rencontre pour voir son détail.
          </p>
          <div
            className="championship-bracket__scroll"
            tabIndex={0}
            aria-label="Tableau des tours éliminatoires"
          >
            {rounds
              .filter(
                (round) =>
                  round.matches.length > 0 ||
                  (round.name === "Quarts de finale" && directQuarter),
              )
              .map((round) => (
                <div className="championship-bracket__round" key={round.name}>
                  <h3>{round.name}</h3>
                  {isFirstSeries && firstSeries2027Weekends[round.name] && (
                    <p className="championship-bracket__hint">
                      Week-end prévu : {firstSeries2027Weekends[round.name]}
                    </p>
                  )}
                  {round.name === "Quarts de finale" && directQuarter && (
                    <div className="championship-bracket__match">
                      <span>
                        <strong>
                          {playerNames(
                            directQuarter.rank4.players,
                            directQuarter.rank4.teamLabel,
                          )}
                        </strong>
                        <b>—</b>
                      </span>
                      <span>
                        <strong>
                          {playerNames(
                            directQuarter.rank5.players,
                            directQuarter.rank5.teamLabel,
                          )}
                        </strong>
                        <b>—</b>
                      </span>
                      <small>Projection · 4e contre 5e</small>
                    </div>
                  )}
                  {round.matches.map((match) => (
                    <button
                      type="button"
                      key={match.matchId}
                      className="championship-bracket__match"
                      onClick={() => setSelected(match)}
                    >
                      <span className={match.team1IsMyClub ? "is-club" : ""}>
                        <strong>
                          {playerNames(match.team1Players, match.team1Label)}
                        </strong>
                        <b>{score(match, 1)}</b>
                      </span>
                      <span className={match.team2IsMyClub ? "is-club" : ""}>
                        <strong>
                          {playerNames(match.team2Players, match.team2Label)}
                        </strong>
                        <b>{score(match, 2)}</b>
                      </span>
                      <small>
                        {match.effectiveOn ??
                          match.theoreticalOn ??
                          "Date à définir"}
                      </small>
                    </button>
                  ))}
                </div>
              ))}
          </div>
          <p className="championship-bracket__hint">
            Seules les rencontres publiées par le comité sont affichées. Aucune
            branche ou exemption n'est déduite du classement.
          </p>
          {selected && (
            <div
              className="championship-bracket__detail"
              role="region"
              aria-label="Détail de la rencontre"
            >
              <button type="button" onClick={() => setSelected(null)}>
                Fermer ×
              </button>
              <h3>
                {playerNames(selected.team1Players, selected.team1Label)} –{" "}
                {playerNames(selected.team2Players, selected.team2Label)}
              </h3>
              <p>
                {selected.team1ClubName} contre {selected.team2ClubName}
              </p>
              <p>
                Score : {score(selected, 1)} – {score(selected, 2)} ·{" "}
                {selected.resultSource === "official"
                  ? "Résultat officiel"
                  : selected.resultSource === "proposed"
                    ? "Résultat proposé"
                    : "En attente"}
              </p>
              <p>
                {selected.effectiveOn ??
                  selected.theoreticalOn ??
                  "Date à définir"}{" "}
                {selected.effectiveTime?.slice(0, 5) ?? ""} ·{" "}
                {selected.venue ?? "Lieu à définir"}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
