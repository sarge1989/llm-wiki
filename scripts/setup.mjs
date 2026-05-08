#!/usr/bin/env node
/**
 * One-shot installer. Walks the user through:
 *   1. wrangler login (Cloudflare auth)
 *   2. Telegram bot token + user ID
 *   3. Generate webhook secret
 *   4. Write .dev.vars (so local dev works)
 *   5. Create R2 bucket (idempotent)
 *   6. Push secrets to the deployed worker
 *   7. Build + deploy
 *   8. Register Telegram webhook + Mini App menu button + bot commands
 *
 * No new dependencies — uses only Node built-ins (readline, child_process,
 * crypto, fs).
 */

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, exit } from "node:process";
import { randomBytes } from "node:crypto";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const DEFAULT_SLUG = "llm-wiki";
const WRANGLER_PATH = "wrangler.jsonc";
const AGENT_PATH = "workers/agent.ts";

/**
 * Cloudflare resource names are account-scoped, so two deployments of this
 * repo into the same account must use different worker / R2 / queue names.
 * Derive a slug from the bot's @username — unique within the user's
 * Telegram account, sanitized to Cloudflare's lowercase-kebab convention.
 */
function slugFromUsername(username) {
  return username
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Idempotent text find-and-replace across wrangler.jsonc + workers/agent.ts.
 * The default strings are unique enough that a parser-free replaceAll is
 * safe. If `currentSlug` isn't in the files (already substituted), no-op.
 */
function applySlug(currentSlug, newSlug) {
  if (currentSlug === newSlug) return false;

  const wranglerBefore = readFileSync(WRANGLER_PATH, "utf8");
  const wranglerAfter = wranglerBefore
    .replaceAll(`"name": "${currentSlug}"`, `"name": "${newSlug}"`)
    .replaceAll(
      `"bucket_name": "${currentSlug}-workspace"`,
      `"bucket_name": "${newSlug}-workspace"`,
    )
    .replaceAll(
      `"queue": "${currentSlug}-tasks"`,
      `"queue": "${newSlug}-tasks"`,
    );
  if (wranglerBefore !== wranglerAfter) writeFileSync(WRANGLER_PATH, wranglerAfter);

  const agentBefore = readFileSync(AGENT_PATH, "utf8");
  const agentAfter = agentBefore.replaceAll(
    `id: "${currentSlug}"`,
    `id: "${newSlug}"`,
  );
  if (agentBefore !== agentAfter) writeFileSync(AGENT_PATH, agentAfter);

  return wranglerBefore !== wranglerAfter || agentBefore !== agentAfter;
}

/** Read the current worker name from wrangler.jsonc to detect prior substitution. */
function currentSlug() {
  const m = readFileSync(WRANGLER_PATH, "utf8").match(/"name":\s*"([^"]+)"/);
  return m?.[1] ?? DEFAULT_SLUG;
}

const rl = createInterface({ input: stdin, output: stdout });
const ask = (q) => rl.question(q);
const log = (s = "") => console.log(s);
const fail = (msg) => {
  console.error(`\n❌ ${msg}`);
  rl.close();
  exit(1);
};

