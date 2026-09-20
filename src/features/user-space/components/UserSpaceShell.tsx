import type { PropsWithChildren } from "react";
import {
  BadgeCheck,
  BarChart3,
  Bell,
  CalendarDays,
  LayoutDashboard,
  Trophy,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { PushActivationNudge } from "@/features/notifications/components/PushActivationNudge";
import { ROUTES } from "@/shared/config";
import "./UserSpaceShell.css";

export function UserSpaceShell({ children }: PropsWithChildren) {
  const location = useLocation();
  const showDashboardPushNudge = location.pathname === ROUTES.userSpace;

  return (
    <div className="user-space-shell">
      <nav
        className="user-space-shell__nav"
        aria-label="Navigation de l’espace personnel"
      >
        <NavLink end to={ROUTES.userSpace}>
          <LayoutDashboard aria-hidden="true" /> Tableau de bord
        </NavLink>
        <NavLink to={ROUTES.myReservations}>
          <CalendarDays aria-hidden="true" /> Mes réservations
        </NavLink>
        <NavLink to={ROUTES.myTournaments}>
          <Trophy aria-hidden="true" /> Mes tournois
        </NavLink>
        <NavLink to={ROUTES.myChampionships}>
          <TrendingUp aria-hidden="true" /> Mes championnats
        </NavLink>
        <NavLink to={ROUTES.myStatistics}>
          <BarChart3 aria-hidden="true" /> Mes statistiques
        </NavLink>
        <NavLink to={ROUTES.myLicence}>
          <BadgeCheck aria-hidden="true" /> Ma licence
        </NavLink>
        <NavLink to={ROUTES.myNotifications}>
          <Bell aria-hidden="true" /> Notifications
        </NavLink>
        <NavLink to={ROUTES.myProfile}>
          <UserRound aria-hidden="true" /> Mon profil
        </NavLink>
      </nav>
      <div className="user-space-shell__content">
        {showDashboardPushNudge && <PushActivationNudge context="general" />}
        {children}
      </div>
    </div>
  );
}
