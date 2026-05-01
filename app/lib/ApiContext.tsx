import { createContext, useContext } from "react";
import type { ApiClient, TelegramUser } from "./api";

export const ApiContext = createContext<ApiClient | null>(null);
export const UserContext = createContext<TelegramUser | null>(null);

/** Returns the shared ApiClient. Must be used inside MiniAppLayout. */
export function useApi(): ApiClient {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error("useApi must be used inside MiniAppLayout");
  return ctx;
}

/** Returns the authenticated Telegram user. Must be used inside MiniAppLayout. */
export function useUser(): TelegramUser {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used inside MiniAppLayout");
  return ctx;
}
