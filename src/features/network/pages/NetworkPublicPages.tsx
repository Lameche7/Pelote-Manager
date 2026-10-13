import { Link } from "react-router-dom";
import {
  NetworkNavigation,
  PILOTOKI_TESTER_URL,
} from "@/features/network/components/NetworkNavigation";
import "./NetworkDirectoryPage.css";

function NetworkPageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="network-directory">
      <div className="network-directory__subpage-header">
        <NetworkNavigation />
      </div>
      {children}
      <footer className="network-directory__footer">Pilotoki · Clubs et tournois</footer>
    </main>
  );
}

export function NetworkDiscoveryPage() {
  return (
    <NetworkPageShell>
      <section className="network-directory__tester">
        <div className="network-directory__subpage-heading">
          <div>
            <h1>Découvrir Pilotoki</h1>
            <p>Explorez le testeur interactif de la plateforme.</p>
          </div>
          <a href={PILOTOKI_TESTER_URL} target="_blank" rel="noopener noreferrer">
            Ouvrir le testeur en plein écran ↗
          </a>
        </div>
        <iframe
          className="network-directory__tester-frame"
          src={PILOTOKI_TESTER_URL}
          title="Testeur interactif Pilotoki"
          loading="eager"
          allow="fullscreen"
        />
        <p className="network-directory__tester-help">
          Si le testeur ne s'affiche pas dans cette page,{" "}
          <a href={PILOTOKI_TESTER_URL} target="_blank" rel="noopener noreferrer">
            ouvrez-le ici
          </a>.
          La navigation Pilotoki reste accessible en haut pour revenir aux tournois, aux clubs ou à l'abonnement.
        </p>
      </section>
    </NetworkPageShell>
  );
}

export function NetworkSubscriptionPage() {
  return (
    <NetworkPageShell>
      <section className="network-directory__section network-directory__subscription">
        <p className="network-directory__eyebrow">Rejoindre le réseau</p>
        <h1>S'abonner à Pilotoki</h1>
        <p>
          Bientôt, les clubs pourront rejoindre Pilotoki et gérer leurs activités
          depuis une plateforme commune.
        </p>
        <p>
          Les abonnements et la création de club en ligne ne sont pas encore ouverts.
          Aucun paiement n'est demandé à ce stade.
        </p>
        <Link to="/reseau/decouvrir" className="network-directory__subscription-link">
          Découvrir les fonctionnalités →
        </Link>
      </section>
    </NetworkPageShell>
  );
}
