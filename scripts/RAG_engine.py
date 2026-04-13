#!/usr/bin/env python3
"""
RAG_engine.py — Zenith Enhanced Retrieval-Augmented Generation Engine
======================================================================
Features:
  • 3 user-selectable embedding models (SPECTER2, Nomic, MedEmbed)
  • Section-aware sentence-boundary chunking (no mid-sentence cuts)
  • ChromaDB persistent HNSW vector store with custom embedding functions
  • Hybrid retrieval: Dense (HNSW) + BM25 merged via Reciprocal Rank Fusion
  • Cross-encoder re-ranking for precision
  • MMR (Maximal Marginal Relevance) for result diversity
  • Section-filtered retrieval via ChromaDB metadata WHERE clauses
  • In-process model caching (one model kept hot per process lifetime)
  • Full graceful degradation when optional deps are missing
"""

import os
import sys
import re
import json
import pickle
import time

# ── Paths ─────────────────────────────────────────────────────────────────────
import tempfile
_TEMP = tempfile.gettempdir()
VECTORDB_DIR = os.path.join(_TEMP, "Zenith", "Research", "vector_db")
os.makedirs(VECTORDB_DIR, exist_ok=True)

# ══════════════════════════════════════════════════════════════════════════════
# ██  OPTIONAL DEPENDENCY FLAGS
# ══════════════════════════════════════════════════════════════════════════════

try:
    import chromadb
    _HAS_CHROMADB = True
except ImportError:
    _HAS_CHROMADB = False

try:
    from sentence_transformers import SentenceTransformer
    _HAS_ST = True
except ImportError:
    _HAS_ST = False

try:
    from sentence_transformers import CrossEncoder
    _HAS_CROSS_ENCODER = True
except ImportError:
    _HAS_CROSS_ENCODER = False

try:
    from rank_bm25 import BM25Okapi
    _HAS_BM25 = True
except ImportError:
    _HAS_BM25 = False

try:
    import numpy as np
    _HAS_NUMPY = True
except ImportError:
    _HAS_NUMPY = False

try:
    import nltk
    _HAS_NLTK = True
except ImportError:
    _HAS_NLTK = False


# ══════════════════════════════════════════════════════════════════════════════
# ██  MODEL REGISTRY
# ══════════════════════════════════════════════════════════════════════════════

EMBEDDING_MODELS = {
    "allenai/specter2": {
        "display": "SPECTER2",
        "short": "sp2",
        "dims": 768,
        "max_chars": 1800,   # ≈ 450 tokens — fits within 512-token limit
        "domain": "scientific",
        "doc_prefix": "",
        "query_prefix": "",
        "trust_remote_code": False,
        "description": "Best for scientific & academic papers (AllenAI)",
    },
    "nomic-ai/nomic-embed-text-v1.5": {
        "display": "Nomic",
        "short": "nom",
        "dims": 768,
        "max_chars": 4000,   # ≈ 1000 tokens — exploits 8192-token context window
        "domain": "general",
        "doc_prefix": "search_document: ",
        "query_prefix": "search_query: ",
        "trust_remote_code": True,
        "description": "Long-context model, great for full-section retrieval",
    },
    "abhinand/MedEmbed-base-v0.1": {
        "display": "MedEmbed",
        "short": "med",
        "dims": 768,
        "max_chars": 1800,   # ≈ 450 tokens
        "domain": "medical",
        "doc_prefix": "",
        "query_prefix": "",
        "trust_remote_code": False,
        "description": "Specialized for clinical & biomedical literature",
    },
}

DEFAULT_EMBEDDING_MODEL = "allenai/specter2"
RERANKER_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"

# In-process model caches (survive within the same Python subprocess)
_EMBEDDING_CACHE: dict = {}
_RERANKER_CACHE: dict = {}


# ══════════════════════════════════════════════════════════════════════════════
# ██  SECTION DETECTION — Academic paper structure parsing
# ══════════════════════════════════════════════════════════════════════════════

