import { NextRequest, NextResponse } from "next/server";
import {
  OLLAMA_GENERATE_URL,
  OLLAMA_MODEL,
  OLLAMA_TIMEOUT_MS,
} from "@/lib/ollama-config";

export const runtime = "nodejs";

const TRIAGE_SYSTEM_PROMPT = `You are a disaster-field triage decision support module.

CRITICAL OUTPUT RULES:
- Respond with ONE single JSON object only.
- Do NOT wrap the JSON in markdown code fences (no \`\`\`json).
- Do NOT add any text before or after the JSON.
- Use double quotes for all JSON strings.

The JSON MUST conform to this shape and allowed enum values:

{
  "patientId": "P-001",
  "timestamp": "HH:MM",
  "startTag": "IMMEDIATE" | "DELAYED" | "MINOR" | "EXPECTANT",
  "priorityLevel": 1 | 2 | 3 | 4,
  "priorityLabel": "Critical" | "Urgent" | "Non-Urgent" | "Expectant",
  "chiefComplaint": "string",
  "vitalSigns": {
    "consciousness": "Alert" | "Verbal" | "Pain" | "Unresponsive",
    "breathing": "Normal" | "Labored" | "Absent",
    "circulation": "Normal" | "Weak" | "Absent"
  },
  "suspectedInjuries": ["string"],
  "immediateActions": ["string"],
  "doNotDo": ["string"],
  "transportPriority": "Immediate evacuation" | "Next available" | "Delayed" | "Do not transport"
}

Consistency rules:
- IMMEDIATE ↔ priorityLevel 1 ↔ priorityLabel "Critical"
- DELAYED ↔ 2 ↔ "Urgent"
- MINOR ↔ 3 ↔ "Non-Urgent"
- EXPECTANT ↔ 4 ↔ "Expectant"

Arrays must contain at least one string each (use "Unknown" if truly not applicable).
Be concise and clinically appropriate.`;

function jsonError(
  success: false,
  error: string,
  status: number,
): NextResponse<{ success: false; error: string }> {
  return NextResponse.json({ success, error }, { status });
}

function stripMarkdownCodeFence(raw: string): string {
  let s = raw.trim();
  const wrapped = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/i.exec(s);
  if (wrapped) return wrapped[1].trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  return s.trim();
}

function extractJsonObject(s: string): string {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end > start) return s.slice(start, end + 1).trim();
  return s.trim();
}

function formatPatientId(patientNumber: number): string {
  const n = Number.isFinite(patientNumber) ? Math.max(1, Math.floor(patientNumber)) : 1;
  return `P-${String(n).padStart(3, "0")}`;
}

function nowHHMM24(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(false, "Invalid JSON body", 400);
    }

    if (typeof body !== "object" || body === null) {
      return jsonError(false, "Invalid request body", 400);
    }

    const b = body as { symptoms?: unknown; patientNumber?: unknown };
    const symptoms = b.symptoms;
    if (typeof symptoms !== "string" || !symptoms.trim()) {
      return jsonError(
        false,
        'Field "symptoms" is required and must be a non-empty string',
        400,
      );
    }

    const patientNumber =
      typeof b.patientNumber === "number" &&
      Number.isFinite(b.patientNumber) &&
      b.patientNumber > 0
        ? Math.floor(b.patientNumber)
        : 1;

    const USER_PROMPT = `PATIENT SYMPTOMS (for triage only):
${symptoms.trim()}

Output the JSON object now.`;

    const FULL_PROMPT = `${TRIAGE_SYSTEM_PROMPT}\n\n${USER_PROMPT}`;

    const ollamaPayload = {
      model: OLLAMA_MODEL,
      prompt: FULL_PROMPT,
      stream: false as const,
      options: {
        temperature: 0.1,
        top_p: 0.9,
      },
    };

    console.log("[api/triage] before Ollama fetch", {
      url: OLLAMA_GENERATE_URL,
      model: ollamaPayload.model,
      patientNumber,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

    let ollamaRes: Response;
    try {
      ollamaRes = await fetch(OLLAMA_GENERATE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ollamaPayload),
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        console.error("[api/triage] Ollama fetch aborted (timeout)", OLLAMA_TIMEOUT_MS);
        return NextResponse.json({
          success: false,
          error: "Ollama request timed out",
        });
      }
      console.error("[api/triage] Ollama fetch network error", err);
      return NextResponse.json({
        success: false,
        error: "Could not reach Ollama",
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const ok = ollamaRes.ok === true;
    console.log("[api/triage] after Ollama fetch", { status: ollamaRes.status, ok });

    if (!ok) {
      const detail = await ollamaRes.text().catch(() => "");
      console.error("[api/triage] Ollama HTTP not ok", ollamaRes.status, detail.slice(0, 800));
      return NextResponse.json({
        success: false,
        error: "Ollama request failed",
      });
    }

    let ollamaData: unknown;
    try {
      ollamaData = await ollamaRes.json();
    } catch (e) {
      console.error("[api/triage] failed to parse Ollama HTTP body as JSON", e);
      return NextResponse.json({
        success: false,
        error: "Invalid response body from Ollama",
      });
    }

    console.log("[api/triage] Ollama body parsed", {
      hasResponse:
        typeof ollamaData === "object" &&
        ollamaData !== null &&
        "response" in ollamaData,
    });

    const responseText =
      typeof ollamaData === "object" &&
      ollamaData !== null &&
      "response" in ollamaData &&
      typeof (ollamaData as { response: unknown }).response === "string"
        ? (ollamaData as { response: string }).response
        : "";

    if (!responseText.trim()) {
      console.error("[api/triage] empty model response field", ollamaData);
      return NextResponse.json({
        success: false,
        error: "Empty response from Ollama model",
      });
    }

    const cleaned = extractJsonObject(stripMarkdownCodeFence(responseText));

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("[api/triage] model JSON parse failed", parseErr);
      console.error("[api/triage] raw model text (truncated):", responseText.slice(0, 2000));
      return NextResponse.json({
        success: false,
        error: "Invalid JSON from model",
      });
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.error("[api/triage] parsed root is not a plain object", parsed);
      return NextResponse.json({
        success: false,
        error: "Invalid JSON from model",
      });
    }

    const triage: Record<string, unknown> = {
      ...(parsed as Record<string, unknown>),
      patientId: formatPatientId(patientNumber),
      timestamp: nowHHMM24(),
    };

    console.log("[api/triage] triage JSON ready", {
      startTag: triage["startTag"],
      priorityLevel: triage["priorityLevel"],
    });

    return NextResponse.json({ success: true, triage });
  } catch (err) {
    console.error("[api/triage] unexpected handler error", err);
    return NextResponse.json({
      success: false,
      error: "Internal server error",
    });
  }
}
