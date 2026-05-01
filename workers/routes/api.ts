import { Hono } from "hono";
import { getAgentByName } from "agents";
import { miniAppAuth, type MiniAppVariables } from "../middleware/miniAppAuth";

const app = new Hono<{ Bindings: Env; Variables: MiniAppVariables }>();

app.use("*", miniAppAuth);

app.get("/me", (c) => c.json({ user: c.get("user") }));

app.get("/wiki/pages", async (c) => {
  const agent = await getAgentByName(
    c.env.MyAgent,
    String(c.get("user").id),
  );
  const pages = await agent.listPages();
  return c.json({ pages });
});

app.get("/wiki/page", async (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "missing ?path=" }, 400);

  const agent = await getAgentByName(
    c.env.MyAgent,
    String(c.get("user").id),
  );
  const content = await agent.readPage(path);
  if (content === null) return c.json({ error: "not found" }, 404);
  return c.json({ path, content });
});

app.get("/graph", async (c) => {
  const agent = await getAgentByName(
    c.env.MyAgent,
    String(c.get("user").id),
  );
  const graph = await agent.getGraph();
  return c.json(graph);
});

export default app;
