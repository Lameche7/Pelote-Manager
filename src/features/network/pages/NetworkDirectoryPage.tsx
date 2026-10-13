import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/infrastructure/supabase/client";
import { tournamentService } from "@/features/tournaments/services/tournamentService";
import { NetworkTournamentCatalog } from "@/features/network/components/NetworkTournamentCatalog";
import type { NetworkTournamentListing } from "@/features/network/components/NetworkTournamentCatalog";
import "./NetworkDirectoryPage.css";

type Club = { name: string; slug: string; logo_url: string | null; hero_image_url: string | null };

export function NetworkDirectoryPage() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [tournaments, setTournaments] = useState<NetworkTournamentListing[]>(
    [],
  );
  const [specialties, setSpecialties] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let current = true;
    async function load() {
      try {
        const { data, error: directoryError } = await supabase.rpc(
          "list_network_clubs_v3",
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
        const { data: specialtyRows } = await supabase
          .from("network_tournament_profiles")
          .select("tournament_id,specialty");
        if (current)
          setSpecialties(
            Object.fromEntries(
              (specialtyRows ?? [])
                .filter((item) => item.specialty)
                .map((item) => [item.tournament_id, item.specialty as string]),
            ),
          );
        setTournaments(
          lists.flatMap((result, index) =>
            result.status === "fulfilled"
              ? result.value
                  .filter((tournament) => tournament.status !== "cancelled")
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
    club.logo_url ? (
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
      <section className="network-directory__hero" id="accueil">
        <header className="network-directory__hero-header">
          <Link
            to="/reseau"
            className="network-directory__brand"
            aria-label="Accueil Pilotoki"
          >
            <img src="/branding/pilotoki-wordmark.png" alt="Pilotoki" />
          </Link>
          <nav
            className="network-directory__hero-nav"
            aria-label="Navigation Pilotoki"
          >
            <a href="#tournois">Tournois</a>
            <a href="#clubs">Clubs</a>
            <a href="https://pelote-manager-ltvjzizbl-guegue-team.vercel.app/pilotoki-demo/#customizer">Découvrir Pilotoki</a>
            <a href="#abonnement" className="network-directory__subscribe-link">
              S'abonner
            </a>
          </nav>
        </header>
        <h1>La pelote se retrouve ici.</h1>
        <p>
          Découvrez les clubs, les tournois, les poules, les classements et les
          résultats.
        </p>
      </section>

      <NetworkTournamentCatalog
        tournaments={tournaments}
        specialtiesById={specialties}
        loading={loading}
      />

      <section className="network-directory__section" id="clubs">
        <div className="network-directory__section-heading">
          <div>
            <p className="network-directory__eyebrow">Communauté</p>
            <h2>Clubs du réseau</h2>
          </div>
          <span>
            {clubs.length} club{clubs.length > 1 ? "s" : ""}
          </span>
        </div>
        {loading ? (
          <p>Chargement des clubs…</p>
        ) : clubs.length ? (
          <div className="network-directory__grid">
            {clubs.map((club) => (
              <Link
                key={club.slug}
                to={`/reseau/clubs/${encodeURIComponent(club.slug)}`}
                className="network-directory__card network-directory__club-card"
              >
                {clubLogo(club)}
                <div>
                  <h3>{club.name}</h3>
                  <p>Club référencé sur Pilotoki</p>
                </div>
              </Link>
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
      <section
        className="network-directory__section network-directory__info-sections"
        id="decouvrir"
      >
        <div>
          <p className="network-directory__eyebrow">La plateforme</p>
          <h2>Découvrir Pilotoki</h2>
          <p>
            Pilotoki rassemble la vie des clubs de pelote : tournois, poules,
            résultats, classements et informations des clubs, dans un réseau
            accessible à tous.
          </p>
        </div>
        <div id="abonnement">
          <p className="network-directory__eyebrow">Rejoindre le réseau</p>
          <h2>S'abonner à Pilotoki</h2>
          <p>
            La création de club et la souscription en ligne arriveront
            prochainement. Aucun paiement n'est demandé sur cette page pour le
            moment.
          </p>
        </div>
      </section>
      <footer className="network-directory__footer">
        Pilotoki · Clubs et tournois
      </footer>
    </main>
  );
}
