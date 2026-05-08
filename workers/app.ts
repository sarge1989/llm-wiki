import { Hono } from "hono";
import { createRequestHandler } from "react-router";
import apiRoutes from "./routes/api";
import webhookRoutes from "./routes/webhook";
import { processQueueMessage, type QueueMessage } from "./turn";

const app = new Hono<{ Bindings: Env }>();

app.route("/webhook", webhookRoutes);
app.route("/api", apiRoutes);

// React Router SSR fallback for everything else
app.get("*", (c) => {
  const requestHandler = createRequestHandler(
    () => import("virtual:react-router/server-build"),
    import.meta.env.MODE,
  );
  return requestHandler(c.req.raw, {
    cloudflare: { env: c.env, ctx: c.executionCtx as ExecutionContext },
  });
});

export default {
  fetch: app.fetch,

  /**
   * Queue consumer. Telegram updates land on /webhook, get pushed to the
   * `llm-wiki-tasks` queue, and arrive here for the actual agent work.
   *
   * Each message is acked unconditionally — handleTurn / handleImageTurn
   * already report errors to the user via Telegram, so retrying would
   * cause duplicate processing. The wrangler.jsonc consumer config sets
   * `max_retries: 0` as belt-and-braces.
   */
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: Env,
  ): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processQueueMessage(env, message.body);
      } catch (err) {
        console.error("queue process failed:", err);
      }
      message.ack();
    }
  },
} satisfies ExportedHandler<Env, QueueMessage>;

export { MyAgent } from "./agent";
