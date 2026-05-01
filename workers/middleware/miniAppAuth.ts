import { createMiddleware } from "hono/factory";
import { validateInitData, type TelegramUser } from "../utils/validateInitData";

export type MiniAppVariables = { user: TelegramUser };

/**
 * Stateless Mini App auth: validate the X-Telegram-InitData header on every
 * request, ensure the embedded user matches the allowlist, and set `user` on
 * the Hono context.
 */
export const miniAppAuth = createMiddleware<{
  Bindings: Env;
  Variables: MiniAppVariables;
}>(async (c, next) => {
  const initData = c.req.header("X-Telegram-InitData");
  if (!initData) {
    return c.json({ error: "missing initData" }, 401);
  }

  const result = await validateInitData(initData, c.env.TELEGRAM_BOT_TOKEN);
  if (!result.ok) {
    return c.json({ error: `invalid initData: ${result.reason}` }, 401);
  }
  if (String(result.user.id) !== c.env.ALLOWED_TG_USER_ID) {
    return c.json({ error: "forbidden" }, 403);
  }

  c.set("user", result.user);
  await next();
});
