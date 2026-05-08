const MESSAGE_LIMIT = 4096;

export type TelegramUpdate = {
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number };
    text?: string;
    caption?: string;
    photo?: Array<{ file_id: string; file_size?: number }>;
  };
};

/**
 * Call a Telegram Bot API method. Returns the parsed `result` payload, or null
 * on any failure. Logs errors but doesn't throw — callers decide how to react.
 */
async function tg<T = void>(
  token: string,
  method: string,
  body: unknown,
): Promise<T | null> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`telegram ${method} HTTP ${res.status}: ${await res.text()}`);
    return null;
  }
  const data = (await res.json()) as {
    ok: boolean;
    result?: T;
    description?: string;
  };
  if (!data.ok) {
    console.error(`telegram ${method}: ${data.description}`);
    return null;
  }
  return data.result ?? (null as T | null);
}

export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
): Promise<void> {
  for (let i = 0; i < text.length; i += MESSAGE_LIMIT) {
    await tg(token, "sendMessage", {
      chat_id: chatId,
      text: text.slice(i, i + MESSAGE_LIMIT),
    });
  }
}

/**
 * Stream a partial message via Telegram's animated draft mechanism (Bot API 9.5).
 * Repeated calls with the same draft_id are animated as updates.
 */
export async function sendMessageDraft(
  token: string,
  chatId: number,
  draftId: number,
  text: string,
): Promise<void> {
  if (!text) return;
  await tg(token, "sendMessageDraft", {
    chat_id: chatId,
    draft_id: draftId,
    text: text.slice(0, MESSAGE_LIMIT),
  });
}

/**
 * Send a chat action ("typing…", "upload_photo", etc.). The indicator lasts
 * up to 5 seconds or until the bot sends a message — call this on a refresh
 * interval (see {@link withTyping}) for long-running turns.
 */
export async function sendChatAction(
  token: string,
  chatId: number,
  action:
    | "typing"
    | "upload_photo"
    | "upload_document"
    | "upload_voice"
    | "record_voice"
    | "find_location"
    | "choose_sticker",
): Promise<void> {
  await tg(token, "sendChatAction", { chat_id: chatId, action });
}

/**
 * Keep a typing indicator lit in the chat until `fn` resolves. Telegram's
 * action expires in ~5s, so we refresh every 4s. Refresh failures are logged
 * but don't fail the turn.
 */
export async function withTyping<T>(
  token: string,
  chatId: number,
  fn: () => Promise<T>,
): Promise<T> {
  await sendChatAction(token, chatId, "typing").catch(() => {});
  const interval = setInterval(() => {
    sendChatAction(token, chatId, "typing").catch((err) =>
      console.error("typing refresh failed:", err),
    );
  }, 4000);
  try {
    return await fn();
  } finally {
    clearInterval(interval);
  }
}

/**
 * Download a Telegram file by file_id. Returns the bytes plus a MIME type
 * inferred from the file extension.
 */
export async function getTelegramFile(
  token: string,
  fileId: string,
): Promise<{ bytes: Uint8Array; mediaType: string; ext: string } | null> {
  const meta = await tg<{ file_path?: string }>(token, "getFile", {
    file_id: fileId,
  });
  if (!meta?.file_path) return null;

  const res = await fetch(
    `https://api.telegram.org/file/bot${token}/${meta.file_path}`,
  );
  if (!res.ok) {
    console.error(`telegram file download HTTP ${res.status}`);
    return null;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ext = (meta.file_path.split(".").pop() ?? "bin").toLowerCase();
  return { bytes, mediaType: extToMime(ext), ext };
}

function extToMime(ext: string): string {
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    default:
      return "application/octet-stream";
  }
}
