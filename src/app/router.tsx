import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { MainLayout } from "@/app/layouts/MainLayout";
import { HomePage } from "@/features/home/pages/HomePage";
import { ROUTES } from "@/shared/config";
import { NotFound } from "@/shared/pages/NotFound";

export const routes = [
  {
    path: ROUTES.home,
    element: <MainLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: ROUTES.notFound, element: <NotFound /> },
    ],
  },
] satisfies Parameters<typeof createBrowserRouter>[0];

const router = createBrowserRouter(routes);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
