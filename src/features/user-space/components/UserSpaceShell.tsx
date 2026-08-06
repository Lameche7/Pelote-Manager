import type { PropsWithChildren } from "react";
import { Bell, CalendarDays, LayoutDashboard, UserRound } from "lucide-react";
import { NavLink } from "react-router-dom";
import { ROUTES } from "@/shared/config";
import "./UserSpaceShell.css";

export function UserSpaceShell({ children }: PropsWithChildren) {
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
        <NavLink to={ROUTES.myNotifications}>
          <Bell aria-hidden="true" /> Notifications
        </NavLink>
        <NavLink to={ROUTES.myProfile}>
          <UserRound aria-hidden="true" /> Mon profil
        </NavLink>
      </nav>
      <div className="user-space-shell__content">{children}</div>
    </div>
  );
}
