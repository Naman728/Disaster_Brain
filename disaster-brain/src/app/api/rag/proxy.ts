import { NextResponse } from "next/server";

import { getRagServerBaseUrl } from "@/lib/rag-server";

const UPSTREAM_TIMEOUT_MS = 120_000;

type RagPath = "query" | "sitrep";

function upstreamFetchErrorDetail(e: unknown): string {
  if (!(e instanceof Error)) return "fetch failed";
  const cause = e.cause;
  if (cause && typeof cause === "object" && "code" in cause) {
    const code = String((cause as { code?: string }).code);
    if (code === "ECONNREFUSED") {
      return "connection refused — no process is listening (start uvicorn; first boot can take ~1 min while the embedder loads)";
    }
  }
  return e.message;
}

/** Parse RAG body; strip BOM; salvage first `{...}` if wrapped in noise. */
function parseUpstreamJson(raw: string): unknown {
  const s = raw.replace(/^\uFEFF/, "").trim();
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    const i = s.indexOf("{");
    const j = s.lastIndexOf("}");
    if (i !== -1 && j > i) {
      return JSON.parse(s.slice(i, j + 1));
    }
    throw new SyntaxError("Upstream body is not JSON");
  }
}

/**
 * Forward POST body to FastAPI RAG and return JSON (avoids invalid upstream headers / HTML error pages).
 */
export async function proxyRagPost(
  path: RagPath,
  request: Request,
): Promise<NextResponse> {
  try {
    return await _proxyRagPostInner(path, request);
  } catch (e) {
    console.error(`[api/rag/${path}]`, e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Unexpected error in RAG proxy (see server terminal).",
      },
      { status: 500 },
    );
  }
}

async function _proxyRagPostInner(
  path: RagPath,
  request: Request,
): Promise<NextResponse> {
  let body: string;
  try {
    body = await request.text();
  } catch (e) {
    console.error(`[api/rag/${path}] read body`, e);
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const base = getRagServerBaseUrl();
  const upstream = `${base}/${path}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal: ac.signal,
    });
  } catch (e) {
    const msg = upstreamFetchErrorDetail(e);
    return NextResponse.json(
      {
        error: `RAG unreachable at ${base}: ${msg}. In a terminal: cd Kaggle/rag && uvicorn server:app --host 127.0.0.1 --port 8010 --reload — wait until you see "Application startup complete", then retry. Or set RAG_SERVER_URL in disaster-brain/.env.local (must match host, port, and RAG_API_PREFIX on the Python app).`,
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }

  let text: string;
  try {
    text = await upstreamRes.text();
  } catch (e) {
    console.error(`[api/rag/${path}] read upstream`, e);
    return NextResponse.json(
      { error: "Failed to read response from RAG server." },
      { status: 502 },
    );
  }

  const trimmed = text.trim();
  let payload: unknown;
  try {
    payload = parseUpstreamJson(trimmed);
  } catch (e) {
    console.error(`[api/rag/${path}] upstream non-JSON`, e, trimmed.slice(0, 300));
    return NextResponse.json(
      {
        error: "RAG server returned non-JSON (check uvicorn logs).",
        preview: trimmed.slice(0, 400),
      },
      { status: 502 },
    );
  }

  return NextResponse.json(payload, { status: upstreamRes.status });
}
