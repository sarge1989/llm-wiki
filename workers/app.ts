import { Hono } from "hono";
import { createRequestHandler } from "react-router";
import apiRoutes from "./routes/api";
import webhookRoutes from "./routes/webhook";

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

export default app;
export { MyAgent } from "./agent";
