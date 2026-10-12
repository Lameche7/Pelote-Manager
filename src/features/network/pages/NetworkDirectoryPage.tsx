import { useEffect, useState } from "react";
import { supabase } from "@/infrastructure/supabase/client";
import { tournamentService } from "@/features/tournaments/services/tournamentService";
import type { PublicTournamentSummary } from "@/features/tournaments/types";
import "./NetworkDirectoryPage.css";

type Club = { name: string; slug: string; logo_url: string | null };
type TournamentListing = { club: Club; tournament: PublicTournamentSummary };
const LOURDES_SLUG = "pelotaris-club-lourdais";
const formatDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export function NetworkDirectoryPage() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [tournaments, setTournaments] = useState<TournamentListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let current = true;
    async function load() {
      try {
        const { data, error: directoryError } = await supabase.rpc(
          "list_network_clubs_v2",
        );
        if (directoryError) throw directoryError;
        const directory = ((data ?? []) as Club[]).filter(
          (club) =>
            typeof club.slug === "string" && typeof club.name === "string",
        );
        const lists = await Promise.allSettled(
          directory.map((club) => tournamentService.listPublic(club.slug)),
        );
        if (!current) return;
        setClubs(directory);
        setTournaments(
          lists.flatMap((result, index) =>
            result.status === "fulfilled"
              ? result.value
                  .filter(
                    (tournament) =>
                      tournament.status !== "archived" &&
                      tournament.status !== "cancelled",
                  )
                  .map((tournament) => ({ club: directory[index], tournament }))
              : [],
          ),
        );
        setError(lists.some((result) => result.status === "rejected"));
      } catch {
        if (current) setError(true);
      } finally {
        if (current) setLoading(false);
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, []);

  const clubLogo = (club: Club) =>
    club.logo_url  (
      <img
        className="network-directory__club-logo"
        src={club.logo_url}
        alt={`Logo ${club.name}`}
        loading="lazy"
      />
    ) : (
      <span className="network-directory__club-placeholder" aria-hidden="true">
        {club.name.slice(0, 2).toUpperCase()}
      </span>
    );

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
        <h1>La pelote se retrouve ici.</h1>
        <p>
          Découvrez les clubs, les tournois, les poules, les classements et les
          résultats.
        </p>
        <p className="network-directory__note">
          Rejoindre le réseau en créant son club : bientôt disponible.
        </p>
      </section>

      <section className="network-directory__section">
        <div className="network-directory__section-heading">
          <div>
            <p className="network-directory__eyebrow">Compétitions</p>
            <h2>Tournois du réseau</h2>
          </div>
          <span>
            {tournaments.length} tournoi{tournaments.length > 1 ? "s" : ""}
          </span>
        </div>
        {loading  (
          <p>Chargement des tournois…</p>
        ) : tournaments.length ? (
          <div className="network-directory__grid">
            {tournaments.map(({ club, tournament }) => (
              <article
                className="network-directory__card"
                key={`${club.slug}-${tournament.id}`}
              >
                <div className="network-directory__club-heading">
                  {clubLogo(club)}
                  <span>{club.name}</span>
                </div>
                <span className="network-directory__status">
                  Tournoi publié
                </span>
                <h3>{tournament.name}</h3>
                <p>Début : {formatDate(tournament.startsOn)}</p>
                <p className="network-directory__date-note">
                  Fin de la phase de poules : {formatDate(tournament.endsOn)}
                </p>
                <p className="network-directory__date-note">
                  Fin du tournoi : à confirmer (phase finale non datée)
                </p>
                <div className="network-directory__meta">
                  <span>{tournament.teamCount} équipes</span>
                  <span>{tournament.series.length} séries</span>
                </div>
                {club.slug === LOURDES_SLUG  (
                  <a
                    className="network-directory__action"
                    href={`https://app.pelotemanager.fr/tournois/${encodeURIComponent(tournament.id)}`}
                  >
                    Voir les poules, classements et résultats →
                  </a>
                ) : (
                  <p className="network-directory__date-note">
                    Consultation détaillée bientôt disponible pour ce club
                  </p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p>Aucun tournoi publié pour le moment.</p>
        )}
      </section>

      <section className="network-directory__section">
        <div className="network-directory__section-heading">
          <div>
            <p className="network-directory__eyebrow">Communauté</p>
            <h2>Clubs du réseau</h2>
          </div>
          <span>
            {clubs.length} club{clubs.length > 1  "s" : ""}
          </span>
        </div>
        {loading ? (
          <p>Chargement des clubs…</p>
        ) : clubs.length  (
          <div className="network-directory__grid">
            {clubs.map((club) => (
              <article
                key={club.slug}
                className="network-directory__card network-directory__club-card"
              >
                {clubLogo(club)}
                <div>
                  <h3>{club.name}</h3>
                  <p>Club référencé sur Pilotoki</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p>Aucun club disponible pour le moment.</p>
        )}
        {error && (
          <p role="alert">
            Une partie du catalogue est temporairement indisponible.
          </p>
        )}
      </section>
      <footer className="network-directory__footer">
        <a href="https://app.pelotemanager.fr/">
          Accéder à l'application des joueurs de Lourdes
        </a>
      </footer>
    </main>
  );
}
