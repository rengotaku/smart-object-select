import { describe, it, expect, beforeEach } from "vitest";
import { usersApi } from "./users";
import { useAuthStore } from "@/hooks/useAuthStore";

describe("usersApi", () => {
  beforeEach(() => {
    useAuthStore.getState().clearToken();
  });

  describe("getAll", () => {
    it("fetches all users", async () => {
      const users = await usersApi.getAll();

      expect(users).toHaveLength(2);
      expect(users[0].name).toBe("John Doe");
      expect(users[1].name).toBe("Jane Smith");
    });
  });

  describe("getById", () => {
    it("fetches a user by id", async () => {
      const user = await usersApi.getById("1");

      expect(user.id).toBe("1");
      expect(user.name).toBe("John Doe");
      expect(user.email).toBe("john@example.com");
    });
  });

  describe("create", () => {
    it("creates a new user with password", async () => {
      const newUser = await usersApi.create({
        name: "New User",
        email: "new@example.com",
        password: "password123",
      });

      expect(newUser.name).toBe("New User");
      expect(newUser.email).toBe("new@example.com");
      expect(newUser.id).toBeDefined();
    });
  });

  describe("update", () => {
    it("updates an existing user when authenticated", async () => {
      useAuthStore.getState().setToken("valid-token");
      const updatedUser = await usersApi.update("1", {
        name: "Updated Name",
        email: "updated@example.com",
      });

      expect(updatedUser.name).toBe("Updated Name");
      expect(updatedUser.email).toBe("updated@example.com");
    });
  });

  describe("delete", () => {
    it("deletes a user when authenticated", async () => {
      useAuthStore.getState().setToken("valid-token");
      const response = await usersApi.delete("1");

      expect(response.ok).toBe(true);
    });
  });
});
