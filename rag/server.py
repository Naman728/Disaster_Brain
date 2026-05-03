from __future__ import annotations

import json
import logging
import os
import traceback
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

import chromadb
import requests
from chromadb.api import ClientAPI
from chromadb.api.models.Collection import Collection
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction
from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from pypdf import PdfReader

logger = logging.getLogger("rag.server")


def _resolved_rag_api_prefix() -> str:
    """
    URL prefix for all RAG HTTP routes (default /disaster-brain-rag).
    Use another FastAPI app on :8000 without path clashes; run this service on e.g. --port 8010.
    Set RAG_API_PREFIX= (empty) to serve /health, /query, /sitrep at the root again.
    """
    if "RAG_API_PREFIX" not in os.environ:
        return "/disaster-brain-rag"
    v = os.environ["RAG_API_PREFIX"].strip()
    if not v:
        return ""
    if not v.startswith("/"):
        v = "/" + v
    return v.rstrip("/") or ""


RAG_API_PREFIX = _resolved_rag_api_prefix()

CHROMA_PATH = "./chroma_db"
COLLECTION_NAME = "disaster_protocols"
EMBEDDING_MODEL = "all-MiniLM-L6-v2"

# Chunking: ~400–500 characters; skip strips below min chunk length
CHUNK_MIN_CHARS = 50
CHUNK_TARGET = 450
CHUNK_HARD_MAX = 500

OLLAMA_GENERATE_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "gemma3:4b"
OLLAMA_TIMEOUT_SEC = 120

_chroma_client: Optional[ClientAPI] = None
_embedding_function: Optional[SentenceTransformerEmbeddingFunction] = None
_collection: Optional[Collection] = None


def get_or_create_collection() -> Collection:
    """Return the shared Chroma collection, creating client, embedder, and DB on first use."""
    global _chroma_client, _embedding_function, _collection

    if _chroma_client is None:
        _chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)

    if _embedding_function is None:
        _embedding_function = SentenceTransformerEmbeddingFunction(
            model_name=EMBEDDING_MODEL,
        )

    if _collection is None:
        _collection = _chroma_client.get_or_create_collection(
            name=COLLECTION_NAME,
            embedding_function=_embedding_function,
        )

    return _collection


def _reset_collection_for_reindex() -> Collection:
    """Drop and recreate the collection so each startup gets a clean index."""
    global _collection, _chroma_client

    if _chroma_client is None:
        _chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)

    try:
        _chroma_client.delete_collection(COLLECTION_NAME)
    except Exception as e:
        logger.debug("delete_collection (expected on first run): %s", e)

    _collection = None
    return get_or_create_collection()


def chunk_text(text: str) -> list[str]:
    """Split text into ~400–500 character chunks; skip empty or short pieces."""
    normalized = " ".join((text or "").split())
    if len(normalized) < CHUNK_MIN_CHARS:
        return []

    chunks: list[str] = []
    start = 0
    n = len(normalized)

    while start < n:
        end = min(start + CHUNK_HARD_MAX, n)
        if end < n:
            window = normalized[start:end]
            split_at = max(window.rfind(" "), window.rfind("\n"))
            if split_at >= CHUNK_TARGET - 150:
                end = start + split_at + 1

        piece = normalized[start:end].strip()
        if len(piece) >= CHUNK_MIN_CHARS:
            chunks.append(piece)
        start = end if end > start else start + 1

    return chunks


