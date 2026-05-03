"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CommsBridge from "./components/CommsBridge";
import NetworkStatusBadge from "./components/NetworkStatusBadge";
import ProtocolsTab from "./components/ProtocolsTab";
import PhotoUpload from "@/components/PhotoUpload";
import TriageCard, { type TriagePayload } from "@/components/TriageCard";
import { usePatients } from "@/context/PatientContext";
import { useNavigatorOnLine } from "@/hooks/useNavigatorOnLine";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

type TriageApiResponse = {
  success: boolean;
  triage?: TriagePayload;
  error?: string;
};

type InputMode = "voice" | "photo" | "queue" | "protocols" | "comms";

const MAIN_TABS: { id: InputMode; label: string }[] = [
  { id: "voice", label: "Voice" },
  { id: "photo", label: "Photo" },
  { id: "queue", label: "Queue" },
  { id: "protocols", label: "Protocols" },
  { id: "comms", label: "COMMS BRIDGE" },
];

const CLIENT_FETCH_TIMEOUT_MS = 120_000;

const OLLAMA_ALERT =
  "Error: Make sure Ollama is running (ollama serve)";

const MSG_CLIENT_TIMEOUT =
  "Request timed out. Still processing locally — try again if needed.";

function logClientTriageResponse(payload: {
  httpStatus: number;
  ok: boolean;
  parsed: TriageApiResponse;
  rawText: string;
}) {
  const { rawText, ...rest } = payload;
  const rawPreview =
    rawText.length > 4000 ? `${rawText.slice(0, 4000)}… (${rawText.length} chars)` : rawText;
  console.info("[DisasterBrain] /api/triage full response", {
    ...rest,
    rawPreview,
  });
}

