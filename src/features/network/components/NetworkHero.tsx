import { Link } from "react-router-dom";
import { NetworkNavigation } from "./NetworkNavigation";

export function NetworkHero({
  variant = "default",
}: {
  variant?: "default" | "discovery" | "subscription";
}) {
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
        {variant === "subscription" ? (
          <>
            <h1>S'abonner à Pilotoki</h1>
            <p>
              Rejoignez le réseau Pilotoki et découvrez une nouvelle façon de
              gérer votre club.
            </p>
          </>
        ) : variant === "discovery" ? (
          <>
            <h1>Découvrez tout ce que Pilotoki peut faire pour votre club.</h1>
            <p>
              Un testeur interactif intégré à Pilotoki. Explorez librement les
              fonctionnalités côté joueur et côté administrateur.
            </p>
          </>
        ) : (
          <>
            <h1>
              La plateforme des <span>clubs de pelote</span>
            </h1>
            <p>
              Réservations, tournois, championnats, arbitrage et communication
              club dans un seul outil.
            </p>
            <div className="network-directory__hero-actions">
              <Link
                to="/reseau/decouvrir"
                className="network-directory__hero-primary"
              >
                Découvrir Pilotoki →
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
