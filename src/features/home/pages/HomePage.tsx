import { Link } from "react-router-dom";
import { ClubLogo } from "@/shared/components/ClubLogo";
import { CLUB_CONFIG, ROUTES } from "@/shared/config";
import "./PremiumHomePage.css";

const benefits = [
  {
    icon: "▦",
    title: "Réservations simples",
    text: "Consultez les disponibilités et réservez en quelques instants.",
  },
  {
    icon: "✓",
    title: "Paiement sécurisé",
    text: "Réglez vos réservations en ligne en toute sécurité.",
  },
  {
    icon: "◉",
    title: "Infos en direct",
    text: "Retrouvez la vie des installations et les actualités du club.",
  },
  {
    icon: "◎",
    title: "Club & communauté",
    text: "Un seul espace pour les joueurs, licenciés et dirigeants.",
  },
];

export function HomePage() {
  const venueLabel = [CLUB_CONFIG.venueName, CLUB_CONFIG.location]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="premium-home">
      <section className="premium-home__hero" aria-labelledby="home-title">
        <div className="premium-home__veil" aria-hidden="true" />
        <div className="premium-home__content">
          <ClubLogo className="premium-home__logo" />
          <p className="premium-home__eyebrow">{CLUB_CONFIG.name}</p>
          <h1 id="home-title">Pelote Manager</h1>
          <p className="premium-home__signature">
            {CLUB_CONFIG.foundedYear && (
              <>
                Depuis <strong>{CLUB_CONFIG.foundedYear}</strong> –{" "}
              </>
            )}
            {CLUB_CONFIG.tagline}
          </p>
          <div className="premium-home__actions">
            <Link className="button button--primary" to={ROUTES.reservations}>
              ▦ Réserver un créneau
            </Link>
            <Link className="button button--secondary" to={ROUTES.login}>
              ♙ Accéder à mon compte
            </Link>
          </div>
        </div>
      </section>

      <section
        className="premium-home__benefits"
        aria-label="Services Pelote Manager"
      >
        <div className="premium-home__benefit-grid">
          {benefits.map((benefit) => (
            <article className="premium-benefit" key={benefit.title}>
              <span className="premium-benefit__icon" aria-hidden="true">
                {benefit.icon}
              </span>
              <div>
                <h2>{benefit.title}</h2>
                <p>{benefit.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="premium-home__club">
        <div className="premium-home__club-card">
          <ClubLogo className="premium-home__club-logo" />
          <div>
            <p className="section-kicker">{venueLabel}</p>
            <h2>Le club, notre passion.</h2>
            <p>{CLUB_CONFIG.description}</p>
            <Link className="text-link" to={ROUTES.reservations}>
              Voir les créneaux disponibles →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
