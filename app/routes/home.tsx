import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useApi, useUser } from "../lib/ApiContext";
import { FolderTree } from "../components/FolderTree";
import { buildTree, type FlatPage } from "../lib/tree";

export function meta() {
  return [{ title: "llm-wiki" }];
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; pages: FlatPage[] }
  | { kind: "error"; message: string };

export default function Home() {
  const user = useUser();
  const api = useApi();
  const name = user.first_name ?? user.username ?? `user ${user.id}`;

  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ pages: FlatPage[] }>("/api/wiki/pages")
      .then((res) => {
        if (!cancelled) setState({ kind: "ready", pages: res.pages });
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
  }, [api]);

  return (
    <main className="mx-auto max-w-2xl p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">llm-wiki</h1>
        <Link to="/graph" className="text-sm text-link">
          graph →
        </Link>
      </header>
      <p className="mt-1 text-sm text-hint">Signed in as {name}.</p>

      <section className="mt-6">
        {state.kind === "loading" && (
          <p className="text-sm text-hint">Loading…</p>
        )}
        {state.kind === "error" && (
          <p className="text-sm" style={{ color: "#ff453a" }}>
            {state.message}
          </p>
        )}
        {state.kind === "ready" && state.pages.length === 0 && (
          <p className="text-sm text-hint">
            No wiki pages yet. Drop something to the bot in Telegram and it'll
            appear here.
          </p>
        )}
        {state.kind === "ready" && state.pages.length > 0 && (
          <FolderTree nodes={buildTree(state.pages)} />
        )}
      </section>
    </main>
  );
}
