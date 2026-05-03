"use client";

import { useCallback, useRef, useState } from "react";

import type { TriageData } from "@/context/PatientContext";
import { DEFAULT_RAG_SERVER_URL } from "@/lib/rag-server";

/** Same-origin proxy → FastAPI (avoids browser CORS / localhost issues). */
const RAG_QUERY_PATH = "/api/rag/query";
const RAG_SITREP_PATH = "/api/rag/sitrep";

const SUGGESTED_QUESTIONS = [
  "What is START triage red criteria?",
  "How do you control severe extremity bleeding in the field?",
  "What are signs of tension pneumothorax?",
  "How should hypothermia be managed during evacuation?",
  "What spinal precautions apply during disaster extrication?",
  "What is the role of mass-casualty triage officer?",
  "How do you assess a pediatric patient quickly in a disaster?",
  "What immediate actions apply for suspected inhalation injury after burns?",
] as const;

type ProtocolsTabProps = {
  /** Same array as `usePatients().patients` (no copy). */
  patients: readonly TriageData[];
};

type QueryApiResponse = {
  answer?: string;
  sources?: Record<string, unknown>[];
  context_chunks?: string[];
  error?: string;
};

type SitrepApiResponse = {
  sitrep?: string;
  error?: string;
};

type FeatureMode = "qa" | "sitrep";

function formatProxyError(raw: string, status: number): string {
  let detail = `Request failed (${status})`;
  try {
    const errBody = JSON.parse(raw) as {
      error?: string;
      detail?: string | unknown[];
      preview?: string;
    };
    if (typeof errBody.error === "string") return errBody.error;
    if (typeof errBody.detail === "string") return errBody.detail;
    if (Array.isArray(errBody.detail)) {
      return errBody.detail.map((x) => JSON.stringify(x)).join("; ");
    }
    if (typeof errBody.preview === "string") return errBody.preview;
  } catch {
    if (raw.trim()) return raw.slice(0, 600);
  }
  return detail;
}

