import { create } from "zustand";

const STORAGE_KEY = "react-spa-auth-token";

const safeStorage = {
  read(): string | null {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  },
  write(token: string | null): void {
    if (typeof window === "undefined") return;
    try {
      if (token === null) {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, token);
      }
    } catch {
      /* ignore quota/access errors */
    }
  },
};

interface AuthState {
  token: string | null;
  setToken: (token: string) => void;
  clearToken: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: safeStorage.read(),
  setToken: (token) => {
    safeStorage.write(token);
    set({ token });
  },
  clearToken: () => {
    safeStorage.write(null);
    set({ token: null });
  },
}));

export const getAuthToken = () => useAuthStore.getState().token;
export const clearAuthToken = () => useAuthStore.getState().clearToken();
