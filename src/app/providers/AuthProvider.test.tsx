import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/app/providers/AuthProvider";
import type { AuthService } from "@/infrastructure/auth/authService";
import { USER_ROLES } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";
import type { AuthUser } from "@/shared/types/auth";

const admin: AuthUser = {
  id: "test-admin",
  email: "admin@example.test",
  role: USER_ROLES.admin,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function Consumer() {
  const { user, isAuthenticated, isLoading, login, logout } = useAuth();
  return (
    <>
      <p>
        {isLoading ? "loading" : isAuthenticated ? user?.email : "anonymous"}
      </p>
      <button onClick={() => void login()}>login</button>
      <button onClick={() => void logout()}>logout</button>
    </>
  );
}

describe("AuthProvider", () => {
  it("expose d'abord le chargement puis un utilisateur non connecté", async () => {
    const currentUser = deferred<AuthUser | null>();
    const service: AuthService = {
      getCurrentUser: vi.fn(() => currentUser.promise),
      login: vi.fn(async () => admin),
      logout: vi.fn(async () => undefined),
    };

    render(
      <AuthProvider service={service}>
        <Consumer />
      </AuthProvider>,
    );
    expect(screen.getByText("loading")).toBeTruthy();

    await act(async () => currentUser.resolve(null));
    expect(screen.getByText("anonymous")).toBeTruthy();
  });

  it("effectue la connexion et la déconnexion avec le service injecté", async () => {
    const service: AuthService = {
      getCurrentUser: vi.fn(async () => null),
      login: vi.fn(async () => admin),
      logout: vi.fn(async () => undefined),
    };
    render(
      <AuthProvider service={service}>
        <Consumer />
      </AuthProvider>,
    );
    await screen.findByText("anonymous");

    fireEvent.click(screen.getByRole("button", { name: "login" }));
    await screen.findByText(admin.email);
    expect(service.login).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "logout" }));
    await screen.findByText("anonymous");
    expect(service.logout).toHaveBeenCalledOnce();
  });

  it("fournit le contexte à useAuth", async () => {
    const service: AuthService = {
      getCurrentUser: vi.fn(async () => admin),
      login: vi.fn(async () => admin),
      logout: vi.fn(async () => undefined),
    };
    render(
      <AuthProvider service={service}>
        <Consumer />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText(admin.email)).toBeTruthy());
  });

  it("fait lever à useAuth une erreur claire hors du provider", () => {
    expect(() => render(<Consumer />)).toThrow(
      "useAuth doit être utilisé dans un AuthProvider.",
    );
  });
});
