/**
 * Default matches Kaggle/rag: port 8010 + `/disaster-brain-rag` prefix so another app can keep :8000.
 * Override in `.env.local` with full base (no trailing slash), e.g. RAG_SERVER_URL=http://127.0.0.1:8010/disaster-brain-rag
 */
export const DEFAULT_RAG_SERVER_URL =
  "http://127.0.0.1:8010/disaster-brain-rag";

/** FastAPI RAG base URL (server-side only). Used by /api/rag/* proxy routes. */
export function getRagServerBaseUrl(): string {
  const raw = process.env.RAG_SERVER_URL;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim().replace(/\/$/, "");
  }
  return DEFAULT_RAG_SERVER_URL;
}
