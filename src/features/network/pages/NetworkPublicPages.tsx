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

const plans = [
  {
    id: "essentiel",
    name: "Essentiel",
    price: "9,90 €",
    description: "La réservation de vos installations, en toute simplicité.",
    features: [
      "Calendrier et réservations de terrains",
      "Gestion des adhérents et des créneaux",
      "Règles de réservation, fermetures et échanges",
      "Notifications liées aux réservations",
    ],
  },
  {
    id: "club",
    name: "Club",
    price: "14,90 €",
    description: "Tout pour organiser la vie sportive de votre club.",
    features: [
      "Tout ce qui est inclus dans Essentiel",
      "Tournois : inscriptions, poules et programmation",
      "Championnats : calendrier et programmation",
      "Résultats, classements et phases finales",
      "Demandes de report et notifications de compétition",
    ],
  },
  {
    id: "premium",
    name: "Premium",
    price: "19,90 €",
    description: "L'expérience complète, jusqu'aux écrans du club.",
    features: [
      "Tout ce qui est inclus dans Club",
      "Gestion des arbitres",
      "Saisie des résultats par les arbitres",
      "Mode TV pour les spectateurs",
      "Statistiques et personnalisation avancées",
    ],
  },
] as const;

const comparisons = [
  { label: "Réservations et adhérents", access: [true, true, true] },
  { label: "Tournois et championnats", access: [false, true, true] },
  { label: "Résultats, classements et reports", access: [false, true, true] },
  { label: "Notifications de compétition", access: [false, true, true] },
  { label: "Arbitrage et saisie des scores", access: [false, false, true] },
  { label: "Mode TV et statistiques avancées", access: [false, false, true] },
] as const;

export function NetworkSubscriptionPage() {
  return (
    <NetworkPageShell>
      <section
        className="network-directory__section network-pricing"
        id="abonnement"
      >
        <div className="network-pricing__heading">
          <p className="network-directory__eyebrow">
            Trois offres pour les clubs
          </p>
          <h2>Votre club, votre formule.</h2>
          <p>
            De la réservation d'un terrain à l'organisation d'un tournoi :
            choisissez les fonctionnalités adaptées à votre club de pelote.
          </p>
        </div>

        <div className="network-pricing__cards">
          {plans.map((plan) => (
            <article
              key={plan.id}
              className={
                "network-pricing__card" +
                (plan.id === "club" ? " network-pricing__card--featured" : "")
              }
            >
              {plan.id === "club" && (
                <span className="network-pricing__featured-label">
                  Notre formule recommandée
                </span>
              )}
              <div className="network-pricing__card-header">
                <h3>{plan.name}</h3>
                <p className="network-pricing__description">
                  {plan.description}
                </p>
                <div className="network-pricing__price">
                  <strong>{plan.price}</strong>
                  <span>/ mois / club</span>
                </div>
              </div>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <Link
                to={`/reseau/inscription?formule=${plan.id}`}
                className="network-pricing__explore"
              >
                Demander cette formule
              </Link>
            </article>
          ))}
        </div>

        <p className="network-pricing__launch-note">
          Les demandes d'inscription sont ouvertes : notre équipe vous
          recontactera pour valider votre club. La création des accès et le
          paiement ne sont pas encore activés.
        </p>
        <p className="network-pricing__launch-note">
          Tarifs mensuels indicatifs par club, affichés avant le lancement
          commercial. Les modalités TTC/HT seront précisées à l'ouverture. Les
          abonnements, les paiements et l'essai gratuit ne sont pas encore
          accessibles : aucun paiement n'est demandé sur cette page.
        </p>
      </section>

      <section className="network-directory__section network-pricing__comparison">
        <div className="network-pricing__heading">
          <p className="network-directory__eyebrow">Comparer les formules</p>
          <h2>Les fonctionnalités en un coup d'œil</h2>
        </div>
        <div className="network-pricing__table-scroll">
          <table>
            <caption>Comparaison des trois formules Pilotoki</caption>
            <thead>
              <tr>
                <th scope="col">Fonctionnalités</th>
                <th scope="col">Essentiel</th>
                <th scope="col">Club</th>
                <th scope="col">Premium</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map((item) => (
                <tr key={item.label}>
                  <th scope="row">{item.label}</th>
                  {item.access.map((included, index) => (
                    <td key={plans[index].id}>
                      <span
                        className={
                          included
                            ? "network-pricing__yes"
                            : "network-pricing__no"
                        }
                      >
                        {included ? "Inclus" : "—"}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="network-directory__section network-pricing__next">
        <p className="network-directory__eyebrow">Découvrir Pilotoki</p>
        <h2>Imaginez Pilotoki aux couleurs de votre club.</h2>
        <p>
          Découvrez notre démonstration interactive, côté joueur comme côté
          administrateur, avant l'ouverture des abonnements.
        </p>
        <Link to="/reseau/decouvrir" className="network-pricing__explore">
          Tester la démonstration
        </Link>
      </section>
    </NetworkPageShell>
  );
}
