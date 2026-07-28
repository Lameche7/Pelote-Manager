import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ProtectedRoute } from "@/app/router/ProtectedRoute";
import { ROUTES, USER_ROLES } from "@/shared/config";
import { AuthContext, type AuthContextValue } from "@/shared/hooks/useAuth";

const baseValue: AuthContextValue = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
  login: vi.fn(),
  logout: vi.fn(),
};

function Destination() {
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)
    ?.from;
  return <p>{from?.pathname ? `from:${from.pathname}` : location.pathname}</p>;
}

function renderProtected(value: AuthContextValue) {
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[ROUTES.admin]}>
        <Routes>
          <Route
            path={ROUTES.admin}
            element={
              <ProtectedRoute allowedRoles={[USER_ROLES.admin]}>
                <p>contenu protégé</p>
              </ProtectedRoute>
            }
          />
          <Route path={ROUTES.login} element={<Destination />} />
          <Route path={ROUTES.forbidden} element={<Destination />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("ProtectedRoute", () => {
  it("affiche le chargement", () => {
    renderProtected({ ...baseValue, isLoading: true });
    expect(screen.getByRole("status").textContent).toContain("Chargement");
  });

  it("redirige vers la connexion en conservant la page demandée", async () => {
    renderProtected(baseValue);
    expect(await screen.findByText(`from:${ROUTES.admin}`)).toBeTruthy();
  });

  it("redirige un rôle insuffisant vers l'accès refusé", async () => {
    renderProtected({
      ...baseValue,
      isAuthenticated: true,
      user: {
        id: "member",
        email: "member@test.local",
        role: USER_ROLES.member,
      },
    });
    expect(await screen.findByText(ROUTES.forbidden)).toBeTruthy();
  });

  it("affiche les enfants pour le rôle autorisé", () => {
    renderProtected({
      ...baseValue,
      isAuthenticated: true,
      user: { id: "admin", email: "admin@test.local", role: USER_ROLES.admin },
    });
    expect(screen.getByText("contenu protégé")).toBeTruthy();
  });
});
