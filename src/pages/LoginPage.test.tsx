import { render, screen, waitFor } from "@/test/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach } from "vitest";
import { LoginPage } from "./LoginPage";
import { useAuthStore } from "@/hooks/useAuthStore";
import { MOCK_VALID_EMAIL, MOCK_VALID_PASSWORD, MOCK_TOKEN } from "@/test/mocks/handlers";

describe("LoginPage", () => {
  beforeEach(() => {
    useAuthStore.getState().clearToken();
  });

  it("shows validation errors for empty fields", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText("Email is required")).toBeInTheDocument();
      expect(screen.getByText("Password is required")).toBeInTheDocument();
    });
  });

  it("logs in successfully and stores token", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), MOCK_VALID_EMAIL);
    await user.type(screen.getByLabelText("Password"), MOCK_VALID_PASSWORD);
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(useAuthStore.getState().token).toBe(MOCK_TOKEN);
    });
  });

  it("shows server error message on invalid credentials", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText("Email"), "wrong@example.com");
    await user.type(screen.getByLabelText("Password"), "badpassword");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
    });
    expect(useAuthStore.getState().token).toBeNull();
  });
});
