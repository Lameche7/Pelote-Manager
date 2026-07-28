import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LoginPage } from "@/features/auth/pages/LoginPage";
import { ROUTES } from "@/shared/config";
import { AuthContext, type AuthContextValue } from "@/shared/hooks/useAuth";

function renderLogin(login: AuthContextValue["login"]) {
  return render(
    <AuthContext.Provider
      value={{
        user: null,
        isAuthenticated: false,
        isLoading: false,
        login,
        logout: vi.fn(),
      }}
    >
      <MemoryRouter initialEntries={[ROUTES.login]}>
        <Routes>
          <Route path={ROUTES.login} element={<LoginPage />} />
          <Route path={ROUTES.home} element={<p>accueil</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("LoginPage", () => {
  it("affiche le titre et le bouton", () => {
    renderLogin(vi.fn());
    expect(screen.getByRole("heading", { name: "Connexion" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /compte de démonstration/i }),
    ).toBeTruthy();
  });

  it("appelle login, désactive le bouton puis redirige", async () => {
    let finishLogin!: () => void;
    const login = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishLogin = resolve;
        }),
    );
    renderLogin(login);
    const button = screen.getByRole("button", {
      name: /compte de démonstration/i,
    });

    fireEvent.click(button);
    expect(login).toHaveBeenCalledOnce();
    expect((button as HTMLButtonElement).disabled).toBe(true);

    finishLogin();
    expect(await screen.findByText("accueil")).toBeTruthy();
  });

  it("réactive le bouton et affiche une erreur accessible si login échoue", async () => {
    renderLogin(
      vi.fn(async () => {
        throw new Error("failure");
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /compte de démonstration/i }),
    );

    expect(await screen.findByRole("alert")).toBeTruthy();
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: /compte de démonstration/i,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
  });
});
