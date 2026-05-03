"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

type LangId =
  | "en"
  | "hi"
  | "ta"
  | "ar"
  | "bn"
  | "te"
  | "uk"
  | "fa"
  | "ps"
  | "fr"
  | "sw";

type LangDef = {
  id: LangId;
  label: string;
  /** Web Speech recognition BCP-47 */
  speechCode: string;
  /** `SpeechSynthesisUtterance.lang` */
  ttsLang: string;
};

const LANGS: LangDef[] = [
  { id: "en", label: "English", speechCode: "en-IN", ttsLang: "en-IN" },
  { id: "hi", label: "Hindi (हिंदी)", speechCode: "hi-IN", ttsLang: "hi-IN" },
  { id: "ta", label: "Tamil (தமிழ்)", speechCode: "ta-IN", ttsLang: "ta-IN" },
  { id: "ar", label: "Arabic (العربية)", speechCode: "ar-SA", ttsLang: "ar-SA" },
  { id: "bn", label: "Bengali (বাংলা)", speechCode: "bn-IN", ttsLang: "bn-IN" },
  { id: "te", label: "Telugu (తెలుగు)", speechCode: "te-IN", ttsLang: "te-IN" },
  {
    id: "uk",
    label: "Ukrainian (українська) 🇺🇦",
    speechCode: "uk-UA",
    ttsLang: "uk-UA",
  },
  {
    id: "fa",
    label: "Dari (دری) 🇦🇫",
    speechCode: "fa-AF",
    ttsLang: "fa-AF",
  },
  {
    id: "ps",
    label: "Pashto (پښتو) 🇦🇫",
    speechCode: "ps-AF",
    ttsLang: "ps-AF",
  },
  {
    id: "fr",
    label: "French (français) 🇫🇷",
    speechCode: "fr-FR",
    ttsLang: "fr-FR",
  },
  {
    id: "sw",
    label: "Swahili (Kiswahili) 🌍",
    speechCode: "sw-KE",
    ttsLang: "sw-KE",
  },
];

type ScenarioToggleMode = "disaster" | "combat";

const DISASTER_PHRASES = [
  "Are you injured?",
  "Where does it hurt?",
  "Can you move?",
  "Stay calm, help is coming",
  "Do not move",
  "Can you hear me?",
] as const;

const COMBAT_RESPONDER_PHRASES = [
  "Where are you wounded?",
  "Are you breathing normally?",
  "How many casualties with you?",
  "I am going to help you",
  "Don't move your neck",
  "Is there active shooting nearby?",
] as const;

const COMBAT_SURVIVOR_PHRASES = [
  "I am shot / I am wounded here",
  "I cannot breathe well",
  "There are [X] of us wounded",
  "I cannot move my legs",
  "The shooting stopped",
  "I need water",
] as const;

/** Combat: responder + survivor lines in one list (same chips in each panel). */
const COMBAT_ALL_PHRASES = [
  ...COMBAT_RESPONDER_PHRASES,
  ...COMBAT_SURVIVOR_PHRASES,
] as const;

function getQuickPhrases(scenario: ScenarioToggleMode): readonly string[] {
  if (scenario === "disaster") return DISASTER_PHRASES;
  return COMBAT_ALL_PHRASES;
}

type LogEntry = {
  id: string;
  origin: "responder" | "survivor";
  original: string;
  translated: string;
  sourceLangLabel: string;
  targetLangLabel: string;
};

interface SpeechRecAlternative {
  transcript: string;
}

interface SpeechRecResultEntry {
  readonly length: number;
  [index: number]: SpeechRecAlternative;
}

interface SpeechRecResultList {
  readonly length: number;
  [index: number]: SpeechRecResultEntry;
}

interface SpeechRecEvent {
  results: SpeechRecResultList;
}

