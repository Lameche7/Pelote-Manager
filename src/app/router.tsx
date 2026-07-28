import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { MainLayout } from "@/app/layouts/MainLayout";
import { ProtectedRoute } from "@/app/router/ProtectedRoute";
import { AdminPage } from "@/features/admin/pages/AdminPage";
import { AdminUsersPage } from "@/features/admin/pages/AdminUsersPage";
import { LoginPage } from "@/features/auth/pages/LoginPage";
import { HomePage } from "@/features/home/pages/HomePage";
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
      { path: ROUTES.notFound, element: <NotFound /> },
    ],
  },
] satisfies Parameters<typeof createBrowserRouter>[0];

const router = createBrowserRouter(routes);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