export default function Home() {
  const navOnline = useNavigatorOnLine();
  const [mode, setMode] = useState<InputMode>("voice");
  const [manualInput, setManualInput] = useState("");
  const [voiceTriageError, setVoiceTriageError] = useState<string | null>(null);
  const [triageLoading, setTriageLoading] = useState(false);
  const [voicePreview, setVoicePreview] = useState<TriagePayload | null>(null);
  const [voicePreviewDismissed, setVoicePreviewDismissed] = useState(false);
  const inFlightRef = useRef(false);

  const { patients, addPatient, clearAll, getNextApiPatientNumber } =
    usePatients();

  const {
    transcript,
    listening,
    supported,
    startListening,
    stopListening,
    resetTranscript,
  } = useSpeechRecognition();

  const safeTranscript = transcript ?? "";

  const totalCount = patients.length;
  const immediateCount = useMemo(
    () =>
      patients.filter((p) => p.triage.startTag === "IMMEDIATE").length,
    [patients],
  );

  /** Transcript wins when non-empty; otherwise typed symptoms. */
  const activeInput = useMemo(() => {
    const t = safeTranscript.trim();
    const m = manualInput.trim();
    return t || m;
  }, [safeTranscript, manualInput]);

  useEffect(() => {
    if (mode !== "voice") return;
    const t = safeTranscript.trim();
    if (t) setManualInput(t);
  }, [safeTranscript, mode]);

  useEffect(() => {
    if (mode !== "voice" && listening) stopListening();
  }, [mode, listening, stopListening]);

  const failVoice = useCallback((message: string, alertOllama: boolean) => {
    if (alertOllama) window.alert(OLLAMA_ALERT);
    setVoiceTriageError(message);
  }, []);

  async function submitTriage() {
    const trimmed = activeInput.trim();
    if (!trimmed || inFlightRef.current || mode !== "voice") return;

    const ac = new AbortController();
    const timeoutId = window.setTimeout(
      () => ac.abort(),
      CLIENT_FETCH_TIMEOUT_MS,
    );

    inFlightRef.current = true;
    try {
      setTriageLoading(true);
      setVoiceTriageError(null);

      const patientNumber = getNextApiPatientNumber();
      const body = { symptoms: trimmed, patientNumber };

      let res: Response;
      try {
        res = await fetch("/api/triage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ac.signal,
          cache: "no-store",
        });
      } catch (fetchErr) {
        console.error("[ui/triage] fetch failed", fetchErr);
        const isAbort =
          fetchErr instanceof DOMException && fetchErr.name === "AbortError";
        failVoice(
          isAbort ? MSG_CLIENT_TIMEOUT : "Network error — could not reach API.",
          true,
        );
        return;
      }

      const rawText = await res.text();
      let data: TriageApiResponse;
      try {
        data = JSON.parse(rawText) as TriageApiResponse;
      } catch {
        console.error("[ui/triage] response was not JSON", rawText.slice(0, 500));
        console.info("[DisasterBrain] /api/triage non-JSON body", {
          httpStatus: res.status,
          rawPreview: rawText.slice(0, 4000),
        });
        failVoice("Invalid response from server.", true);
        return;
      }

      logClientTriageResponse({
        httpStatus: res.status,
        ok: res.ok,
        parsed: data,
        rawText,
      });

      if (!res.ok) {
        failVoice(data.error ?? `Request failed (${res.status})`, true);
        return;
      }

      if (data.success && data.triage && typeof data.triage === "object") {
        addPatient({
          triage: data.triage,
          source: "voice",
          symptomsRaw: trimmed,
        });
        setVoicePreview(data.triage);
        setVoicePreviewDismissed(false);
        return;
      }

      failVoice(data.error ?? "Triage request failed.", true);
    } catch (e) {
      console.error("[ui/triage] unexpected", e);
      failVoice("Unexpected error during triage.", true);
    } finally {
      clearTimeout(timeoutId);
      setTriageLoading(false);
      inFlightRef.current = false;
    }
  }

  const onMicPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (!supported || triageLoading) return;
      e.preventDefault();
      const el = e.currentTarget;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      startListening();
    },
    [supported, triageLoading, startListening],
  );

  const onMicPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const el = e.currentTarget;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* not captured */
      }
      stopListening();
    },
    [stopListening],
  );

  const onMicPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      stopListening();
    },
    [stopListening],
  );

  function switchMode(next: InputMode) {
    setMode(next);
    setVoiceTriageError(null);
  }

  const showVoicePreview =
    mode === "voice" &&
    voicePreview &&
    !voicePreviewDismissed &&
    !triageLoading;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 font-mono antialiased">
      <header className="sticky top-0 z-20 border-b border-gray-800/80 bg-gray-950/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="relative h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.85)]"
              aria-hidden
            >
              <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-60" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[11px] font-semibold tracking-[0.35em] text-gray-500">
                UNIFIED COMMAND
              </div>
              <div className="truncate text-sm font-bold tracking-[0.2em] text-gray-100 sm:text-base">
                DISASTER BRAIN
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <div className="hidden items-center gap-2 rounded border border-gray-800 bg-gray-900/80 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 sm:flex">
              <span className="text-gray-500">Queue</span>
              <span className="text-amber-200/90">{totalCount}</span>
              <span className="text-gray-600">·</span>
              <span className="text-gray-500">IMMEDIATE</span>
              <span className="text-red-300">{immediateCount}</span>
            </div>
            <Link
              href="/queue"
              className="rounded border border-amber-800/40 bg-amber-950/30 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-100 transition hover:border-amber-600/60 sm:text-xs"
            >
              Queue board
            </Link>
            <NetworkStatusBadge />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-gray-800/90 pb-6">
          <div className="min-w-0 border-l-2 border-amber-600/50 pl-4">
            <h1 className="text-base font-bold uppercase tracking-[0.12em] text-amber-500/95 sm:text-lg">
              Multimodal emergency triage
            </h1>
            <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-gray-500 sm:text-xs">
              Voice and vision pipelines feed one hospital-grade queue. Results
              sync instantly to the board — single source of truth via patient
              context.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
            <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-wider text-gray-500 sm:hidden">
              <span>
                Queue {totalCount} · IMM {immediateCount}
              </span>
              <button
                type="button"
                disabled={totalCount === 0}
                onClick={clearAll}
                className="text-rose-400/90 underline decoration-rose-900/80 disabled:opacity-30"
              >
                Clear queue
              </button>
            </div>
            <button
              type="button"
              disabled={totalCount === 0}
              onClick={clearAll}
              className="hidden text-[10px] uppercase tracking-wider text-gray-500 underline decoration-gray-700 hover:text-gray-400 disabled:opacity-30 sm:inline"
            >
              Clear queue
            </button>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Triage input mode"
          className="mb-6 flex flex-wrap gap-0 rounded border border-gray-800 bg-gray-900/40 p-1 sm:inline-flex"
        >
          {MAIN_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={mode === tab.id}
              id={`tab-${tab.id}`}
              onClick={() => switchMode(tab.id)}
              className={`min-h-[44px] flex-1 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.2em] transition sm:flex-none sm:px-6 ${
                mode === tab.id
                  ? "border border-amber-700/40 bg-amber-950/50 text-amber-100"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {tab.id === "comms" ? (
                <span className="inline-flex flex-wrap items-center justify-center gap-1.5">
                  <span aria-hidden>🌐</span>
                  <span>{tab.label}</span>
                  {!navOnline ? (
                    <span
                      className="rounded-full border px-1.5 py-0.5 text-[8px] font-bold tracking-[0.06em] text-[#ff3b30]"
                      style={{
                        borderColor: "rgba(255,59,48,0.4)",
                        backgroundColor: "rgba(255,59,48,0.08)",
                        boxShadow: "0 0 6px rgba(255,59,48,0.35)",
                      }}
                    >
                      OFFLINE
                    </span>
                  ) : null}
                </span>
              ) : (
                tab.label
              )}
            </button>
          ))}
        </div>

        {mode === "comms" ? (
          <CommsBridge />
        ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section
            role="tabpanel"
            aria-labelledby={`tab-${mode}`}
            className="space-y-5"
          >
            {mode === "voice" ? (
              <>
                <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
                  Symptoms (live transcript or type)
                </label>
                <textarea
                  className="min-h-[160px] w-full resize-y border border-gray-700 bg-gray-900/80 p-4 text-sm leading-relaxed text-gray-100 shadow-inner outline-none placeholder:text-gray-600 focus:border-amber-700/50 focus:ring-1 focus:ring-amber-600/30"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder="Hold mic to dictate, or type chief complaint…"
                  autoComplete="off"
                  spellCheck
                />

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={!supported || triageLoading}
                    onPointerDown={onMicPointerDown}
                    onPointerUp={onMicPointerUp}
                    onPointerCancel={onMicPointerCancel}
                    style={{ touchAction: "none" }}
                    className="select-none border border-gray-600 bg-gray-900 px-5 py-3 text-xs font-bold uppercase tracking-wider text-gray-100 transition hover:border-amber-600/50 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {listening ? "Listening…" : "Hold to speak"}
                  </button>
                  {!supported ? (
                    <span className="max-w-[14rem] text-[10px] text-gray-600">
                      Speech API unavailable — use typed symptoms or Chrome.
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-600">
                      Press & hold (works on touch devices)
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      resetTranscript();
                      setManualInput("");
                    }}
                    className="text-[10px] uppercase tracking-wider text-gray-500 underline decoration-gray-700 hover:text-gray-400"
                  >
                    Clear input
                  </button>
                </div>

                <div className="rounded border border-gray-800/80 bg-gray-950/50 px-3 py-2 text-[10px] text-gray-500">
                  Next API patient #{" "}
                  <span className="font-mono text-gray-300">
                    {getNextApiPatientNumber()}
                  </span>
                </div>

                <button
                  type="button"
                  disabled={triageLoading || !activeInput.trim()}
                  onClick={() => void submitTriage()}
                  className="w-full border border-red-900/50 bg-red-950/45 px-6 py-3.5 text-xs font-bold uppercase tracking-[0.2em] text-red-100 transition hover:bg-red-900/55 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
                >
                  {triageLoading ? "Analyzing…" : "Run voice / text triage"}
                </button>
              </>
            ) : mode === "photo" ? (
              <div className="space-y-3">
                <p className="text-[11px] leading-relaxed text-gray-500">
                  Upload a field photo. Gemma vision returns START-style JSON;
                  the same queue receives the case as{" "}
                  <span className="text-gray-400">source: photo</span>.
                </p>
                <PhotoUpload />
              </div>
            ) : mode === "queue" ? (
              <div className="space-y-4">
                <p className="text-[11px] leading-relaxed text-gray-500">
                  Live patient board: same global queue as voice and photo
                  triage. Open the full board for sort-by-severity layout and
                  removals.
                </p>
                <div className="flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-wider text-gray-500">
                  <span>
                    Queue {totalCount} · IMMEDIATE {immediateCount}
                  </span>
                  <Link
                    href="/queue"
                    className="rounded border border-amber-800/40 bg-amber-950/30 px-3 py-2 text-[10px] font-semibold text-amber-100 transition hover:border-amber-600/60"
                  >
                    Open queue board
                  </Link>
                </div>
                {patients.length > 0 ? (
                  <ul className="max-h-[min(60vh,28rem)] space-y-4 overflow-y-auto border border-gray-800/80 bg-gray-950/40 p-3">
                    {patients.slice(0, 8).map((p) => (
                      <li key={p.id} className="space-y-2 border-b border-gray-800/60 pb-4 last:border-0 last:pb-0">
                        <div className="text-[10px] uppercase tracking-wider text-gray-500">
                          {p.id} · {p.source}
                        </div>
                        <TriageCard data={p.triage} />
                      </li>
                    ))}
                    {patients.length > 8 ? (
                      <li className="pt-1 text-center text-[10px] text-gray-600">
                        +{patients.length - 8} more on the board →{" "}
                        <Link
                          href="/queue"
                          className="text-amber-400/90 underline decoration-amber-900/50"
                        >
                          /queue
                        </Link>
                      </li>
                    ) : null}
                  </ul>
                ) : (
                  <div className="rounded border border-dashed border-gray-800 px-4 py-8 text-center text-[11px] text-gray-500">
                    No patients yet. Use{" "}
                    <button
                      type="button"
                      onClick={() => switchMode("voice")}
                      className="text-amber-400/90 underline decoration-amber-900/50"
                    >
                      Voice
                    </button>{" "}
                    or{" "}
                    <button
                      type="button"
                      onClick={() => switchMode("photo")}
                      className="text-amber-400/90 underline decoration-amber-900/50"
                    >
                      Photo
                    </button>{" "}
                    to add cases.
                  </div>
                )}
              </div>
            ) : mode === "protocols" ? (
              <ProtocolsTab patients={patients} />
            ) : null}
          </section>

          <aside className="space-y-4 lg:pl-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
              Status
            </div>

            {mode === "voice" && voiceTriageError ? (
              <div className="border border-rose-900/50 bg-rose-950/30 px-4 py-3 text-sm whitespace-pre-wrap text-rose-200">
                {voiceTriageError}
              </div>
            ) : null}

            {mode === "voice" && triageLoading ? (
              <div
                className="border border-gray-800 bg-gray-900/50 p-5"
                aria-busy
                aria-label="Analyzing triage"
              >
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                      Processing
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-gray-400">
                    Structured triage via local model…
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="h-3 w-full animate-pulse rounded bg-gray-800" />
                  <div className="h-3 w-[88%] animate-pulse rounded bg-gray-800" />
                  <div className="h-3 w-[70%] animate-pulse rounded bg-gray-800" />
                </div>
              </div>
            ) : null}

            {showVoicePreview ? (
              <div className="space-y-2 border border-gray-800/90 bg-gray-900/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500/90">
                    Last voice triage
                  </span>
                  <button
                    type="button"
                    onClick={() => setVoicePreviewDismissed(true)}
                    className="shrink-0 text-[10px] uppercase tracking-wider text-gray-500 hover:text-gray-300"
                  >
                    Dismiss
                  </button>
                </div>
                <TriageCard data={voicePreview} />
                <p className="text-[10px] text-gray-600">
                  Case is in the global queue — open the board to prioritize.
                </p>
              </div>
            ) : null}

            {mode === "photo" ? (
              <div className="rounded border border-dashed border-gray-800 px-4 py-5 text-center text-[11px] text-gray-500">
                <p className="mb-2 text-gray-400">
                  Voice / text triage is on the other tab.
                </p>
                <Link
                  href="/queue"
                  className="font-semibold text-amber-400/90 underline decoration-amber-900/50"
                >
                  Open live queue board →
                </Link>
              </div>
            ) : mode === "queue" ? (
              <div className="rounded border border-dashed border-gray-800 px-4 py-5 text-center text-[11px] text-gray-500">
                <p className="mb-2 text-gray-400">
                  Full command-center view with sort and clear actions.
                </p>
                <Link
                  href="/queue"
                  className="font-semibold text-amber-400/90 underline decoration-amber-900/50"
                >
                  Open live queue board →
                </Link>
              </div>
            ) : mode === "protocols" ? (
              <div className="rounded border border-dashed border-gray-800 px-4 py-5 text-center text-[11px] text-gray-500">
                <p className="mb-2 text-gray-400">
                  RAG answers are grounded in indexed PDFs / seed protocols on the
                  Python service.
                </p>
                <p className="text-gray-600">
                  Protocols call <span className="font-mono text-gray-400">/api/rag/*</span>{" "}
                  → set <span className="font-mono text-gray-400">RAG_SERVER_URL</span> and
                  run <span className="font-mono text-gray-400">uvicorn</span> on port{" "}
                  <span className="font-mono text-gray-400">8010</span> in{" "}
                  <span className="font-mono text-gray-400">Kaggle/rag</span> (see{" "}
                  <span className="font-mono text-gray-400">RAG_SERVER_URL</span> / prefix).
                </p>
              </div>
            ) : (
              <div className="rounded border border-dashed border-gray-800 px-4 py-5 text-center text-[11px] text-gray-500">
                <Link
                  href="/queue"
                  className="font-semibold text-amber-400/90 underline decoration-amber-900/50"
                >
                  View unified queue board →
                </Link>
                <p className="mt-2 text-gray-600">
                  {totalCount} case{totalCount === 1 ? "" : "s"} in system
                </p>
              </div>
            )}
          </aside>
        </div>
        )}
      </main>

      <footer className="mx-auto mt-10 max-w-5xl border-t border-gray-800/80 px-4 py-6 text-center text-[10px] uppercase tracking-widest text-gray-600 sm:px-6">
        Voice + vision → PatientContext · gemma3:4b · Demo in Chrome (speech) ·
        API logs: DevTools console [DisasterBrain] ·{" "}
        <code className="text-gray-500">npm run verify</code>
      </footer>
    </div>
  );
}
