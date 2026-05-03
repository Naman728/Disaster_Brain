"use client";

import {
  useCallback,
  useRef,
  useState,
  type DragEvent,
} from "react";
import type { TriagePayload } from "@/components/TriageCard";
import { usePatients } from "@/context/PatientContext";

type PhotoTriageApiResponse = {
  success: boolean;
  triage?: TriagePayload & Record<string, unknown>;
  error?: string;
};

const PHOTO_FETCH_TIMEOUT_MS = 120_000;

function logPhotoTriageResponse(payload: {
  httpStatus: number;
  ok: boolean;
  parsed: PhotoTriageApiResponse;
  rawText: string;
}) {
  const { rawText, ...rest } = payload;
  const rawPreview =
    rawText.length > 4000 ? `${rawText.slice(0, 4000)}… (${rawText.length} chars)` : rawText;
  console.info("[DisasterBrain] /api/photo-triage full response", {
    ...rest,
    rawPreview,
  });
}

function extractFromDataUrlPreview(preview: string): {
  base64Data: string;
  mimeType: string | undefined;
} {
  const trimmed = preview.trim();
  const comma = trimmed.indexOf(",");
  if (comma === -1) {
    const base64Data = trimmed;
    if (!base64Data) throw new Error("Invalid image format");
    return { base64Data, mimeType: undefined };
  }
  const header = trimmed.slice(0, comma);
  const base64Data = trimmed.slice(comma + 1).trim();
  if (!base64Data) throw new Error("Invalid image format");
  const mimeType = header.match(/:(.*?);/)?.[1];
  return { base64Data, mimeType };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r !== "string" || !r.trim()) {
        reject(new Error("Invalid image format"));
        return;
      }
      resolve(r);
    };
    reader.onerror = () => reject(new Error("Could not read image file"));
    reader.readAsDataURL(file);
  });
}

export default function PhotoUpload() {
  const { addPatient, getNextApiPatientNumber } = usePatients();
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const clearPreview = useCallback(() => {
    setPreview(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const applyFile = useCallback(async (file: File | null | undefined) => {
    if (!file || !file.type.startsWith("image/")) {
      setError(null);
      if (!file) setPreview(null);
      else setError("Please choose an image file.");
      return;
    }
    setError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setPreview(dataUrl);
    } catch (e) {
      console.error("[PhotoUpload] read failed", e);
      setPreview(null);
      setError(
        e instanceof Error ? e.message : "Invalid image format",
      );
    }
  }, []);

  const analyzePhoto = useCallback(async () => {
    if (!preview || loading) return;

    const patientNumber = getNextApiPatientNumber();
    const ac = new AbortController();
    const timeoutId = window.setTimeout(() => ac.abort(), PHOTO_FETCH_TIMEOUT_MS);

    setLoading(true);
    setError(null);
    try {
      let base64Payload: string;
      let mimeType: string | undefined;
      try {
        const extracted = extractFromDataUrlPreview(preview);
        base64Payload = extracted.base64Data;
        mimeType = extracted.mimeType;
      } catch (e) {
        throw new Error(
          e instanceof Error ? e.message : "Invalid image format",
        );
      }

      const body = {
        imageBase64: base64Payload,
        mimeType,
        patientNumber,
      };

      let res: Response;
      try {
        res = await fetch("/api/photo-triage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ac.signal,
          cache: "no-store",
        });
      } catch (fetchErr) {
        console.error("[PhotoUpload] fetch failed", fetchErr);
        throw new Error("Photo analysis failed. Check Ollama + API.");
      }

      const rawText = await res.text();
      let data: PhotoTriageApiResponse;
      try {
        data = JSON.parse(rawText) as PhotoTriageApiResponse;
      } catch {
        console.error("[PhotoUpload] bad JSON body", rawText.slice(0, 400));
        console.info("[DisasterBrain] /api/photo-triage non-JSON body", {
          httpStatus: res.status,
          rawPreview: rawText.slice(0, 4000),
        });
        throw new Error("Photo analysis failed. Check Ollama + API.");
      }

      logPhotoTriageResponse({
        httpStatus: res.status,
        ok: res.ok,
        parsed: data,
        rawText,
      });

      if (!res.ok || data.success !== true || !data.triage) {
        throw new Error(
          data.error ?? "Photo analysis failed. Check Ollama + API.",
        );
      }

      const triage: TriagePayload = { ...data.triage };
      addPatient({
        triage,
        source: "photo",
        symptomsRaw: "Photo field triage",
        photoDataUrl: preview,
      });

      clearPreview();
    } catch (e) {
      console.error("[PhotoUpload] analyze error", e);
      setError(
        e instanceof Error
          ? e.message
          : "Photo analysis failed. Check Ollama + API.",
      );
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }, [addPatient, clearPreview, getNextApiPatientNumber, preview, loading]);

  const onDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current < 0) dragDepthRef.current = 0;
  }, []);

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
      const file = e.dataTransfer.files?.[0];
      void applyFile(file);
    },
    [applyFile],
  );

  return (
    <div className="space-y-3">
      <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
        Photo field triage
      </label>

      <div
        role="presentation"
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className="rounded border border-dashed border-gray-600 bg-gray-900/40 px-4 py-6 text-center text-xs text-gray-500 transition hover:border-amber-700/40 hover:text-gray-400"
      >
        <p className="mb-3">
          Drag & drop an image here, or choose / capture below (Mac & Windows).
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="mx-auto max-w-full text-xs text-gray-400 file:mr-3 file:border file:border-gray-600 file:bg-gray-900 file:px-3 file:py-1.5 file:text-gray-200"
          onChange={(e) => void applyFile(e.target.files?.[0])}
        />
      </div>

      {preview ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="Selected scene preview"
            className="max-h-48 w-auto max-w-full rounded border border-gray-700 object-contain"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                void analyzePhoto();
              }}
              className="border border-amber-700/50 bg-amber-950/40 px-4 py-2 text-xs font-bold uppercase tracking-wider text-amber-100 transition hover:bg-amber-900/50 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {loading ? "Gemma 4 analyzing injury..." : "Analyze photo"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={clearPreview}
              className="px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500 underline decoration-gray-700 hover:text-gray-400 disabled:opacity-40"
            >
              Clear image
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="border border-rose-900/50 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      ) : null}
    </div>
  );
}
