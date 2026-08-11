import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import App from "./App";

describe("App", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("redirects the root path to the Model Lab page (issue #59: Model Lab-only scope)", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Model Lab" })).toBeInTheDocument();
  });

  it("renders the app title in the header", () => {
    render(<App />);
    expect(screen.getByText("Smart Object Select")).toBeInTheDocument();
  });

  it("renders a 404 page for unknown routes", () => {
    window.history.pushState({}, "", "/unknown");
    render(<App />);
    expect(screen.getByText("404")).toBeInTheDocument();
  });
});
