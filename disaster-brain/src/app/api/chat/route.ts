import { Ollama } from "ollama";
import { OLLAMA_HOST, OLLAMA_MODEL } from "@/lib/ollama-config";

// Node runtime: reliable access to local Ollama (avoid Edge).
export const runtime = "nodejs";

const SYSTEM_PREFIX =
  "You are Disaster Brain, a concise assistant for emergency and disaster response. " +
  "Give practical, safety-aware guidance. If you are unsure, say so.\n\n";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message =
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof (body as { message: unknown }).message === "string"
      ? (body as { message: string }).message
      : null;

  if (!message?.trim()) {
    return Response.json(
      {
        error:
          'Field "message" is required and must be a non-empty string',
      },
      { status: 400 },
    );
  }

  const systemOverride =
    typeof body === "object" &&
    body !== null &&
    "system" in body &&
    typeof (body as { system: unknown }).system === "string"
      ? (body as { system: string }).system.trim()
      : null;

  const trimmedMessage = message.trim();

  /** COMMS Bridge and similar: one user blob + no "think" stream — Gemma 3 otherwise often returns refusals or empty `content`. */
  const translatorMode = Boolean(systemOverride);

  type ChatMsg = { role: "system" | "user"; content: string };
  const messages: ChatMsg[] = translatorMode
    ? [
        {
          role: "user",
          content: `${systemOverride}\n\n---\nTEXT TO TRANSLATE (reply with only the translation):\n${trimmedMessage}`,
        },
      ]
    : [
        {
          role: "user",
          content: `${SYSTEM_PREFIX}User:\n${trimmedMessage}\n\nAssistant:`,
        },
      ];

  const encoder = new TextEncoder();

  try {
    const ollama = new Ollama({ host: OLLAMA_HOST });

    console.log("[api/chat] starting Ollama chat stream", {
      model: OLLAMA_MODEL,
      host: OLLAMA_HOST,
      translatorMode,
    });

    const ollamaStream = await ollama.chat({
      model: OLLAMA_MODEL,
      messages,
      stream: true,
      // Thinking models may leave `content` empty or emit refusals for strict translator prompts.
      think: translatorMode ? false : undefined,
      options: translatorMode
        ? { num_predict: 768, temperature: 0.28, top_p: 0.95 }
        : { num_predict: 2048 },
    });

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of ollamaStream) {
            const m = chunk.message;
            const thinking =
              m && typeof m.thinking === "string" ? m.thinking : "";
            const content =
              m && typeof m.content === "string" ? m.content : "";
            if (translatorMode) {
              if (content) controller.enqueue(encoder.encode(content));
            } else {
              const piece = thinking + content;
              if (piece) controller.enqueue(encoder.encode(piece));
            }
          }
          controller.close();
          console.log("[api/chat] stream finished");
        } catch (streamErr) {
          console.error("[api/chat] stream error", streamErr);
          const msg =
            streamErr instanceof Error ? streamErr.message : "Stream failed";
          controller.enqueue(encoder.encode(`\n\n[Error] ${msg}`));
          controller.close();
        }
      },
    });

    return new Response(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/chat] Ollama setup/chat error", err);
    return Response.json(
      {
        error:
          "Could not reach Ollama or start the model. Is it running on 127.0.0.1:11434?",
      },
      { status: 500 },
    );
  }
}
