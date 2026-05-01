import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  layout("layouts/miniapp.tsx", [
    index("routes/home.tsx"),
    route("wiki", "routes/wiki.tsx"),
    route("graph", "routes/graph.tsx"),
  ]),
] satisfies RouteConfig;
