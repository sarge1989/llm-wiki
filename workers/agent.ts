import { Think } from "@cloudflare/think";
import { createBrowserTools } from "@cloudflare/think/tools/browser";
import { Workspace } from "@cloudflare/shell";
import { createWorkersAI } from "workers-ai-provider";
import wikiPrompt from "./prompts/wiki.md?raw";
import { extractWikilinks, resolveLink } from "./utils/wikilinks";

declare global {
  namespace Cloudflare {
    interface Env {
      TELEGRAM_WEBHOOK_SECRET: string;
      ALLOWED_TG_USER_ID: string;
    }
  }
}

export type Env = Cloudflare.Env;

const MODEL = "@cf/moonshotai/kimi-k2.6";

export type WikiPageInfo = {
  path: string;
  name: string;
  size: number;
  updatedAt: number;
};

export type GraphNode = { id: string; label: string };
export type GraphEdge = { source: string; target: string };
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

export class MyAgent extends Think<Env> {
  /**
   * Override Think's default Workspace to enable R2 spillover for files above
   * the inline threshold (default 1.5 MB). Small files stay in DO SQLite (fast);
   * larger files (typical Telegram photos) go to R2 (cheaper, no per-DO cap).
   */
  override workspace = new Workspace({
    sql: this.ctx.storage.sql,
    r2: this.env.llm_wiki_workspace,
    name: () => this.name,
  });

  getModel() {
    return createWorkersAI({ binding: this.env.AI })(MODEL);
  }

  /**
   * Expose CDP-backed browser tools (`browser_search`, `browser_execute`) so
   * the agent can fetch URLs, extract page content, take screenshots, etc.
   * Used primarily for URL-drop ingestion — see workers/prompts/wiki.md.
   */
  getTools() {
    return {
      ...createBrowserTools({
        browser: this.env.BROWSER,
        loader: this.env.LOADER,
      }),
    };
  }

  getSystemPrompt(): string {
    const today = new Date().toISOString().slice(0, 16).replace("T", " ");
    return `${wikiPrompt}\n\n# Today\n\nCurrent UTC time: ${today}.`;
  }

  /** List all markdown files in the workspace. */
  async listPages(): Promise<WikiPageInfo[]> {
    const files = await this.workspace.glob("**/*.md");
    return files
      .filter((f) => f.type === "file")
      .map((f) => ({
        path: f.path,
        name: f.name,
        size: f.size,
        updatedAt: f.updatedAt,
      }));
  }

  /** Read a single workspace file. Returns null if missing. */
  async readPage(path: string): Promise<string | null> {
    return this.workspace.readFile(path);
  }

  /**
   * Persist arbitrary bytes (typically image/file uploads) to the workspace.
   * The default `WorkspaceLike` interface only exposes string ops; we cast to
   * the concrete `Workspace` for `writeFileBytes`. Safe because Think's
   * default workspace is the full class.
   */
  async saveBytes(
    path: string,
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<void> {
    const ws = this.workspace as Workspace;
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir) await ws.mkdir(dir, { recursive: true });
    await ws.writeFileBytes(path, bytes, mediaType);
  }

  /** Build a force-directed-graph payload from `[[wikilinks]]` between .md pages. */
  async getGraph(): Promise<GraphData> {
    const files = await this.workspace.glob("**/*.md");
    const mdFiles = files.filter((f) => f.type === "file");
    const paths = new Set(mdFiles.map((f) => f.path));

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const seen = new Set<string>();

    for (const file of mdFiles) {
      const content = await this.workspace.readFile(file.path);
      if (content == null) continue;
      nodes.push({ id: file.path, label: pageTitle(file.path, content) });
      for (const link of extractWikilinks(content)) {
        const resolved = resolveLink(link.target, paths);
        if (!resolved || resolved === file.path) continue;
        const key = `${file.path}->${resolved}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ source: file.path, target: resolved });
      }
    }

    return { nodes, edges };
  }
}

function pageTitle(path: string, content: string): string {
  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return path.split("/").pop()!.replace(/\.md$/i, "");
}