def seed_sample_protocols(collection: Collection) -> int:
    """Insert ≥10 disaster-medicine protocol chunks when no PDFs are available."""
    protocols: list[tuple[str, str, int]] = [
        (
            "START triage (Simple Triage and Rapid Treatment): classify patients into IMMEDIATE (red), DELAYED (yellow), MINOR (green), or EXPECTANT (black) using respirations, perfusion, and mental status; reassess dynamically.",
            "START triage overview",
            0,
        ),
        (
            "Airway: jaw thrust or chin lift if spinal injury not ruled out; suction visible debris; consider recovery position if unconscious with intact airway and breathing.",
            "Airway management",
            0,
        ),
        (
            "Bleeding control: apply firm direct pressure with clean gauze or cloth; elevate extremity if not contraindicated; use pressure points or hemostatic dressings if trained; tourniquet for life-threatening extremity hemorrhage not controlled by pressure.",
            "Bleeding control",
            0,
        ),
        (
            "Suspected pneumothorax / tension pneumothorax: decreased breath sounds, distended neck veins, hypotension, tracheal deviation (late); urgent decompression per protocol and training only—needle thoracostomy second intercostal space midclavicular line if indicated.",
            "Pneumothorax",
            0,
        ),
        (
            "Hypothermia: remove wet clothing; insulate with blankets and vapor barrier; avoid rough movement in severe hypothermia; warm gradually; monitor airway and rhythm; evacuation priority for altered mental status or unstable vitals.",
            "Hypothermia",
            0,
        ),
        (
            "Burns: stop the burning process (cool small burns with clean water briefly); cover with dry sterile dressing; fluid resuscitation for large burns per burn-center guidance; watch airway for inhalation injury (soot, facial burns, singed nasal hair).",
            "Burn injury",
            0,
        ),
        (
            "Spinal precautions: maintain inline stabilization when mechanism suggests spine injury; log-roll for assessment if trained; immobilize on rigid board only when indicated and resources allow.",
            "Spinal precautions",
            0,
        ),
        (
            "Mass casualty: establish triage officer, communication, and patient flow; document counts by category; conserve resources; expect psychological stress in responders—rotate duties.",
            "Mass casualty operations",
            0,
        ),
        (
            "Chemical exposure: remove contaminated clothing; irrigate eyes and skin with water copiously unless contraindicated by agent-specific antidote protocols; protect rescuers with PPE.",
            "Chemical exposure",
            0,
        ),
        (
            "Crush injury / crush syndrome: anticipate rhabdomyolysis and hyperkalemia after prolonged entrapment; aggressive field care per protocol; monitor for compartment syndrome after extrication.",
            "Crush injury",
            0,
        ),
        (
            "Pediatric triage: use pediatric assessment triangle (appearance, work of breathing, circulation); children compensate then decompensate rapidly—lower threshold for IMMEDIATE if abnormal.",
            "Pediatric triage",
            0,
        ),
        (
            "Communicable disease in disasters: hand hygiene, PPE, and patient separation reduce transmission; screen for outbreak-prone symptoms when directed by public health.",
            "Infection control",
            0,
        ),
    ]

    protocols += [
        (
            "MARCH is the TCCC treatment priority order. "
            "M=Massive hemorrhage: apply tourniquet 2-3 inches above wound, tighten until bleeding stops, mark time on forehead. "
            "A=Airway: chin lift, nasopharyngeal airway if unconscious. "
            "R=Respiration: needle decompression for tension pneumothorax (2nd intercostal space midclavicular line), chest seal for open chest wounds. "
            "C=Circulation: IV/IO access, 1L saline bolus for shock. "
            "H=Hypothermia: remove wet clothing, space blanket reflective side in, warm fluids. Always treat in MARCH order.",
            "TCCC MARCH Protocol",
            13,
        ),
        (
            "Apply tourniquet 2-3 inches proximal to wound on limb only. Tighten until bleeding completely stops. "
            "Write time of application on tourniquet AND patient forehead. Never remove in field. "
            "If bleeding continues, apply second tourniquet above first. Effective window ~2 hours before tissue damage risk increases.",
            "Tourniquet Management",
            14,
        ),
        (
            "Tension pneumothorax: signs include absent/decreased breath sounds on one side, respiratory distress, hypotension, tracheal deviation. "
            "Use 14G needle (3.25 inch). Insert at 2nd intercostal space midclavicular line OR 4th-5th anterior axillary line. "
            "Insert perpendicular until air rush or relief. Leave needle in place and reassess.",
            "Needle Decompression",
            15,
        ),
        (
            "Blast injuries have 4 types: Primary (pressure wave → lungs, bowel, eardrum), Secondary (shrapnel), "
            "Tertiary (body thrown → fractures/TBI), Quaternary (burns, crush, inhalation). "
            "Assume blast lung even if asymptomatic. Silent chest after blast = emergency decompression. "
            "Symptoms may worsen over 24–48 hours.",
            "Blast Injury Medicine",
            16,
        ),
        (
            "Gunshot wound care: identify entry/exit (exit usually larger). "
            "Chest GSW: apply occlusive chest seal, monitor for tension pneumothorax. "
            "Abdominal GSW: do not remove objects, cover wound, immediate evacuation. "
            "Limb GSW with bleeding: tourniquet first, then packing if needed. "
            "Head GSW: secure airway and urgent evacuation.",
            "Gunshot Wound Protocol",
            17,
        ),
        (
            "CASEVAC categories: T1 Urgent (1 hour): airway, hemorrhage, tension pneumothorax, shock. "
            "T2 Priority (4 hours): stable serious injuries, fractures, controlled bleeding. "
            "T3 Routine (24 hours): minor injuries. "
            "T4 Expectant: unsurvivable injuries. "
            "Always document casualty count, severity, and security status.",
            "CASEVAC Protocol",
            18,
        ),
    ]

    ids: list[str] = []
    documents: list[str] = []
    metadatas: list[dict[str, str | int]] = []

    for i, (body, title, page) in enumerate(protocols):
        doc = f"{title}\n\n{body}"
        ids.append(f"seed-{i}")
        documents.append(doc)
        metadatas.append(
            {
                "source": "seed_protocols",
                "page": page,
                "title": title,
            }
        )

    collection.upsert(ids=ids, documents=documents, metadatas=metadatas)
    return len(ids)


