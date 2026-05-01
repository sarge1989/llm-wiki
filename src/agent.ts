import { Think } from "@cloudflare/think";
import { createWorkersAI } from "workers-ai-provider";

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

export class MyAgent extends Think<Env> {
  getModel() {
    return createWorkersAI({ binding: this.env.AI })(MODEL);
  }
}
