#!/usr/bin/env node
/**
 * Disaster Brain — pre-demo stack check (Ollama tags + optional Next health).
 * Run from project root: npm run verify
 *
 * Does not start servers. Expects:
 *   Terminal 1: ollama serve (already running is OK)
 *   Terminal 2: npm run dev (for /api/health check)
 */

const OLLAMA_TAGS =
  (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, "") +
  "/api/tags";
const REQUIRED = "gemma3:4b";
const APP_BASE = (process.env.APP_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);

let exit = 0;

function log(msg) {
  console.log(msg);
}

function fail(msg) {
  console.error(msg);
  exit = 1;
}

function abortAfter(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, cancel: () => clearTimeout(t) };
}

async function checkOllamaTags() {
  log("\n--- Ollama: GET /api/tags ---");
  log(`URL: ${OLLAMA_TAGS}`);
  const { signal, cancel } = abortAfter(8000);
  let res;
  try {
    res = await fetch(OLLAMA_TAGS, { signal });
  } catch (e) {
    fail(
      `Cannot reach Ollama at ${OLLAMA_TAGS}\n` +
        `  → Start: ollama serve\n` +
        `  → If "address already in use", Ollama is already running — OK.\n` +
        `  → Error: ${e instanceof Error ? e.message : e}`,
    );
    return false;
  } finally {
    cancel();
  }

  if (!res.ok) {
    fail(`Ollama returned HTTP ${res.status}`);
    return false;
  }

  let body;
  try {
    body = await res.json();
  } catch {
    fail("Ollama /api/tags response was not JSON");
    return false;
  }

  const names = (body.models || [])
    .map((m) => (typeof m.name === "string" ? m.name : ""))
    .filter(Boolean);

  log(`Models (${names.length}): ${names.slice(0, 12).join(", ") || "(none)"}${names.length > 12 ? "…" : ""}`);

  const has = names.some(
    (n) => n === REQUIRED || n.startsWith(`${REQUIRED}:`),
  );
  if (!has) {
    fail(
      `Required model "${REQUIRED}" not found in tag list.\n` +
        `  → Run: ollama pull ${REQUIRED}`,
    );
    return false;
  }

  log(`OK — "${REQUIRED}" is available.`);
  return true;
}

async function checkNextHealth() {
  log("\n--- Next.js: GET /api/health ---");
  log(`URL: ${APP_BASE}/api/health`);
  const { signal, cancel } = abortAfter(8000);
  let res;
  try {
    res = await fetch(`${APP_BASE}/api/health`, { signal });
  } catch (e) {
    fail(
      `Cannot reach ${APP_BASE}/api/health\n` +
        `  → Start in another terminal: npm run dev\n` +
        `  → Error: ${e instanceof Error ? e.message : e}`,
    );
    return false;
  } finally {
    cancel();
  }

  let json;
  try {
    json = await res.json();
  } catch {
    fail("/api/health response was not JSON");
    return false;
  }

  console.log(JSON.stringify(json, null, 2));

  if (!json.ok) {
    fail("Health check returned ok: false — fix Ollama/model before demo.");
    return false;
  }

  log("OK — Next server can reach Ollama with the required model.");
  return true;
}

async function checkAppRoot() {
  log("\n--- Next.js: GET / (smoke) ---");
  const { signal, cancel } = abortAfter(8000);
  try {
    const res = await fetch(APP_BASE, { signal });
    if (!res.ok) {
      fail(`GET / returned HTTP ${res.status}`);
      return false;
    }
    log(`OK — ${APP_BASE} responded (${res.status}).`);
    return true;
  } catch (e) {
    fail(
      `Cannot reach ${APP_BASE}\n` +
        `  → Run: npm run dev\n` +
        `  → Error: ${e instanceof Error ? e.message : e}`,
    );
    return false;
  } finally {
    cancel();
  }
}

async function main() {
  log("Disaster Brain — Run & verify stack");
  const ollamaOk = await checkOllamaTags();
  if (!ollamaOk) {
    process.exit(exit);
  }

  const healthOk = await checkNextHealth();
  if (!healthOk) {
    await checkAppRoot();
    process.exit(exit);
  }

  log("\n=== Summary ===");
  log("Use Google Chrome for the demo (Web Speech API).");
  log("Flows: Voice tab → triage | Photo tab → analyze | /queue → live board.");
  log("Full checklist: docs/DEMO_VALIDATION.md");
  process.exit(exit);
}

main();
