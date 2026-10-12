import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { PublicTournamentSummary } from "@/features/tournaments/types";
import "./NetworkTournamentCatalog.css";

type Club = { name: string; slug: string; logo_url: string | null };
export type NetworkTournamentListing = {
  club: Club;
  tournament: PublicTournamentSummary;
};

type Status = "all" | "open" | "closed" | "ongoing" | "finished";
type SortOrder = "upcoming" | "recent" | "name";

const specialties = ["Tous les types", "Trinquet", "Mur à gauche", "Fronton", "Place libre", "Autre"];
const statusLabels: { key: Status; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "open", label: "Inscriptions ouvertes" },
  { key: "closed", label: "Inscriptions closes" },
  { key: "ongoing", label: "En cours" },
  { key: "finished", label: "Terminés" },
];

function tournamentStatus(tournament: PublicTournamentSummary): Exclude<Status, "all"> {
  if (tournament.status === "completed" || tournament.status === "archived") return "finished";
  if (["in_progress", "pools_generated", "pools_validated", "planning_generated", "planning_published"].includes(tournament.status)) return "ongoing";
  const now = Date.now();
  const opens = Date.parse(tournament.registrationOpensAt);
  const closes = Date.parse(tournament.registrationClosesAt);
  if (Number.isFinite(opens) && Number.isFinite(closes) && now >= opens && now < closes && tournament.status === "registrations_open") return "open";
  return "closed";
}
const labels: Record<Exclude<Status, "all">, string> = {
  open: "Ouvertes",
  closed: "Closes",
  ongoing: "En cours",
  finished: "Terminé",
};
const dateLabel = (date: string) => {
  if (!date) return "Date à préciser";
  return new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric",
  });
};

export function NetworkTournamentCatalog({
  tournaments,
  specialtiesById,
  loading,
}: {
  tournaments: NetworkTournamentListing[];
  specialtiesById: Record<string, string>;
  loading: boolean;
}) {
  const [status, setStatus] = useState<Status>("all");
  const [specialty, setSpecialty] = useState("Tous les types");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOrder>("upcoming");
  const [showSearch, setShowSearch] = useState(false);

  const counts = useMemo(() => {
    const result: Record<Status, number> = { all: tournaments.length, open: 0, closed: 0, ongoing: 0, finished: 0 };
    tournaments.forEach(({ tournament }) => { result[tournamentStatus(tournament)] += 1; });
    return result;
  }, [tournaments]);

  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("fr-FR");
    return tournaments.filter(({ club, tournament }) =>
      (status === "all" || tournamentStatus(tournament) === status) &&
      (specialty === "Tous les types" || specialtiesById[tournament.id] === specialty) &&
      (!search || `${club.name} ${tournament.name} ${specialtiesById[tournament.id] ?? ""}`.toLocaleLowerCase("fr-FR").includes(search)),
    ).sort((a, b) => {
      if (sort === "name") return a.tournament.name.localeCompare(b.tournament.name, "fr");
      const left = Date.parse(a.tournament.startsOn);
      const right = Date.parse(b.tournament.startsOn);
      const aDate = Number.isFinite(left) ? left : Number.MAX_SAFE_INTEGER;
      const bDate = Number.isFinite(right) ? right : Number.MAX_SAFE_INTEGER;
      return sort === "recent" ? bDate - aDate : aDate - bDate;
    });
  }, [tournaments, status, specialty, query, sort, specialtiesById]);

  return (
    <section className="network-directory__section network-tournaments" id="tournois">
      <div className="network-directory__section-heading">
        <div>
          <p className="network-directory__eyebrow">Compétitions</p>
          <h2>Tournois du réseau</h2>
        </div>
        <span>Recherchez votre prochain tournoi</span>
      </div>

      <div className="network-tournaments__filters" aria-label="Filtrer les tournois">
        <div className="network-tournaments__filter-row" role="group" aria-label="État des tournois">
          {statusLabels.map(({ key, label }) => (
            <button key={key} type="button" aria-pressed={status === key}
              className={status === key ? "network-tournaments__filter is-selected" : "network-tournaments__filter"}
              onClick={() => setStatus(key)}>
              {label} <span className="network-tournaments__count">{counts[key]}</span>
            </button>
          ))}
          <button type="button" className="network-tournaments__search-trigger"
            aria-label="Rechercher un tournoi" aria-expanded={showSearch}
            onClick={() => { setShowSearch(!showSearch); if (showSearch) setQuery(""); }}>⌕</button>
        </div>
        <div className="network-tournaments__filter-row" role="group" aria-label="Spécialité du tournoi">
          {specialties.map((item) => (
            <button key={item} type="button" aria-pressed={specialty === item}
              className={specialty === item ? "network-tournaments__filter is-selected" : "network-tournaments__filter"}
              onClick={() => setSpecialty(item)}>{item}</button>
          ))}
        </div>
        {showSearch && (
          <label className="network-tournaments__search">
            Recherche par tournoi ou club
            <input type="search" value={query} autoFocus
              placeholder="Ex. Lourdes, trinquet, club…" onChange={(event) => setQuery(event.target.value)} />
          </label>
        )}
      </div>

      <div className="network-tournaments__results-heading">
        <span>{filtered.length} tournoi{filtered.length > 1 ? "s" : ""}</span>
        <label>
          Trier par{" "}
          <select value={sort} onChange={(event) => setSort(event.target.value as SortOrder)}>
            <option value="upcoming">Date de début (croissante)</option>
            <option value="recent">Date de début (décroissante)</option>
            <option value="name">Nom du tournoi</option>
          </select>
        </label>
      </div>

      {loading ? <p role="status">Chargement des tournois…</p> : filtered.length === 0 ? (
        <p className="network-tournaments__empty">Aucun tournoi ne correspond à ces filtres. Essayez un autre statut ou une autre spécialité.</p>
      ) : (
        <div className="network-tournaments__cards">
          {filtered.map(({ club, tournament }) => {
            const state = tournamentStatus(tournament);
            return (
              <article className="network-tournaments__card" key={tournament.id}>
                <div className="network-tournaments__visual">
                  <span className={`network-tournaments__state network-tournaments__state--${state}`}>{labels[state]}</span>
                  {club.logo_url ? <img src={club.logo_url} alt={`Logo ${club.name}`} loading="lazy" /> : <span className="network-tournaments__monogram">{club.name.slice(0, 2).toUpperCase()}</span>}
                </div>
                <div className="network-tournaments__card-content">
                  <span className="network-tournaments__specialty">{specialtiesById[tournament.id] ?? "Spécialité à préciser"}</span>
                  <h3>{tournament.name}</h3>
                  <p>{club.name}</p>
                  <p>Dès le {dateLabel(tournament.startsOn)}</p>
                  <div className="network-tournaments__card-footer">
                    <span>{tournament.teamCount} équipes</span>
                    <Link to={`/reseau/tournois/${encodeURIComponent(tournament.id)}`}>Voir le tournoi →</Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
