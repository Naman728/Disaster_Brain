# Disaster Brain

Offline-first **disaster triage and responder tools**: voice + photo → **local Ollama** (`gemma3:4b`), shared queue, optional **protocol RAG** (FastAPI + Chroma), and **COMMS BRIDGE** (multilingual translation). Built for demos like the **Gemma 4 Good Hackathon**.

This GitHub repo is a **small monorepo**:

| Folder | Role |
|--------|------|
| **[`disaster-brain/`](disaster-brain/)** | Next.js 16 app — main UI, APIs, queue |
| **[`rag/`](rag/)** | Python FastAPI service — protocol Q&A + SITREP (used by the Protocols tab) |

---

## Why the long README is inside `disaster-brain/`

**GitHub only renders `README.md` at the repository root** (the top level of the default branch).  
Your detailed setup guide lives in **`disaster-brain/README.md`**, so GitHub shows it when you open that folder — not on the repo homepage.

**This file (`README.md` at the root)** is what appears on the **main GitHub project page**. For the full step-by-step (Ollama, RAG, env vars, troubleshooting), open:

**[disaster-brain/README.md](disaster-brain/README.md)**

---

## Quick start

```bash
git clone https://github.com/Naman728/Disaster_Brain.git
cd Disaster_Brain

# Terminal 1 — Ollama
ollama serve
ollama pull gemma3:4b

# Terminal 2 — Web app
cd disaster-brain
npm install
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)**.

Optional **Protocols** RAG (from repo root):

```bash
cd rag
python3 -m venv .venv && source .venv/bin/activate
pip install uvicorn fastapi chromadb pydantic pypdf requests sentence-transformers
uvicorn server:app --host 127.0.0.1 --port 8010 --reload
```

Set **`RAG_SERVER_URL`** in `disaster-brain/.env.local` if your RAG URL differs (see `disaster-brain/.env.example`).

---

**Full documentation:** [disaster-brain/README.md](disaster-brain/README.md)
