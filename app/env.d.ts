import type { AppLoadContext as OriginalAppLoadContext } from "react-router";

declare module "react-router" {
  interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

export {};
