import { Link } from "react-router-dom";
import { NetworkHero } from "@/features/network/components/NetworkHero";
import "./NetworkDirectoryPage.css";

function NetworkPageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="network-directory">
      <NetworkHero variant="subscription" />
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
