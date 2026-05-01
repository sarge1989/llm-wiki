import { RpcTarget } from "cloudflare:workers";
import { getAgentByName } from "agents";
import { type Env, MyAgent } from "./agent";
import {
  sendMessage,
  sendMessageDraft,
  type TelegramUpdate,
} from "./telegram";

export { MyAgent };

const DRAFT_THROTTLE_MS = 800;

/**
 * RpcTarget passed to `agent.chat()`. Methods are invoked from the agent DO
 * via RPC; mutable fields stay local to the worker side.
 *
 * We accumulate `text-delta` chunks, throttle draft updates, and serialize
 * Telegram API calls through a promise chain so concurrent inflight requests
 * can't race or trip Telegram's per-chat rate limit.
 */
class TelegramDraftSink extends RpcTarget {
  text = "";
  private lastFlush = 0;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private token: string,
    private chatId: number,
    private draftId: number,
  ) {
    super();
  }

  onEvent(json: string) {
    let ev: { type?: string; delta?: string };
    try {
      ev = JSON.parse(json);
    } catch {
      return;
    }
    if (ev.type !== "text-delta" || typeof ev.delta !== "string") return;
    this.text += ev.delta;

    const now = Date.now();
    if (now - this.lastFlush < DRAFT_THROTTLE_MS) return;
    this.lastFlush = now;
    this.enqueue(this.text);
  }

  onDone() {}

  onError(error: string) {
    console.error("agent stream error:", error);
  }

  async settle(): Promise<void> {
    await this.pending;
  }

  private enqueue(snapshot: string) {
    this.pending = this.pending
      .then(() => sendMessageDraft(this.token, this.chatId, this.draftId, snapshot))
      .catch((err) => console.error("draft flush failed:", err));
  }
}

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("not found", { status: 404 });
    }
    if (
      req.headers.get("X-Telegram-Bot-Api-Secret-Token") !==
      env.TELEGRAM_WEBHOOK_SECRET
    ) {
      return new Response("forbidden", { status: 403 });
    }

    const update = (await req.json()) as TelegramUpdate;
    const msg = update.message;

    if (
      msg?.text &&
      msg.chat.type === "private" &&
      String(msg.from?.id) === env.ALLOWED_TG_USER_ID
    ) {
      ctx.waitUntil(handleTurn(env, msg.chat.id, msg.message_id, msg.text));
    }

    return new Response("ok");
  },
} satisfies ExportedHandler<Env>;

async function handleTurn(
  env: Env,
  chatId: number,
  draftId: number,
  text: string,
): Promise<void> {
  try {
    if (text.startsWith("/")) {
      const cmd = text.split(/[\s@]/)[0].toLowerCase();
      if (cmd === "/start") {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "Send me a message to start talking to the agent. /clear to reset our conversation.");
        return;
      }
      if (cmd === "/clear") {
        const agent = await getAgentByName(env.MyAgent, String(chatId));
        await agent.clearMessages();
        await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "Cleared. Fresh start.");
        return;
      }
    }

    const sink = new TelegramDraftSink(env.TELEGRAM_BOT_TOKEN, chatId, draftId);
    const agent = await getAgentByName(env.MyAgent, String(chatId));
    await agent.chat(text, sink);
    await sink.settle();
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, sink.text || "(empty reply)");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("turn failed:", err);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `⚠️ ${detail}`);
  }
}
