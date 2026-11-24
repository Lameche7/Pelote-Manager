import { ROUTES } from "@/shared/config";
import type { ClubModules } from "./clubModules";

// Module gates complement, never replace, existing user permissions.
export function isAdminRouteEnabled(
  path: string,
  modules: ClubModules,
): boolean {
  switch (path.replace(/\/+$/, "").toLowerCase()) {
    case ROUTES.adminReservations:
    case ROUTES.adminSlotExchange:
    case ROUTES.adminPermanentSlots:
    case ROUTES.adminReservationSettings:
      return modules.reservations;
    case ROUTES.adminClubHours:
    case ROUTES.adminClubClosures:
      return modules.reservations || modules.tournaments;
    case ROUTES.adminMembers:
    case ROUTES.adminUnlicensedUsers:
    case ROUTES.adminLicences:
      return modules.licences;
    case ROUTES.adminTournaments:
    case ROUTES.adminTournamentImport:
    case ROUTES.adminTournamentTeams:
    case ROUTES.adminTournamentAccounts:
    case ROUTES.adminTournamentPools:
    case ROUTES.adminTournamentQualification:
    case ROUTES.adminTournamentPublication:
    case ROUTES.adminTournamentReschedules:
    case ROUTES.adminTournamentResults:
    case "/admin/membres/recherche-globale":
      return modules.tournaments;
    case ROUTES.adminTournamentPlanning:
      return modules.tournaments && modules.tournamentPlanning;
    case ROUTES.adminChampionships:
    case ROUTES.adminChampionshipImport:
    case ROUTES.adminChampionshipReservations:
    case ROUTES.adminChampionshipResults:
      return modules.championships;
    case ROUTES.adminRefereeing:
      return (
        modules.championships ||
        (modules.tournaments && modules.tournamentRefereeing)
      );
    case ROUTES.adminCommunication:
      return modules.communication;
    case ROUTES.adminPayments:
    case ROUTES.adminPaymentSettings:
      return modules.payments;
    case "/admin/parametres/live":
      return modules.live;
    default:
      return true;
  }
}
