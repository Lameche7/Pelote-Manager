import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { MainLayout } from "@/app/layouts/MainLayout";
import { ProtectedRoute } from "@/app/router/ProtectedRoute";
import { AdminPage } from "@/features/admin/pages/AdminPage";
import { AdminPaymentsPage } from "@/features/admin/pages/AdminPaymentsPage";
import { AdminReservationOperationsPage } from "@/features/admin/pages/AdminReservationOperationsPage";
import { AdminReservationsPage } from "@/features/admin/pages/AdminReservationsPage";
import { AdminUsersPage } from "@/features/admin/pages/AdminUsersPage";
import { LoginPage } from "@/features/auth/pages/LoginPage";
import { HomePage } from "@/features/home/pages/HomePage";
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
      { path: ROUTES.reservations, element: <ReservationsPage /> },
      { path: ROUTES.reservationPaymentReturn, element: <PaymentReturnPage /> },
      { path: ROUTES.forbidden, element: <Forbidden /> },
      {
        path: ROUTES.admin,
        element: (
          <ProtectedRoute allowedRoles={[USER_ROLES.admin]}>
            <AdminPage />
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.adminUsers,
        element: (
          <ProtectedRoute allowedRoles={[USER_ROLES.admin]}>
            <AdminUsersPage />
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.adminReservations,
        element: (
          <ProtectedRoute allowedRoles={[USER_ROLES.admin]}>
            <AdminReservationsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.adminReservationOperations,
        element: (
          <ProtectedRoute allowedRoles={[USER_ROLES.admin]}>
            <AdminReservationOperationsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: ROUTES.adminPayments,
        element: (
          <ProtectedRoute allowedRoles={[USER_ROLES.admin]}>
            <AdminPaymentsPage />
          </ProtectedRoute>
        ),
      },
      { path: ROUTES.notFound, element: <NotFound /> },
    ],
  },
] satisfies Parameters<typeof createBrowserRouter>[0];

const router = createBrowserRouter(routes);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}