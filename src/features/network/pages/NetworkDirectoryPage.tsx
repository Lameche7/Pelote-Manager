import { useEffect, useState } from "react";
import { supabase } from "@/infrastructure/supabase/client";
import { tournamentService } from "@/features/tournaments/services/tournamentService";
import type { PublicTournamentSummary } from "@/features/tournaments/types";
import "./NetworkDirectoryPage.css";

type Club = { name: string; slug: string };
type TournamentListing = { club: Club; tournament: PublicTournamentSummary };

export function NetworkDirectoryPage() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [tournaments, setTournaments] = useState<TournamentListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let current = true;
    async function load() {
      try {
        const { data, error: directoryError } = await supabase.rpc("list_network_clubs");
        if (directoryError) throw directoryError;
        const directory = ((data ?? []) as Club[]).filter(
          (club) => typeof club.slug === "string" && typeof club.name === "string",
        );
        const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
        const lists = await Promise.allSettled(
          directory.map((club) => tournamentService.listPublic(club.slug)),
        );
        if (!current) return;
        setClubs(directory);
        setTournaments(lists.flatMap((result, index) => (
          result.status === "fulfilled"
            ? result.value
              .filter((tournament) =>
                tournament.endsOn >= today && tournament.status !== "archived"
              )
              .map((tournament) => ({ club: directory[index], tournament }))
            : []
        )));
        setError(lists.some((result) => result.status === "rejected"));
      } catch {
        if (current) setError(true);
      } finally {
        if (current) setLoading(false);
      }
    }
    void load();
    return () => { current = false; };
  }, []);

  return (
    <main className="network-directory">
      <header className="network-directory__header">
        <a href="https://app.pelotemanager.fr/" aria-label="Retour à Pilotoki">
          <img src="/branding/pilotoki-wordmark.png" alt="Pilotoki" />
        </a>
        <span>Le réseau des clubs</span>
      </header>
      <section className="network-directory__hero">
        <p className="network-directory__eyebrow">Pilotoki Network</p>
        <h1>Les clubs et leurs tournois, au même endroit.</h1>
        <p>Découvrez les clubs présents sur Pilotoki et leurs compétitions en cours.</p>
        <p>Création de club sur abonnement : prochainement disponible.</p>
        <p className="network-directory__note">L'ouverture automatique après abonnement sera disponible prochainement. Aucun paiement n'est demandé ici.</p>
      </section>
      <section className="network-directory__section">
        <h2>Tournois en cours et à venir</h2>
        {loading ? <p>Chargement des tournois…</p> : tournaments.length ? (
          <div className="network-directory__grid">
            {tournaments.map(({ club, tournament }) => (
              <article className="network-directory__card" key={tournament.id}>
                <span className="network-directory__eyebrow">{club.name}</span>
                <h3>{tournament.name}</h3>
                <p>Du {tournament.startsOn} au {tournament.endsOn}</p>
              </article>
            ))}
          </div>
        ) : <p>Aucun tournoi public en cours pour le moment.</p>}
      </section>
      <section className="network-directory__section">
        <h2>Clubs du réseau</h2>
        {loading ? <p>Chargement des clubs…</p> : clubs.length ? (
          <div className="network-directory__grid">
            {clubs.map((club) => (
              <article key={club.slug} className="network-directory__card">
                <h3>{club.name}</h3>
                <p>Club référencé sur Pilotoki</p>
              </article>
            ))}
          </div>
        ) : <p>Aucun club disponible pour le moment.</p>}
        {error && <p role="alert">Une partie du catalogue est temporairement indisponible.</p>}
      </section>
      <footer className="network-directory__footer">
        <a href="https://app.pelotemanager.fr/">Accéder à l'application des joueurs de Lourdes</a>
      </footer>
    </main>
  );
}
