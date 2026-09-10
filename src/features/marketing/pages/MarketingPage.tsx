import { useEffect } from "react";
import {
  ArrowRight,
  BarChart3,
  BellRing,
  CalendarDays,
  CheckCircle2,
  MonitorPlay,
  ShieldCheck,
  Smartphone,
  Trophy,
  Users,
} from "lucide-react";
import { APP_HOST, applicationOrigin } from "@/shared/config/domains";
import "./MarketingPage.css";

const features = [
  {
    icon: CalendarDays,
    title: "Réservations",
    text: "Planning des installations, créneaux disponibles, règles d’accès, tarifs et suivi des réservations dans un même espace.",
  },
  {
    icon: Trophy,
    title: "Tournois",
    text: "Inscriptions, équipes, poules, planning, résultats, classements, qualifications et phases finales jusqu’au tableau final.",
  },
  {
    icon: ShieldCheck,
    title: "Championnats",
    text: "Import des compétitions, calendrier des équipes, résultats, classements officiels et espace personnel pour chaque joueur.",
  },
  {
    icon: Users,
    title: "Licenciés & club",
    text: "Base membres, profils, rôles, droits d’administration et informations du club centralisés et faciles à retrouver.",
  },
  {
    icon: BellRing,
    title: "Communication",
    text: "Informations du club et notifications ciblées pour prévenir les joueurs au bon moment et les ramener directement vers l’action utile.",
  },
  {
    icon: MonitorPlay,
    title: "Mode TV",
    text: "Affichage grand écran pour faire vivre les compétitions et les informations du club au trinquet, sans ressaisie spécifique.",
  },
];

const audiences = [
  {
    eyebrow: "Pour les joueurs",
    title: "Le club dans la poche.",
    text: "Réserver, retrouver ses prochaines parties, suivre ses tournois et championnats, recevoir les informations utiles et accéder à son historique depuis un seul compte.",
    points: [
      "Une interface pensée pour le téléphone",
      "Des informations personnelles au bon endroit",
      "Une application web installable sans passer par un store",
    ],
  },
  {
    eyebrow: "Pour les dirigeants",
    title: "Une administration enfin réunie.",
    text: "Pelote Manager rapproche les tâches qui vivent habituellement dans plusieurs fichiers, formulaires, messages et outils différents.",
    points: [
      "Gestion quotidienne du club",
      "Pilotage des tournois et compétitions",
      "Droits d’accès, suivi et statistiques",
    ],
  },
];

function getAppOrigin() {
  if (typeof window === "undefined") return `https://${APP_HOST}`;
  return applicationOrigin(window.location.hostname, window.location.origin);
}

