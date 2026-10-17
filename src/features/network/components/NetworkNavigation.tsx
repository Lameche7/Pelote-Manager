import { NavLink } from "react-router-dom";

export const PILOTOKI_TESTER_URL =
  "https://pelote-manager-ltvjzizbl-guegue-team.vercel.app/pilotoki-demo/#customizer";

export function NetworkNavigation() {
  return (
    <header className="network-directory__hero-header">
      <NavLink
        to="/reseau"
        className="network-directory__brand"
        aria-label="Accueil Pilotoki"
      >
        <img src="/branding/pilotoki-wordmark.png" alt="Pilotoki" />
      </NavLink>
      <nav className="network-directory__hero-nav" aria-label="Navigation Pilotoki">
        <NavLink to="/reseau/tournois">Tournois</NavLink>
        <NavLink to="/reseau/clubs">Clubs</NavLink>
        <NavLink to="/reseau/decouvrir">Découvrir Pilotoki</NavLink>
        <NavLink to="/reseau/abonnement" className="network-directory__subscribe-link">
          S'abonner
        </NavLink>
      </nav>
    </header>
  );
}
