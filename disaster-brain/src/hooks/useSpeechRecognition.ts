"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Minimal Web Speech API surface (DOM lib may omit these types). */
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

function normalizeTranscript(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeechRecognition() {
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    setSupported(getSpeechRecognitionCtor() !== null);
  }, []);

  const stopListening = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    recRef.current = null;
    setListening(false);
  }, []);

  const resetTranscript = useCallback(() => {
    setTranscript("");
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor || typeof window === "undefined") return;

    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    recRef.current = null;

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = (event: SpeechRecEvent) => {
      const parts: string[] = [];
      for (let i = 0; i < event.results.length; i++) {
        const alt = event.results[i][0];
        if (alt?.transcript) parts.push(alt.transcript);
      }
      setTranscript(normalizeTranscript(parts.join(" ")));
    };

    rec.onerror = (event: SpeechRecErrorEvent) => {
      console.warn("[useSpeechRecognition]", event.error);
      setListening(false);
    };

    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };

    recRef.current = rec;
    setListening(true);

    try {
      rec.start();
    } catch (e) {
      console.warn("[useSpeechRecognition] start failed", e);
      setListening(false);
      recRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
      recRef.current = null;
    };
  }, []);

  return {
    transcript,
    listening,
    supported,
    startListening,
    stopListening,
    resetTranscript,
  };
}
