import { useEffect, useMemo, useState } from "react";
import { Trophy } from "lucide-react";
import { championshipResultsService, type ChampionshipBrowserMatch, type ChampionshipResultsCatalogItem } from "@/features/user-space/championships/services/championshipResultsService";
import "./ChampionshipFinalBracket.css";

const roundNames = ["Barrage", "32es de finale", "16es de finale", "8es de finale", "Quarts de finale", "Demi-finales", "Finale"];
const roundIndex = (phase: string) => {
  const p = phase.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/barrage/.test(p)) return 0;
  if (/32/.test(p)) return 1;
  if (/16/.test(p)) return 2;
  if (/1\s*\/\s*8|8eme|huitieme/.test(p)) return 3;
  if (/1\s*\/\s*4|quart/.test(p)) return 4;
  if (/1\s*\/\s*2|demi/.test(p)) return 5;
  if (/final/.test(p) && !/phase|poule/.test(p)) return 6;
  return -1;
};
const score = (match: ChampionshipBrowserMatch, side: 1 | 2) =>
  (side === 1 ? match.displayedScoreTeam1 : match.displayedScoreTeam2) ?? "—";

export function ChampionshipFinalBracket({ preferredChampionshipId, preferredDivisionId }: { preferredChampionshipId?: string | null; preferredDivisionId?: string | null }) {
  const [catalog, setCatalog] = useState<ChampionshipResultsCatalogItem[]>([]);
  const [championshipId, setChampionshipId] = useState("");
  const [divisionId, setDivisionId] = useState("");
  const [matches, setMatches] = useState<ChampionshipBrowserMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ChampionshipBrowserMatch | null>(null);

  useEffect(() => {
    let active = true;
    championshipResultsService.listCatalog().then(items => {
      if (!active) return;
      setCatalog(items);
      setChampionshipId(items.find(x => x.championshipId === preferredChampionshipId)?.championshipId ?? items.find(x => x.hasMyTeam)?.championshipId ?? items[0]?.championshipId ?? "");
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Impossible de charger les championnats."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [preferredChampionshipId]);

  const championship = catalog.find(x => x.championshipId === championshipId);
  useEffect(() => {
    const division = championship?.divisions.find(x => x.id === preferredDivisionId) ??
      championship?.divisions.find(x => championship.myDivisionIds.includes(x.id)) ?? championship?.divisions[0];
    setDivisionId(division?.id ?? "");
  }, [championship, preferredDivisionId]);

  useEffect(() => {
    if (!championshipId) return;
    let active = true;
    setLoading(true);
    setError("");
    setMatches([]);
    setSelected(null);
    championshipResultsService.listMatches(championshipId).then(items => { if (active) setMatches(items); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : "Impossible de charger les phases finales."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [championshipId]);

  const rounds = useMemo(() => roundNames.map((name, index) => ({
    name, matches: matches.filter(m => m.divisionId === divisionId && roundIndex(m.phase) === index)
      .sort((a, b) => (a.theoreticalOn ?? "").localeCompare(b.theoreticalOn ?? "") || a.matchId.localeCompare(b.matchId)),
  })).filter(r => r.matches.length), [matches, divisionId]);

  return <section className="championship-bracket" aria-label="Tableau des phases finales">
    <header><Trophy aria-hidden="true" /><div><h2>Phases finales</h2><p>Suivez toutes les rencontres de chaque série jusqu’à la finale. Les équipes de votre club sont mises en évidence.</p></div></header>
    <div className="championship-bracket__filters">
      <label>Championnat<select value={championshipId} onChange={e => setChampionshipId(e.target.value)}>{catalog.map(c => <option key={c.championshipId} value={c.championshipId}>{c.seasonLabel} · {c.championshipName}</option>)}</select></label>
      <label>Série<select value={divisionId} onChange={e => { setDivisionId(e.target.value); setSelected(null); }}>{championship?.divisions.map(d => <option key={d.id} value={d.id}>{d.name}{championship.myDivisionIds.includes(d.id) ? " · Mon club" : ""}</option>)}</select></label>
    </div>
    {error ? <p role="alert">{error}</p> : loading ? <p>Chargement du tableau…</p> : rounds.length === 0 ? <p>Le tableau des phases finales n’est pas encore disponible pour cette série.</p> : <>
      <p className="championship-bracket__hint">Faites défiler horizontalement pour parcourir les tours. Touchez une rencontre pour voir son détail.</p>
      <div className="championship-bracket__scroll" tabIndex={0} aria-label="Tableau des tours éliminatoires">
        {rounds.map(round => <div className="championship-bracket__round" key={round.name}>
          <h3>{round.name}</h3>
          {round.matches.map(m => <button type="button" key={m.matchId} className="championship-bracket__match" onClick={() => setSelected(m)} aria-label={m.team1Label + " contre " + m.team2Label}>
            <span className={m.team1IsMyClub ? "is-club" : ""}><strong>{m.team1Label}</strong><b>{score(m, 1)}</b></span>
            <span className={m.team2IsMyClub ? "is-club" : ""}><strong>{m.team2Label}</strong><b>{score(m, 2)}</b></span>
            <small>{m.effectiveOn ?? m.theoreticalOn ?? "Date à définir"} · {m.resultSource === "official" ? "Officiel" : m.resultSource === "proposed" ? "Proposé" : "À jouer"}</small>
          </button>)}
        </div>)}
      </div>
      <p className="championship-bracket__hint">Les rencontres sont regroupées par tour officiel. Les liaisons entre matchs seront tracées lorsque leur correspondance sera confirmée par la source fédérale.</p>
      {selected && <div className="championship-bracket__detail" role="region" aria-label="Détail de la rencontre">
        <button type="button" onClick={() => setSelected(null)}>Fermer ×</button>
        <h3>{selected.team1Label} – {selected.team2Label}</h3>
        <p>{selected.team1Players.join(" / ") || selected.team1ClubName} contre {selected.team2Players.join(" / ") || selected.team2ClubName}</p>
        <p>Score : {score(selected, 1)} – {score(selected, 2)} · {selected.resultSource === "official" ? "Résultat officiel" : selected.resultSource === "proposed" ? "Résultat proposé" : "En attente"}</p>
        <p>{selected.effectiveOn ?? selected.theoreticalOn ?? "Date à définir"} {selected.effectiveTime?.slice(0, 5) ?? ""} · {selected.venue ?? "Lieu à définir"}</p>
      </div>}
    </>}
  </section>;
}
