#!/usr/bin/env python3
"""Show retrieval results with content."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import RAG_engine as rag

KEY = "AIzaSyAIlQ2ZNs2fwFn1d1MSdo6abo5PWjDWsY8"
PID = "manuscript_benchmark"
MODEL = "models/gemini-embedding-2-preview"

QUERIES = [
    "What is the main research question?",
    "What methodology was used?",
    "What are the key findings?",
    "What are the limitations?",
    "What conclusions are made?",
]

for qi, q in enumerate(QUERIES):
    print(f"\n{'='*60}", flush=True)
    print(f"Q{qi+1}: {q}", flush=True)
    print(f"{'='*60}", flush=True)
    qr = rag.query_vectordb({"project_id":PID,"query":q,"n_results":3,"embedding_model":MODEL,"gemini_api_key":KEY,"use_reranker":True,"use_mmr":True,"use_hybrid":True})
    for ri, r in enumerate(qr.get("results",[])):
        print(f"\n  [{ri+1}] score={r['score']:.4f} | section={r.get('section','')} | title={r.get('title','')}", flush=True)
        print(f"  Text preview: {r['text'][:300]}...", flush=True)