interface SpeechRecErrorEvent {
  error: string;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecEvent) => void) | null;
  onerror: ((ev: SpeechRecErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function normalizeTranscript(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function langById(id: LangId): LangDef {
  return LANGS.find((l) => l.id === id) ?? LANGS[0];
}

function buildTranslatorSystem(targetLanguageLabel: string): string {
  return (
    "You are an emergency field translator for disaster responders.\n" +
    `Task: rewrite the message in ${targetLanguageLabel} (correct script and spelling).\n` +
    "Rules:\n" +
    "- Output ONLY the translated text. No quotes, labels, apologies, or English commentary.\n" +
    "- Single words, names, numbers, and short triage phrases must still be translated.\n" +
    "- Mixed languages: translate every part you can; never refuse normal human input.\n" +
    "- If it is already in the target language, copy it unchanged.\n" +
    '- Never output the words "unavailable", "cannot translate", or bracketed status codes.'
  );
}

/** Shorter follow-up if the model echoes refusals (Gemma sometimes overfits strict prompts). */
function buildTranslatorMinimal(targetLanguageLabel: string): string {
  return (
    `Rewrite the line below in ${targetLanguageLabel}. ` +
    "Print only the translation. Do not refuse. No English."
  );
}

const REFUSAL_RE = /translation\s*unavailable|\[?\s*unavailable\s*\]?/i;

async function readChatStream(res: Response): Promise<string> {
  if (!res.ok) {
    const t = await res.text();
    let msg = t.trim().slice(0, 400) || res.statusText;
    try {
      const j = JSON.parse(t) as { error?: string };
      if (typeof j.error === "string" && j.error.trim()) msg = j.error;
    } catch {
      /* plain text */
    }
    throw new Error(msg);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");
  const dec = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  out += dec.decode();
  return out.trim();
}

function normalizeTranslationOutput(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^[`"'「『]+|[`"'」』]+$/g, "").trim();
  t = t.replace(/^(translation|output|result)\s*:\s*/i, "").trim();
  return t;
}

function isModelRefusalOrEmpty(translated: string): boolean {
  const t = translated.trim();
  if (!t) return true;
  if (/\[?\s*TRANSLATION\s+UNAVAILABLE\s*\]?/i.test(t)) return true;
  if (REFUSAL_RE.test(t) && t.length < 200) return true;
  return false;
}

async function postChatTranslate(message: string, system: string): Promise<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, system }),
    cache: "no-store",
  });
  return normalizeTranslationOutput(await readChatStream(res));
}

async function translateWithRetry(
  message: string,
  targetLabel: string,
): Promise<string> {
  const trimmed = message.trim();
  let out = await postChatTranslate(trimmed, buildTranslatorSystem(targetLabel));
  if (isModelRefusalOrEmpty(out)) {
    out = await postChatTranslate(trimmed, buildTranslatorMinimal(targetLabel));
  }
  if (isModelRefusalOrEmpty(out)) {
    return trimmed;
  }
  return out;
}

