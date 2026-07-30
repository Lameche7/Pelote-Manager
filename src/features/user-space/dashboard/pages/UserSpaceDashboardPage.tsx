import type { LucideIcon } from "lucide-react";
import {
  Bell,
  CalendarDays,
  CreditCard,
  Trophy,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { Link } from "react-router-dom";
import { UserSpaceShell } from "@/features/user-space/components/UserSpaceShell";
import { getGreeting } from "@/features/user-space/domain/userSpace";
import { ROUTES } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";
import "./UserSpaceDashboardPage.css";

type DashboardCard = {
  title: string;
  description?: string;
  icon: LucideIcon;
  to?: string;
};
const cards: DashboardCard[] = [
  {
    title: "Mes réservations",
    description: "Consulter, reprendre un paiement ou annuler une réservation.",
    icon: CalendarDays,
    to: ROUTES.myReservations,
  },
  {
    title: "Mon profil",
    description: "Consulter vos informations personnelles.",
    icon: UserRound,
    to: ROUTES.myProfile,
  },
  { title: "Mes tournois", icon: Trophy },
  { title: "Mes paiements", icon: CreditCard },
  { title: "Notifications", icon: Bell },
  { title: "Mon activité", icon: TrendingUp },
];

function Card({ card }: { card: DashboardCard }) {
  const Icon = card.icon;
  const content = (
    <>
      <span className="user-dashboard__icon">
        <Icon aria-hidden="true" />
      </span>
      <div>
        <h2>{card.title}</h2>
        {card.description ? (
          <p>{card.description}</p>
        ) : (
          <span className="user-dashboard__soon">Bientôt disponible</span>
        )}
      </div>
      {card.to && (
        <span className="user-dashboard__arrow" aria-hidden="true">
          →
        </span>
      )}
    </>
  );
  return card.to ? (
    <Link className="user-dashboard__card" to={card.to}>
      {content}
    </Link>
  ) : (
    <article
      className="user-dashboard__card user-dashboard__card--disabled"
      aria-disabled="true"
    >
      {content}
    </article>
  );
}

export function UserSpaceDashboardPage() {
  const { profile } = useAuth();
  return (
    <UserSpaceShell>
      <section className="user-dashboard" aria-labelledby="user-space-title">
        <header>
          <p className="user-dashboard__eyebrow">Mon espace</p>
          <h1 id="user-space-title">{getGreeting(profile?.firstName)}</h1>
          <p>Bienvenue dans votre espace personnel.</p>
        </header>
        <div className="user-dashboard__grid">
          {cards.map((card) => (
            <Card key={card.title} card={card} />
          ))}
        </div>
      </section>
    </UserSpaceShell>
  );
}
