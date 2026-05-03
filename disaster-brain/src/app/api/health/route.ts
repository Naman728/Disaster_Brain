import { NextResponse } from "next/server";
import {
  OLLAMA_HOST,
  OLLAMA_MODEL,
  OLLAMA_TAGS_URL,
} from "@/lib/ollama-config";

export const runtime = "nodejs";

type TagsBody = { models?: Array<{ name?: string }> };

/**
 * Readiness probe from the Next.js server (same network path as /api/triage).
 * Use for demos: GET /api/health while `npm run dev` is running.
 */
export async function GET() {
  let ollamaReachable = false;
  let modelPresent = false;
  let modelNames: string[] = [];
  let tagsError: string | undefined;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(OLLAMA_TAGS_URL, {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
    });
    ollamaReachable = res.ok;
    if (res.ok) {
      const body = (await res.json()) as TagsBody;
      modelNames = (body.models ?? [])
        .map((m) => (typeof m.name === "string" ? m.name : ""))
        .filter(Boolean);
      modelPresent = modelNames.some(
        (n) => n === OLLAMA_MODEL || n.startsWith(`${OLLAMA_MODEL}:`),
      );
    } else {
      tagsError = `HTTP ${res.status}`;
    }
  } catch (e) {
    tagsError = e instanceof Error ? e.message : "fetch failed";
  } finally {
    clearTimeout(timer);
  }

  const ok = ollamaReachable && modelPresent;

  return NextResponse.json(
    {
      ok,
      next: true,
      ollama: {
        host: OLLAMA_HOST,
        reachable: ollamaReachable,
        requiredModel: OLLAMA_MODEL,
        modelPresent,
        models: modelNames.slice(0, 30),
        error: tagsError,
      },
      hints: ok
        ? []
        : [
            'Terminal 1: run `ollama serve` (ignore "address already in use" if Ollama is already up).',
            `Pull model: \`ollama pull ${OLLAMA_MODEL}\``,
            "Terminal 2: `npm run dev` — use Google Chrome for voice (Web Speech API).",
            "Run `npm run verify` from the project root to check tags + app health.",
          ],
    },
    { status: ok ? 200 : 503 },
  );
}
