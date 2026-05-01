const MESSAGE_LIMIT = 4096;

export type TelegramUpdate = {
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number };
    text?: string;
  };
};

async function call(
  token: string,
  method: string,
  body: unknown,
): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`telegram ${method} failed: ${res.status} ${await res.text()}`);
  }
}

export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
): Promise<void> {
  for (let i = 0; i < text.length; i += MESSAGE_LIMIT) {
    await call(token, "sendMessage", {
      chat_id: chatId,
      text: text.slice(i, i + MESSAGE_LIMIT),
    });
  }
}

/**
 * Stream a partial message via Telegram's animated draft mechanism (Bot API 9.5).
 * Repeated calls with the same draft_id are animated as updates.
 * Drafts are capped at 4096 chars — we send the head of the buffer; the final
 * full text gets committed via {@link sendMessage}.
 */
export async function sendMessageDraft(
  token: string,
  chatId: number,
  draftId: number,
  text: string,
): Promise<void> {
  if (!text) return;
  await call(token, "sendMessageDraft", {
    chat_id: chatId,
    draft_id: draftId,
    text: text.slice(0, MESSAGE_LIMIT),
  });
}