def index_pdfs() -> int:
    """
    Index all PDFs under rag/pdfs into Chroma. If none exist, seed built-in protocols.
    Returns number of chunks stored.
    """
    pdfs_dir = Path(__file__).resolve().parent / "pdfs"
    pdfs_dir.mkdir(parents=True, exist_ok=True)

    pdf_paths = sorted(pdfs_dir.glob("*.pdf"))
    collection = _reset_collection_for_reindex()

    if not pdf_paths:
        n = seed_sample_protocols(collection)
        print(f"[index_pdfs] No PDFs in {pdfs_dir}; indexed {n} seed protocol chunks.")
        return n

    ids: list[str] = []
    documents: list[str] = []
    metadatas: list[dict[str, str | int]] = []

    for pdf_path in pdf_paths:
        try:
            reader = PdfReader(str(pdf_path))
        except Exception as e:
            logger.warning("Skipping unreadable PDF %s: %s", pdf_path.name, e)
            continue

        for page_num, page in enumerate(reader.pages, start=1):
            try:
                raw = page.extract_text() or ""
            except Exception as e:
                logger.warning("Page extract failed %s p%s: %s", pdf_path.name, page_num, e)
                continue

            for chunk_idx, chunk in enumerate(chunk_text(raw)):
                uid = f"{pdf_path.stem}-p{page_num}-c{chunk_idx}"
                ids.append(uid)
                documents.append(chunk)
                metadatas.append(
                    {
                        "source": pdf_path.name,
                        "page": page_num,
                    }
                )

    if not ids:
        n = seed_sample_protocols(collection)
        print(
            f"[index_pdfs] PDFs present but no indexable chunks; "
            f"indexed {n} seed protocol chunks instead."
        )
        return n

    # Chroma upsert in batches to avoid oversized payloads
    batch_size = 128
    for i in range(0, len(ids), batch_size):
        collection.upsert(
            ids=ids[i : i + batch_size],
            documents=documents[i : i + batch_size],
            metadatas=metadatas[i : i + batch_size],
        )

    print(
        f"[index_pdfs] Indexed {len(ids)} chunks from {len(pdf_paths)} PDF(s) "
        f"under {pdfs_dir}."
    )
    return len(ids)


class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=8000)
    n_results: int = Field(default=3, ge=1, le=50)


