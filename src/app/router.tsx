import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { MainLayout } from "@/app/layouts/MainLayout";
import { ProtectedRoute } from "@/app/router/ProtectedRoute";
import { AdminPage } from "@/features/admin/pages/AdminPage";
import { AdminShell } from "@/features/admin/components/AdminShell";
import { ClubInformationPage } from "@/features/admin/club/pages/ClubInformationPage";
import { ClubPricingPage, ClubSeasonsPage } from "@/features/admin/club/pages/ClubCollectionsPage";
import { ClubHoursPage } from "@/features/admin/club/pages/ClubHoursPage";
import { ClubClosuresPage } from "@/features/admin/club/pages/ClubClosuresPage";
import { AdminComingSoonPage } from "@/features/admin/pages/AdminComingSoonPage";
import { PermissionRoute } from "@/features/admin/access/PermissionRoute";
import { ADMIN_PERMISSIONS, type AdminPermission } from "@/features/admin/config/adminPermissions";
import { AdminPaymentsPage } from "@/features/admin/pages/AdminPaymentsPage";
import { AdminReservationOperationsPage } from "@/features/admin/pages/AdminReservationOperationsPage";
import { AdminReservationsPage } from "@/features/admin/pages/AdminReservationsPage";
import { AdminReservationsManagementPage } from "@/features/admin/reservations/pages/AdminReservationsManagementPage";
import { AdminUsersPage } from "@/features/admin/pages/AdminUsersPage";
import { AdminEventsPage } from "@/features/admin/events/pages/AdminEventsPage";
import { AdminMembersPage } from "@/features/admin/members/pages/AdminMembersPage";
import { MemberImportPage } from "@/features/admin/members/pages/MemberImportPage";
import { MemberImportsPage } from "@/features/admin/members/pages/MemberImportsPage";
import { LoginPage } from "@/features/auth/pages/LoginPage";
import { RegisterPage } from "@/features/auth/pages/RegisterPage";
import { HomePage } from "@/features/home/pages/HomePage";
import { UserSpaceDashboardPage } from "@/features/user-space/dashboard/pages/UserSpaceDashboardPage";
import { MyProfilePage } from "@/features/user-space/profile/pages/MyProfilePage";
import { MyReservationsPage } from "@/features/reservations/pages/MyReservationsPage";
import { PaymentReturnPage } from "@/features/reservations/pages/PaymentReturnPage";
import { ReservationsPage } from "@/features/reservations/pages/ReservationsPage";
import { ROUTES, USER_ROLES } from "@/shared/config";
import { Forbidden } from "@/shared/pages/Forbidden";
import { NotFound } from "@/shared/pages/NotFound";

const permitted = (permission: AdminPermission, page: React.ReactNode) => (
  <PermissionRoute permission={permission}>{page}</PermissionRoute>
);

export const routes = [
  {
    path: ROUTES.home,
    element: <MainLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: ROUTES.login, element: <LoginPage /> },
      { path: ROUTES.register, element: <RegisterPage /> },
      { path: ROUTES.reservations, element: <ReservationsPage /> },
      {
        path: ROUTES.userSpace,
        element: (
          <ProtectedRoute allowedRoles={[USER_ROLES.visitor, USER_ROLES.user, USER_ROLES.member, USER_ROLES.admin]}>
            <UserSpaceDashboardPage />
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.myProfile,
        element: (
          <ProtectedRoute allowedRoles={[USER_ROLES.visitor, USER_ROLES.user, USER_ROLES.member, USER_ROLES.admin]}>
            <MyProfilePage />
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.myReservations,
        element: (
          <ProtectedRoute
            allowedRoles={[
              USER_ROLES.visitor,
              USER_ROLES.user,
              USER_ROLES.member,
              USER_ROLES.admin,
            ]}
          >
            <MyReservationsPage />
          </ProtectedRoute>
        ),
      },
      { path: ROUTES.reservationPaymentReturn, element: <PaymentReturnPage /> },
      { path: ROUTES.forbidden, element: <Forbidden /> },
      {
        path: ROUTES.admin,
        element: (
          <ProtectedRoute>
            <AdminShell />
          </ProtectedRoute>
        ),
        children: [
          { index: true, element: permitted(ADMIN_PERMISSIONS.dashboard, <AdminPage />) },
          { path: "club/informations", element: permitted(ADMIN_PERMISSIONS.club, <ClubInformationPage />) },
          { path: "club/horaires", element: permitted(ADMIN_PERMISSIONS.reservations, <ClubHoursPage />) },
          { path: "club/fermetures", element: permitted(ADMIN_PERMISSIONS.reservations, <ClubClosuresPage />) },
          { path: "club/saisons", element: permitted(ADMIN_PERMISSIONS.club, <ClubSeasonsPage />) },
          { path: "club/tarifs", element: permitted(ADMIN_PERMISSIONS.pricing, <ClubPricingPage />) },
          { path: "reservations", element: permitted(ADMIN_PERMISSIONS.reservations, <AdminReservationsManagementPage />) },
          { path: "reservations/parametres", element: permitted(ADMIN_PERMISSIONS.reservations, <AdminReservationsPage />) },
          { path: "reservations/suivi", element: permitted(ADMIN_PERMISSIONS.reservations, <AdminReservationOperationsPage />) },
          { path: "utilisateurs", element: permitted(ADMIN_PERMISSIONS.settings, <AdminUsersPage />) },
          { path: "paiements", element: permitted(ADMIN_PERMISSIONS.paymentsRead, <AdminPaymentsPage />) },
          { path: "membres", element: permitted(ADMIN_PERMISSIONS.members, <AdminMembersPage />) },
          { path: "membres/importer", element: permitted(ADMIN_PERMISSIONS.members, <MemberImportPage />) },
          { path: "membres/imports", element: permitted(ADMIN_PERMISSIONS.members, <MemberImportsPage />) },
          { path: "evenements", element: permitted(ADMIN_PERMISSIONS.events, <AdminEventsPage />) },
          { path: "tournois", element: permitted(ADMIN_PERMISSIONS.tournaments, <AdminComingSoonPage title="Tournois" />) },
          { path: "communication", element: permitted(ADMIN_PERMISSIONS.communication, <AdminComingSoonPage title="Communication" />) },
          { path: "statistiques", element: permitted(ADMIN_PERMISSIONS.statistics, <AdminComingSoonPage title="Statistiques" />) },
          { path: "parametres", element: permitted(ADMIN_PERMISSIONS.settings, <AdminComingSoonPage title="Paramètres" />) },
        ],
      },
      { path: ROUTES.notFound, element: <NotFound /> },
    ],
  },
] satisfies Parameters<typeof createBrowserRouter>[0];

const router = createBrowserRouter(routes);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
