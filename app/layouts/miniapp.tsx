import { useEffect, useState } from "react";
import { Outlet } from "react-router";
import { createApi, type ApiClient, type TelegramUser } from "../lib/api";
import { ApiContext, UserContext } from "../lib/ApiContext";

type Status =
  | { kind: "loading" }
  | { kind: "ready"; api: ApiClient; user: TelegramUser }
  | { kind: "error"; message: string };

export default function MiniAppLayout() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const WebApp = (await import("@twa-dev/sdk")).default;
        WebApp.ready();
        WebApp.expand();

        if (!WebApp.initData) {
          throw new Error(
            "No initData. Open this from inside Telegram (tap the bot's menu button).",
          );
        }

        const api = createApi(WebApp.initData);
        const { user } = await api.get<{ user: TelegramUser }>("/api/me");
        if (cancelled) return;
        setStatus({ kind: "ready", api, user });
      } catch (e) {
        if (cancelled) return;
        setStatus({
          kind: "error",
          message: e instanceof Error ? e.message : "Authentication failed",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status.kind === "loading") {
    return <CenterStatus message="Loading…" />;
  }
  if (status.kind === "error") {
    return <CenterStatus message={status.message} isError />;
  }

  return (
    <ApiContext.Provider value={status.api}>
      <UserContext.Provider value={status.user}>
        <Outlet />
      </UserContext.Provider>
    </ApiContext.Provider>
  );
}

function CenterStatus({
  message,
  isError,
}: {
  message: string;
  isError?: boolean;
}) {
  return (
    <div
      className="flex min-h-dvh items-center justify-center px-6 text-center text-sm leading-relaxed"
      style={{ color: isError ? "#ff453a" : "var(--color-hint)" }}
    >
      {message}
    </div>
  );
}
