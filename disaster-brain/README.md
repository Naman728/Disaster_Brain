# Disaster Brain

**Disaster Brain** is an offline-first demo app for **field triage and responder tools**: voice and photo inputs go through **local Ollama** (`gemma3:4b`), structured triage JSON lands in a **shared in-memory queue**, and optional **RAG** (indexed protocols) plus **COMMS BRIDGE** (multilingual chat) extend the same Next.js app.

It is built for scenarios like the **Gemma 4 Good Hackathon**: run models locally, keep sensitive data on-device, and still show a credible command-center UI.

---

## What you get

| Area | What it does |
|------|----------------|
| **Voice** | Web Speech → `/api/triage` → START-style triage JSON → queue |
| **Photo** | Image → `/api/photo-triage` → vision triage (START/TCCC-style JSON) → queue |
| **Queue** | In-app list + full **`/queue`** board sorted by severity |
| **Protocols** | Next.js **`/api/rag/*`** proxies to **FastAPI + Chroma** (`Kaggle/rag`) for Q&A and SITREP |
| **COMMS BRIDGE** | Responder/survivor panels → **`/api/chat`** (Ollama) for translation + quick phrases |

**Network badge** in the header reflects browser online/offline; local Ollama/RAG can still work when you are “offline” from the internet.

---

## Prerequisites

- **Node.js** 20+ (matches Next 16)
- **Ollama** installed and on your PATH  
- **Chrome** (or Chromium) recommended — **Web Speech API** for voice tab  
- **Protocols / RAG only:** Python **3.10+**, `uv` or `pip` to install `Kaggle/rag` dependencies  

---

## Setup (copy-paste order)

### 1. Start Ollama (leave this terminal open)

```bash
ollama serve
```

If you see *address already in use*, the daemon is already running — continue.

### 2. Pull the chat model (once per machine)

```bash
ollama pull gemma3:4b
```

Same model is used for triage, photo triage, chat, and COMMS BRIDGE unless you change `OLLAMA_MODEL` in code.

### 3. (Optional) Run the protocol RAG API

Only needed for the **Protocols** tab (PDF/seed Q&A and SITREP).

From the **repo root** (folder that contains `disaster-brain/` and `rag/`):

```bash
cd rag
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install uvicorn fastapi chromadb pydantic pypdf requests sentence-transformers
uvicorn server:app --host 127.0.0.1 --port 8010 --reload
```

Wait until you see **Application startup complete** (first run may download the embedding model).

- Health check (default prefix):  
  `http://127.0.0.1:8010/disaster-brain-rag/health` → `{"status":"ok"}`  
- If another app already uses **port 8000**, **8010** + path prefix avoids clashes. Override with env:  
  - **`RAG_API_PREFIX`** on the Python side (empty = routes at `/`, `/query`, …)  
  - **`RAG_SERVER_URL`** in Next (see below) must match **host + port + prefix** with **no trailing slash**.

### 4. Install and run the Next.js app

```bash
cd disaster-brain
npm install
npm run dev
```

### 5. Open the app

**[http://localhost:3000](http://localhost:3000)**  
Use **Voice** in Chrome for dictation; you can always type instead.

### 6. (Optional) Validate the stack

With Ollama up (and dev server up):

```bash
cd disaster-brain
npm run verify
```

---

## Configuration

Create **`disaster-brain/.env.local`** (not committed) as needed:

| Variable | Purpose |
|----------|---------|
| `OLLAMA_HOST` | Ollama base URL (default `http://127.0.0.1:11434`) |
| `RAG_SERVER_URL` | Base URL for FastAPI RAG (default in code: `http://127.0.0.1:8010/disaster-brain-rag`) |

See **`.env.example`** for commented templates.

---

## Project layout (high level)

```
disaster-brain/
├── src/app/page.tsx          # Main tabs: Voice, Photo, Queue, Protocols, COMMS BRIDGE
├── src/app/queue/page.tsx    # Full queue board
├── src/app/api/triage/       # Text triage → Ollama
├── src/app/api/photo-triage/ # Vision triage → Ollama
├── src/app/api/chat/         # Streaming chat + COMMS translator (`system` override)
├── src/app/api/rag/          # Proxy to FastAPI (`query`, `sitrep`)
├── src/context/PatientContext.tsx
├── src/components/           # TriageCard, PhotoUpload, …
└── src/app/components/       # ProtocolsTab, CommsBridge, NetworkStatusBadge, …
```

Python RAG service (sibling folder):

```
../rag/
├── server.py       # FastAPI: /health, /query, /sitrep (+ optional RAG_API_PREFIX)
├── chroma_db/      # Persistent vectors (created at runtime)
└── pdfs/           # Drop PDFs here to index (otherwise seed protocols load)
```

---

## Troubleshooting

| Symptom | What to try |
|---------|----------------|
| **Protocols: RAG unreachable** | RAG terminal running? Correct **`RAG_SERVER_URL`**? Curl `/…/health`. |
| **Voice not listening** | Use Chrome; check mic permission; type symptoms instead. |
| **`tsconfig` / build errors** | Do **not** set `extends` to Expo in `tsconfig.json` unless that package exists. |
| **Ollama errors** | `ollama list` includes `gemma3:4b`; `ollama serve` reachable at `OLLAMA_HOST`. |

---

## More docs

- **[Run & test checklist](docs/DEMO_VALIDATION.md)** — flows, success criteria, demo script.

---

Disaster Brain is a [Next.js](https://nextjs.org) App Router project. For deployment and framework docs, see [Next.js documentation](https://nextjs.org/docs).