export default function ProtocolsTab({ patients }: ProtocolsTabProps) {
  const queryInFlight = useRef(false);
  const sitrepInFlight = useRef(false);

  const [featureMode, setFeatureMode] = useState<FeatureMode>("qa");
  const [question, setQuestion] = useState("");
  const [nResults, setNResults] = useState(4);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<Record<string, unknown>[] | null>(
    null,
  );
  const [contextChunks, setContextChunks] = useState<string[] | null>(null);

  const [sitrepLoading, setSitrepLoading] = useState(false);
  const [sitrepError, setSitrepError] = useState<string | null>(null);
  const [sitrepText, setSitrepText] = useState<string | null>(null);

  const runQuery = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || queryInFlight.current) return;
    queryInFlight.current = true;

    setQueryLoading(true);
    setQueryError(null);
    setAnswer(null);
    setSources(null);
    setContextChunks(null);

    let res: Response;
    try {
      res = await fetch(RAG_QUERY_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, n_results: nResults }),
        cache: "no-store",
      });
    } catch (e) {
      const msg =
        e instanceof TypeError
          ? "Cannot reach Next.js API (is npm run dev running?)."
          : e instanceof Error
            ? e.message
            : "Network error";
      setQueryError(msg);
      setQueryLoading(false);
      queryInFlight.current = false;
      return;
    }

    const raw = await res.text();

    if (!res.ok) {
      setQueryError(formatProxyError(raw, res.status));
      setQueryLoading(false);
      queryInFlight.current = false;
      return;
    }

    let data: QueryApiResponse;
    try {
      data = JSON.parse(raw) as QueryApiResponse;
    } catch {
      setQueryError("Invalid JSON from protocol search.");
      setQueryLoading(false);
      queryInFlight.current = false;
      return;
    }

    setAnswer(typeof data.answer === "string" ? data.answer : "");
    setSources(Array.isArray(data.sources) ? data.sources : []);
    setContextChunks(
      Array.isArray(data.context_chunks) ? data.context_chunks : [],
    );
    setQueryLoading(false);
    queryInFlight.current = false;
  }, [nResults]);

  const runSitrep = useCallback(async () => {
    if (sitrepInFlight.current) return;
    sitrepInFlight.current = true;

    setSitrepLoading(true);
    setSitrepError(null);
    setSitrepText(null);

    const payload = patients.map((p) => ({ ...p }));

    let res: Response;
    try {
      res = await fetch(RAG_SITREP_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patients: payload }),
        cache: "no-store",
      });
    } catch (e) {
      const msg =
        e instanceof TypeError
          ? "Cannot reach Next.js API (is npm run dev running?)."
          : e instanceof Error
            ? e.message
            : "Network error";
      setSitrepError(msg);
      setSitrepLoading(false);
      sitrepInFlight.current = false;
      return;
    }

    const raw = await res.text();

    if (!res.ok) {
      setSitrepError(formatProxyError(raw, res.status));
      setSitrepLoading(false);
      sitrepInFlight.current = false;
      return;
    }

    let data: SitrepApiResponse;
    try {
      data = JSON.parse(raw) as SitrepApiResponse;
    } catch {
      setSitrepError("Invalid JSON from SITREP service.");
      setSitrepLoading(false);
      sitrepInFlight.current = false;
      return;
    }

    setSitrepText(typeof data.sitrep === "string" ? data.sitrep : "");
    setSitrepLoading(false);
    sitrepInFlight.current = false;
  }, [patients]);

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Protocols feature mode"
        className="flex flex-wrap gap-0 rounded border border-gray-800 bg-gray-900/40 p-1 sm:inline-flex"
      >
        <button
          type="button"
          role="tab"
          aria-selected={featureMode === "qa"}
          onClick={() => setFeatureMode("qa")}
          className={`min-h-[44px] flex-1 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.2em] transition sm:flex-none sm:px-6 ${
            featureMode === "qa"
              ? "border border-amber-700/40 bg-amber-950/50 text-amber-100"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          Protocol Q&amp;A
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={featureMode === "sitrep"}
          onClick={() => setFeatureMode("sitrep")}
          className={`min-h-[44px] flex-1 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.2em] transition sm:flex-none sm:px-6 ${
            featureMode === "sitrep"
              ? "border border-amber-700/40 bg-amber-950/50 text-amber-100"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          SITREP
        </button>
      </div>

      <p className="text-[10px] uppercase tracking-wider text-gray-600">
        RAG via{" "}
        <span className="font-mono text-gray-400">{RAG_QUERY_PATH}</span> /{" "}
        <span className="font-mono text-gray-400">{RAG_SITREP_PATH}</span>
        <span className="mt-1 block normal-case text-gray-500">
          Server forwards to <span className="font-mono">RAG_SERVER_URL</span>{" "}
          (default <span className="font-mono">{DEFAULT_RAG_SERVER_URL}</span> in{" "}
          <span className="font-mono">.env.local</span>).
        </span>
      </p>

      {featureMode === "qa" ? (
        <div className="space-y-5">
          <div>
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
              Suggested questions
            </label>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={queryLoading}
                  onClick={() => {
                    setQuestion(q);
                    void runQuery(q);
                  }}
                  className="rounded border border-gray-700 bg-gray-900/80 px-3 py-2 text-left text-[10px] leading-snug text-gray-300 transition hover:border-amber-700/40 hover:text-amber-100 disabled:opacity-40 sm:text-xs"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="protocol-custom-query"
              className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500"
            >
              Custom query
            </label>
            <textarea
              id="protocol-custom-query"
              rows={4}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={queryLoading}
              placeholder="Ask about disaster medicine protocols…"
              className="w-full resize-y border border-gray-700 bg-gray-900/80 p-4 text-sm leading-relaxed text-gray-100 shadow-inner outline-none placeholder:text-gray-600 focus:border-amber-700/50 focus:ring-1 focus:ring-amber-600/30 disabled:opacity-50"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[10px] text-gray-500">
                <span className="uppercase tracking-wider">Chunks</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={nResults}
                  onChange={(e) =>
                    setNResults(
                      Math.min(20, Math.max(1, Number(e.target.value) || 4)),
                    )
                  }
                  disabled={queryLoading}
                  className="w-16 border border-gray-800 bg-gray-950 px-2 py-1 font-mono text-xs text-gray-300 outline-none"
                />
              </label>
              <button
                type="button"
                disabled={queryLoading || !question.trim()}
                onClick={() => void runQuery(question)}
                className="border border-amber-800/50 bg-amber-950/40 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-amber-100 transition hover:bg-amber-900/45 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {queryLoading ? "Querying…" : "Run protocol search"}
              </button>
            </div>
          </div>

          {queryError ? (
            <div className="border border-rose-900/50 bg-rose-950/30 px-4 py-3 text-sm whitespace-pre-wrap text-rose-200">
              {queryError}
            </div>
          ) : null}

          {queryLoading ? (
            <div
              className="border border-gray-800 bg-gray-900/50 p-5"
              aria-busy
              aria-label="Querying protocols"
            >
              <div className="mb-2 flex items-center gap-2">
                <div className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                  Retrieving context + model
                </span>
              </div>
              <div className="space-y-2">
                <div className="h-3 w-full animate-pulse rounded bg-gray-800" />
                <div className="h-3 w-[85%] animate-pulse rounded bg-gray-800" />
              </div>
            </div>
          ) : null}

          {answer !== null && !queryLoading ? (
            <div className="space-y-4 border border-gray-800/90 bg-gray-950/50 p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-500/90">
                Answer
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">
                {answer || "—"}
              </div>
              {sources && sources.length > 0 ? (
                <div>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    Sources (metadata)
                  </div>
                  <ul className="space-y-2 text-xs text-gray-400">
                    {sources.map((s, i) => (
                      <li
                        key={i}
                        className="rounded border border-gray-800/80 bg-gray-900/60 px-3 py-2 font-mono text-[11px]"
                      >
                        {JSON.stringify(s)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {contextChunks && contextChunks.length > 0 ? (
                <details className="text-xs text-gray-400">
                  <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wider text-gray-500 hover:text-gray-400">
                    Retrieved chunks ({contextChunks.length})
                  </summary>
                  <div className="mt-2 max-h-64 space-y-2 overflow-y-auto border border-gray-800/60 bg-gray-900/40 p-3">
                    {contextChunks.map((c, i) => (
                      <p
                        key={i}
                        className="border-b border-gray-800/50 pb-2 text-[11px] leading-relaxed text-gray-300 last:border-0 last:pb-0"
                      >
                        {c}
                      </p>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-[11px] leading-relaxed text-gray-500">
            Generate a military-style SITREP from the current patient queue
            (triage tags sent to the RAG service as JSON).
          </p>
          <div className="rounded border border-gray-800/80 bg-gray-950/50 px-3 py-2 text-[10px] text-gray-500">
            Patients in payload:{" "}
            <span className="font-mono text-gray-300">{patients.length}</span>
          </div>

          {sitrepError ? (
            <div className="border border-rose-900/50 bg-rose-950/30 px-4 py-3 text-sm whitespace-pre-wrap text-rose-200">
              {sitrepError}
            </div>
          ) : null}

          {sitrepLoading ? (
            <div
              className="border border-gray-800 bg-gray-900/50 p-5"
              aria-busy
              aria-label="Generating SITREP"
            >
              <div className="mb-2 flex items-center gap-2">
                <div className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                  Generating SITREP via Ollama
                </span>
              </div>
              <div className="space-y-2">
                <div className="h-3 w-full animate-pulse rounded bg-gray-800" />
                <div className="h-3 w-[72%] animate-pulse rounded bg-gray-800" />
              </div>
            </div>
          ) : null}

          <button
            type="button"
            disabled={sitrepLoading}
            onClick={() => void runSitrep()}
            className="w-full border border-red-900/50 bg-red-950/45 px-6 py-3.5 text-xs font-bold uppercase tracking-[0.2em] text-red-100 transition hover:bg-red-900/55 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
          >
            {sitrepLoading ? "Generating…" : "Generate SITREP from queue"}
          </button>

          {sitrepText !== null && !sitrepLoading ? (
            <div className="space-y-2 border border-gray-800/90 bg-gray-950/50 p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-500/90">
                SITREP
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">
                {sitrepText || "—"}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
