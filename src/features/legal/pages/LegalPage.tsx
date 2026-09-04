import { Link } from "react-router-dom";
import { APP_CONFIG, CLUB_CONFIG, LEGAL_CONFIG, ROUTES } from "@/shared/config";
import "./LegalPage.css";

function MissingLegalDetails() {
  if (LEGAL_CONFIG.registeredOffice && LEGAL_CONFIG.contactEmail) return null;

  return (
    <aside className="legal-page__warning" role="note">
      Version de préparation du pilote : l’adresse officielle du siège et
      l’adresse de contact doivent être renseignées avant l’ouverture publique
      du tournoi.
    </aside>
  );
}

function LegalHeader({ title, intro }: { title: string; intro: string }) {
  return (
    <header className="legal-page__header">
      <p className="section-kicker">{LEGAL_CONFIG.pilotLabel}</p>
      <h1>{title}</h1>
      <p>{intro}</p>
      <small>Dernière mise à jour : {LEGAL_CONFIG.lastUpdated}</small>
    </header>
  );
}

export function LegalNoticePage() {
  return (
    <article className="legal-page">
      <LegalHeader
        title="Mentions légales"
        intro={`${APP_CONFIG.name} est utilisé par ${CLUB_CONFIG.name} dans le cadre de son pilote grandeur nature.`}
      />
      <MissingLegalDetails />

      <section>
        <h2>Éditeur du service</h2>
        <p>
          <strong>{LEGAL_CONFIG.editorName}</strong>, {LEGAL_CONFIG.editorType},
          située à {LEGAL_CONFIG.editorLocation}.
        </p>
        <p>
          Siège :{" "}
          {LEGAL_CONFIG.registeredOffice ||
            "à compléter avant le pilote public"}
          .
        </p>
        <p>Directeur de la publication : {LEGAL_CONFIG.publicationDirector}.</p>
        <p>
          Contact :{" "}
          {LEGAL_CONFIG.contactEmail || "à compléter avant le pilote public"}.
        </p>
      </section>

      <section>
        <h2>Hébergement et prestataires techniques</h2>
        <p>
          L’application est déployée au moyen de Vercel et s’appuie sur Supabase
          pour les services de base de données et d’authentification. Ces
          prestataires interviennent comme fournisseurs techniques du service.
        </p>
      </section>

      <section>
        <h2>Version pilote</h2>
        <p>
          Le pilote PCL débute le {LEGAL_CONFIG.pilotStartDate}. Il est proposé
          sans facturation aux participants afin de tester l’application en
          conditions réelles avant toute éventuelle commercialisation.
        </p>
      </section>

      <nav className="legal-page__links" aria-label="Documents juridiques">
        <Link to={ROUTES.privacy}>Politique de confidentialité</Link>
        <Link to={ROUTES.terms}>Conditions d’utilisation</Link>
      </nav>
    </article>
  );
}

