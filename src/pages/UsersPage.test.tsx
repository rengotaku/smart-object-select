import { render, screen, waitFor } from "@/test/test-utils";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UsersPage } from "./UsersPage";
import { useAuthStore } from "@/hooks/useAuthStore";

describe("UsersPage", () => {
  beforeEach(() => {
    useAuthStore.getState().clearToken();
  });

  it("displays loading state initially", () => {
    render(<UsersPage />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("displays users list after loading", async () => {
    render(<UsersPage />);

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
    });

    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
  });

  it("displays empty state when no users", async () => {
    const { server } = await import("@/test/mocks/server");
    const { http, HttpResponse } = await import("msw");

    server.use(
      http.get("http://localhost:8080/api/v1/users", () => {
        return HttpResponse.json([]);
      })
    );

    render(<UsersPage />);

    await waitFor(() => {
      expect(screen.getByText("No users found.")).toBeInTheDocument();
    });
  });

  it("creates a new user with password", async () => {
    const user = userEvent.setup();
    render(<UsersPage />);

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Name"), "New User");
    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toHaveValue("");
    });
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("shows validation errors for empty fields including password", async () => {
    const user = userEvent.setup();
    render(<UsersPage />);

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeInTheDocument();
      expect(screen.getByText("Email is required")).toBeInTheDocument();
      expect(
        screen.getByText("Password must be at least 8 characters")
      ).toBeInTheDocument();
    });
  });

  it("shows validation error for invalid email", async () => {
    const user = userEvent.setup();
    render(<UsersPage />);

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Name"), "Test User");
    await user.type(screen.getByLabelText("Email"), "invalid-email");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.getByText("Invalid email format")).toBeInTheDocument();
    });
  });

  it("shows validation error for short password", async () => {
    const user = userEvent.setup();
    render(<UsersPage />);

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Name"), "Test User");
    await user.type(screen.getByLabelText("Email"), "test@example.com");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(
        screen.getByText("Password must be at least 8 characters")
      ).toBeInTheDocument();
    });
  });

  it("enters edit mode without password field", async () => {
    const user = userEvent.setup();
    render(<UsersPage />);

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
    });

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    await user.click(editButtons[0]);

    expect(screen.getByLabelText("Name")).toHaveValue("John Doe");
    expect(screen.getByLabelText("Email")).toHaveValue("john@example.com");
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("cancels edit mode", async () => {
    const user = userEvent.setup();
    render(<UsersPage />);

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
    });

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    await user.click(editButtons[0]);

    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("updates a user when authenticated", async () => {
    useAuthStore.getState().setToken("valid-token");
    const userInput = userEvent.setup();
    render(<UsersPage />);

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
    });

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    await userInput.click(editButtons[0]);

    const nameInput = screen.getByLabelText("Name");
    await userInput.clear(nameInput);
    await userInput.type(nameInput, "Updated Name");

    await userInput.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toHaveValue("");
    });
  });

  it("deletes a user when confirmed and authenticated", async () => {
    useAuthStore.getState().setToken("valid-token");
    const userInput = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<UsersPage />);

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    await userInput.click(deleteButtons[0]);

    expect(window.confirm).toHaveBeenCalledWith("Delete this user?");
  });

  it("does not delete a user when cancelled", async () => {
    const userInput = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<UsersPage />);

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    await userInput.click(deleteButtons[0]);

    expect(window.confirm).toHaveBeenCalledWith("Delete this user?");
    expect(screen.getByText("John Doe")).toBeInTheDocument();
  });

  it("displays error state", async () => {
    const { server } = await import("@/test/mocks/server");
    const { http, HttpResponse } = await import("msw");

    server.use(
      http.get("http://localhost:8080/api/v1/users", () => {
        return HttpResponse.json({ error: "Server error" }, { status: 500 });
      })
    );

    render(<UsersPage />);

    await waitFor(() => {
      expect(screen.getByText(/Error:/)).toBeInTheDocument();
    });
  });
});
