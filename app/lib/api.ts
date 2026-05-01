/**
 * Frontend API client. Stateless — every request injects the
 * X-Telegram-InitData header, which the worker re-validates server-side.
 *
 * No JWTs, no sessionStorage. The Mini App reboots fresh each launch and
 * Telegram's WebApp.ready() refreshes initData automatically.
 */

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export interface ApiClient {
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  del<T = unknown>(path: string): Promise<T>;
}

export function createApi(initData: string): ApiClient {
  async function call<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const res = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-InitData": initData,
        ...init.headers,
      },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }

  return {
    get: (path) => call(path),
    post: (path, body) =>
      call(path, {
        method: "POST",
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    del: (path) => call(path, { method: "DELETE" }),
  };
}
