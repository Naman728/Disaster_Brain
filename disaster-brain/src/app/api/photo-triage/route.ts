import { NextRequest, NextResponse } from "next/server";
import {
  OLLAMA_GENERATE_URL,
  OLLAMA_MODEL,
  OLLAMA_TIMEOUT_MS,
} from "@/lib/ollama-config";

export const runtime = "nodejs";

const PHOTO_UPSTREAM_HINT = `Photo analysis failed. Ensure Ollama is running with ${OLLAMA_MODEL}`;

/**
 * Photo / vision triage — START vs TCCC, disaster vs conflict, extended injury taxonomy.
 * Server attaches patientId, timestamp, source; maps evacuationPriority → transportPriority for queue UI.
 */
const PHOTO_TRIAGE_PROMPT = `You are Disaster Brain — an offline AI trauma assessment system for disaster response and conflict zone field medicine.

Analyze the photograph. Look for ALL of the following:

DISASTER injuries:
- crush wounds
- fall injuries
- drowning signs
- burns from fire
- structural trauma

COMBAT injuries:
- gunshot wounds (entry/exit wounds)
- blast injuries (primary/secondary/tertiary)
- shrapnel wounds
- burns from explosions
- traumatic amputations
- tourniquet already applied
- blast lung signs

Auto-detect scenario from visible injury pattern. Decide whether this is a civilian disaster scene or a conflict zone medical situation.

Respond ONLY with valid JSON — no markdown, no explanation, raw JSON only:

{
  "protocol": "START" | "TCCC",
  "scenarioType": "disaster" | "conflict",
  "startTag": "IMMEDIATE" | "DELAYED" | "MINOR" | "EXPECTANT",
  "priorityLevel": 1 | 2 | 3 | 4,
  "priorityLabel": "Critical" | "Urgent" | "Non-Urgent" | "Expectant",
  "chiefComplaint": "Visual assessment summary",

  "vitalSigns": {
    "consciousness": "Alert" | "Verbal" | "Pain" | "Unresponsive" | "Unknown",
    "breathing": "Normal" | "Labored" | "Absent" | "Unknown",
    "circulation": "Normal" | "Weak" | "Absent" | "Unknown"
  },

  "visibleInjuries": ["detailed description of each visible injury"],

  "combatSpecific": {
    "tourniquetVisible": true | false,
    "blastInjury": true | false,
    "penetratingTrauma": true | false,
    "burnPresent": true | false,
    "amputationPresent": true | false
  },

  "suspectedInjuries": ["suspected injuries based on mechanism of injury"],

  "immediateActions": ["action1", "action2", "action3"],

  "tcccActions": {
    "massiveHemorrhage": "instruction or N/A",
    "airway": "instruction or N/A",
    "respiration": "instruction or N/A",
    "circulation": "instruction or N/A",
    "hypothermia": "instruction or N/A"
  },

  "doNotDo": ["critical warnings if any"],

  "evacuationPriority": "Immediate" | "Urgent (1hr)" | "Priority (4hr)" | "Routine (24hr)",

  "confidenceNote": "brief note on image quality and diagnostic confidence"
}

Be decisive and conservative in life-threatening interpretation.

If a tourniquet is visible, assume active hemorrhage control and recommend time check immediately.

If blast injury is suspected, assume primary blast lung involvement until ruled out.

If gunshot or shrapnel is visible, assume penetrating trauma with internal injury risk even if external wound appears small.

OUTPUT RULES:
- One JSON object only; double-quoted strings; no code fences.
- Arrays must have at least one entry (use "None identified" or "Unknown" if needed).
- You may omit patientId and timestamp — the API will set them.`;

function normalizePhotoTriageShape(parsed: Record<string, unknown>): void {
  if (
    typeof parsed.evacuationPriority === "string" &&
    parsed.evacuationPriority.trim() &&
    (parsed.transportPriority === undefined ||
      (typeof parsed.transportPriority === "string" &&
        !String(parsed.transportPriority).trim()))
  ) {
    parsed.transportPriority = parsed.evacuationPriority;
  }
}

const SHORT_IMAGE_PROMPT =
  "Analyze this disaster or casualty scene image. Apply the system rules and respond with ONLY the JSON object, nothing else.";

function stripDataUrlPrefix(imageBase64: string): string {
  const t = imageBase64.trim();
  if (t.startsWith("data:")) {
    const comma = t.indexOf(",");
    if (comma !== -1) return t.slice(comma + 1).trim();
  }
  return t;
}

