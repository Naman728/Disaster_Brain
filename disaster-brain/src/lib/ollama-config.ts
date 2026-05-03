/**
 * Single source of truth for local Ollama used by triage + vision routes.
 * Override with OLLAMA_HOST (e.g. http://127.0.0.1:11434) if needed.
 */
export const OLLAMA_MODEL = "gemma3:4b" as const;

const rawHost =
  typeof process.env.OLLAMA_HOST === "string" && process.env.OLLAMA_HOST.trim()
    ? process.env.OLLAMA_HOST.trim().replace(/\/$/, "")
    : "http://127.0.0.1:11434";

export const OLLAMA_HOST = rawHost;

export const OLLAMA_GENERATE_URL = `${OLLAMA_HOST}/api/generate`;
export const OLLAMA_TAGS_URL = `${OLLAMA_HOST}/api/tags`;

export const OLLAMA_TIMEOUT_MS = 120_000;
