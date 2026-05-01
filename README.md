# llm-wiki

A personal "idea dump" knowledge base. Drop links, photos, and stray thoughts to a Telegram bot; an LLM agent files them into an evolving wiki of markdown drops and topic pages, which you browse via a Telegram Mini App.

Inspired by [Karpathy's LLM-wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — instead of RAG re-discovering knowledge from scratch on every query, the LLM **incrementally maintains** a structured wiki: filing raw drops, lazily creating topic pages once a theme has at least two contributing drops, cross-linking aggressively, and updating an index. The wiki is a compounding artifact, not a re-derived one.

## What's in the box

- **Telegram bot** for capture — text, photos with captions, URLs (browser-extracted to markdown). Streams the agent's reply back via Telegram's animated `sendMessageDraft` (Bot API 9.5).
- **[Cloudflare Project Think](https://blog.cloudflare.com/project-think/) agent** as a Durable Object — handles message persistence, turn lifecycle, tool execution, durable workspace.
- **Telegram Mini App** front-end built on React Router 7 (framework mode, SSR via the same Worker). Lists drops, renders pages with frontmatter as a metadata block, and has a Cytoscape force-directed **graph view** of `[[wikilinks]]` between pages.
- **Per-request stateless auth** for the Mini App: every API call sends Telegram `initData` in a header, the worker re-validates HMAC server-side. No JWTs, no session DB.
- **R2 spillover** for the workspace — small files in DO SQLite (fast), large files (typical photos) in R2 (cheap, no per-DO size cap).

## Stack

- Cloudflare Workers + Durable Objects (SQLite-backed) + R2 + Workers AI + Browser Rendering + Worker Loaders
- [`@cloudflare/think`](https://github.com/cloudflare/agents/tree/main/packages/think) for the agent runtime; `@cloudflare/shell` for the workspace; `@cloudflare/codemode` for browser tools
- Workers AI **`@cf/moonshotai/kimi-k2.6`** — multimodal so the agent sees images natively
- Hono in the Worker entry; React Router v7 for the Mini App; Tailwind v4; Cytoscape.js for the graph
- `@twa-dev/sdk` for the Telegram WebApp API in the browser

## Repo layout

```
workers/
  app.ts                 Hono entry: /webhook + /api/* + RR SSR fallback. Exports MyAgent.
  agent.ts               MyAgent (Think subclass). Overrides workspace (R2 spillover),
                         getModel, getSystemPrompt, getTools (browser).
  turn.ts                handleTurn (text), handleImageTurn (photo+caption),
                         TelegramDraftSink (streams chunks → sendMessageDraft).
  telegram.ts            Bot API client: sendMessage, sendMessageDraft, getTelegramFile.
  prompts/wiki.md        System prompt — Karpathy-style wiki conventions.
  routes/
    webhook.ts           POST /webhook — Telegram updates dispatcher.
    api.ts               GET /api/me, /api/wiki/pages, /api/wiki/page, /api/graph.
  middleware/
    miniAppAuth.ts       Stateless per-request initData validation.
  utils/
    validateInitData.ts  Pure WebCrypto HMAC verifier for Telegram initData.
    wikilinks.ts         [[Wikilink]] extraction + resolution.

app/
  root.tsx               HTML shell + ErrorBoundary.
  entry.server.tsx       SSR render entry.
  routes.ts              Route config (everything wrapped in miniapp layout).
  layouts/miniapp.tsx    Boots WebApp.ready/expand, fetches /api/me, provides ApiContext.
  routes/
    home.tsx             Lists drops newest-first; link to graph.
    wiki.tsx             /wiki?path=… — renders markdown with frontmatter metadata block.
    graph.tsx            /graph — Cytoscape force-directed graph of wikilinks.
  lib/
    api.ts               Fetch wrapper: injects X-Telegram-InitData on every call.
    ApiContext.tsx       useApi() / useUser() React contexts.
    markdown.ts          Frontmatter parser + marked + wikilink rewriting.
  app.css                Tailwind + Telegram theme bridge + .markdown styles.
```

## Set this up on your own Cloudflare account

### Prerequisites

- Node.js 20+
- A Cloudflare account
- A domain on Cloudflare (or use `*.workers.dev`) for the production deploy
- A laptop tunnel for local dev — [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) is the cleanest option
- Cloudflare account features enabled (some are paid):
  - **Workers AI** — usage-billed, modest costs for personal use
  - **Browser Rendering** — has a free tier; `@cloudflare/codemode` + browser tools depend on it
  - **Worker Loaders** — required by `@cloudflare/codemode`; check availability on your account
  - **R2** — pay-as-you-go, very cheap

`wrangler` (Cloudflare's CLI) is included as a devDependency, so `npm install` covers it — you don't need a global install. All `wrangler ...` commands below should be run as `npx wrangler ...` so they pick up the project-local version.

### 1. Clone + install

```bash
git clone <your-fork>
cd llm-wiki
npm install
```

### 2. Authenticate wrangler with your Cloudflare account

Required for any production task (deploy, secret push, R2 bucket creation). Local dev uses simulators and doesn't strictly need this.

```bash
npx wrangler login
```

Opens a browser; sign in to Cloudflare and authorize. The token is cached on your machine — you only do this once per laptop.

### 3. Get a Telegram bot

DM **@BotFather** in Telegram → `/newbot` → follow the prompts → save the bot token.

### 4. Get your Telegram user ID

DM **@userinfobot** → copy the numeric ID. This is the only ID the bot will respond to (single-user allowlist).

### 5. Local environment

Create `.dev.vars` in the repo root (gitignored):

```
TELEGRAM_BOT_TOKEN=<from BotFather>
TELEGRAM_WEBHOOK_SECRET=<any random string you choose>
ALLOWED_TG_USER_ID=<your numeric Telegram user ID>
```

Regenerate the runtime types so they're picked up:

```bash
npm run cf-typegen
```

This shells out to `npx wrangler types` — the bundled wrangler from step 1.

### 6. Set up a tunnel for local dev

Telegram requires HTTPS for webhooks and Mini App URLs, so you need a public URL pointing at `localhost:8421`.

The simplest option for casual dev:

```bash
cloudflared tunnel --url http://localhost:8421
```

Cloudflared prints a `https://*.trycloudflare.com` URL. For a stable URL across restarts (recommended), set up a [named tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-local-tunnel/) mapped to a subdomain you control.

### 7. Run dev

```bash
npm run dev
```

This starts Vite + the Cloudflare runtime (workerd) on port 8421. Both the webhook handler and the Mini App SSR are served from the same worker.

### 8. Register the Telegram webhook

Telegram needs to know where to POST updates. Substitute your bot token, tunnel URL, and webhook secret:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d 'url=https://<your-tunnel>/webhook' \
  -d 'secret_token=<TELEGRAM_WEBHOOK_SECRET>'
```

Verify it took:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

`url` should match what you set; `last_error_message` should be empty.

### 9. Register the Mini App menu button

So you can launch the Mini App from inside the bot chat:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setChatMenuButton" \
  -H "Content-Type: application/json" \
  -d '{
    "menu_button": {
      "type": "web_app",
      "text": "Open Wiki",
      "web_app": {"url": "https://<your-tunnel>/"}
    }
  }'
```

(Optional but nice: register the `/start` and `/clear` commands so they appear in the bot's `/` autocomplete.)

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setMyCommands" \
  -H "Content-Type: application/json" \
  -d '{"commands":[
    {"command":"start","description":"Welcome message"},
    {"command":"clear","description":"Reset the conversation"}
  ]}'
```

### 10. Try it

Open the bot in Telegram, send a message ("hello"), and watch the agent reply. Tap the menu button to open the Mini App and see the page appear.

## Production deploy

(Make sure you ran `npx wrangler login` from step 2 — these all hit your Cloudflare account.)

### 1. Create the R2 bucket

```bash
npx wrangler r2 bucket create llm-wiki-workspace
```

(If you change the bucket name, also update `wrangler.jsonc`.)

### 2. Push secrets

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put ALLOWED_TG_USER_ID
```

### 3. Deploy

```bash
npm run deploy
```

This builds the Mini App (`react-router build`) and pushes the worker to your account. The output prints the deployed URL (`https://llm-wiki.<subdomain>.workers.dev` by default).

### 4. Re-point Telegram

Update both the webhook and the Mini App menu button to the deployed URL:

```bash
# webhook
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d 'url=https://llm-wiki.<subdomain>.workers.dev/webhook' \
  -d 'secret_token=<TELEGRAM_WEBHOOK_SECRET>'

# menu button
curl -X POST "https://api.telegram.org/bot<TOKEN>/setChatMenuButton" \
  -H "Content-Type: application/json" \
  -d '{
    "menu_button": {
      "type": "web_app",
      "text": "Open Wiki",
      "web_app": {"url": "https://llm-wiki.<subdomain>.workers.dev/"}
    }
  }'
```

If you're routing a custom domain through Workers, swap that domain in instead.

## Customization

- **Wiki conventions** — edit `workers/prompts/wiki.md`. This is the single biggest knob; the agent's behaviour follows from this prompt.
- **Model** — change `MODEL` in `workers/agent.ts`. Anything in the [Workers AI catalog](https://developers.cloudflare.com/workers-ai/models/) works; multimodal is needed if you want photo ingestion.
- **Wikilink resolution** — `workers/utils/wikilinks.ts` decides what `[[Foo]]` resolves to. Default tries: `Foo.md`, kebab-cased, `topics/foo.md`.
- **Bot commands** — `handleTurn` in `workers/turn.ts` dispatches `/start` and `/clear`. Add your own there.

## Known gaps

- **Document and voice ingestion** are not yet wired. Only text and photos work end-to-end. PDFs, .docx, and voice notes (Telegram's `document` / `voice` updates) are silently dropped.
- **Browser tools may not work in local dev** — miniflare's simulation of Browser Rendering and Worker Loaders is incomplete; URL drops fall back to stub markdown locally and only fully resolve once deployed.
- **Single user only** — multi-user would require keying the DO by user ID instead of chat ID, plus broader auth. The current design is intentionally personal.
- **No sync to disk / Obsidian** — the workspace lives entirely inside the DO + R2. If you want to point Obsidian at this, you'd need a periodic git push from the Worker (planned, not built).

## Scripts

```
npm run dev         # Vite + workerd dev server on :8421
npm run build       # react-router build (client + SSR bundles)
npm run deploy      # build + wrangler deploy
npm run cf-typegen  # regenerate worker-configuration.d.ts from wrangler.jsonc + .dev.vars
npm run typecheck   # react-router typegen + tsc -b
npm run reset:db    # kill dev server + wipe .wrangler/ (local DO + R2 simulator state)
```

## License

MIT
