import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { MainLayout } from "@/app/layouts/MainLayout";
import { ProtectedRoute } from "@/app/router/ProtectedRoute";
import { AdminPage } from "@/features/admin/pages/AdminPage";
import { AdminShell } from "@/features/admin/components/AdminShell";
import { ClubInformationPage } from "@/features/admin/club/pages/ClubInformationPage";
import { ClubPricingPage, ClubSeasonsPage } from "@/features/admin/club/pages/ClubCollectionsPage";
import { AdminComingSoonPage } from "@/features/admin/pages/AdminComingSoonPage";
import { AdminPaymentsPage } from "@/features/admin/pages/AdminPaymentsPage";
import { AdminReservationOperationsPage } from "@/features/admin/pages/AdminReservationOperationsPage";
import { AdminReservationsPage } from "@/features/admin/pages/AdminReservationsPage";
import { AdminReservationsManagementPage } from "@/features/admin/reservations/pages/AdminReservationsManagementPage";
import { AdminUsersPage } from "@/features/admin/pages/AdminUsersPage";
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
          <ProtectedRoute allowedRoles={[USER_ROLES.admin]}>
            <AdminShell />
          </ProtectedRoute>
        ),
        children: [
          { index: true, element: <AdminPage /> },
          { path: "club/informations", element: <ClubInformationPage /> },
          { path: "club/horaires", element: <AdminReservationsPage /> },
          { path: "club/fermetures", element: <AdminReservationsPage /> },
          { path: "club/saisons", element: <ClubSeasonsPage /> },
          { path: "club/tarifs", element: <ClubPricingPage /> },
          { path: "reservations", element: <AdminReservationsManagementPage /> },
          { path: "reservations/parametres", element: <AdminReservationsPage /> },
          { path: "reservations/suivi", element: <AdminReservationOperationsPage /> },
          { path: "utilisateurs", element: <AdminUsersPage /> },
          { path: "paiements", element: <AdminPaymentsPage /> },
          { path: "membres", element: <AdminComingSoonPage title="Membres" /> },
          { path: "evenements", element: <AdminComingSoonPage title="Évènements" /> },
          { path: "tournois", element: <AdminComingSoonPage title="Tournois" /> },
          { path: "communication", element: <AdminComingSoonPage title="Communication" /> },
          { path: "statistiques", element: <AdminComingSoonPage title="Statistiques" /> },
          { path: "parametres", element: <AdminComingSoonPage title="Paramètres" /> },
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
