import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { apiClient, UNAUTHORIZED_EVENT } from "./client";
import { useAuthStore } from "@/hooks/useAuthStore";
import { server } from "@/test/mocks/server";
import { http, HttpResponse } from "msw";

describe("apiClient", () => {
  beforeEach(() => {
    useAuthStore.getState().clearToken();
  });

  it("is configured with correct base URL", async () => {
    const response = await apiClient.get("api/v1/users");
    const users = await response.json();

    expect(Array.isArray(users)).toBe(true);
  });

  it("includes Content-Type header", async () => {
    const response = await apiClient.post("api/v1/users", {
      json: { name: "Test", email: "test@example.com", password: "password123" },
    });

    expect(response.ok).toBe(true);
  });

  it("attaches Bearer token when present in auth store", async () => {
    useAuthStore.getState().setToken("test-token");
    let observed: string | null = null;
    server.use(
      http.get("http://localhost:8080/api/v1/users", ({ request }) => {
        observed = request.headers.get("Authorization");
        return HttpResponse.json([]);
      })
    );

    await apiClient.get("api/v1/users");

    expect(observed).toBe("Bearer test-token");
  });

  it("does not attach Authorization header when token is null", async () => {
    let observed: string | null = "untouched";
    server.use(
      http.get("http://localhost:8080/api/v1/users", ({ request }) => {
        observed = request.headers.get("Authorization");
        return HttpResponse.json([]);
      })
    );

    await apiClient.get("api/v1/users");

    expect(observed).toBeNull();
  });

  describe("401 handling", () => {
    let dispatched = 0;
    const handler = () => {
      dispatched += 1;
    };

    beforeEach(() => {
      dispatched = 0;
      window.addEventListener(UNAUTHORIZED_EVENT, handler);
    });

    afterEach(() => {
      window.removeEventListener(UNAUTHORIZED_EVENT, handler);
    });

    it("clears token and dispatches event on 401", async () => {
      useAuthStore.getState().setToken("expired-token");
      server.use(
        http.get("http://localhost:8080/api/v1/users", () =>
          HttpResponse.json({ error: "unauthorized" }, { status: 401 })
        )
      );

      await expect(apiClient.get("api/v1/users")).rejects.toThrow();

      expect(useAuthStore.getState().token).toBeNull();
      expect(dispatched).toBe(1);
    });

    it("does not clear token or dispatch event when login itself returns 401", async () => {
      useAuthStore.getState().setToken("existing-token");

      await expect(
        apiClient.post("api/v1/auth/login", {
          json: { email: "wrong@example.com", password: "bad" },
        })
      ).rejects.toThrow();

      expect(useAuthStore.getState().token).toBe("existing-token");
      expect(dispatched).toBe(0);
    });
  });
});
