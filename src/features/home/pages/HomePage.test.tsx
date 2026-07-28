import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomePage } from "./HomePage";

describe("HomePage", () => {
  it("affiche la page d’accueil", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", { name: "Pelote Manager" }),
    ).toBeInTheDocument();
  });
});