function formatPatientId(patientNumber: number): string {
  const n = Number.isFinite(patientNumber) ? Math.max(1, Math.floor(patientNumber)) : 1;
  return `P-${String(n).padStart(3, "0")}`;
}

function nowHHMM24(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function cleanModelJsonText(raw: string): string {
  return raw
    .replace(/```json\n?/gi, "")
    .replace(/```/g, "")
    .trim();
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    if (typeof body !== "object" || body === null) {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 },
      );
    }

    const b = body as {
      imageBase64?: unknown;
      mimeType?: unknown;
      patientNumber?: unknown;
    };

    if (typeof b.imageBase64 !== "string" || !b.imageBase64.trim()) {
      return NextResponse.json(
        { success: false, error: "Field imageBase64 is required" },
        { status: 400 },
      );
    }

    const patientNumber =
      typeof b.patientNumber === "number" &&
      Number.isFinite(b.patientNumber) &&
      b.patientNumber > 0
        ? Math.floor(b.patientNumber)
        : 1;

    const mimeType =
      typeof b.mimeType === "string" && b.mimeType.trim() ? b.mimeType.trim() : undefined;

    const imagePayload = stripDataUrlPrefix(b.imageBase64);
    if (!imagePayload) {
      return NextResponse.json(
        { success: false, error: "imageBase64 is empty after stripping data URL" },
        { status: 400 },
      );
    }

    const ollamaPayload = {
      model: OLLAMA_MODEL,
      prompt: SHORT_IMAGE_PROMPT,
      system: PHOTO_TRIAGE_PROMPT,
      images: [imagePayload],
      stream: false as const,
      options: {
        temperature: 0.1,
      },
    };

    if (mimeType) {
      console.log("[api/photo-triage] client mimeType (informational):", mimeType);
    }

    console.log("[api/photo-triage] before Ollama fetch", {
      model: ollamaPayload.model,
      imageChars: imagePayload.length,
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
      console.error("[api/photo-triage] Ollama fetch error", err);
      return NextResponse.json(
        {
          success: false,
          error: PHOTO_UPSTREAM_HINT,
        },
        { status: 500 },
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!ollamaRes.ok) {
      const detail = await ollamaRes.text().catch(() => "");
      console.error("[api/photo-triage] Ollama HTTP error", ollamaRes.status, detail);
      return NextResponse.json(
        {
          success: false,
          error: PHOTO_UPSTREAM_HINT,
        },
        { status: 500 },
      );
    }

    let ollamaData: unknown;
    try {
      ollamaData = await ollamaRes.json();
    } catch (e) {
      console.error("[api/photo-triage] invalid JSON from Ollama HTTP", e);
      return NextResponse.json(
        {
          success: false,
          error: PHOTO_UPSTREAM_HINT,
        },
        { status: 500 },
      );
    }

    const rawText =
      typeof ollamaData === "object" &&
      ollamaData !== null &&
      "response" in ollamaData &&
      typeof (ollamaData as { response: unknown }).response === "string"
        ? (ollamaData as { response: string }).response.trim()
        : "";

    if (!rawText) {
      console.error("[api/photo-triage] empty model response", ollamaData);
      return NextResponse.json(
        { success: false, error: "Invalid model output" },
        { status: 500 },
      );
    }

    const cleaned = cleanModelJsonText(rawText);
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error("[api/photo-triage] no JSON object in model output", cleaned.slice(0, 1500));
      return NextResponse.json(
        { success: false, error: "Invalid model output" },
        { status: 500 },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(match[0]);
    } catch (parseErr) {
      console.error("[api/photo-triage] JSON.parse failed", parseErr);
      console.error("[api/photo-triage] matched segment:", match[0].slice(0, 2000));
      return NextResponse.json(
        { success: false, error: "Model returned invalid JSON" },
        { status: 500 },
      );
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json(
        { success: false, error: "Model returned invalid JSON" },
        { status: 500 },
      );
    }

    const merged = { ...(parsed as Record<string, unknown>) };
    normalizePhotoTriageShape(merged);

    const triage: Record<string, unknown> = {
      ...merged,
      patientId: formatPatientId(patientNumber),
      timestamp: nowHHMM24(),
      source: "photo",
    };

    console.log("[api/photo-triage] success", {
      patientId: triage.patientId,
      startTag: triage["startTag"],
    });

    return NextResponse.json({ success: true, triage });
  } catch (err) {
    console.error("[api/photo-triage] unexpected error", err);
    return NextResponse.json(
      {
        success: false,
        error: PHOTO_UPSTREAM_HINT,
      },
      { status: 500 },
    );
  }
}