class QueryResponse(BaseModel):
    answer: str
    sources: list[dict[str, Any]]
    context_chunks: list[str]


class SitrepRequest(BaseModel):
    patients: list[dict[str, Any]] = Field(default_factory=list)


class SitrepResponse(BaseModel):
    sitrep: str


def _map_start_tag_to_bucket(raw: str) -> str | None:
    """Map START / triage labels to RED | YELLOW | GREEN | BLACK."""
    u = raw.strip().upper()
    if u in ("IMMEDIATE", "RED", "CRITICAL", "P1"):
        return "RED"
    if u in ("DELAYED", "YELLOW", "URGENT", "P2"):
        return "YELLOW"
    if u in ("MINOR", "GREEN", "NON-URGENT", "P3"):
        return "GREEN"
    if u in ("EXPECTANT", "BLACK", "P4"):
        return "BLACK"
    return None


def _priority_bucket(patient: dict[str, Any]) -> str | None:
    """Infer RED/YELLOW/GREEN/BLACK from flat or nested triage fields."""
    triage = patient.get("triage")
    if isinstance(triage, dict):
        st = triage.get("startTag")
        if isinstance(st, str):
            b = _map_start_tag_to_bucket(st)
            if b:
                return b
        pl = triage.get("priorityLevel")
        if isinstance(pl, (int, float)):
            return {1: "RED", 2: "YELLOW", 3: "GREEN", 4: "BLACK"}.get(int(pl))

    for key in ("startTag", "priority", "tag", "category"):
        v = patient.get(key)
        if isinstance(v, str):
            b = _map_start_tag_to_bucket(v)
            if b:
                return b
    return None


def _count_patients_by_priority(
    patients: list[dict[str, Any]],
) -> tuple[dict[str, int], int]:
    counts = {"RED": 0, "YELLOW": 0, "GREEN": 0, "BLACK": 0, "UNKNOWN": 0}
    for p in patients:
        if not isinstance(p, dict):
            counts["UNKNOWN"] += 1
            continue
        bucket = _priority_bucket(p)
        if bucket is None:
            counts["UNKNOWN"] += 1
        else:
            counts[bucket] += 1
    total = sum(counts.values())
    return counts, total


def _build_sitrep_summary(counts: dict[str, int], total: int) -> str:
    lines = [
        "CASUALTY COUNTS (START / MCI triage colors)",
        f"- RED (immediate / critical): {counts['RED']}",
        f"- YELLOW (delayed / urgent): {counts['YELLOW']}",
        f"- GREEN (minor / walking wounded): {counts['GREEN']}",
        f"- BLACK (expectant / deceased expectant): {counts['BLACK']}",
        f"- UNCLASSIFIED / other: {counts['UNKNOWN']}",
        f"TOTAL PATIENTS: {total}",
    ]
    return "\n".join(lines)


def _build_context_string(documents: list[str], metadatas: list[dict[str, Any]]) -> str:
    blocks: list[str] = []
    for doc, meta in zip(documents, metadatas):
        text = (doc or "").strip()
        if not text:
            continue
        filename = (meta or {}).get("source")
        if filename is None:
            filename = "unknown"
        blocks.append(f"[Source: {filename}]\n{text}")
    return "\n\n".join(blocks).strip()


def _ollama_generate(prompt: str, *, temperature: float = 0.2) -> str:
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": temperature},
    }
    try:
        res = requests.post(
            OLLAMA_GENERATE_URL,
            json=payload,
            timeout=OLLAMA_TIMEOUT_SEC,
            headers={"Content-Type": "application/json"},
        )
    except requests.RequestException as e:
        raise HTTPException(
            status_code=502,
            detail=f"Could not reach Ollama at {OLLAMA_GENERATE_URL}: {e}",
        ) from e

    if not res.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Ollama error HTTP {res.status}: {res.text[:500]}",
        )

    try:
        data = res.json()
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=502,
            detail="Ollama returned invalid JSON",
        ) from e

    text = data.get("response")
    if not isinstance(text, str):
        return ""
    return text.strip()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "RAG HTTP routes: prefix %r (change with RAG_API_PREFIX; empty = root)",
        RAG_API_PREFIX or "/",
    )
    try:
        index_pdfs()
    except Exception as e:
        print(f"[startup] index_pdfs failed: {e}")
        traceback.print_exc()
    yield