function speak(text: string, lang: string): void {
  if (typeof window === "undefined" || !text.trim()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.85;
  window.speechSynthesis.speak(utterance);
}

const selectClass =
  "w-full max-w-full border border-[rgba(255,255,255,0.15)] bg-[#141c24] text-white outline-none focus:border-amber-600/50 focus:ring-1 focus:ring-amber-600/20";

const selectStyle: CSSProperties = {
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};

export default function CommsBridge() {
  const responderSelectId = useId();
  const survivorSelectId = useId();

  const [responderLang, setResponderLang] = useState<LangId>("en");
  const [survivorLang, setSurvivorLang] = useState<LangId>("hi");

  const [responderInput, setResponderInput] = useState("");
  const [survivorInput, setSurvivorInput] = useState("");

  const [responderCard, setResponderCard] = useState<{
    original: string;
    translated: string;
    key: string;
  } | null>(null);
  const [survivorCard, setSurvivorCard] = useState<{
    original: string;
    translated: string;
    key: string;
  } | null>(null);

  const [log, setLog] = useState<LogEntry[]>([]);
  const [loadingReceiver, setLoadingReceiver] = useState<
    "responder" | "survivor" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [scenarioMode, setScenarioMode] =
    useState<ScenarioToggleMode>("disaster");

  const recRef = useRef<SpeechRecognitionInstance | null>(null);
  const speechSupported = useMemo(
    () =>
      typeof window !== "undefined" && getSpeechRecognitionCtor() !== null,
    [],
  );

  const stopRecognition = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    recRef.current = null;
  }, []);

  useEffect(() => () => stopRecognition(), [stopRecognition]);

  const runRecognition = useCallback(
    (panel: "responder" | "survivor", langCode: string) => {
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) return;

      stopRecognition();

      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = langCode;

      rec.onresult = (event: SpeechRecEvent) => {
        const parts: string[] = [];
        for (let i = 0; i < event.results.length; i++) {
          const alt = event.results[i][0];
          if (alt?.transcript) parts.push(alt.transcript);
        }
        const line = normalizeTranscript(parts.join(" "));
        if (panel === "responder") setResponderInput(line);
        else setSurvivorInput(line);
      };

      rec.onerror = (event: SpeechRecErrorEvent) => {
        console.warn("[CommsBridge] speech", event.error);
        stopRecognition();
      };

      rec.onend = () => {
        recRef.current = null;
      };

      recRef.current = rec;
      try {
        rec.start();
      } catch (e) {
        console.warn("[CommsBridge] rec.start", e);
        stopRecognition();
      }
    },
    [stopRecognition],
  );

  const translateResponderText = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || loadingReceiver) return;
      const target = langById(survivorLang);
      setError(null);
      setLoadingReceiver("survivor");
      try {
        const translated = await translateWithRetry(text, target.label);
        const key = `${Date.now()}-sv`;
        setSurvivorCard({ original: text, translated, key });
        setLog((prev) => [
          ...prev,
          {
            id: key,
            origin: "responder",
            original: text,
            translated,
            sourceLangLabel: langById(responderLang).label,
            targetLangLabel: target.label,
          },
        ]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Translation failed");
      } finally {
        setLoadingReceiver(null);
      }
    },
    [loadingReceiver, responderLang, survivorLang],
  );

  const translateSurvivorText = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || loadingReceiver) return;
      const target = langById(responderLang);
      setError(null);
      setLoadingReceiver("responder");
      try {
        const translated = await translateWithRetry(text, target.label);
        const key = `${Date.now()}-re`;
        setResponderCard({ original: text, translated, key });
        setLog((prev) => [
          ...prev,
          {
            id: key,
            origin: "survivor",
            original: text,
            translated,
            sourceLangLabel: langById(survivorLang).label,
            targetLangLabel: target.label,
          },
        ]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Translation failed");
      } finally {
        setLoadingReceiver(null);
      }
    },
    [loadingReceiver, survivorLang, responderLang],
  );

  const translateFromResponder = useCallback(() => {
    void translateResponderText(responderInput);
  }, [responderInput, translateResponderText]);

  const translateFromSurvivor = useCallback(() => {
    void translateSurvivorText(survivorInput);
  }, [survivorInput, translateSurvivorText]);

  const onResponderMicDown = useCallback(() => {
    runRecognition("responder", langById(responderLang).speechCode);
  }, [responderLang, runRecognition]);

  const onSurvivorMicDown = useCallback(() => {
    runRecognition("survivor", langById(survivorLang).speechCode);
  }, [survivorLang, runRecognition]);

  const onMicUp = useCallback(() => {
    stopRecognition();
  }, [stopRecognition]);

  const langOptions = LANGS.map((l) => (
    <option key={l.id} value={l.id}>
      {l.label}
    </option>
  ));

  return (
    <div className="space-y-6">
      <p className="text-[11px] leading-relaxed text-gray-500">
        Bidirectional offline translation for responder ↔ survivor. Speech and
        text are sent to local <span className="font-mono text-gray-400">/api/chat</span>{" "}
        (Ollama). Use typed input if Web Speech is unavailable.
      </p>

      {error ? (
        <div className="rounded border border-rose-900/50 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      ) : null}

      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded border border-gray-800/80 bg-gray-900/30 px-3 py-2.5"
        role="group"
        aria-label="Scenario mode"
      >
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
          Phrase set
        </span>
        <div className="flex flex-wrap gap-1 rounded border border-gray-800 bg-gray-950/60 p-0.5">
          <button
            type="button"
            onClick={() => setScenarioMode("disaster")}
            className={`rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition ${
              scenarioMode === "disaster"
                ? "border border-sky-500/50 bg-sky-950/50 text-sky-100 shadow-[0_0_12px_rgba(56,189,248,0.15)]"
                : "border border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            Disaster
          </button>
          <button
            type="button"
            onClick={() => setScenarioMode("combat")}
            className={`rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition ${
              scenarioMode === "combat"
                ? "border border-red-500/50 bg-red-950/50 text-red-100 shadow-[0_0_12px_rgba(248,113,113,0.12)]"
                : "border border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            Combat
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-0 lg:flex-row lg:gap-0">
        {/* Responder */}
        <div className="min-w-0 flex-1 border-b border-[rgba(255,255,255,0.08)] pb-6 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-500/90">
            RESPONDER
          </div>
          <label htmlFor={responderSelectId} className="sr-only">
            Responder language
          </label>
          <select
            id={responderSelectId}
            value={responderLang}
            onChange={(e) => setResponderLang(e.target.value as LangId)}
            className={selectClass}
            style={selectStyle}
          >
            {langOptions}
          </select>

          <div className="mt-3 flex flex-wrap gap-2">
            {getQuickPhrases(scenarioMode).map((q, i) => (
              <button
                key={`r-${scenarioMode}-${i}-${q.slice(0, 24)}`}
                type="button"
                onClick={() => {
                  setResponderInput(q);
                  void translateResponderText(q);
                }}
                disabled={!!loadingReceiver}
                className="rounded border border-gray-700 bg-gray-900/80 px-3 py-2 text-left text-[10px] leading-snug text-gray-300 transition hover:border-amber-700/40 hover:text-amber-100 disabled:opacity-40 sm:text-xs"
              >
                {q}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={!speechSupported || !!loadingReceiver}
            onPointerDown={onResponderMicDown}
            onPointerUp={onMicUp}
            onPointerCancel={onMicUp}
            style={{ touchAction: "none" }}
            className="mt-4 w-full select-none border border-amber-700/40 bg-gray-900 px-5 py-3 text-xs font-bold uppercase tracking-wider text-gray-100 transition hover:border-amber-600/50 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            🎙 Hold to speak
          </button>

          <textarea
            className="mt-3 min-h-[88px] w-full resize-y border border-gray-700 bg-gray-900/80 p-3 text-sm text-gray-100 outline-none placeholder:text-gray-600 focus:border-amber-700/50 focus:ring-1 focus:ring-amber-600/30"
            placeholder="Type message to translate for survivor…"
            value={responderInput}
            onChange={(e) => setResponderInput(e.target.value)}
            spellCheck
          />
          <button
            type="button"
            disabled={!responderInput.trim() || !!loadingReceiver}
            onClick={() => void translateFromResponder()}
            className="mt-2 w-full border border-amber-800/50 bg-amber-950/20 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-amber-100 transition hover:bg-amber-950/40 disabled:opacity-40"
          >
            {loadingReceiver === "survivor" ? "Translating…" : "Send translation"}
          </button>

          <div className="relative mt-4 min-h-[48px]">
            {loadingReceiver === "responder" ? (
              <div
                className="mb-2 h-0.5 w-full overflow-hidden rounded-full bg-gray-800"
                aria-busy
                aria-label="Translating"
              >
                <div className="h-full w-2/5 animate-pulse rounded-full bg-amber-500/80" />
              </div>
            ) : null}
            {responderCard ? (
              <div
                key={responderCard.key}
                className="card-in space-y-2 rounded-[10px] border border-[rgba(255,159,10,0.25)] px-4 py-3.5 text-[15px] text-white"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  fontFamily:
                    "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
                }}
              >
                <div>{responderCard.translated}</div>
                <div className="text-[11px] text-gray-500">
                  {responderCard.original}
                </div>
              </div>
            ) : null}
            {responderCard ? (
              <button
                type="button"
                onClick={() =>
                  speak(
                    responderCard.translated,
                    langById(responderLang).ttsLang,
                  )
                }
                className="mt-2 w-full border border-amber-700/40 bg-transparent px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-amber-100/90 transition hover:bg-amber-950/30"
              >
                🔊 SPEAK IN {langById(responderLang).label.toUpperCase()}
              </button>
            ) : null}
          </div>
        </div>

        {/* Survivor */}
        <div className="min-w-0 flex-1 pt-6 lg:pl-6 lg:pt-0">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-500/90">
            SURVIVOR
          </div>
          <label htmlFor={survivorSelectId} className="sr-only">
            Survivor language
          </label>
          <select
            id={survivorSelectId}
            value={survivorLang}
            onChange={(e) => setSurvivorLang(e.target.value as LangId)}
            className={selectClass}
            style={selectStyle}
          >
            {langOptions}
          </select>

          <div className="mt-3 flex flex-wrap gap-2">
            {getQuickPhrases(scenarioMode).map((q, i) => (
              <button
                key={`s-${scenarioMode}-${i}-${q.slice(0, 24)}`}
                type="button"
                onClick={() => {
                  setSurvivorInput(q);
                  void translateSurvivorText(q);
                }}
                disabled={!!loadingReceiver}
                className="rounded border border-gray-700 bg-gray-900/80 px-3 py-2 text-left text-[10px] leading-snug text-gray-300 transition hover:border-amber-700/40 hover:text-amber-100 disabled:opacity-40 sm:text-xs"
              >
                {q}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={!speechSupported || !!loadingReceiver}
            onPointerDown={onSurvivorMicDown}
            onPointerUp={onMicUp}
            onPointerCancel={onMicUp}
            style={{ touchAction: "none" }}
            className="mt-4 w-full select-none border border-amber-700/40 bg-gray-900 px-5 py-3 text-xs font-bold uppercase tracking-wider text-gray-100 transition hover:border-amber-600/50 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            🎙 Hold to speak
          </button>

          <textarea
            className="mt-3 min-h-[88px] w-full resize-y border border-gray-700 bg-gray-900/80 p-3 text-sm text-gray-100 outline-none placeholder:text-gray-600 focus:border-amber-700/50 focus:ring-1 focus:ring-amber-600/30"
            placeholder="Type message to translate for responder…"
            value={survivorInput}
            onChange={(e) => setSurvivorInput(e.target.value)}
            spellCheck
          />
          <button
            type="button"
            disabled={!survivorInput.trim() || !!loadingReceiver}
            onClick={() => void translateFromSurvivor()}
            className="mt-2 w-full border border-amber-800/50 bg-amber-950/20 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-amber-100 transition hover:bg-amber-950/40 disabled:opacity-40"
          >
            {loadingReceiver === "responder" ? "Translating…" : "Send translation"}
          </button>

          <div className="relative mt-4 min-h-[48px]">
            {loadingReceiver === "survivor" ? (
              <div
                className="mb-2 h-0.5 w-full overflow-hidden rounded-full bg-gray-800"
                aria-busy
                aria-label="Translating"
              >
                <div className="h-full w-2/5 animate-pulse rounded-full bg-amber-500/80" />
              </div>
            ) : null}
            {survivorCard ? (
              <div
                key={survivorCard.key}
                className="card-in space-y-2 rounded-[10px] border border-[rgba(255,159,10,0.25)] px-4 py-3.5 text-[15px] text-white"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  fontFamily:
                    "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
                }}
              >
                <div>{survivorCard.translated}</div>
                <div className="text-[11px] text-gray-500">
                  {survivorCard.original}
                </div>
              </div>
            ) : null}
            {survivorCard ? (
              <button
                type="button"
                onClick={() =>
                  speak(
                    survivorCard.translated,
                    langById(survivorLang).ttsLang,
                  )
                }
                className="mt-2 w-full border border-amber-700/40 bg-transparent px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-amber-100/90 transition hover:bg-amber-950/30"
              >
                🔊 SPEAK IN {langById(survivorLang).label.toUpperCase()}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Log */}
      <div>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
          Conversation log
        </div>
        <div
          className="max-h-[200px] space-y-2 overflow-y-auto rounded-xl border border-gray-800/80 bg-[#0e1318] p-3"
          style={{ borderRadius: 12 }}
        >
          {log.length === 0 ? (
            <p className="text-center text-[11px] text-gray-600">
              Translations appear here.
            </p>
          ) : (
            log.map((entry) => (
              <div
                key={entry.id}
                className={`flex ${entry.origin === "responder" ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[min(100%,28rem)] rounded-lg border px-3 py-2 ${
                    entry.origin === "responder"
                      ? "border-gray-700/80 bg-gray-900/50"
                      : "border-amber-900/30 bg-amber-950/20"
                  }`}
                >
                  <span
                    className={`mb-1 inline-block rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                      entry.origin === "responder"
                        ? "bg-gray-800 text-gray-400"
                        : "bg-amber-900/40 text-amber-200/90"
                    }`}
                  >
                    {entry.sourceLangLabel} → {entry.targetLangLabel}
                  </span>
                  <div
                    className="text-[15px] text-white"
                    style={{
                      fontFamily:
                        "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
                    }}
                  >
                    {entry.translated}
                  </div>
                  <div className="mt-1 text-[10px] text-gray-500">
                    {entry.original}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  );
}
