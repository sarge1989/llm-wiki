import { marked } from "marked";
import { rewriteWikilinks } from "../../workers/utils/wikilinks";

export type Frontmatter = Record<string, string>;

export type RenderedPage = {
  html: string;
  meta: Frontmatter;
};

/*
 * Sanitize raw HTML embedded in markdown.
 *
 * Wiki pages can include content the agent scraped from arbitrary URLs.
 * `marked` v9+ removed its built-in `sanitize` flag, and renders raw HTML as-is
 * via `dangerouslySetInnerHTML`. A scraped page with `<img onerror=...>` or
 * `<script>` could exfiltrate Telegram `initData` from the Mini App's JS scope.
 *
 * We escape rather than drop so the user can still see what the agent wrote,
 * but no tags execute.
 */
const escapeMap: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => escapeMap[c] ?? c);
}

marked.use({
  renderer: {
    html(token: { text: string }) {
      return escapeHtml(token.text);
    },
  },
});

/**
 * Render a wiki page's markdown to HTML, with YAML frontmatter parsed out
 * separately so the wiki view can render it as proper metadata instead of
 * letting `marked` collapse it into a paragraph.
 *
 * Supports flat `key: value` frontmatter only (no nested objects, no lists).
 * Sufficient for our drop conventions; can grow if needed.
 */
export function renderMarkdown(
  content: string,
  paths: Set<string>,
): RenderedPage {
  const { meta, body } = parseFrontmatter(content);
  const preprocessed = rewriteWikilinks(body, paths);
  const html = marked.parse(preprocessed, { gfm: true, async: false }) as string;
  return { html, meta };
}

function parseFrontmatter(content: string): {
  meta: Frontmatter;
  body: string;
} {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: content };

  const meta: Frontmatter = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line
      .slice(idx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key) meta[key] = value;
  }
  return { meta, body: content.slice(m[0].length) };
}
