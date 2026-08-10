import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import { Layout } from "./Layout";

describe("Layout", () => {
  it("renders the app title", () => {
    render(
      <MemoryRouter>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByText("Smart Object Select")).toBeInTheDocument();
  });

  it("renders header and main sections", () => {
    render(
      <MemoryRouter>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByRole("banner")).toBeInTheDocument(); // header
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("renders navigation links to Segment and Model Lab pages", () => {
    render(
      <MemoryRouter>
        <Layout />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: "Segment" })).toHaveAttribute(
      "href",
      "/segment"
    );
    expect(screen.getByRole("link", { name: "Model Lab" })).toHaveAttribute(
      "href",
      "/model-lab"
    );
  });
});
