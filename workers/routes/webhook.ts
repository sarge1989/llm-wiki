import { Hono } from "hono";
import type { TelegramUpdate } from "../telegram";
import type { QueueMessage } from "../turn";
import { constantTimeEqual } from "../utils/safeCompare";

const app = new Hono<{ Bindings: Env }>();

app.post("/", async (c) => {
  const provided = c.req.header("X-Telegram-Bot-Api-Secret-Token");
  if (
    typeof provided !== "string" ||
    !constantTimeEqual(provided, c.env.TELEGRAM_WEBHOOK_SECRET)
  ) {
    return c.text("forbidden", 403);
  }

  let update: TelegramUpdate;
  try {
    update = (await c.req.json()) as TelegramUpdate;
  } catch (err) {
    // Malformed body — ack to Telegram so it doesn't retry; log for triage.
    console.error("webhook json parse failed:", err);
    return c.text("ok");
  }

  const msg = update.message;

  // Single-user allowlist; private DMs only.
  if (
    !msg ||
    msg.chat.type !== "private" ||
    String(msg.from?.id) !== c.env.ALLOWED_TG_USER_ID
  ) {
    return c.text("ok");
  }

  // Push to the queue and return immediately. The queue consumer (defined
  // in workers/app.ts) does the heavy lifting with up to 15 minutes of
  // wall-clock budget — far more than ctx.waitUntil's 30-second cap.
  let queueMessage: QueueMessage | null = null;
  if (msg.photo && msg.photo.length > 0) {
    queueMessage = {
      kind: "image",
      chatId: msg.chat.id,
      messageId: msg.message_id,
      fileId: msg.photo[msg.photo.length - 1].file_id,
      caption: msg.caption ?? "",
    };
  } else if (msg.text) {
    queueMessage = {
      kind: "text",
      chatId: msg.chat.id,
      messageId: msg.message_id,
      text: msg.text,
    };
  }

  if (queueMessage) {
    try {
      await c.env.TASK_QUEUE.send(queueMessage);
    } catch (err) {
      console.error("queue send failed:", err);
      // Still ack to avoid Telegram retries — the user can resend if needed.
    }
  }

  return c.text("ok");
});

export default app;
