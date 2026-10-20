import { Link } from "react-router-dom";
import { NetworkNavigation } from "./NetworkNavigation";

export function NetworkHero() {
  return (
    <section
      className="network-directory__hero network-directory__hero--photo"
      id="accueil"
      style={{
        backgroundImage:
          'linear-gradient(90deg, rgba(5, 33, 27, .94) 0%, rgba(5, 33, 27, .72) 45%, rgba(5, 33, 27, .04) 100%), url("/branding/pilotoki-hero-hd.webp")',
      }}
    >
      <NetworkNavigation />
      <div className="network-directory__hero-copy">
        <h1>
          La plateforme des <span>clubs de pelote</span>
        </h1>
        <p>
          Réservations, tournois, championnats, arbitrage et communication club
          dans un seul outil.
        </p>
        <div className="network-directory__hero-actions">
          <Link to="/reseau/decouvrir" className="network-directory__hero-primary">
            Découvrir Pilotoki →
          </Link>
        </div>
      </div>
    </section>
  );
}
