import { Hono } from "hono";
import { handleImageTurn, handleTurn } from "../turn";
import type { TelegramUpdate } from "../telegram";
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

  const update = (await c.req.json()) as TelegramUpdate;
  const msg = update.message;

  if (
    !msg ||
    msg.chat.type !== "private" ||
    String(msg.from?.id) !== c.env.ALLOWED_TG_USER_ID
  ) {
    return c.text("ok");
  }

  if (msg.photo && msg.photo.length > 0) {
    // Use the largest photo (last in the array) for best vision-model fidelity
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    c.executionCtx.waitUntil(
      handleImageTurn(
        c.env,
        msg.chat.id,
        msg.message_id,
        fileId,
        msg.caption ?? "",
      ),
    );
  } else if (msg.text) {
    c.executionCtx.waitUntil(
      handleTurn(c.env, msg.chat.id, msg.message_id, msg.text),
    );
  }

  return c.text("ok");
});

export default app;