export function MarketingPage() {
  const appOrigin = getAppOrigin();

  useEffect(() => {
    document.title = "Pelote Manager · La plateforme des clubs de pelote";
    const description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    description?.setAttribute(
      "content",
      "Pelote Manager réunit réservations, licenciés, tournois, championnats, communication et administration dans une seule application pour les clubs de pelote.",
    );
  }, []);

  return (
    <div className="marketing-site">
      <header className="marketing-header">
        <a
          className="marketing-brand"
          href="#accueil"
          aria-label="Pelote Manager - Accueil"
        >
          <span className="marketing-brand__mark" aria-hidden="true">
            PM
          </span>
          <span>
            <strong>Pelote Manager</strong>
            <small>La plateforme des clubs de pelote</small>
          </span>
        </a>
        <nav className="marketing-nav" aria-label="Navigation du site">
          <a href="#fonctionnalites">Fonctionnalités</a>
          <a href="#pour-qui">Pour qui ?</a>
          <a href="#vision">La plateforme</a>
          <a className="marketing-nav__app" href={appOrigin}>
            Ouvrir l’application
          </a>
        </nav>
      </header>

      <main>
        <section className="marketing-hero" id="accueil">
          <div className="marketing-hero__copy">
            <p className="marketing-kicker">
              Pensé pour la pelote. Construit pour les clubs.
            </p>
            <h1>
              Toute la vie du club.
              <span> Un seul endroit.</span>
            </h1>
            <p className="marketing-hero__lead">
              Pelote Manager réunit réservations, licenciés, tournois,
              championnats et communication dans une plateforme simple à
              utiliser pour les joueurs comme pour les dirigeants.
            </p>
            <div className="marketing-hero__actions">
              <a
                className="marketing-button marketing-button--primary"
                href={appOrigin}
              >
                <Smartphone aria-hidden="true" />
                Ouvrir Pelote Manager
                <ArrowRight aria-hidden="true" />
              </a>
              <a
                className="marketing-button marketing-button--secondary"
                href="#fonctionnalites"
              >
                Découvrir les fonctionnalités
              </a>
            </div>
            <p className="marketing-hero__install">
              Application web installable sur téléphone, tablette et
              ordinateur.
            </p>
          </div>

          <div
            className="marketing-product"
            aria-label="Aperçu des modules Pelote Manager"
          >
            <div className="marketing-product__topbar">
              <span className="marketing-product__logo">PM</span>
              <div>
                <strong>Pelote Manager</strong>
                <small>Tableau de bord du club</small>
              </div>
              <span className="marketing-product__status">En ligne</span>
            </div>
            <div className="marketing-product__grid">
              <article className="marketing-mini-card marketing-mini-card--wide">
                <CalendarDays aria-hidden="true" />
                <div>
                  <small>Aujourd’hui</small>
                  <strong>Réservations</strong>
                  <span>Créneaux et terrains au même endroit</span>
                </div>
              </article>
              <article className="marketing-mini-card">
                <Trophy aria-hidden="true" />
                <small>Compétitions</small>
                <strong>Tournois</strong>
              </article>
              <article className="marketing-mini-card">
                <ShieldCheck aria-hidden="true" />
                <small>Équipes</small>
                <strong>Championnats</strong>
              </article>
              <article className="marketing-mini-card">
                <Users aria-hidden="true" />
                <small>Communauté</small>
                <strong>Licenciés</strong>
              </article>
              <article className="marketing-mini-card">
                <BarChart3 aria-hidden="true" />
                <small>Pilotage</small>
                <strong>Statistiques</strong>
              </article>
            </div>
          </div>
        </section>

        <section
          className="marketing-proof"
          aria-label="Principes de Pelote Manager"
        >
          <span>Une seule identité joueur</span>
          <span>Une seule administration club</span>
          <span>Une expérience mobile et bureau</span>
        </section>

        <section className="marketing-section" id="fonctionnalites">
          <header className="marketing-section__heading">
            <p className="marketing-kicker">Fonctionnalités</p>
            <h2>Un outil qui suit réellement la vie d’un club.</h2>
            <p>
              Chaque module communique avec les autres pour éviter les doubles
              saisies et garder joueurs, organisateurs et dirigeants sur la même
              information.
            </p>
          </header>
          <div className="marketing-feature-grid">
            {features.map(({ icon: Icon, title, text }) => (
              <article className="marketing-feature" key={title}>
                <span className="marketing-feature__icon">
                  <Icon aria-hidden="true" />
                </span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="marketing-audiences" id="pour-qui">
          {audiences.map((audience) => (
            <article className="marketing-audience" key={audience.eyebrow}>
              <p className="marketing-kicker">{audience.eyebrow}</p>
              <h2>{audience.title}</h2>
              <p>{audience.text}</p>
              <ul>
                {audience.points.map((point) => (
                  <li key={point}>
                    <CheckCircle2 aria-hidden="true" />
                    {point}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        <section className="marketing-platform" id="vision">
          <div>
            <p className="marketing-kicker">
              Une plateforme, pas un empilement d’outils
            </p>
            <h2>Le même Pelote Manager, du licencié à l’administrateur.</h2>
            <p>
              Le joueur accède uniquement à ce qui le concerne. Les responsables
              disposent des outils de gestion adaptés à leur rôle. Le club garde
              la maîtrise de son organisation et de ses données.
            </p>
          </div>
          <div className="marketing-platform__steps">
            <div>
              <strong>01</strong>
              <span>Le club configure son environnement.</span>
            </div>
            <div>
              <strong>02</strong>
              <span>Les licenciés retrouvent leur espace personnel.</span>
            </div>
            <div>
              <strong>03</strong>
              <span>
                Les compétitions et réservations vivent au même endroit.
              </span>
            </div>
          </div>
        </section>

        <section className="marketing-cta">
          <div>
            <p className="marketing-kicker">Pelote Manager</p>
            <h2>Moins de fichiers. Moins de messages perdus. Plus de club.</h2>
            <p>
              Accédez à l’application actuelle et découvrez l’expérience côté
              joueur et côté dirigeant.
            </p>
          </div>
          <a
            className="marketing-button marketing-button--light"
            href={appOrigin}
          >
            Ouvrir l’application <ArrowRight aria-hidden="true" />
          </a>
        </section>
      </main>

      <footer className="marketing-footer">
        <div className="marketing-brand marketing-brand--footer">
          <span className="marketing-brand__mark" aria-hidden="true">
            PM
          </span>
          <span>
            <strong>Pelote Manager</strong>
            <small>La plateforme des clubs de pelote</small>
          </span>
        </div>
        <p>© {new Date().getFullYear()} Pelote Manager</p>
      </footer>
    </div>
  );
}
