import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach } from "vitest";
import {
  useUsers,
  useUser,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
} from "./useUsers";
import { useAuthStore } from "./useAuthStore";
import type { ReactNode } from "react";

beforeEach(() => {
  useAuthStore.getState().clearToken();
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useUsers", () => {
  it("fetches users list", async () => {
    const { result } = renderHook(() => useUsers(), { wrapper: createWrapper() });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].name).toBe("John Doe");
  });
});

describe("useUser", () => {
  it("fetches single user by id", async () => {
    const { result } = renderHook(() => useUser("1"), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.name).toBe("John Doe");
    expect(result.current.data?.email).toBe("john@example.com");
  });

  it("does not fetch when id is empty", () => {
    const { result } = renderHook(() => useUser(""), { wrapper: createWrapper() });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });
});

describe("useCreateUser", () => {
  it("creates a new user", async () => {
    const { result } = renderHook(() => useCreateUser(), { wrapper: createWrapper() });

    result.current.mutate({
      name: "New User",
      email: "new@example.com",
      password: "password123",
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.name).toBe("New User");
  });
});

describe("useUpdateUser", () => {
  it("updates an existing user when authenticated", async () => {
    useAuthStore.getState().setToken("valid-token");
    const { result } = renderHook(() => useUpdateUser(), { wrapper: createWrapper() });

    result.current.mutate({
      id: "1",
      input: { name: "Updated Name", email: "updated@example.com" },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.name).toBe("Updated Name");
  });
});

describe("useDeleteUser", () => {
  it("deletes a user when authenticated", async () => {
    useAuthStore.getState().setToken("valid-token");
    const { result } = renderHook(() => useDeleteUser(), { wrapper: createWrapper() });

    result.current.mutate("1");

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });
});
