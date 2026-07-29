import { Link } from "react-router-dom";
import { ClubLogo } from "@/shared/components/ClubLogo";
import { ROUTES } from "@/shared/config";

const benefits = [
  { icon: "▦", title: "Réservations simples", text: "Consultez les disponibilités et réservez en quelques instants." },
  { icon: "✓", title: "Paiement sécurisé", text: "Suivez le statut de votre réservation et de votre règlement." },
  { icon: "◉", title: "Infos en direct", text: "Retrouvez la vie du trinquet et les actualités du club." },
  { icon: "◎", title: "Club & communauté", text: "Un seul espace pour les joueurs, licenciés et dirigeants." },
];

export function HomePage() {
  return (
    <div className="home-page">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero__court" aria-hidden="true">
          <span className="home-hero__line home-hero__line--one" />
          <span className="home-hero__line home-hero__line--two" />
          <span className="home-hero__line home-hero__line--three" />
        </div>
        <div className="home-hero__content">
          <ClubLogo className="home-hero__logo" />
          <p className="home-hero__eyebrow">Pelotaris Club Lourdais</p>
          <h1 id="home-title">Pelote Manager</h1>
          <p className="home-hero__signature">
            Depuis <strong>1957</strong> – Plus qu’un Club, une Histoire.
          </p>
          <div className="home-hero__actions">
            <Link className="button button--primary" to={ROUTES.reservations}>
              <span aria-hidden="true">▦</span> Réserver un créneau
            </Link>
            <Link className="button button--secondary" to={ROUTES.login}>
              <span aria-hidden="true">♙</span> Accéder à mon compte
            </Link>
          </div>
        </div>
      </section>

      <section className="home-benefits" aria-label="Services Pelote Manager">
        <div className="home-benefits__grid">
          {benefits.map((benefit) => (
            <article className="benefit-card" key={benefit.title}>
              <span className="benefit-card__icon" aria-hidden="true">{benefit.icon}</span>
              <div>
                <h2>{benefit.title}</h2>
                <p>{benefit.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="home-intro">
        <p className="section-kicker">Trinquet Robert Cathala · Lourdes</p>
        <h2>Votre club, simplement connecté.</h2>
        <p>
          Pelote Manager rassemble les réservations, les paiements et bientôt les informations du club dans une interface claire, accessible sur ordinateur, mobile et écran TV.
        </p>
        <Link className="text-link" to={ROUTES.reservations}>Voir les créneaux disponibles →</Link>
      </section>
    </div>
  );
}
