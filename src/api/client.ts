import ky from "ky";
import { logger } from "../lib/logger";
import { getAuthToken, clearAuthToken } from "@/hooks/useAuthStore";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

export const UNAUTHORIZED_EVENT = "auth:unauthorized";

const LOGIN_PATH = "api/v1/auth/login";

export const apiClient = ky.create({
  prefixUrl: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
  hooks: {
    beforeRequest: [
      (request) => {
        const token = getAuthToken();
        if (token) {
          request.headers.set("Authorization", `Bearer ${token}`);
        }
      },
    ],
    afterResponse: [
      (request, _options, response) => {
        if (response.status === 401 && !request.url.endsWith(LOGIN_PATH)) {
          clearAuthToken();
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
          }
        }
      },
    ],
    beforeError: [
      async (error) => {
        const { response } = error;
        if (response) {
          try {
            const body = await response.json();
            const message =
              (body as { message?: string; error?: string }).message ||
              (body as { error?: string }).error ||
              error.message;
            logger.error(`API ${response.url} failed: ${response.status}`, message);
            error.message = message;
          } catch {
            logger.warn(`Failed to parse error response: ${response.url}`);
          }
        } else {
          logger.error("Network request failed", error.message);
        }
        return error;
      },
    ],
  },
});