_SECTION_PATTERNS = [
    (re.compile(r'(?im)^\s*(?:abstract|background and aims?)\s*[:\n]'), "abstract"),
    (re.compile(r'(?im)^\s*(?:\d+\.?\s+)?introduction\s*[:\n]'), "introduction"),
    (re.compile(r'(?im)^\s*(?:\d+\.?\s+)?(?:methods?|methodology|materials?\s+and\s+methods?|patients?\s+and\s+methods?|study\s+design)\s*[:\n]'), "methods"),
    (re.compile(r'(?im)^\s*(?:\d+\.?\s+)?(?:results?|findings?|outcomes?|statistical\s+analysis)\s*[:\n]'), "results"),
    (re.compile(r'(?im)^\s*(?:\d+\.?\s+)?discussion\s*[:\n]'), "discussion"),
    (re.compile(r'(?im)^\s*(?:\d+\.?\s+)?(?:conclusions?|concluding\s+remarks?|summary)\s*[:\n]'), "conclusion"),
    (re.compile(r'(?im)^\s*(?:references?|bibliography|works?\s+cited)\s*[:\n]'), "references"),
    (re.compile(r'(?im)^\s*(?:acknowledgements?|funding|conflict\s+of\s+interest)\s*[:\n]'), "acknowledgements"),
]


def _detect_section(text: str, char_position: int) -> str:
    """Determine the academic section at a given character position."""
    before = text[:char_position]
    current = "body"
    last_match_pos = -1
    for pattern, section_name in _SECTION_PATTERNS:
        for m in pattern.finditer(before):
            if m.start() > last_match_pos:
                last_match_pos = m.start()
                current = section_name
    return current


# ══════════════════════════════════════════════════════════════════════════════
# ██  SMART CHUNKING — Sentence-boundary + section-aware
# ══════════════════════════════════════════════════════════════════════════════

def _split_sentences(text: str) -> list:
    """Split text into sentences using NLTK if available, else regex."""
    if _HAS_NLTK:
        try:
            # Lazy-load the punkt tokenizer data
            try:
                nltk.data.find("tokenizers/punkt")
            except LookupError:
                nltk.download("punkt", quiet=True)
            from nltk.tokenize import sent_tokenize
            return sent_tokenize(text)
        except Exception:
            pass
    # Regex fallback: split at sentence-ending punctuation + whitespace + capital
    parts = re.split(r'(?<=[.!?])\s+(?=[A-Z\d"\'(\[])', text)
    return [p.strip() for p in parts if p.strip()]


