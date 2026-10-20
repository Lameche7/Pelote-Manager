import { Link } from "react-router-dom";
import { NetworkHero } from "@/features/network/components/NetworkHero";
import "./NetworkDirectoryPage.css";

function NetworkPageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="network-directory">
      <NetworkHero />
      {children}
      <footer className="network-directory__footer">
        Pilotoki · Clubs et tournois
      </footer>
    </main>
  );
}

export { NetworkDiscoveryPage } from "./NetworkDiscoveryDemoPage";

export function NetworkSubscriptionPage() {
  return (
    <NetworkPageShell>
      <section className="network-directory__section network-directory__subscription">
        <p className="network-directory__eyebrow">Rejoindre le réseau</p>
        <h1>S'abonner à Pilotoki</h1>
        <p>
          Bientôt, les clubs pourront rejoindre Pilotoki et gérer leurs
          activités depuis une plateforme commune.
        </p>
        <p>
          Les abonnements et la création de club en ligne ne sont pas encore
          ouverts. Aucun paiement n'est demandé à ce stade.
        </p>
        <Link
          to="/reseau/decouvrir"
          className="network-directory__subscription-link"
        >
          Découvrir les fonctionnalités →
        </Link>
      </section>
    </NetworkPageShell>
  );
}
