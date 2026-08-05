import { apiClient } from "./client";
import type { User, CreateUserInput, UpdateUserInput } from "@/types/user";

export const usersApi = {
  getAll: () => apiClient.get("api/v1/users").json<User[]>(),

  getById: (id: string) => apiClient.get(`api/v1/users/${id}`).json<User>(),

  create: (input: CreateUserInput) =>
    apiClient.post("api/v1/users", { json: input }).json<User>(),

  update: (id: string, input: UpdateUserInput) =>
    apiClient.put(`api/v1/users/${id}`, { json: input }).json<User>(),

  delete: (id: string) => apiClient.delete(`api/v1/users/${id}`),
};