def _chunk_text_smart(text: str, max_chars: int = 1800, overlap_chars: int = 250) -> list:
    """Produce sentence-boundary, section-aware chunks with overlap.

    Returns:
        List of dicts: {text, section, char_start}
    """
    if not text or len(text.strip()) < 50:
        return []

    sentences = _split_sentences(text)
    if not sentences:
        # Fallback: hard split
        return [{"text": text[i:i + max_chars], "section": "body", "char_start": i}
                for i in range(0, len(text), max_chars - overlap_chars)]

    chunks = []
    current_sents = []
    current_len = 0
    overlap_buffer = []   # rolling buffer for overlap
    char_offset = 0

    for sent in sentences:
        sent_len = len(sent)
        section = _detect_section(text, char_offset)
        char_offset += sent_len + 1

        # Skip sentences inside the References section (not useful for retrieval)
        if section in ("references", "acknowledgements"):
            continue

        # Flush chunk when it would exceed the limit
        if current_len + sent_len > max_chars and current_sents:
            chunk_text = " ".join(current_sents)
            # Detect section of the chunk's midpoint
            mid_section = _detect_section(text, char_offset - current_len // 2)
            chunks.append({
                "text": chunk_text,
                "section": mid_section if mid_section != "references" else "body",
                "char_start": char_offset - current_len,
            })
            # Start fresh with overlap from last few sentences
            current_sents = overlap_buffer.copy()
            current_len = sum(len(s) + 1 for s in current_sents)

        current_sents.append(sent)
        current_len += sent_len + 1

        # Maintain rolling overlap buffer
        overlap_buffer.append(sent)
        while sum(len(s) for s in overlap_buffer) > overlap_chars and len(overlap_buffer) > 1:
            overlap_buffer.pop(0)

    # Flush final chunk
    if current_sents:
        chunk_text = " ".join(current_sents)
        mid_section = _detect_section(text, max(0, char_offset - current_len // 2))
        chunks.append({
            "text": chunk_text,
            "section": mid_section if mid_section != "references" else "body",
            "char_start": max(0, char_offset - current_len),
        })

    return chunks


# ══════════════════════════════════════════════════════════════════════════════
# ██  EMBEDDING MODEL MANAGEMENT
# ══════════════════════════════════════════════════════════════════════════════

def _load_embedding_model(model_name: str):
    """Load and in-process cache a SentenceTransformer model."""
    global _EMBEDDING_CACHE
    if model_name in _EMBEDDING_CACHE:
        return _EMBEDDING_CACHE[model_name]

    if not _HAS_ST:
        print("[RAG] sentence-transformers not installed. "
              "Run: pip install sentence-transformers", file=sys.stderr, flush=True)
        return None

    # Keep only one model hot (evict others to save RAM on laptops)
    for stale in list(_EMBEDDING_CACHE.keys()):
        if stale != model_name:
            try:
                del _EMBEDDING_CACHE[stale]
            except Exception:
                pass

    config = EMBEDDING_MODELS.get(model_name, {})
    trust = config.get("trust_remote_code", False)

    print(f"[RAG] Loading embedding model: {config.get('display', model_name)} "
          f"({model_name})...", file=sys.stderr, flush=True)
    t0 = time.time()
    try:
        model = SentenceTransformer(model_name, trust_remote_code=trust)
        _EMBEDDING_CACHE[model_name] = model
        print(f"[RAG] Model ready in {time.time()-t0:.1f}s", file=sys.stderr, flush=True)
        return model
    except Exception as e:
        print(f"[RAG] Failed to load {model_name}: {e}", file=sys.stderr, flush=True)
        return None


def _embed_texts(texts: list, model_name: str, is_query: bool = False) -> list:
    """Embed a list of texts, applying task-specific prefixes if needed.

    Returns list of float lists, or [] on failure.
    """
    if not texts:
        return []
    model = _load_embedding_model(model_name)
    if model is None:
        return []

    config = EMBEDDING_MODELS.get(model_name, {})
    prefix = config.get("query_prefix" if is_query else "doc_prefix", "")
    if prefix:
        texts = [prefix + t for t in texts]

    try:
        embs = model.encode(
            texts,
            show_progress_bar=False,
            batch_size=16,          # conservative for laptop RAM
            normalize_embeddings=True,
        )
        return embs.tolist()
    except Exception as e:
        print(f"[RAG] Embedding encode error: {e}", file=sys.stderr, flush=True)
        return []


# ── ChromaDB embedding function adapter ──────────────────────────────────────

class _ZenithEmbeddingFunction:
    """Wraps our SentenceTransformer as a ChromaDB EmbeddingFunction."""

    def __init__(self, model_name: str):
        self.model_name = model_name

    def __call__(self, input: list) -> list:
        embs = _embed_texts(input, self.model_name, is_query=False)
        if embs:
            return embs
        # ChromaDB requires a result — zero-vector fallback
        dims = EMBEDDING_MODELS.get(self.model_name, {}).get("dims", 768)
        return [[0.0] * dims for _ in input]


# ══════════════════════════════════════════════════════════════════════════════
# ██  BM25 INDEX — Persistence helpers
# ══════════════════════════════════════════════════════════════════════════════

def _bm25_path(db_path: str) -> str:
    return os.path.join(db_path, "bm25_index.pkl")


def _tokenize_bm25(text: str) -> list:
    """Simple lowercase word tokenizer for BM25."""
    # Also split on camelCase and common scientific separators
    text = re.sub(r'([a-z])([A-Z])', r'\1 \2', text)
    return re.findall(r'[a-z0-9]{2,}', text.lower())


def _save_bm25(data: dict, db_path: str) -> None:
    try:
        with open(_bm25_path(db_path), "wb") as f:
            pickle.dump(data, f, protocol=4)
    except Exception as e:
        print(f"[RAG] BM25 save error: {e}", file=sys.stderr)


def _load_bm25(db_path: str) -> dict:
    p = _bm25_path(db_path)
    if not os.path.exists(p):
        return {}
    try:
        with open(p, "rb") as f:
            return pickle.load(f)
    except Exception:
        return {}


def _bm25_retrieve(db_path: str, query: str, n: int) -> list:
    """Returns list of doc_ids ranked by BM25 score."""
    if not _HAS_BM25:
        return []
    data = _load_bm25(db_path)
    if not data or "bm25" not in data:
        return []
    try:
        q_tokens = _tokenize_bm25(query)
        scores = data["bm25"].get_scores(q_tokens)
        top = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:n]
        ids = data.get("doc_ids", [])
        return [ids[i] for i in top if i < len(ids)]
    except Exception as e:
        print(f"[RAG] BM25 search error: {e}", file=sys.stderr)
        return []


# ══════════════════════════════════════════════════════════════════════════════
# ██  MMR — Maximal Marginal Relevance
# ══════════════════════════════════════════════════════════════════════════════

def _cosine_matrix(a, b):
    """Compute cosine similarity between rows of a and rows of b (numpy)."""
    a_norm = a / (np.linalg.norm(a, axis=1, keepdims=True) + 1e-10)
    b_norm = b / (np.linalg.norm(b, axis=1, keepdims=True) + 1e-10)
    return a_norm @ b_norm.T


def _mmr_select(query_emb: list, candidates: list, n: int, lambda_param: float = 0.65) -> list:
    """Select n diverse candidates using MMR.

    Args:
        query_emb: [float] — query embedding
        candidates: list of dicts, each must have key 'embedding': [float]
        n: how many to return
        lambda_param: 1.0 = pure relevance, 0.0 = pure diversity
    """
    if not _HAS_NUMPY or not candidates:
        return candidates[:n]
    try:
        q = np.array(query_emb, dtype=np.float32).reshape(1, -1)
        embs = np.array([c["embedding"] for c in candidates], dtype=np.float32)

        # Relevance of each candidate to query
        rel = _cosine_matrix(embs, q).flatten()

        selected_indices = []
        remaining = list(range(len(candidates)))

        while len(selected_indices) < n and remaining:
            if not selected_indices:
                best_local = int(np.argmax(rel[remaining]))
            else:
                sel_embs = embs[selected_indices]
                rem_embs = embs[remaining]
                sim = _cosine_matrix(rem_embs, sel_embs)
                max_sim = sim.max(axis=1) if sim.ndim > 1 else sim.flatten()
                rem_rel = rel[remaining]
                scores = lambda_param * rem_rel - (1 - lambda_param) * max_sim
                best_local = int(np.argmax(scores))

            chosen_global = remaining[best_local]
            selected_indices.append(chosen_global)
            remaining.pop(best_local)

        return [candidates[i] for i in selected_indices]
    except Exception as e:
        print(f"[RAG] MMR error: {e}", file=sys.stderr)
        return candidates[:n]


# ══════════════════════════════════════════════════════════════════════════════
# ██  CROSS-ENCODER RE-RANKER
# ══════════════════════════════════════════════════════════════════════════════

def _load_reranker():
    """Load and cache the cross-encoder re-ranker."""
    global _RERANKER_CACHE
    if RERANKER_MODEL in _RERANKER_CACHE:
        return _RERANKER_CACHE[RERANKER_MODEL]
    if not _HAS_CROSS_ENCODER:
        return None
    try:
        print(f"[RAG] Loading reranker: {RERANKER_MODEL}...", file=sys.stderr, flush=True)
        reranker = CrossEncoder(RERANKER_MODEL, max_length=512)
        _RERANKER_CACHE[RERANKER_MODEL] = reranker
        print("[RAG] Reranker ready.", file=sys.stderr, flush=True)
        return reranker
    except Exception as e:
        print(f"[RAG] Reranker load failed: {e}", file=sys.stderr)
        return None


def _rerank(query: str, candidates: list, n_final: int) -> list:
    """Cross-encoder re-rank — returns top n_final candidates."""
    if not candidates:
        return candidates
    reranker = _load_reranker()
    if reranker is None:
        return candidates[:n_final]
    try:
        pairs = [(query, c["text"][:512]) for c in candidates]
        scores = reranker.predict(pairs)
        ranked = sorted(zip(scores.tolist(), candidates), key=lambda x: x[0], reverse=True)
        return [c for _, c in ranked[:n_final]]
    except Exception as e:
        print(f"[RAG] Rerank error: {e}", file=sys.stderr)
        return candidates[:n_final]


# ══════════════════════════════════════════════════════════════════════════════
# ██  CHROMADB COLLECTION MANAGEMENT
# ══════════════════════════════════════════════════════════════════════════════

def _collection_name(embedding_model: str) -> str:
    short = EMBEDDING_MODELS.get(embedding_model, {}).get("short", "unk")
    return f"research_papers_{short}"


def _init_rag_collection(project_id: str, embedding_model: str):
    """Initialize (or get) a ChromaDB collection for a project + model pair.

    Returns (collection, db_path) or (None, None) on failure.
    """
    if not _HAS_CHROMADB:
        return None, None

    db_path = os.path.join(VECTORDB_DIR, project_id)
    os.makedirs(db_path, exist_ok=True)

    try:
        client = chromadb.PersistentClient(path=db_path)
        cname = _collection_name(embedding_model)

        if _HAS_ST:
            ef = _ZenithEmbeddingFunction(embedding_model)
            collection = client.get_or_create_collection(
                name=cname,
                metadata={
                    "hnsw:space": "cosine",
                    "embedding_model": embedding_model,
                },
                embedding_function=ef,
            )
        else:
            # Fallback: ChromaDB built-in (all-MiniLM-L6-v2)
            collection = client.get_or_create_collection(
                name=cname,
                metadata={
                    "hnsw:space": "cosine",
                    "embedding_model": "chroma-default",
                },
            )

        return collection, db_path
    except Exception as e:
        print(f"[RAG] Collection init error: {e}", file=sys.stderr)
        return None, None


# ══════════════════════════════════════════════════════════════════════════════
# ██  PUBLIC API — ingest_into_vectordb
# ══════════════════════════════════════════════════════════════════════════════

def ingest_into_vectordb(args: dict) -> dict:
    """Phase 2.2 — Ingest extracted paper texts into the enhanced vector store.

    Args:
        project_id (str): Research thread/project identifier.
        papers (list): [{title, doi, text, year, journal}]
        query (str): The research question (stored as metadata).
        embedding_model (str): One of the three supported model IDs.

    Returns:
        {ok, chunks_stored, collection_size, embedding_model, warning?}
    """
    project_id = args.get("project_id", "default")
    papers = args.get("papers", [])
    query = args.get("query", "")
    embedding_model = args.get("embedding_model", DEFAULT_EMBEDDING_MODEL)

    # Normalise model name (handles display-name input from settings)
    if embedding_model not in EMBEDDING_MODELS:
        embedding_model = DEFAULT_EMBEDDING_MODEL

    if not _HAS_CHROMADB:
        return {
            "ok": True, "chunks_stored": 0, "collection_size": 0,
            "warning": (
                "chromadb not installed. "
                "Run: pip install chromadb sentence-transformers rank-bm25"
            ),
        }

    collection, db_path = _init_rag_collection(project_id, embedding_model)
    if collection is None:
        return {"ok": True, "chunks_stored": 0, "collection_size": 0,
                "warning": "Could not initialize RAG collection."}

    config = EMBEDDING_MODELS[embedding_model]
    max_chars = config["max_chars"]
    overlap = min(300, max_chars // 5)

    chunks_stored = 0
    all_texts_bm25: list = []
    all_ids_bm25: list = []
    model_key = config["short"]

    # Extend existing BM25 corpus
    existing_bm25 = _load_bm25(db_path) if (_HAS_BM25 and db_path) else {}

    for pi, paper in enumerate(papers):
        text = paper.get("text", "")
        title = paper.get("title", f"Paper {pi + 1}")
        doi = paper.get("doi", "")
        year = str(paper.get("year", ""))
        journal = paper.get("journal", "")

        if not text or len(text.strip()) < 50:
            continue

        chunk_dicts = _chunk_text_smart(text, max_chars=max_chars, overlap_chars=overlap)
        if not chunk_dicts:
            continue

        enriched_texts = []
        metadatas = []
        ids = []

        for ci, cd in enumerate(chunk_dicts):
            section = cd.get("section", "body")
            # Prepend title + section for richer context representation
            prefix = f"Title: {title}."
            if section not in ("body", "references", "acknowledgements"):
                prefix += f" Section: {section.title()}."
            enriched = prefix + " " + cd["text"]

            chunk_id = f"p{pi}_c{ci}_{model_key}"
            enriched_texts.append(enriched)
            ids.append(chunk_id)
            metadatas.append({
                "paper_idx": pi,
                "title": title[:200],
                "doi": doi,
                "year": year,
                "journal": journal[:100],
                "chunk_idx": ci,
                "section": section,
                "query": query[:200],
            })

        try:
            collection.add(documents=enriched_texts, ids=ids, metadatas=metadatas)
            chunks_stored += len(enriched_texts)
            all_texts_bm25.extend(enriched_texts)
            all_ids_bm25.extend(ids)
        except Exception as e:
            if "already exists" not in str(e).lower():
                print(f"[RAG] Ingest error ({title[:40]}): {e}", file=sys.stderr)

    # Rebuild BM25 index (extend existing corpus)
    if _HAS_BM25 and all_texts_bm25 and db_path:
        try:
            prior_texts = existing_bm25.get("texts", [])
            prior_ids = existing_bm25.get("doc_ids", [])
            merged_texts = prior_texts + all_texts_bm25
            merged_ids = prior_ids + all_ids_bm25
            tokenized = [_tokenize_bm25(t) for t in merged_texts]
            bm25_index = BM25Okapi(tokenized)
            _save_bm25({
                "bm25": bm25_index,
                "doc_ids": merged_ids,
                "texts": merged_texts,
            }, db_path)
        except Exception as e:
            print(f"[RAG] BM25 build error: {e}", file=sys.stderr)

    return {
        "ok": True,
        "chunks_stored": chunks_stored,
        "collection_size": collection.count(),
        "embedding_model": embedding_model,
    }


# ══════════════════════════════════════════════════════════════════════════════
# ██  PUBLIC API — query_vectordb
# ══════════════════════════════════════════════════════════════════════════════

# Section aliases for WHERE-clause filtering
_SECTION_FILTER_MAP = {
    "introduction": ["introduction", "abstract", "body"],
    "methods":      ["methods", "body"],
    "results":      ["results", "body"],
    "discussion":   ["discussion", "body"],
    "conclusion":   ["conclusion", "body"],
    "abstract":     ["abstract", "body"],
}


def query_vectordb(args: dict) -> dict:
    """Retrieve relevant chunks via hybrid dense+BM25 retrieval, re-ranking, and MMR.

    Args:
        project_id (str): Research thread identifier.
        query (str): Query text.
        n_results (int): Final number of chunks to return (default 10).
        section_type (str): Optional section filter (e.g. 'methods').
        embedding_model (str): Must match the model used during ingestion.
        use_reranker (bool): Apply cross-encoder re-ranking (default True).
        use_mmr (bool): Apply MMR diversity selection (default True).
        use_hybrid (bool): Use BM25 + dense fusion (default True).

    Returns:
        {ok, results: [{text, title, doi, section, year, score}]}
    """
    project_id = args.get("project_id", "default")
    query_text = args.get("query", "")
    n_results = int(args.get("n_results", 10))
    section_type = args.get("section_type", "")
    embedding_model = args.get("embedding_model", DEFAULT_EMBEDDING_MODEL)
    use_reranker = args.get("use_reranker", True)
    use_mmr = args.get("use_mmr", True)
    use_hybrid = args.get("use_hybrid", True)

    if embedding_model not in EMBEDDING_MODELS:
        embedding_model = DEFAULT_EMBEDDING_MODEL

    if not _HAS_CHROMADB:
        return {"ok": True, "results": [], "warning": "chromadb not installed"}

    collection, db_path = _init_rag_collection(project_id, embedding_model)
    if collection is None or collection.count() == 0:
        return {"ok": True, "results": []}

    total = collection.count()
    n_dense = min(n_results * 4, total)  # Over-fetch for re-ranking and MMR

    # Augment query with section prefix for better dense matching
    search_q = f"{section_type}: {query_text}" if section_type else query_text

    try:
        # ── 1. Dense HNSW retrieval ─────────────────────────────────────────
        where_filter = None
        if section_type and total > 15:
            allowed = _SECTION_FILTER_MAP.get(section_type.lower())
            if allowed:
                where_filter = {"section": {"$in": allowed}}

        dense_args = dict(
            query_texts=[search_q],
            n_results=n_dense,
        )
        if where_filter:
            dense_args["where"] = where_filter

        raw = collection.query(**dense_args)

        candidates = []
        if raw and raw.get("documents"):
            docs = raw["documents"][0]
            metas = raw.get("metadatas", [[]])[0]
            dists = raw.get("distances", [[]])[0]
            ids = raw.get("ids", [[]])[0]
            for i, (doc, meta, dist, did) in enumerate(zip(docs, metas, dists, ids)):
                candidates.append({
                    "id": did,
                    "text": doc,
                    "title": meta.get("title", ""),
                    "doi": meta.get("doi", ""),
                    "section": meta.get("section", "body"),
                    "year": meta.get("year", ""),
                    "dense_score": round(1.0 - float(dist), 4),
                    "score": round(1.0 - float(dist), 4),
                    "dense_rank": i,
                })

        if not candidates:
            return {"ok": True, "results": []}

        # ── 2. BM25 retrieval + Reciprocal Rank Fusion ──────────────────────
        if use_hybrid and _HAS_BM25 and db_path:
            bm25_ids = _bm25_retrieve(db_path, search_q, n_dense)
            if bm25_ids:
                rrf_k = 60
                id_to_cand = {c["id"]: c for c in candidates}
                # Assign dense RRF score
                for c in candidates:
                    dr = c["dense_rank"]
                    c["score"] = 1.0 / (rrf_k + dr + 1)
                # Add BM25 RRF score to any shared candidates
                for bm25_rank, did in enumerate(bm25_ids):
                    bm25_rrf = 1.0 / (rrf_k + bm25_rank + 1)
                    if did in id_to_cand:
                        id_to_cand[did]["score"] += bm25_rrf
                # Re-sort by fused RRF score
                candidates.sort(key=lambda x: x["score"], reverse=True)

        # Trim to reasonable pool before expensive steps
        pool = candidates[: n_results * 3]

        # ── 3. Cross-encoder re-ranking ─────────────────────────────────────
        if use_reranker:
            pool = _rerank(search_q, pool, n_results * 2)

        # ── 4. MMR diversity selection ───────────────────────────────────────
        if use_mmr and _HAS_ST and _HAS_NUMPY and pool:
            q_embs = _embed_texts([search_q], embedding_model, is_query=True)
            if q_embs:
                doc_texts = [c["text"] for c in pool]
                doc_embs = _embed_texts(doc_texts, embedding_model, is_query=False)
                if doc_embs and len(doc_embs) == len(pool):
                    for i, c in enumerate(pool):
                        c["embedding"] = doc_embs[i]
                    pool_with_emb = [c for c in pool if "embedding" in c]
                    if pool_with_emb:
                        pool = _mmr_select(q_embs[0], pool_with_emb, n_results, lambda_param=0.65)

        # ── 5. Final trim and format ─────────────────────────────────────────
        final = pool[:n_results]
        results = []
        for c in final:
            results.append({
                "text": c["text"],
                "title": c.get("title", ""),
                "doi": c.get("doi", ""),
                "section": c.get("section", ""),
                "year": c.get("year", ""),
                "score": round(c.get("score", 0.0), 4),
            })

        return {"ok": True, "results": results, "total_in_db": total}

    except Exception as e:
        print(f"[RAG] Query error: {e}", file=sys.stderr)
        return {"ok": True, "results": [], "error": str(e)}


# ══════════════════════════════════════════════════════════════════════════════
# ██  UTILITY — Model info (for settings UI / status display)
# ══════════════════════════════════════════════════════════════════════════════

def get_model_info(model_name: str) -> dict:
    """Return display info for a given embedding model."""
    cfg = EMBEDDING_MODELS.get(model_name, {})
    return {
        "id": model_name,
        "display": cfg.get("display", model_name),
        "dims": cfg.get("dims", 0),
        "domain": cfg.get("domain", ""),
        "description": cfg.get("description", ""),
        "loaded": model_name in _EMBEDDING_CACHE,
    }


def list_models() -> list:
    """Return info for all available embedding models."""
    return [get_model_info(m) for m in EMBEDDING_MODELS]


# ══════════════════════════════════════════════════════════════════════════════
# ██  LEGACY COMPAT — For code that checks _HAS_CHROMADB
# ══════════════════════════════════════════════════════════════════════════════

# Export the flag so research_engine.py can do: from RAG_engine import _HAS_CHROMADB
# (no code change needed in callers that already check _HAS_CHROMADB)
