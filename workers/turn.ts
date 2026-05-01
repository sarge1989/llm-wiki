import { RpcTarget } from "cloudflare:workers";
import { getAgentByName } from "agents";
import type { Env } from "./agent";
import {
  getTelegramFile,
  sendMessage,
  sendMessageDraft,
} from "./telegram";

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

export async function handleTurn(
  env: Env,
  chatId: number,
  draftId: number,
  text: string,
): Promise<void> {
  try {
    if (text.startsWith("/")) {
      const cmd = text.split(/[\s@]/)[0].toLowerCase();
      if (cmd === "/start") {
        await sendMessage(
          env.TELEGRAM_BOT_TOKEN,
          chatId,
          "Send me a message to start talking to the agent. /clear to reset our conversation.",
        );
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

/**
 * Photo-with-caption turn. Downloads the image from Telegram, content-addresses
 * it into the workspace, and sends a multimodal UIMessage (caption + image
 * data URL) to the agent. The system prompt knows how to file the result.
 */
export async function handleImageTurn(
  env: Env,
  chatId: number,
  draftId: number,
  fileId: string,
  caption: string,
): Promise<void> {
  try {
    const file = await getTelegramFile(env.TELEGRAM_BOT_TOKEN, fileId);
    if (!file) {
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        "⚠️ Couldn't fetch that image from Telegram.",
      );
      return;
    }

    const hashBuf = await crypto.subtle.digest(
      "SHA-256",
      file.bytes.buffer as ArrayBuffer,
    );
    const hash = [...new Uint8Array(hashBuf)]
      .slice(0, 6)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const wsPath = `drops/images/${hash}.${file.ext}`;

    const sink = new TelegramDraftSink(env.TELEGRAM_BOT_TOKEN, chatId, draftId);
    const agent = await getAgentByName(env.MyAgent, String(chatId));

    await agent.saveBytes(wsPath, file.bytes, file.mediaType);

    const dataUrl = `data:${file.mediaType};base64,${bytesToBase64(file.bytes)}`;
    const captionText = caption.trim();
    const userText = captionText
      ? `${captionText}\n\n_(Telegram image — saved at \`${wsPath}\`)_`
      : `_(Telegram image — no caption — saved at \`${wsPath}\`)_`;

    await agent.chat(
      {
        id: crypto.randomUUID(),
        role: "user",
        parts: [
          { type: "text", text: userText },
          { type: "file", mediaType: file.mediaType, url: dataUrl },
        ],
      },
      sink,
    );
    await sink.settle();
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, sink.text || "(empty reply)");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("image turn failed:", err);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `⚠️ ${detail}`);
  }
}

/** btoa-friendly base64 encoder for Uint8Array, chunked to avoid stack overflow on large buffers. */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(""));
}
