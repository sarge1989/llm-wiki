import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useApi } from "../lib/ApiContext";

export function meta() {
  return [{ title: "graph — llm-wiki" }];
}

type GraphData = {
  nodes: Array<{ id: string; label: string }>;
  edges: Array<{ source: string; target: string }>;
};

type Status =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "rendered"; nodes: number; edges: number }
  | { kind: "error"; message: string };

export default function GraphView() {
  const api = useApi();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    let cyInstance: { destroy: () => void } | null = null;

    (async () => {
      try {
        const [{ default: cytoscape }, data] = await Promise.all([
          import("cytoscape"),
          api.get<GraphData>("/api/graph"),
        ]);
        if (cancelled || !containerRef.current) return;

        if (data.nodes.length === 0) {
          setStatus({ kind: "empty" });
          return;
        }

        const styles = getComputedStyle(document.documentElement);
        const fg =
          styles.getPropertyValue("--tg-theme-text-color")?.trim() || "#000";
        const button =
          styles.getPropertyValue("--tg-theme-button-color")?.trim() ||
          "#2481cc";
        const hint =
          styles.getPropertyValue("--tg-theme-hint-color")?.trim() || "#888";

        const cy = cytoscape({
          container: containerRef.current,
          elements: [
            ...data.nodes.map((n) => ({ data: { id: n.id, label: n.label } })),
            ...data.edges.map((e) => ({
              data: { source: e.source, target: e.target },
            })),
          ],
          style: [
            {
              selector: "node",
              style: {
                "background-color": button,
                label: "data(label)",
                color: fg,
                "font-size": 11,
                "text-valign": "bottom",
                "text-margin-y": 6,
                width: 14,
                height: 14,
              },
            },
            {
              selector: "edge",
              style: {
                width: 1,
                "line-color": hint,
                "target-arrow-color": hint,
                "target-arrow-shape": "triangle",
                "curve-style": "bezier",
              },
            },
          ],
          // cose (force-directed) needs edges to do anything sensible.
          // Falling back to grid for sparse/disconnected graphs gives us
          // visible nodes regardless of how the agent has been linking.
          layout:
            data.edges.length > 0
              ? { name: "cose", animate: false, padding: 30, fit: true }
              : { name: "grid", padding: 30, fit: true },
        });

        cy.on("tap", "node", (evt) => {
          const id = evt.target.data("id") as string;
          navigate(`/wiki?path=${encodeURIComponent(id)}`);
        });

        cy.ready(() => cy.fit(undefined, 30));
        cyInstance = cy;
        setStatus({
          kind: "rendered",
          nodes: data.nodes.length,
          edges: data.edges.length,
        });
      } catch (e) {
        if (cancelled) return;
        setStatus({
          kind: "error",
          message: e instanceof Error ? e.message : "Failed to load graph",
        });
      }
    })();

    return () => {
      cancelled = true;
      cyInstance?.destroy();
    };
  }, [api, navigate]);

  return (
    <main className="flex flex-col" style={{ height: "100dvh" }}>
      <header className="flex items-center justify-between gap-3 p-4">
        <h1 className="text-lg font-semibold">graph</h1>
        <div className="flex items-center gap-3 text-xs text-hint">
          {status.kind === "rendered" && (
            <span>
              {status.nodes} node{status.nodes === 1 ? "" : "s"} ·{" "}
              {status.edges} edge{status.edges === 1 ? "" : "s"}
            </span>
          )}
          <Link to="/" className="text-sm text-link">
            ← back
          </Link>
        </div>
      </header>
      <div className="relative flex-1" style={{ minHeight: 0 }}>
        <div
          ref={containerRef}
          style={{ position: "absolute", inset: 0 }}
        />
        {status.kind === "loading" && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-hint">
            Loading…
          </p>
        )}
        {status.kind === "empty" && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-hint">
            No pages yet. Drop something to the bot first.
          </p>
        )}
        {status.kind === "error" && (
          <p
            className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm"
            style={{ color: "#ff453a" }}
          >
            {status.message}
          </p>
        )}
      </div>
    </main>
  );
}
