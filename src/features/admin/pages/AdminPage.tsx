import { CalendarCheck, CalendarClock, CircleAlert, Users } from "lucide-react";
import "./AdminDashboard.css";

export function AdminPage() {
  return (
    <section className="admin-page" aria-labelledby="admin-title">
      <header className="admin-page__header"><p className="admin-page__eyebrow">Vue d’ensemble</p><h1 id="admin-title">Tableau de bord</h1><p className="admin-page__lead">Retrouvez les informations essentielles du club et les actions à traiter aujourd’hui.</p></header>
      <div className="admin-dashboard__metrics">
        <article className="admin-card"><CalendarCheck/><span>Réservations du jour</span><strong>—</strong><small>Indicateur prêt à être connecté</small></article>
        <article className="admin-card"><CalendarClock/><span>À venir</span><strong>—</strong><small>7 prochains jours</small></article>
        <article className="admin-card"><Users/><span>Utilisateurs</span><strong>—</strong><small>Comptes enregistrés</small></article>
        <article className="admin-card"><CircleAlert/><span>Alertes</span><strong>0</strong><small>Aucune alerte système</small></article>
      </div>
      <div className="admin-dashboard__columns"><article className="admin-card"><h2>Activité récente</h2><p>Les prochaines réservations et opérations apparaîtront ici.</p></article><article className="admin-card"><h2>À surveiller</h2><ul><li>Paiements en attente</li><li>Fermetures programmées</li><li>Prochains événements</li></ul></article></div>
    </section>
  );
}
