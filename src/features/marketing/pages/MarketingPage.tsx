import { useEffect } from "react";
import {
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
import "./MarketingPage.css";
import "./MarketingPilotGuide.css";

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

export function MarketingPage() {
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
          <a href="#guide-pcl">Guide PCL</a>
          <a href="#vision">La plateforme</a>
        </nav>
      </header>

      <main>
        <section className="marketing-hero" id="accueil">
          <div className="marketing-hero__copy">
            <p className="marketing-pilot-badge">
              En test au Pelotaris Club Lourdais
            </p>
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
                href="#guide-pcl"
              >
                <Smartphone aria-hidden="true" />
                Guide du test PCL
              </a>
              <a
                className="marketing-button marketing-button--secondary"
                href="#fonctionnalites"
              >
                Découvrir les fonctionnalités
              </a>
            </div>
            <p className="marketing-hero__install">
              Le pilote est actuellement réservé aux joueurs du Pelotaris Club
              Lourdais.
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
              <span className="marketing-product__status">Pilote PCL</span>
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

        <section className="marketing-pilot-guide" id="guide-pcl">
          <header className="marketing-section__heading">
            <p className="marketing-kicker">Pilote · Pelotaris Club Lourdais</p>
            <h2>Bien démarrer avec Pelote Manager.</h2>
            <p>
              Cette partie s’adresse aux joueurs du PCL qui participent au test.
              L’accès à l’application est transmis directement par le club.
            </p>
          </header>

          <div className="marketing-guide-grid">
            <article className="marketing-guide-card marketing-guide-card--install">
              <span className="marketing-guide-card__number">01</span>
              <Smartphone aria-hidden="true" />
              <h3>Installer Pelote Manager comme une appli</h3>
              <div className="marketing-install-columns">
                <div>
                  <strong>Sur iPhone</strong>
                  <ol>
                    <li>Ouvrez Pelote Manager avec Safari.</li>
                    <li>Touchez le bouton Partager.</li>
                    <li>Choisissez « Ajouter à l’écran d’accueil ».</li>
                    <li>Validez avec « Ajouter ».</li>
                  </ol>
                </div>
                <div>
                  <strong>Sur Android</strong>
                  <ol>
                    <li>Ouvrez Pelote Manager avec Chrome.</li>
                    <li>Ouvrez le menu ⋮ du navigateur.</li>
                    <li>
                      Choisissez « Installer l’application » ou « Ajouter à
                      l’écran d’accueil ».
                    </li>
                    <li>Confirmez l’installation.</li>
                  </ol>
                </div>
              </div>
              <p className="marketing-guide-note">
                Une icône Pelote Manager apparaît ensuite sur votre écran
                d’accueil, comme pour une application classique.
              </p>
            </article>

            <article className="marketing-guide-card">
              <span className="marketing-guide-card__number">02</span>
              <CalendarDays aria-hidden="true" />
              <h3>Réserver un créneau</h3>
              <ol>
                <li>Connectez-vous à votre compte.</li>
                <li>Ouvrez la rubrique « Réservations ».</li>
                <li>Choisissez le terrain, la semaine et le créneau libre.</li>
                <li>Touchez le créneau marqué « Réserver ».</li>
                <li>Vérifiez la date, l’horaire et confirmez avec « Réserver ».</li>
              </ol>
              <p className="marketing-guide-note">
                Pour le test PCL, les créneaux s’ouvrent à 8 h : 72 h à l’avance
                pour un licencié actif et 48 h à l’avance pour un compte non
                licencié.
              </p>
            </article>

            <article className="marketing-guide-card">
              <span className="marketing-guide-card__number">03</span>
              <ShieldCheck aria-hidden="true" />
              <h3>Annuler une réservation</h3>
              <ol>
                <li>Ouvrez « Mon espace ».</li>
                <li>Entrez dans « Mes réservations ».</li>
                <li>Ouvrez la réservation concernée.</li>
                <li>Touchez « Annuler la réservation » et confirmez.</li>
              </ol>
              <p className="marketing-guide-note marketing-guide-note--important">
                Au PCL, l’annulation par le joueur est possible jusqu’à 8 heures
                avant le début du créneau. Après cette limite, le bouton
                d’annulation n’est plus proposé dans l’application.
              </p>
            </article>
          </div>
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
            <p className="marketing-kicker">Déploiement pilote</p>
            <h2>Pelote Manager est actuellement testé en conditions réelles.</h2>
            <p>
              Le Pelotaris Club Lourdais est le club pilote. Cette phase permet
              de valider les usages quotidiens avec les joueurs et les dirigeants
              avant une ouverture plus large.
            </p>
          </div>
          <span className="marketing-pilot-stamp">Pilote PCL · en cours</span>
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
