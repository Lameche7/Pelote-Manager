import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { routes } from "./router";

describe("router", () => {
  it("affiche NotFound pour une route inconnue", () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ["/une-route-inconnue"],
    });

    render(<RouterProvider router={router} />);

    expect(
      screen.getByRole("heading", { name: "Page introuvable" }),
    ).toBeInTheDocument();
  });
});