export function PrivacyPage() {
  return (
    <article className="legal-page">
      <LegalHeader
        title="Politique de confidentialité"
        intro="Cette page explique simplement quelles données sont utilisées, pourquoi et comment exercer vos droits."
      />
      <MissingLegalDetails />

      <section>
        <h2>Qui est responsable des données ?</h2>
        <p>
          Pour le pilote du tournoi PCL, {LEGAL_CONFIG.editorName} détermine les
          finalités de gestion du tournoi et des services du club. Pelote
          Manager est l’outil utilisé pour les mettre en œuvre.
        </p>
      </section>

      <section>
        <h2>Données utilisées</h2>
        <p>
          Selon les fonctions utilisées : nom, prénom, adresse email, données de
          compte, informations de licence lorsque vous choisissez de la
          rattacher, participations aux tournois, équipe, partenaire, poste,
          disponibilités, matchs, résultats, demandes de report, réservations,
          notifications et traces techniques nécessaires à la sécurité du
          service.
        </p>
      </section>

      <section id="participations-importees">
        <h2>Pourquoi Pelote Manager peut déjà connaître votre inscription ?</h2>
        <p>
          Une participation peut avoir été importée depuis les données fournies
          à l’organisateur du tournoi, y compris lorsque l’inscription a été
          saisie par votre partenaire ou un responsable d’équipe. Dans ce cas,
          Pelote Manager recherche uniquement une correspondance sur le nom et
          le prénom afin de vous proposer la participation à confirmer.
        </p>
        <p>
          Les coordonnées éventuellement présentes dans la source importée ne
          constituent jamais une preuve d’identité et ne servent pas à vous
          donner automatiquement des droits sur une équipe. Le rattachement
          devient effectif lorsque vous confirmez explicitement que la
          participation est la vôtre.
        </p>
      </section>

      <section>
        <h2>Pourquoi ces données sont-elles traitées ?</h2>
        <p>
          Pour créer et sécuriser votre compte, organiser les tournois et les
          réservations, publier les plannings et résultats, permettre les
          actions auxquelles vous avez droit, communiquer les informations
          utiles et assurer la sécurité et le bon fonctionnement du service.
        </p>
        <p>
          Selon le traitement, la base juridique peut être l’exécution du
          service ou de l’inscription demandée, l’intérêt légitime du club à
          organiser et sécuriser son activité, une obligation légale ou, lorsque
          la loi l’impose, votre consentement.
        </p>
      </section>

      <section>
        <h2>Qui peut accéder aux données ?</h2>
        <p>
          Les personnes habilitées du club selon leurs droits d’administration,
          les participants pour les informations nécessaires au déroulement du
          tournoi, et les prestataires techniques indispensables au
          fonctionnement de l’application. Les droits d’administration doivent
          rester limités au besoin réel de chaque responsable.
        </p>
      </section>

      <section>
        <h2>Combien de temps sont-elles conservées ?</h2>
        <p>
          Les durées sont définies selon la finalité de chaque traitement. Avant
          le lancement du pilote, le club valide notamment la durée de
          conservation des comptes inactifs, des identités importées non
          réclamées, des données de tournoi et des journaux techniques. Les
          résultats sportifs peuvent être conservés plus longtemps lorsqu’ils
          constituent l’historique de la compétition.
        </p>
      </section>

      <section>
        <h2>Vos droits</h2>
        <p>
          Vous pouvez demander l’accès à vos données, leur rectification,
          l’effacement lorsque les conditions sont réunies, la limitation du
          traitement et, selon la base juridique, vous opposer au traitement ou
          exercer votre droit à la portabilité.
        </p>
        <p>
          Contact données personnelles :{" "}
          {LEGAL_CONFIG.privacyContactEmail ||
            "à compléter avant l’ouverture publique du tournoi"}
          .
        </p>
        <p>
          Vous pouvez également saisir la CNIL si vous estimez, après nous avoir
          contactés, que vos droits ne sont pas respectés.
        </p>
      </section>

      <nav className="legal-page__links" aria-label="Documents juridiques">
        <Link to={ROUTES.legalNotice}>Mentions légales</Link>
        <Link to={ROUTES.terms}>Conditions d’utilisation</Link>
      </nav>
    </article>
  );
}

export function TermsPage() {
  return (
    <article className="legal-page">
      <LegalHeader
        title="Conditions d’utilisation"
        intro="Ces conditions encadrent l’utilisation gratuite de Pelote Manager pendant le pilote PCL."
      />
      <MissingLegalDetails />

      <section>
        <h2>Objet du pilote</h2>
        <p>
          {APP_CONFIG.name} permet notamment de suivre les tournois,
          réservations, plannings, résultats, notifications et actions proposées
          aux joueurs. Le pilote vise à vérifier le service en conditions
          réelles avant son éventuelle diffusion à d’autres clubs.
        </p>
      </section>

      <section>
        <h2>Compte personnel</h2>
        <p>
          Chaque compte est personnel. Vous devez fournir une identité exacte,
          protéger vos identifiants et ne pas confirmer une licence ou une
          participation appartenant à une autre personne. Un rattachement à un
          tournoi ne vaut pas validation d’une licence ni appartenance à un
          club.
        </p>
      </section>

      <section>
        <h2>Données sportives et décisions du tournoi</h2>
        <p>
          Les plannings, résultats et classements affichés sont destinés à
          faciliter l’organisation. En cas d’erreur ou de divergence, la
          décision officielle de l’organisateur du tournoi reste la référence et
          les données peuvent être corrigées par les administrateurs habilités.
        </p>
      </section>

      <section>
        <h2>Disponibilité du service</h2>
        <p>
          Pelote Manager est encore en phase pilote. Le club peut interrompre
          temporairement une fonction pour maintenance, correction ou sécurité.
          Les anomalies constatées pendant le tournoi servent à améliorer le
          service.
        </p>
      </section>

      <section>
        <h2>Usage acceptable</h2>
        <p>
          Il est interdit de tenter d’accéder aux données ou fonctions d’un
          autre utilisateur, de contourner les contrôles d’accès, d’automatiser
          des accès abusifs ou de perturber volontairement le fonctionnement de
          l’application.
        </p>
      </section>

      <section>
        <h2>Évolution des conditions</h2>
        <p>
          Les présentes conditions peuvent évoluer pendant la phase pilote si
          une modification technique, réglementaire ou organisationnelle
          l’exige. Une modification importante sera signalée de manière visible
          aux utilisateurs.
        </p>
      </section>

      <nav className="legal-page__links" aria-label="Documents juridiques">
        <Link to={ROUTES.legalNotice}>Mentions légales</Link>
        <Link to={ROUTES.privacy}>Politique de confidentialité</Link>
      </nav>
    </article>
  );
}
