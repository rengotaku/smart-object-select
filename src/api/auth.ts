import { apiClient } from "./client";
import type { LoginInput, LoginResponse } from "@/types/auth";

export const authApi = {
  login: (input: LoginInput) =>
    apiClient.post("api/v1/auth/login", { json: input }).json<LoginResponse>(),
};
