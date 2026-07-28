import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ROUTES } from "@/shared/config";
import { NotFound } from "./NotFound";

describe("NotFound", () => {
  it("informe l’utilisateur et propose un retour à l’accueil", () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Page introuvable" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Retour à l’accueil" }),
    ).toHaveAttribute("href", ROUTES.home);
  });
});
