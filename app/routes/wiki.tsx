import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useApi } from "../lib/ApiContext";
import { renderMarkdown, type Frontmatter } from "../lib/markdown";

export function meta() {
  return [{ title: "wiki — llm-wiki" }];
}

type Page = { path: string };

type State =
  | { kind: "loading" }
  | { kind: "ready"; html: string; meta: Frontmatter; path: string }
  | { kind: "error"; message: string };

export default function WikiPage() {
  const api = useApi();
  const [params] = useSearchParams();
  const path = params.get("path");

  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!path) {
      setState({ kind: "error", message: "Missing ?path= query param." });
      return;
    }
    let cancelled = false;
    Promise.all([
      api.get<{ path: string; content: string }>(
        `/api/wiki/page?path=${encodeURIComponent(path)}`,
      ),
      api.get<{ pages: Page[] }>("/api/wiki/pages"),
    ])
      .then(([page, list]) => {
        if (cancelled) return;
        const paths = new Set(list.pages.map((p) => p.path));
        const rendered = renderMarkdown(page.content, paths);
        setState({
          kind: "ready",
          html: rendered.html,
          meta: rendered.meta,
          path: page.path,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to load",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [api, path]);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link to="/" className="text-sm text-link">
        ← back
      </Link>
      <p className="mt-2 break-all text-xs text-hint">{path ?? "(no path)"}</p>

      {state.kind === "loading" && (
        <p className="mt-6 text-sm text-hint">Loading…</p>
      )}
      {state.kind === "error" && (
        <p className="mt-6 text-sm" style={{ color: "#ff453a" }}>
          {state.message}
        </p>
      )}
      {state.kind === "ready" && (
        <>
          {state.meta.title && (
            <h1 className="mt-4 text-2xl font-bold">{state.meta.title}</h1>
          )}
          <MetaBlock meta={state.meta} />
          <article
            className="markdown"
            dangerouslySetInnerHTML={{ __html: state.html }}
          />
        </>
      )}
    </main>
  );
}

const HIDE_KEYS = new Set(["title"]); // title is rendered separately as <h1>

function MetaBlock({ meta }: { meta: Frontmatter }) {
  const entries = Object.entries(meta).filter(([k]) => !HIDE_KEYS.has(k));
  if (entries.length === 0) return null;
  return (
    <dl className="markdown-meta mt-3">
      {entries.map(([key, value]) => (
        <Fragment key={key}>
          <dt>{key}</dt>
          <dd>{renderValue(value)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function renderValue(value: string): ReactNode {
  if (/^https?:\/\//.test(value)) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-link"
      >
        {value}
      </a>
    );
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      return (
        <time dateTime={value}>
          {d.toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </time>
      );
    }
  }
  return value;
}
