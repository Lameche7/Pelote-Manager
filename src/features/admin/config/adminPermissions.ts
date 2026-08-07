import { ROUTES } from "@/shared/config";
import { ADMIN_DASHBOARD_PERMISSION } from "@/features/admin/access/adminAccessRules";

export const ADMIN_PERMISSIONS = {
  dashboard: ADMIN_DASHBOARD_PERMISSION,
  club: "club.manage",
  reservations: "reservations.manage",
  members: "members.manage",
  events: "events.manage",
  tournaments: "tournaments.manage",
  communication: "communication.manage",
  statistics: "statistics.read",
  paymentsRead: "payments.read",
  paymentsManage: "payments.manage",
  pricing: "pricing.manage",
  settings: "settings.manage",
} as const;

export type AdminPermission =
  (typeof ADMIN_PERMISSIONS)[keyof typeof ADMIN_PERMISSIONS];

export const ADMIN_ROLE_TEMPLATES = {
  administrator: Object.values(ADMIN_PERMISSIONS),
  reservation_manager: [
    ADMIN_PERMISSIONS.dashboard,
    ADMIN_PERMISSIONS.reservations,
  ],
  tournament_manager: [
    ADMIN_PERMISSIONS.dashboard,
    ADMIN_PERMISSIONS.tournaments,
  ],
  communication_manager: [
    ADMIN_PERMISSIONS.dashboard,
    ADMIN_PERMISSIONS.communication,
  ],
  treasurer: [
    ADMIN_PERMISSIONS.dashboard,
    ADMIN_PERMISSIONS.statistics,
    ADMIN_PERMISSIONS.paymentsRead,
    ADMIN_PERMISSIONS.paymentsManage,
    ADMIN_PERMISSIONS.pricing,
  ],
} satisfies Record<string, AdminPermission[]>;

export const adminNavigation = [
  {
    label: "Tableau de bord",
    to: ROUTES.admin,
    permission: ADMIN_PERMISSIONS.dashboard,
  },
  {
    label: "Club",
    children: [
      {
        label: "Informations",
        to: ROUTES.adminClubInformation,
        permission: ADMIN_PERMISSIONS.club,
      },
      {
        label: "Horaires",
        to: ROUTES.adminClubHours,
        permission: ADMIN_PERMISSIONS.reservations,
      },
      {
        label: "Fermetures",
        to: ROUTES.adminClubClosures,
        permission: ADMIN_PERMISSIONS.reservations,
      },
      {
        label: "Saisons",
        to: ROUTES.adminClubSeasons,
        permission: ADMIN_PERMISSIONS.club,
      },
      {
        label: "Tarifs",
        to: ROUTES.adminClubPricing,
        permission: ADMIN_PERMISSIONS.pricing,
      },
    ],
    permission: ADMIN_PERMISSIONS.pricing,
  },
  {
    label: "Réservations",
    to: ROUTES.adminReservations,
    permission: ADMIN_PERMISSIONS.reservations,
  },
  {
    label: "Licenciés",
    to: ROUTES.adminMembers,
    permission: ADMIN_PERMISSIONS.members,
  },
  {
    label: "Évènements",
    to: ROUTES.adminEvents,
    permission: ADMIN_PERMISSIONS.events,
  },
  {
    label: "Tournois",
    children: [
      {
        label: "Gestion des tournois",
        to: ROUTES.adminTournaments,
        permission: ADMIN_PERMISSIONS.tournaments,
      },
      {
        label: "Équipes & inscriptions",
        to: ROUTES.adminTournamentTeams,
        permission: ADMIN_PERMISSIONS.tournaments,
      },
    ],
    permission: ADMIN_PERMISSIONS.tournaments,
  },
  {
    label: "Recherche licenciés",
    to: "/admin/membres/recherche-globale",
    permission: ADMIN_PERMISSIONS.tournaments,
  },
  {
    label: "Communication",
    to: ROUTES.adminCommunication,
    permission: ADMIN_PERMISSIONS.communication,
  },
  {
    label: "Statistiques",
    to: ROUTES.adminStatistics,
    permission: ADMIN_PERMISSIONS.statistics,
  },
  {
    label: "Paiements",
    to: ROUTES.adminPayments,
    permission: ADMIN_PERMISSIONS.paymentsRead,
  },
  {
    label: "Paramètres",
    to: ROUTES.adminSettings,
    permission: ADMIN_PERMISSIONS.settings,
  },
] as const;
