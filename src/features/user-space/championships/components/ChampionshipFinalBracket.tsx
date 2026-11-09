import { useEffect, useMemo, useState } from "react";
import { Trophy } from "lucide-react";
import {
  championshipResultsService,
  type ChampionshipBrowserMatch,
  type ChampionshipResultsCatalogItem,
} from "@/features/user-space/championships/services/championshipResultsService";
import {
  championshipStandingsService,
  type ChampionshipGeneralStandingBrowserRow,
} from "@/features/user-space/championships/services/championshipStandingsService";
import {
  seedOrder,
  orderRoundOf32MatchesBySeed,
} from "../domain/officialSeedBracket.mjs";
import {
  firstSeries2027Weekends,
  isFirstSeries2027,
  openingRoundMatches,
} from "../domain/firstSeries2027Rules.mjs";
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
const roundLabel = (size: number) =>
  size === 64
    ? "32es de finale"
    : size === 32
      ? "16es de finale"
      : size === 16
        ? "8es de finale"
        : size === 8
          ? "Quarts de finale"
          : size === 4
            ? "Demi-finales"
            : "Finale";
type ProjectedSlot = { label: string; isClub: boolean; teamId?: string };
type ProjectedMatch = {
  left: ProjectedSlot;
  right: ProjectedSlot;
  official?: ChampionshipBrowserMatch;
};
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
    championship?.divisions.find((division) => division.id === divisionId)?.name ??
      "",
  );
  const firstSeriesNationalBTeams = isFirstSeries
    ? standings
        .filter(
          (team) =>
            team.divisionId === divisionId &&
            team.generalRank >= 9 &&
            team.generalRank <= 12,
        )
        .sort((a, b) => a.generalRank - b.generalRank)
    : [];

  const projection = useMemo(() => {
    const ranking = standings.filter((x) => x.divisionId === divisionId);
    const cutoff = ranking[0]?.qualificationCutoff;
    // No bracket is guessed without an explicitly supplied qualification size.
    if (!cutoff || !Number.isInteger(cutoff) || cutoff < 2 || cutoff > 64)
      return null;
    const size = 2 ** Math.ceil(Math.log2(cutoff));
    const order = seedOrder(size);
    const rankMap = new Map(ranking.map((x) => [x.generalRank, x]));
    // Resolve the current club from the server-side club membership flags, not a hard-coded club name.
    const currentClubNames = new Set(
      matches
        .flatMap((m) => [
          ...(m.team1IsMyClub ? [m.team1ClubName] : []),
          ...(m.team2IsMyClub ? [m.team2ClubName] : []),
        ])
        .filter(Boolean),
    );
    const slot = (rank: number): ProjectedSlot => {
      const team = rank <= cutoff ? rankMap.get(rank) : undefined;
      return {
        label: team
          ? playerNames(team.players, team.teamLabel)
          : rank <= cutoff
            ? `Classé n°${rank} à déterminer`
            : "Exempt",
        isClub: Boolean(team && currentClubNames.has(team.clubName)),
        teamId: team?.teamId,
      };
    };
    // A 48-team qualification has 16 barrages followed by an official 32-team round.
    // Never invent the 64-slot bye arrangement: the imported 16es are authoritative.
    if (cutoff === 48) {
      const official16 = matches.filter(
        (m) => m.divisionId === divisionId && roundIndex(m.phase) === 2,
      );
      if (official16.length === 16) {
        const teamRank = new Map(
          ranking.map((team) => [team.teamId, team.generalRank]),
        );
        // These 16 fixtures correspond to ranks 1–16 against the winners
        // of the 16 barrages. The next tour crosses branch 1 with branch 16,
        // branch 8 with 9, etc. Ascending-rank sorting would wrongly pair 1–2.
        const first = orderRoundOf32MatchesBySeed(
          official16.map((m) => ({
            left: {
              label: playerNames(m.team1Players, m.team1Label),
              isClub: m.team1IsMyClub,
              teamId: m.team1Id,
            },
            right: {
              label: playerNames(m.team2Players, m.team2Label),
              isClub: m.team2IsMyClub,
              teamId: m.team2Id,
            },
            official: m,
          })),
          (pair) =>
            Math.min(
              teamRank.get(pair.left.teamId ?? "") ?? 999,
              teamRank.get(pair.right.teamId ?? "") ?? 999,
            ),
        );
        const result: { name: string; matches: ProjectedMatch[] }[] = [
          { name: "16es de finale", matches: first },
        ];
        let current: ProjectedMatch[] = first;
        for (let count = 16; count >= 2; count /= 2) {
          const next: ProjectedMatch[] = [];
          for (let i = 0; i < current.length; i += 2) {
            const winner = (
              pair: ProjectedMatch,
              number: number,
            ): ProjectedSlot => {
              const m = pair.official;
              if (
                m?.resultSource === "official" &&
                m.officialScoreTeam1 != null &&
                m.officialScoreTeam2 != null &&
                m.officialScoreTeam1 !== m.officialScoreTeam2
              )
                return m.officialScoreTeam1 > m.officialScoreTeam2
                  ? pair.left
                  : pair.right;
              return { label: `Vainqueur match ${number}`, isClub: false };
            };
            next.push({
              left: winner(current[i], i + 1),
              right: winner(current[i + 1], i + 2),
            });
          }
          const name = roundLabel(count);
          const published = matches.filter(
            (m) =>
              m.divisionId === divisionId &&
              roundIndex(m.phase) === roundNames.indexOf(name),
          );
          for (const pair of next) {
            const m = published.find(
              (m) =>
                pair.left.teamId &&
                pair.right.teamId &&
                ((m.team1Id === pair.left.teamId &&
                  m.team2Id === pair.right.teamId) ||
                  (m.team2Id === pair.left.teamId &&
                    m.team1Id === pair.right.teamId)),
            );
            if (m) pair.official = m;
          }
          result.push({ name, matches: next });
          current = next;
        }
        return result;
      }
    }
    let current: ProjectedMatch[] = [];
    for (let i = 0; i < order.length; i += 2)
      current.push({ left: slot(order[i]), right: slot(order[i + 1]) });
    const result: { name: string; matches: ProjectedMatch[] }[] = [];
    for (let count = size; count >= 2; count /= 2) {
      const name = roundLabel(count);
      const actual = matches.filter(
        (m) =>
          m.divisionId === divisionId &&
          roundIndex(m.phase) === roundNames.indexOf(name),
      );
      const enriched = current.map((pair) => {
        const official = actual.find(
          (m) =>
            [pair.left.teamId, pair.right.teamId].every(Boolean) &&
            ((m.team1Id === pair.left.teamId &&
              m.team2Id === pair.right.teamId) ||
              (m.team2Id === pair.left.teamId &&
                m.team1Id === pair.right.teamId)),
        );
        return { ...pair, official };
      });
      result.push({
        name,
        matches: openingRoundMatches(cutoff, count, enriched),
      });
      if (count === 2) break;
      current = [];
      for (let i = 0; i < enriched.length; i += 2) {
        const a = enriched[i],
          b = enriched[i + 1];
        const nextSlot = (
          pair: ProjectedMatch,
          index: number,
        ): ProjectedSlot => {
          const scoreA = pair.official?.displayedScoreTeam1,
            scoreB = pair.official?.displayedScoreTeam2;
          if (
            pair.official?.resultSource === "official" &&
            scoreA != null &&
            scoreB != null &&
            scoreA !== scoreB
          ) {
            const winnerId =
              scoreA > scoreB ? pair.official.team1Id : pair.official.team2Id;
            return winnerId === pair.left.teamId ? pair.left : pair.right;
          }
          if (pair.right.label === "Exempt") return pair.left;
          if (pair.left.label === "Exempt") return pair.right;
          return { label: `Vainqueur match ${index + 1}`, isClub: false };
        };
        current.push({ left: nextSlot(a, i), right: nextSlot(b, i + 1) });
      }
    }
    return result;
  }, [matches, standings, divisionId]);
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
  const hasFinals =
    Boolean(projection) || rounds.some((r) => r.matches.length > 0);

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
          {isFirstSeries && (
            <div className="championship-bracket__regulation">
              <strong>1ère série · Championnat du Béarn 2026–2027</strong>
              <p>
                15 équipes en 3 poules de 5. Après le classement général du 9
                novembre : les rangs 1 à 4 vont directement en quarts. Les
                rangs 5 à 12 jouent quatre huitièmes (5–12, 6–11, 7–10,
                8–9). Les rencontres restent des projections tant que le
                comité ne les a pas publiées.
              </p>
            </div>
          )}
          <p className="championship-bracket__hint">
            Faites défiler horizontalement pour parcourir les tours. Touchez une
            rencontre pour voir son détail.
          </p>
          <div
            className="championship-bracket__scroll"
            tabIndex={0}
            aria-label="Tableau des tours éliminatoires"
          >
            {projection
              ? projection.map((round) => (
                  <div className="championship-bracket__round" key={round.name}>
                    <h3>{round.name}</h3>
                    {isFirstSeries &&
                      firstSeries2027Weekends[round.name] && (
                        <p className="championship-bracket__hint">
                          Week-end prévu : {firstSeries2027Weekends[round.name]}
                        </p>
                      )}
                    {round.matches.map((pair, index) => (
                      <button
                        type="button"
                        key={index}
                        className="championship-bracket__match"
                        disabled={!pair.official}
                        onClick={() =>
                          pair.official && setSelected(pair.official)
                        }
                        aria-label={
                          pair.left.label + " contre " + pair.right.label
                        }
                      >
                        <span className={pair.left.isClub ? "is-club" : ""}>
                          <strong>{pair.left.label}</strong>
                          <b>
                            {pair.official
                              ? score(
                                  pair.official,
                                  pair.official.team1Id === pair.left.teamId
                                    ? 1
                                    : 2,
                                )
                              : "—"}
                          </b>
                        </span>
                        <span className={pair.right.isClub ? "is-club" : ""}>
                          <strong>{pair.right.label}</strong>
                          <b>
                            {pair.official
                              ? score(
                                  pair.official,
                                  pair.official.team1Id === pair.right.teamId
                                    ? 1
                                    : 2,
                                )
                              : "—"}
                          </b>
                        </span>
                        <small>
                          {pair.official
                            ? (pair.official.effectiveOn ??
                              pair.official.theoreticalOn ??
                              "Date à définir")
                            : "Projection selon classement"}
                        </small>
                      </button>
                    ))}
                  </div>
                ))
              : rounds.map((round) => (
                  <div className="championship-bracket__round" key={round.name}>
                    <h3>{round.name}</h3>
                    {round.matches.map((m) => (
                      <button
                        type="button"
                        key={m.matchId}
                        className="championship-bracket__match"
                        onClick={() => setSelected(m)}
                      >
                        <span className={m.team1IsMyClub ? "is-club" : ""}>
                          <strong>
                            {playerNames(m.team1Players, m.team1Label)}
                          </strong>
                          <b>{score(m, 1)}</b>
                        </span>
                        <span className={m.team2IsMyClub ? "is-club" : ""}>
                          <strong>
                            {playerNames(m.team2Players, m.team2Label)}
                          </strong>
                          <b>{score(m, 2)}</b>
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
          </div>
          {isFirstSeries && (
            <div className="championship-bracket__regulation">
              <strong>Barrages Nationale B — compétition distincte</strong>
              <p>
                Les équipes classées 9e à 12e disputent deux tours de barrage
                les week-ends des quarts et demi-finales du Béarn (21–22 et
                28–29 novembre). Le règlement fourni ne précise pas les
                croisements : aucun adversaire n'est inventé dans ce tableau.
              </p>
              <p>
                Équipes concernées :{" "}
                {firstSeriesNationalBTeams.length === 4
                  ? firstSeriesNationalBTeams
                      .map(
                        (team) =>
                          `${team.generalRank}e : ${playerNames(team.players, team.teamLabel)}`,
                      )
                      .join(" · ")
                  : "Classement général à confirmer"}.
              </p>
            </div>
          )}
          <p className="championship-bracket__hint">
            Les rencontres publiées sont prioritaires. Les tours suivants sont
            des projections indicatives : leur ordre peut être ajusté selon le
            tableau officiel du comité.
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
