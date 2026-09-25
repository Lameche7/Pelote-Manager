import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  BarChart3,
  Bell,
  CalendarDays,
  Clock3,
  CreditCard,
  Trophy,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { Link } from "react-router-dom";
import { permanentSlotService } from "@/features/reservations/services/permanentSlotService";
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

const standardCards: DashboardCard[] = [
  {
    title: "Mes réservations",
    description: "Consulter, reprendre un paiement ou annuler une réservation.",
    icon: CalendarDays,
    to: ROUTES.myReservations,
  },
  {
    title: "Ma licence",
    description:
      "Demander ou renouveler votre licence et suivre votre dossier.",
    icon: BadgeCheck,
    to: ROUTES.myLicence,
  },
  {
    title: "Mon profil",
    description: "Consulter vos informations personnelles.",
    icon: UserRound,
    to: ROUTES.myProfile,
  },
  {
    title: "Mes tournois",
    description:
      "Retrouver votre équipe, votre poule et vos prochaines parties.",
    icon: Trophy,
    to: ROUTES.myTournaments,
  },
  { title: "Mes paiements", icon: CreditCard },
  {
    title: "Notifications",
    description: "Lire les informations et alertes publiées par le club.",
    icon: Bell,
    to: ROUTES.myNotifications,
  },
  {
    title: "Mes championnats",
    description:
      "Consulter votre équipe, vos parties, vos résultats et votre poule.",
    icon: TrendingUp,
    to: ROUTES.myChampionships,
  },
  {
    title: "Mes statistiques",
    description:
      "Analyser vos résultats de championnats et tournois avec des filtres détaillés.",
    icon: BarChart3,
    to: ROUTES.myStatistics,
  },
];

const permanentSlotCard: DashboardCard = {
  title: "Mes créneaux permanents",
  description:
    "Maintenir ou libérer ponctuellement vos créneaux réservés à l’année.",
  icon: Clock3,
  to: ROUTES.myPermanentSlots,
};

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
  const [hasPermanentSlots, setHasPermanentSlots] = useState(false);

  useEffect(() => {
    let active = true;
    permanentSlotService
      .hasPermanentSlots()
      .then((hasSlots) => {
        if (active) setHasPermanentSlots(hasSlots);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const cards = hasPermanentSlots
    ? [standardCards[0], permanentSlotCard, ...standardCards.slice(1)]
    : standardCards;

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