rag_router = APIRouter()


@rag_router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@rag_router.post("/query", response_model=QueryResponse)
def query_endpoint(body: QueryRequest) -> QueryResponse:
    """
    RAG query: similarity search over indexed protocols, then grounded generation via Ollama.
    """
    collection = get_or_create_collection()
    k = body.n_results

    try:
        raw = collection.query(
            query_texts=[body.question.strip()],
            n_results=k,
            include=["documents", "metadatas", "distances"],
        )
    except Exception as e:
        logger.exception("Chroma query failed")
        raise HTTPException(status_code=500, detail=f"Vector query failed: {e}") from e

    docs_list = (raw.get("documents") or [[]])[0] or []
    meta_list = (raw.get("metadatas") or [[]])[0] or []

    # Normalize metadatas to dicts (Chroma may return None entries)
    metadatas: list[dict[str, Any]] = []
    documents: list[str] = []
    for doc, meta in zip(docs_list, meta_list):
        if doc is None or not str(doc).strip():
            continue
        documents.append(str(doc).strip())
        metadatas.append(dict(meta) if isinstance(meta, dict) else {})

    context_str = _build_context_string(documents, metadatas)

    system_rules = (
        "You are a disaster-medicine assistant answering from a retrieval-augmented knowledge base.\n"
        "CRITICAL RULES:\n"
        "- Use ONLY the information in the CONTEXT block below. Do not use outside knowledge or guess.\n"
        "- If the context does not contain the answer or is empty, respond with exactly: not available\n"
        "- Quote or paraphrase only what is supported by the context; keep answers concise.\n"
    )

    prompt = (
        f"{system_rules}\n"
        f"CONTEXT:\n{context_str if context_str else '(no chunks retrieved)'}\n\n"
        f"QUESTION:\n{body.question.strip()}\n\n"
        "ANSWER:"
    )

    answer = _ollama_generate(prompt)
    if not answer:
        answer = "not available"

    # Chroma metadatas may contain numpy scalars; jsonable_encoder ensures valid JSON.
    payload = jsonable_encoder(
        {
            "answer": answer,
            "sources": metadatas,
            "context_chunks": documents,
        }
    )
    return JSONResponse(content=payload)


@rag_router.post("/sitrep", response_model=SitrepResponse)
def sitrep_endpoint(body: SitrepRequest) -> SitrepResponse:
    """
    Build a military-style SITREP from patient triage counts via Ollama (gemma3:4b).
    """
    counts, total = _count_patients_by_priority(body.patients)
    summary = _build_sitrep_summary(counts, total)

    prompt = (
        "Generate a military-style SITREP for disaster response.\n\n"
        "Use the CASUALTY DATA SUMMARY below as authoritative. Your SITREP MUST explicitly include:\n"
        "1) Casualty breakdown (by triage color / priority, consistent with the counts)\n"
        "2) Immediate priorities\n"
        "3) Resource needs\n"
        "4) Next report time (state when the next SITREP or update should be sent, e.g. T+30 minutes)\n\n"
        "CASUALTY DATA SUMMARY:\n"
        f"{summary}\n\n"
        "SITREP (plain text, concise operational tone):"
    )

    sitrep_text = _ollama_generate(prompt, temperature=0.35)
    if not sitrep_text:
        sitrep_text = (
            "SITREP: Data received but model returned no text. "
            "Verify Ollama (gemma3:4b) is running.\n"
            f"{summary}"
        )

    return JSONResponse(content=jsonable_encoder({"sitrep": sitrep_text}))


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if RAG_API_PREFIX:
    app.include_router(rag_router, prefix=RAG_API_PREFIX)
else:
    app.include_router(rag_router)
