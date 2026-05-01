import { constantTimeBytesEqual, hexToBytes } from "./safeCompare";

/**
 * Validates Telegram Mini App initData using HMAC-SHA256.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Pure WebCrypto, no library dependency. Returns a discriminated result rather
 * than throwing — callers tend to want to map outcomes to HTTP status codes.
 */

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type ValidationResult =
  | { ok: true; user: TelegramUser; authDate: number }
  | { ok: false; reason: string };

export async function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 3600,
): Promise<ValidationResult> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing hash" };

  // Build the data-check-string: sorted key=value pairs, excluding hash
  params.delete("hash");
  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

  // secret_key = HMAC_SHA256("WebAppData", bot_token)
  // signature = HMAC_SHA256(secret_key, data_check_string)
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secretBytes = await crypto.subtle.sign(
    "HMAC",
    baseKey,
    enc.encode(botToken),
  );
  const signKey = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    signKey,
    enc.encode(dataCheckString),
  );

  // Constant-time comparison of the raw HMAC bytes against the hex `hash`
  // sent by the client. Avoids leaking byte-level timing on auth failures.
  const computedBytes = new Uint8Array(sig);
  let hashBytes: Uint8Array;
  try {
    hashBytes = hexToBytes(hash);
  } catch {
    return { ok: false, reason: "bad signature" };
  }
  if (!constantTimeBytesEqual(computedBytes, hashBytes)) {
    return { ok: false, reason: "bad signature" };
  }

  const authDate = Number(params.get("auth_date") ?? 0);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > maxAgeSeconds) {
    return { ok: false, reason: "expired" };
  }

  const userRaw = params.get("user");
  if (!userRaw) return { ok: false, reason: "missing user" };
  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw) as TelegramUser;
  } catch {
    return { ok: false, reason: "malformed user" };
  }
  if (typeof user.id !== "number") {
    return { ok: false, reason: "missing user.id" };
  }

  return { ok: true, user, authDate };
}
