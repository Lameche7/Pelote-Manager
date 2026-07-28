import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { routes } from "@/app/router";
import { ROUTES } from "@/shared/config";
import { AuthContext, type AuthContextValue } from "@/shared/hooks/useAuth";

const anonymous: AuthContextValue = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
  login: vi.fn(),
  logout: vi.fn(),
};

function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AuthContext.Provider value={anonymous}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return router;
}

describe("routes", () => {
  it("affiche la connexion", async () => {
    renderRoute(ROUTES.login);
    expect(
      await screen.findByRole("heading", { name: "Connexion" }),
    ).toBeTruthy();
  });

  it("affiche l'accès refusé", async () => {
    renderRoute(ROUTES.forbidden);
    expect(
      await screen.findByRole("heading", { name: "Accès refusé" }),
    ).toBeTruthy();
  });

  it("protège l'administration", async () => {
    const router = renderRoute(ROUTES.admin);
    await screen.findByRole("heading", { name: "Connexion" });
    expect(router.state.location.pathname).toBe(ROUTES.login);
  });

  it("conserve la page 404", async () => {
    renderRoute("/route-inconnue");
    expect(await screen.findByText("404")).toBeTruthy();
  });
});