/** Run a command, stream output, throw on non-zero exit. */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`);
}

/** Run a command, capture stdout, throw on non-zero exit. */
function capture(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: ["inherit", "pipe", "pipe"], ...opts });
  if (r.status !== 0) {
    const err = r.stderr?.toString() || r.stdout?.toString() || "";
    const e = new Error(`${cmd} ${args.join(" ")} exited ${r.status}: ${err.trim()}`);
    e.stderr = err;
    throw e;
  }
  return r.stdout.toString();
}

/** Push a single secret via stdin. Worker must already exist on Cloudflare. */
function pushSecret(name, value) {
  const r = spawnSync("npx", ["wrangler", "secret", "put", name], {
    input: value + "\n",
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (r.status !== 0) {
    const err = r.stderr?.toString() || r.stdout?.toString() || "";
    throw new Error(`wrangler secret put ${name} failed: ${err.trim()}`);
  }
}

function checkPreflight() {
  log("─ Preflight checks ─────────────────────────────────────────────");

  // Node version — we use built-in fetch, readline/promises, base64url.
  const nodeVer = process.versions.node;
  const major = Number.parseInt(nodeVer.split(".")[0], 10);
  if (Number.isNaN(major) || major < 20) {
    fail(
      `Node.js ${nodeVer} detected — need ≥ 20.\n` +
        `  Upgrade with: brew install node@20  (macOS)\n` +
        `  Or download:  https://nodejs.org/`,
    );
  }
  log(`  ✓ Node.js v${nodeVer}`);

  // Repo deps installed.
  if (!existsSync("node_modules")) {
    fail("node_modules/ not found. Run `npm install` first, then re-run setup.");
  }

  // wrangler is available + reasonably modern. Output format has changed
  // between versions ("⛅️ wrangler 4.87.0" vs just "4.87.0") — match any
  // semver-looking sequence on the first line.
  let wranglerOut;
  try {
    wranglerOut = capture("npx", ["wrangler", "--version"]).trim();
  } catch {
    fail("Couldn't run wrangler. Try `npm install` and re-run.");
  }
  const semverMatch = wranglerOut.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!semverMatch) {
    fail(`Couldn't parse wrangler version from output:\n${wranglerOut}`);
  }
  const wranglerMajor = Number.parseInt(semverMatch[1], 10);
  if (wranglerMajor < 4) {
    fail(
      `Old wrangler detected (${semverMatch[0]}) — need ≥ 4.x. Run \`npm install -D wrangler@latest\`.`,
    );
  }
  log(`  ✓ wrangler ${semverMatch[0]}`);

  // git available — we don't strictly use it, but we want the user to be in
  // a working repo (they cloned, after all). Cheap check, gives a friendly
  // error if they ran setup from the wrong directory.
  if (!existsSync("wrangler.jsonc") || !existsSync("workers/app.ts")) {
    fail(
      "Run setup from the llm-wiki repo root.\n" +
        "  Expected to find ./wrangler.jsonc and ./workers/app.ts here.",
    );
  }
  log(`  ✓ Repo layout looks correct\n`);
}

async function confirmPaidPlan() {
  log("─ Cloudflare account requirements ─────────────────────────────");
  log("  This setup uses several features that require the Workers Paid");
  log("  plan ($5/mo). Confirm your account is on Workers Paid before");
  log("  continuing — otherwise the deploy will fail with a binding error.");
  log("");
  log("  Required:");
  log("    • Workers Paid     — https://dash.cloudflare.com/?to=/:account/workers/plans");
  log("    • Workers AI       — usage-billed, pennies for personal use");
  log("    • Browser Rendering — used for URL-drop scraping");
  log("    • Worker Loaders   — used by @cloudflare/codemode");
  log("    • R2               — has free tier; idea-dump usage well within it");
  log("");
  const answer = (await ask("  Are you on Workers Paid? (y/N): ")).trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") {
    log("");
    log("  Setup paused. Subscribe to Workers Paid, then re-run `npm run setup`.");
    rl.close();
    exit(0);
  }
  log("");
}

async function tg(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`telegram ${method}: ${data.description}`);
  return data.result;
}

