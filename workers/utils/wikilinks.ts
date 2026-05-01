/**
 * Shared wikilink parsing + resolution. Used by the agent (graph extraction)
 * and the markdown renderer (link rewriting).
 */

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;

export type WikiLink = {
  target: string;
  anchor?: string;
  alias?: string;
};

export function extractWikilinks(content: string): WikiLink[] {
  const out: WikiLink[] = [];
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(content)) !== null) {
    const target = m[1].trim();
    if (!target) continue;
    out.push({
      target,
      anchor: m[2]?.trim() || undefined,
      alias: m[3]?.trim() || undefined,
    });
  }
  return out;
}

/**
 * Resolve a wikilink target to an existing workspace path.
 * Tries: as-is, plus .md, kebab-cased, and under topics/.
 * Returns null if no candidate matches.
 */
export function resolveLink(target: string, paths: Set<string>): string | null {
  const base = target.replace(/\.md$/i, "");
  const slug = base.toLowerCase().replace(/\s+/g, "-");
  const candidates = [
    `${base}.md`,
    `${slug}.md`,
    `topics/${slug}.md`,
    `topics/${base}.md`,
    target,
  ];
  for (const c of candidates) if (paths.has(c)) return c;
  return null;
}

/**
 * Replace `[[wikilinks]]` in markdown with standard markdown links. Unresolved
 * targets render as a span with `wikilink-broken` class.
 */
export function rewriteWikilinks(
  content: string,
  paths: Set<string>,
  wikiUrlPrefix = "/wiki?path=",
): string {
  return content.replace(
    WIKILINK_RE,
    (_match, rawTarget: string, rawAnchor: string | undefined, rawAlias: string | undefined) => {
      const target = rawTarget.trim();
      const display = (rawAlias ?? target).trim();
      const resolved = resolveLink(target, paths);
      if (resolved) {
        const anchor = rawAnchor ? `#${rawAnchor.trim()}` : "";
        return `[${display}](${wikiUrlPrefix}${encodeURIComponent(resolved)}${anchor})`;
      }
      return `<span class="wikilink-broken">${display}</span>`;
    },
  );
}
