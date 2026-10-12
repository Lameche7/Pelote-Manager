import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/infrastructure/supabase/client";
import { tournamentService } from "@/features/tournaments/services/tournamentService";
import { tournamentResultsService, type PublicTournamentResults } from "@/features/tournaments/services/tournamentResultsService";
import { tournamentRankingService, type TournamentRankings } from "@/features/tournaments/services/tournamentRankingService";
import { TournamentResultsBoard } from "@/features/tournaments/components/TournamentResultsBoard";
import type { PublicTournamentSummary } from "@/features/tournaments/types";
import "./NetworkDirectoryPage.css";

type ClubProfile = {
  name: string;
  slug: string;
  logo_url: string | null;
};

function NetworkHeader() {
  return (
    <header className="network-directory__header">
      <Link to="/reseau"><img src="/branding/pilotoki-wordmark.png" alt="Pilotoki Network" /></Link>
      <nav aria-label="Navigation du réseau">
        <Link to="/reseau">Accueil du réseau</Link>
      </nav>
    </header>
  );
}

export function NetworkClubPage() {
  const { clubSlug = "" } = useParams();
  const [club, setClub] = useState<ClubProfile | null>(null);
  const [tournaments, setTournaments] = useState<PublicTournamentSummary[]>([]);
  const [status, setStatus] = useState("Chargement de la fiche du club…");

  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.rpc("list_network_clubs_v2"),
      tournamentService.listPublic(clubSlug),
    ]).then(([directory, tournamentList]) => {
      if (directory.error) throw directory.error;
      if (!alive) return;
      const found = ((directory.data ?? []) as ClubProfile[]).find((item) => item.slug === clubSlug);
      setClub(found ?? null);
      setTournaments(tournamentList);
      setStatus(found ? "" : "Club introuvable dans le réseau.");
    }).catch(() => {
      if (alive) setStatus("La fiche du club est momentanément indisponible.");
    });
    return () => { alive = false; };
  }, [clubSlug]);

  return (
    <main className="network-directory">
      <NetworkHeader />
      <section className="network-directory__section network-directory__detail">
        <Link to="/reseau">← Tous les clubs et tournois</Link>
        {club ? (
          <>
            <div className="network-directory__club-heading">
              {club.logo_url && <img src={club.logo_url} alt="" className="network-directory__club-logo" />}
              <h1>{club.name}</h1>
            </div>
            <p>Club référencé dans Pilotoki Network.</p>
            <h2>Informations du club</h2>
            <p>Les coordonnées et renseignements administratifs seront publiés ici après validation par le club.</p>
            <h2>Tournois du club</h2>
            <div className="network-directory__grid">
              {tournaments.filter((item) => item.status !== "archived" && item.status !== "cancelled").map((item) => (
                <Link className="network-directory__card network-directory__detail-link" key={item.id}
                  to={`/reseau/tournois/${encodeURIComponent(item.id)}`}>
                  <strong>{item.name}</strong>
                  <span>{item.teamCount} équipes · {item.series.length} séries</span>
                  <span>Voir les poules, classements et résultats →</span>
                </Link>
              ))}
            </div>
          </>
        ) : <p role="status">{status}</p>}
      </section>
    </main>
  );
}

export function NetworkTournamentPage() {
  const { tournamentId = "" } = useParams();
  const [summary, setSummary] = useState<PublicTournamentSummary | null>(null);
  const [results, setResults] = useState<PublicTournamentResults | null>(null);
  const [rankings, setRankings] = useState<TournamentRankings | null>(null);
  const [status, setStatus] = useState("Chargement du tournoi…");

  useEffect(() => {
    let alive = true;
    Promise.all([
      tournamentService.listPublic(),
      tournamentResultsService.get(tournamentId),
      tournamentRankingService.get(tournamentId),
    ]).then(([list, publicResults, publicRankings]) => {
      if (!alive) return;
      const found = list.find((item) => item.id === tournamentId) ?? null;
      setSummary(found);
      setResults(found ? publicResults : null);
      setRankings(found ? publicRankings : null);
      setStatus(found ? "" : "Tournoi introuvable ou non publié.");
    }).catch(() => {
      if (alive) setStatus("Les informations de ce tournoi sont momentanément indisponibles.");
    });
    return () => { alive = false; };
  }, [tournamentId]);

  const registrationState = summary ? (
    !summary.registrationOpensAt || !summary.registrationClosesAt ? "Dates à confirmer" :
    Date.now() < new Date(summary.registrationOpensAt).getTime() ? "À venir" :
    Date.now() > new Date(summary.registrationClosesAt).getTime() ? "Closes" : "Ouvertes"
  ) : "";

  return (
    <main className="network-directory">
      <NetworkHeader />
      <section className="network-directory__section network-directory__detail">
        <Link to="/reseau">← Retour aux tournois du réseau</Link>
        {summary ? (
          <>
            <p className="network-directory__eyebrow">Tournoi du réseau</p>
            <h1>{summary.name}</h1>
            <p>{summary.teamCount} équipes · {summary.series.length} séries</p>
            <div className="network-directory__registration">
              <h2>Inscriptions au tournoi</h2>
              <p>Statut : {registrationState}</p>
              <p>Les inscriptions seront accessibles dans Pilotoki Network dès que le parcours multiclub sera activé.</p>
            </div>
            {results && rankings ? (
              <div className="network-directory__results">
                <TournamentResultsBoard results={results} rankings={rankings} />
              </div>
            ) : (
              <p>Les poules, classements et résultats apparaîtront dès leur publication.</p>
            )}
          </>
        ) : <p role="status">{status}</p>}
      </section>
    </main>
  );
}