async function main() {
  log("\n🤖 llm-wiki installer\n");
  log("This walks you through everything needed to get the bot running:");
  log("  • Authenticate wrangler with your Cloudflare account");
  log("  • Collect your Telegram bot token and user ID");
  log("  • Create the R2 bucket, push secrets, deploy");
  log("  • Register the webhook + Mini App menu button");
  log("");
  log("Stop with Ctrl+C any time. Re-running is safe — every step is idempotent.\n");

  checkPreflight();
  await confirmPaidPlan();

  // ── 1. Wrangler auth ────────────────────────────────────────────────────
  log("─ Step 1/6: Cloudflare authentication ─────────────────────────────");
  let whoami;
  try {
    whoami = capture("npx", ["wrangler", "whoami"]).trim();
    log(`  ✓ wrangler is logged in.\n`);
  } catch {
    log("  Not logged in. Opening browser for wrangler login…\n");
    try {
      run("npx", ["wrangler", "login"]);
    } catch {
      fail("wrangler login failed — re-run setup once you've completed login.");
    }
  }

  // ── 2. Telegram bot ─────────────────────────────────────────────────────
  log("─ Step 2/6: Telegram bot ──────────────────────────────────────────");
  log("  Open Telegram → DM @BotFather → /newbot → follow prompts.");
  log("  You'll get a token like '123456789:ABCdef…'.\n");
  const botToken = (await ask("  Paste bot token: ")).trim();
  if (!/^\d+:[\w-]+$/.test(botToken)) {
    fail("That doesn't look like a bot token (expected format: digits:letters).");
  }

  log("  Verifying token…");
  let bot;
  try {
    bot = await tg(botToken, "getMe", {});
  } catch (e) {
    fail(`Token verification failed: ${e.message}`);
  }
  log(`  ✓ Bot: @${bot.username} (${bot.first_name})\n`);

  // ── 2b. Resource naming ────────────────────────────────────────────────
  log("─ Resource naming ─────────────────────────────────────────────");
  const proposedSlug = slugFromUsername(bot.username);
  const existingSlug = currentSlug();
  let slug = existingSlug;

  if (existingSlug === proposedSlug) {
    log(`  ✓ Already scoped to "${slug}".\n`);
  } else if (existingSlug !== DEFAULT_SLUG) {
    log(
      `  ⚠ wrangler.jsonc already uses "${existingSlug}" (custom slug). Keeping it.\n`,
    );
  } else {
    log(`  Cloudflare resource names are account-scoped. To support multiple`);
    log(`  forks of this repo on the same Cloudflare account, scope the`);
    log(`  worker / R2 bucket / queue / AI Gateway names to your bot.`);
    log("");
    log(`    Worker:      ${proposedSlug}`);
    log(`    R2 bucket:   ${proposedSlug}-workspace`);
    log(`    Queue:       ${proposedSlug}-tasks`);
    log(`    AI Gateway:  ${proposedSlug}`);
    log("");
    log(`  ⚠ If you've already deployed under "${existingSlug}", this creates`);
    log(`    a new worker and orphans the old one (its R2, queue, gateway`);
    log(`    logs, secrets stay attached to the old name).`);
    log("");
    const ans = (await ask(`  Apply slug "${proposedSlug}"? (Y/n): `))
      .trim()
      .toLowerCase();
    if (ans === "n" || ans === "no") {
      log(`  Keeping default slug "${DEFAULT_SLUG}".\n`);
    } else {
      applySlug(DEFAULT_SLUG, proposedSlug);
      slug = proposedSlug;
      log(`  ✓ Substituted "${DEFAULT_SLUG}" → "${slug}" in wrangler.jsonc, agent.ts\n`);
    }
  }

  // ── 3. User ID ──────────────────────────────────────────────────────────
  log("─ Step 3/6: Your Telegram user ID ─────────────────────────────────");
  log("  Open Telegram → DM @userinfobot → copy the numeric Id from its reply.");
  log("  This becomes your single-user allowlist — only this ID can use the bot.\n");
  const userId = (await ask("  Paste your numeric user ID: ")).trim();
  if (!/^\d+$/.test(userId)) {
    fail("Not a numeric ID.");
  }
  log("");

  // ── 4. Local + secret values ────────────────────────────────────────────
  log("─ Step 4/6: Local config ─────────────────────────────────────────");
  const webhookSecret = randomBytes(32).toString("base64url");
  log(`  ✓ Generated webhook secret (${webhookSecret.length} chars)`);

  const devVarsPath = ".dev.vars";
  if (existsSync(devVarsPath)) {
    log(`  ⚠ ${devVarsPath} already exists — skipping. Edit it manually if values differ.`);
  } else {
    writeFileSync(
      devVarsPath,
      `TELEGRAM_BOT_TOKEN=${botToken}\nTELEGRAM_WEBHOOK_SECRET=${webhookSecret}\nALLOWED_TG_USER_ID=${userId}\n`,
    );
    log(`  ✓ Wrote ${devVarsPath} (gitignored)`);
  }
  log("");

  // ── 5. R2 + deploy + secrets ────────────────────────────────────────────
  // Order matters: bucket must exist before deploy (wrangler.jsonc references
  // it as a binding); worker must exist before `secret put` works.
  log("─ Step 5/6: Cloudflare resources ─────────────────────────────────");
  const bucketName = `${slug}-workspace`;
  const queueName = `${slug}-tasks`;

  log(`  Creating R2 bucket ${bucketName}…`);
  try {
    capture("npx", ["wrangler", "r2", "bucket", "create", bucketName]);
    log("  ✓ Bucket created");
  } catch (e) {
    if (/already exists/i.test(e.stderr || "") || /already exists/i.test(e.message)) {
      log("  ✓ Bucket already exists");
    } else {
      fail(`R2 bucket creation failed: ${e.message}`);
    }
  }

  log(`  Creating queue ${queueName}…`);
  try {
    capture("npx", ["wrangler", "queues", "create", queueName]);
    log("  ✓ Queue created");
  } catch (e) {
    if (/already exists/i.test(e.stderr || "") || /already exists/i.test(e.message)) {
      log("  ✓ Queue already exists");
    } else {
      fail(`Queue creation failed: ${e.message}`);
    }
  }

  log("  Building + deploying worker…");
  let deployStdout;
  try {
    run("npm", ["run", "build"]);
    deployStdout = capture("npx", ["wrangler", "deploy"]);
    process.stdout.write(deployStdout);
  } catch (e) {
    fail(`Deploy failed: ${e.message}`);
  }

  // Parse the deployed URL — wrangler prints lines like
  //   https://llm-wiki.<subdomain>.workers.dev
  const urlMatch = deployStdout.match(/https?:\/\/[\w.-]+\.workers\.dev/);
  if (!urlMatch) {
    log("");
    fail("Couldn't auto-detect the worker URL from wrangler output. Set webhook + menu button manually using the README.");
  }
  const workerUrl = urlMatch[0];
  log(`  ✓ Deployed to ${workerUrl}\n`);

  log("  Pushing secrets to the worker…");
  try {
    pushSecret("TELEGRAM_BOT_TOKEN", botToken);
    pushSecret("TELEGRAM_WEBHOOK_SECRET", webhookSecret);
    pushSecret("ALLOWED_TG_USER_ID", userId);
    log("  ✓ Secrets pushed\n");
  } catch (e) {
    fail(`Secret push failed: ${e.message}`);
  }

  // ── 6. Telegram registration ────────────────────────────────────────────
  log("─ Step 6/6: Register with Telegram ────────────────────────────────");

  log("  Setting webhook…");
  try {
    await tg(botToken, "setWebhook", {
      url: `${workerUrl}/webhook`,
      secret_token: webhookSecret,
    });
    log("  ✓ Webhook registered");
  } catch (e) {
    fail(`setWebhook failed: ${e.message}`);
  }

  log("  Setting Mini App menu button…");
  try {
    await tg(botToken, "setChatMenuButton", {
      menu_button: {
        type: "web_app",
        text: "Open Wiki",
        web_app: { url: `${workerUrl}/` },
      },
    });
    log("  ✓ Menu button set");
  } catch (e) {
    log(`  ⚠ setChatMenuButton failed (non-fatal): ${e.message}`);
  }

  log("  Registering bot commands…");
  try {
    await tg(botToken, "setMyCommands", {
      commands: [
        { command: "start", description: "Welcome message" },
        { command: "clear", description: "Reset the conversation" },
      ],
    });
    log("  ✓ Commands registered");
  } catch (e) {
    log(`  ⚠ setMyCommands failed (non-fatal): ${e.message}`);
  }

  // ── Done ────────────────────────────────────────────────────────────────
  log("");
  log("🎉 Done.");
  log("");
  log(`  Bot:     @${bot.username}`);
  log(`  Worker:  ${workerUrl}`);
  log(`  Wiki:    ${workerUrl}/`);
  log("");
  log(`  ⚠ One manual step left: create the AI Gateway in your dashboard.`);
  log(`     Cloudflare → AI → AI Gateway → Create Gateway → name: "${slug}"`);
  log(`     (Without it, model calls will fail at runtime.)`);
  log("");
  log(`  → DM @${bot.username} on Telegram and tap the "Open Wiki" menu button.`);
  log(`  → Drop a thought, link, or photo. The agent will file it.`);
  log("");
  rl.close();
}

main().catch((err) => {
  console.error(`\n❌ Setup failed: ${err.message}`);
  if (err.stack) console.error(err.stack);
  rl.close();
  exit(1);
});
