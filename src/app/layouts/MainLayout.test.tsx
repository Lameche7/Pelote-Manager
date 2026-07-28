import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { APP_CONFIG, ROUTES } from "@/shared/config";
import { MainLayout } from "./MainLayout";

describe("MainLayout", () => {
  it("affiche son en-tête, son contenu et son pied de page", () => {
    const router = createMemoryRouter(
      [
        {
          path: ROUTES.home,
          element: <MainLayout />,
          children: [{ index: true, element: <p>Contenu de la page</p> }],
        },
      ],
      { initialEntries: [ROUTES.home] },
    );

    render(<RouterProvider router={router} />);

    expect(screen.getByRole("banner")).toHaveTextContent(APP_CONFIG.name);
    expect(screen.getByRole("main")).toHaveTextContent("Contenu de la page");
    expect(screen.getByRole("contentinfo")).toHaveTextContent(APP_CONFIG.name);
  });
});
