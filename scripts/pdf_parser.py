#!/usr/bin/env python3
"""
pdf_parser.py — Intelligent PDF parser using GLM-OCR (self-hosted) + fallbacks.

Self-hosted tiers (tried in order unless overridden):
  Tier 1 — glmocr SDK + vLLM/SGLang  : Full-quality pipeline. Layout detection
            runs locally; OCR calls a locally running vLLM or SGLang server.
            Start server: vllm serve zai-org/GLM-OCR --port 8080
            Install:      pip install "glmocr[selfhosted]"

  Tier 2 — glmocr SDK + Ollama        : Same SDK, Ollama backend (CPU-friendly).
            Start server: ollama serve  (after: ollama pull glm-ocr)
            Uses api_mode="ollama_generate" on port 11434.

  Tier 3 — Raw Transformers (in-process): Loads GLM-OCR weights directly via
            transformers AutoModelForImageTextToText. No server needed.
            Requires: pip install "transformers>=5.3.0" torch Pillow
            PyMuPDF used for PDF→PNG conversion.

  Tier 4 — pdfplumber : Native PDF text + table extraction (text-layer PDFs).
  Tier 5 — pymupdf    : Fast layout-aware text extraction.
  Tier 6 — pypdf      : Minimal pure-Python extraction, last resort.

Every result includes "parser_used" indicating which tier ran.

Usage (CLI):
  python pdf_parser.py paper.pdf
  python pdf_parser.py paper.pdf --output result.json --pretty
  python pdf_parser.py paper.pdf --format markdown
  python pdf_parser.py paper.pdf --tier fallback          # skip all GLM tiers
  python pdf_parser.py paper.pdf --tier pdfplumber
  python pdf_parser.py paper.pdf --tier ollama
  python pdf_parser.py paper.pdf --tier vllm
  python pdf_parser.py paper.pdf --pages 1,3,5
  python pdf_parser.py --libs                             # show installed libs

Usage (module):
  from pdf_parser import parse_pdf, PDFParserSettings
  s = PDFParserSettings(force_tier="ollama", layout_device="cpu")
  result = parse_pdf("paper.pdf", s)
  print(result["parser_used"])
  print(result["full_markdown"])

NOT connected to any other Zenith component — standalone module only.
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
import tempfile
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

__version__ = "2.0.0"

# ══════════════════════════════════════════════════════════════════════════════
# ██  SETTINGS
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class PDFParserSettings:
    """
    All user-configurable knobs for the PDF parser.

    GLM-OCR self-hosted settings
    ─────────────────────────────
    model_id : str
        HuggingFace model ID used by the raw transformers tier.
        Default: "zai-org/GLM-OCR"

    layout_device : str
        Device for PP-DocLayoutV3 layout analysis (glmocr SDK tiers).
        "cpu" recommended on laptops. "cuda" or "cuda:0" if GPU available.
        Default: "cpu"

    vllm_host / vllm_port : str / int
        Host and port of a running vLLM or SGLang server.
        Start with: vllm serve zai-org/GLM-OCR --port 8080
        Default: "127.0.0.1" / 8080

    ollama_host / ollama_port : str / int
        Host and port of a running Ollama server.
        Start with: ollama serve  (after: ollama pull glm-ocr)
        Default: "127.0.0.1" / 11434

    ollama_model : str
        Ollama model name.  Default: "glm-ocr"

    ocr_device : str
        Device for raw transformers tier. "auto" lets torch decide.
        Default: "auto"

    max_new_tokens : int
        Max tokens to generate per page (raw transformers tier).
        Default: 8192

    task_mode : str
        GLM-OCR task prompt mode for raw transformers tier:
          "auto"       — text + tables + formulas detected per-region
          "text"       — plain text recognition only
          "structured" — key-value JSON extraction
          "markdown"   — force markdown output
        Default: "auto"

    glmocr_output_format : str
        Output format hint for glmocr SDK: "json", "markdown", or "both".
        Default: "both"

    save_layout_vis : bool
        Whether glmocr SDK saves layout visualisation images.
        Default: False

    PDF processing settings
    ────────────────────────
    pages : Optional[list[int]]
        1-based page numbers to process (e.g. [1, 3, 5]). None = all.

    dpi : int
        Resolution for PDF→PNG conversion (raw transformers tier).
        Default: 150

    extract_tables : bool
        Request table extraction. Default: True

    extract_formulas : bool
        Request LaTeX formula extraction (GLM-OCR tiers). Default: True

    pdfplumber_extract_tables : bool
        Use pdfplumber's native table finder. Default: True

    pdfplumber_table_settings : Optional[dict]
        Custom settings dict for pdfplumber.extract_tables(). Default: None

    pymupdf_preserve_layout : bool
        Use block-level layout extraction in PyMuPDF tier. Default: True

    include_page_images : bool
        Embed base64 page thumbnail PNGs in output JSON. Default: False

    Tier selection
    ──────────────
    force_tier : Optional[str]
        Force a specific tier, bypassing auto-detection:
          None           — auto (try in order)
          "vllm"         — Tier 1: glmocr SDK + vLLM/SGLang
          "ollama"       — Tier 2: glmocr SDK + Ollama
          "transformers" — Tier 3: raw transformers (in-process)
          "pdfplumber"   — Tier 4
          "pymupdf"      — Tier 5
          "pypdf"        — Tier 6
          "fallback"     — skip all GLM tiers, go straight to pdfplumber
        Default: None
    """

    # GLM-OCR model
    model_id:                    str                 = "zai-org/GLM-OCR"

    # glmocr SDK — layout detection
    layout_device:               str                 = "cpu"
    layout_model_dir:            str                 = "PaddlePaddle/PP-DocLayoutV3_safetensors"

    # glmocr SDK — vLLM / SGLang backend (Tier 1)
    vllm_host:                   str                 = "127.0.0.1"
    vllm_port:                   int                 = 8080

    # glmocr SDK — Ollama backend (Tier 2)
    ollama_host:                 str                 = "127.0.0.1"
    ollama_port:                 int                 = 11434
    ollama_model:                str                 = "glm-ocr"

    # Raw transformers (Tier 3)
    ocr_device:                  str                 = "auto"
    max_new_tokens:              int                 = 8192
    task_mode:                   str                 = "auto"

    # glmocr SDK output
    glmocr_output_format:        str                 = "both"
    save_layout_vis:             bool                = False

    # PDF processing
    pages:                       Optional[list[int]] = None
    dpi:                         int                 = 150
    extract_tables:              bool                = True
    extract_formulas:            bool                = True
    pdfplumber_extract_tables:   bool                = True
    pdfplumber_table_settings:   Optional[dict]      = None
    pymupdf_preserve_layout:     bool                = True
    include_page_images:         bool                = False

    # Tier selection
    force_tier:                  Optional[str]       = None


# ── GLM-OCR task prompts (raw transformers tier) ──────────────────────────────
_TASK_PROMPTS = {
    "text":       "Text Recognition:",
    "table":      "Table Recognition:",
    "formula":    "Formula Recognition:",
    "structured": "Information Extraction:",
}


# ══════════════════════════════════════════════════════════════════════════════
# ██  LIBRARY DETECTION
# ══════════════════════════════════════════════════════════════════════════════

def _detect_available_libs() -> dict:
    libs: dict = {}
    for name in ["glmocr", "pdfplumber", "fitz", "pypdf", "PyPDF2"]:
        try:
            __import__(name)
            libs[name] = True
        except ImportError:
            libs[name] = False

    if not libs["fitz"]:
        try:
            import pymupdf  # noqa: F401
            libs["fitz"] = True
        except ImportError:
            pass

    # transformers GLM support (requires >=5.3.0)
    try:
        import transformers
        from packaging.version import Version
        if Version(transformers.__version__) >= Version("5.3.0"):
            from transformers import AutoModelForImageTextToText  # noqa: F401
            libs["transformers_glm"] = True
        else:
            libs["transformers_glm"] = False
    except Exception:
        libs["transformers_glm"] = False

    return libs


_LIBS = _detect_available_libs()


# ══════════════════════════════════════════════════════════════════════════════
# ██  BACKEND AVAILABILITY CHECKS
# ══════════════════════════════════════════════════════════════════════════════

def _check_server(host: str, port: int, path: str = "/", timeout: float = 2.0) -> bool:
    """Return True if an HTTP server is responding at host:port/path."""
    import urllib.request, urllib.error
    try:
        urllib.request.urlopen(f"http://{host}:{port}{path}", timeout=timeout)
        return True
    except Exception:
        return False


def _vllm_available(settings: PDFParserSettings) -> bool:
    return _check_server(settings.vllm_host, settings.vllm_port, "/v1/models")


def _ollama_available(settings: PDFParserSettings) -> bool:
    return _check_server(settings.ollama_host, settings.ollama_port, "/api/tags")


# ══════════════════════════════════════════════════════════════════════════════
# ██  TIER 1 — glmocr SDK + vLLM / SGLang
# ══════════════════════════════════════════════════════════════════════════════

def _glmocr_base_config(settings: PDFParserSettings) -> dict:
    """Build the base pipeline config dict shared by all glmocr SDK tiers."""
    return {
        "pipeline": {
            "layout": {
                "model_dir": settings.layout_model_dir,
                "device":    settings.layout_device,
            },
            "result_formatter": {
                "output_format": settings.glmocr_output_format,
            },
        }
    }


def _parse_glmocr_vllm(pdf_path: str, settings: PDFParserSettings) -> dict:
    """Parse PDF using glmocr SDK with a vLLM or SGLang backend."""
    from glmocr import GlmOcr  # type: ignore
    import yaml
    import tempfile

    cfg = _glmocr_base_config(settings)
    cfg["pipeline"]["maas"] = {"enabled": False}
    cfg["pipeline"]["ocr_api"] = {
        "api_host": settings.vllm_host,
        "api_port": settings.vllm_port,
        "api_mode": "openai",
        "verify_ssl": False,
    }

    tmp_fd, tmp_cfg = tempfile.mkstemp(suffix=".yaml", prefix="zenith_glmocr_")
    try:
        os.close(tmp_fd)
        with open(tmp_cfg, "w", encoding="utf-8") as f:
            yaml.dump(cfg, f)
        with GlmOcr(config_path=tmp_cfg) as parser:
            result = parser.parse(pdf_path, save_layout_visualization=settings.save_layout_vis)
    finally:
        try:
            os.unlink(tmp_cfg)
        except OSError:
            pass

    return _extract_glmocr_result(result, settings)


# ══════════════════════════════════════════════════════════════════════════════
# ██  TIER 2 — glmocr SDK + Ollama
# ══════════════════════════════════════════════════════════════════════════════

def _parse_glmocr_ollama(pdf_path: str, settings: PDFParserSettings) -> dict:
    """Parse PDF using glmocr SDK with Ollama backend (CPU-friendly)."""
    from glmocr import GlmOcr  # type: ignore
    import yaml

    cfg = _glmocr_base_config(settings)
    cfg["pipeline"]["maas"] = {"enabled": False}
    cfg["pipeline"]["ocr_api"] = {
        "api_host":        settings.ollama_host,
        "api_port":        settings.ollama_port,
        "api_path":        "/api/generate",  # Ollama native endpoint
        "model":           settings.ollama_model,
        "api_mode":        "ollama_generate",
        "verify_ssl":      False,
        # Generous timeouts: cold-loading a 2.2 GB model can take >30 s on CPU
        "connect_timeout": 300,   # wait up to 5 min for Ollama to load the model
        "request_timeout": 600,   # allow up to 10 min per OCR inference call
    }

    tmp_fd, tmp_cfg = tempfile.mkstemp(suffix=".yaml", prefix="zenith_glmocr_")
    try:
        os.close(tmp_fd)
        with open(tmp_cfg, "w", encoding="utf-8") as f:
            yaml.dump(cfg, f)
        with GlmOcr(config_path=tmp_cfg) as parser:
            result = parser.parse(pdf_path, save_layout_visualization=settings.save_layout_vis)
    finally:
        try:
            os.unlink(tmp_cfg)
        except OSError:
            pass

    return _extract_glmocr_result(result, settings)


def _extract_glmocr_result(result, settings: PDFParserSettings) -> dict:
    """Convert a glmocr PipelineResult into our unified output dict."""
    warnings_list = []

    full_markdown = getattr(result, "markdown_result", "") or ""
    raw_json = getattr(result, "json_result", None)

    # raw_json is list-of-pages, each page is a list of region dicts:
    # [{"index": N, "label": "text"|"table"|"formula",
    #   "content": "...", "bbox_2d": [x1,y1,x2,y2]}, ...]
    pages_out = []
    if isinstance(raw_json, list):
        for page_idx, page_regions in enumerate(raw_json):
            if not isinstance(page_regions, list):
                page_regions = []
            text_parts, table_parts, formula_parts, md_parts = [], [], [], []
            for region in page_regions:
                label   = region.get("label", "text")
                content = region.get("content", "")
                if label == "table":
                    table_parts.append(content)
                    md_parts.append(content)
                elif label in ("formula", "equation", "isolated_formula"):
                    formula_parts.append(content)
                    md_parts.append(f"$${content}$$")
                else:
                    text_parts.append(content)
                    md_parts.append(content)

            pages_out.append({
                "page_number":  page_idx + 1,
                "text":         "\n".join(text_parts).strip(),
                "markdown":     "\n\n".join(md_parts).strip(),
                "tables":       table_parts,
                "formulas":     formula_parts,
                "region_count": len(page_regions),
            })
    else:
        # No structured JSON — use markdown split by horizontal rules
        md_pages = full_markdown.split("\n---\n")
        for i, md in enumerate(md_pages):
            pages_out.append({
                "page_number": i + 1,
                "text":        md.strip(),
                "markdown":    md.strip(),
                "tables":      [],
                "formulas":    [],
            })

    full_text = "\n\n".join(p["text"] for p in pages_out if p["text"])
    if not full_markdown:
        full_markdown = "\n\n---\n\n".join(p["markdown"] for p in pages_out if p["markdown"])

    # Filter to requested pages if needed
    if settings.pages:
        pages_out = [p for p in pages_out if p["page_number"] in settings.pages]

    return {
        "pages":         pages_out,
        "full_text":     full_text,
        "full_markdown": full_markdown,
        "warnings":      warnings_list,
    }


# ══════════════════════════════════════════════════════════════════════════════
# ██  TIER 3 — Raw Transformers (in-process, no server needed)
# ══════════════════════════════════════════════════════════════════════════════

_TRANSFORMERS_CACHE: dict = {}


def _load_glm_ocr_model(settings: PDFParserSettings):
    """Load GLM-OCR processor + model directly in-process, with caching."""
    import torch
    from transformers import AutoProcessor, AutoModelForImageTextToText

    key = (settings.model_id, settings.ocr_device)
    if key not in _TRANSFORMERS_CACHE:
        dtype      = torch.bfloat16 if torch.cuda.is_available() else torch.float32
        device_map = settings.ocr_device if settings.ocr_device != "auto" else "auto"

        processor = AutoProcessor.from_pretrained(settings.model_id)
        model = AutoModelForImageTextToText.from_pretrained(
            settings.model_id,
            torch_dtype=dtype,
            device_map=device_map,
        )
        model.eval()
        _TRANSFORMERS_CACHE[key] = (processor, model)

    return _TRANSFORMERS_CACHE[key]


def _glm_infer_raw(processor, model, image_path: str, prompt: str, max_new_tokens: int) -> str:
    """Run one GLM-OCR inference on an image file.

    GLM-OCR expects {"type": "image", "url": "<file_path>"} — NOT PIL objects.
    """
    import torch

    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "url": image_path},
                {"type": "text",  "text": prompt},
            ],
        }
    ]
    inputs = processor.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_dict=True,
        return_tensors="pt",
    )
    if inputs is None:
        raise RuntimeError("processor.apply_chat_template returned None")

    inputs = {k: v.to(model.device) for k, v in inputs.items() if hasattr(v, "to")}
    inputs.pop("token_type_ids", None)

    with torch.no_grad():
        generated = model.generate(**inputs, max_new_tokens=max_new_tokens)

    new_tokens = generated[0][inputs["input_ids"].shape[1]:]
    return processor.decode(new_tokens, skip_special_tokens=True).strip()


def _parse_transformers(pdf_path: str, settings: PDFParserSettings) -> dict:
    """Parse PDF using raw transformers GLM-OCR weights (fully in-process)."""
    import fitz  # pymupdf for PDF→PNG

    processor, model = _load_glm_ocr_model(settings)

    doc         = fitz.open(pdf_path)
    total_pages = len(doc)
    page_indices = _resolve_page_indices(settings.pages, total_pages)

    # Build task prompt set
    task_mode = settings.task_mode
    prompts: dict[str, str] = {}
    if task_mode in ("auto", "text"):
        prompts["text"] = _TASK_PROMPTS["text"]
    if settings.extract_tables and task_mode in ("auto", "markdown"):
        prompts["table"] = _TASK_PROMPTS["table"]
    if settings.extract_formulas and task_mode == "auto":
        prompts["formula"] = _TASK_PROMPTS["formula"]
    if not prompts:
        prompts["text"] = _TASK_PROMPTS["text"]

    pages_out    = []
    warnings_list = []

    for idx in page_indices:
        page = doc[idx]
        mat  = fitz.Matrix(settings.dpi / 72, settings.dpi / 72)
        pix  = page.get_pixmap(matrix=mat, alpha=False)

        # GLM-OCR needs a file path, not a PIL object — save to temp PNG
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".png", prefix=f"zenith_p{idx+1}_")
        try:
            os.close(tmp_fd)
            pix.save(tmp_path)

            page_results: dict[str, str] = {}
            for task_name, prompt in prompts.items():
                try:
                    out = _glm_infer_raw(processor, model, tmp_path, prompt, settings.max_new_tokens)
                    page_results[task_name] = out
                except Exception as exc:
                    warnings_list.append(f"Page {idx+1} '{task_name}' failed: {exc}")
                    page_results[task_name] = ""
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

        text    = page_results.get("text", "")
        tables  = [page_results["table"]] if page_results.get("table") else []
        formula = page_results.get("formula", "")

        md_parts = [p for p in [text] + tables + ([f"$${formula}$$"] if formula else []) if p]
        pages_out.append({
            "page_number": idx + 1,
            "text":        text,
            "markdown":    "\n\n".join(md_parts),
            "tables":      tables,
            "formulas":    [formula] if formula else [],
        })

    doc.close()

    full_text     = "\n\n".join(p["text"] for p in pages_out if p["text"])
    full_markdown = "\n\n---\n\n".join(p["markdown"] for p in pages_out if p["markdown"])
    return {"pages": pages_out, "full_text": full_text, "full_markdown": full_markdown, "warnings": warnings_list}


# ══════════════════════════════════════════════════════════════════════════════
# ██  TIER 4 — pdfplumber
# ══════════════════════════════════════════════════════════════════════════════

def _parse_pdfplumber(pdf_path: str, settings: PDFParserSettings) -> dict:
    import pdfplumber
    warnings_list = []
    pages_out     = []

    with pdfplumber.open(pdf_path) as pdf:
        page_indices = _resolve_page_indices(settings.pages, len(pdf.pages))
        for idx in page_indices:
            pg   = pdf.pages[idx]
            text = pg.extract_text() or ""
            tables, tables_md = [], []
            if settings.pdfplumber_extract_tables:
                try:
                    for tbl in (pg.extract_tables(table_settings=settings.pdfplumber_table_settings) or []):
                        tables.append(tbl)
                        tables_md.append(_table_to_markdown(tbl))
                except Exception as exc:
                    warnings_list.append(f"Page {idx+1} table extraction: {exc}")

            md = "\n\n".join(p for p in [text] + tables_md if p)
            pages_out.append({
                "page_number":    idx + 1,
                "text":           text.strip(),
                "markdown":       md.strip(),
                "tables":         tables,
                "tables_markdown": tables_md,
                "formulas":       [],
                "dimensions":     {"width": round(float(pg.width), 2), "height": round(float(pg.height), 2)},
            })

    full_text     = "\n\n".join(p["text"] for p in pages_out if p["text"])
    full_markdown = "\n\n---\n\n".join(p["markdown"] for p in pages_out if p["markdown"])
    return {"pages": pages_out, "full_text": full_text, "full_markdown": full_markdown, "warnings": warnings_list}


# ══════════════════════════════════════════════════════════════════════════════
# ██  TIER 5 — PyMuPDF (fitz)
# ══════════════════════════════════════════════════════════════════════════════

def _parse_pymupdf(pdf_path: str, settings: PDFParserSettings) -> dict:
    import fitz
    warnings_list = []
    pages_out     = []

    doc = fitz.open(pdf_path)
    for idx in _resolve_page_indices(settings.pages, len(doc)):
        page = doc[idx]
        if settings.pymupdf_preserve_layout:
            blocks = page.get_text("blocks")
            blocks.sort(key=lambda b: (round(b[1] / 20), b[0]))
            text = "\n\n".join(b[4].strip() for b in blocks if b[6] == 0 and b[4].strip())
        else:
            text = page.get_text("text").strip()

        rect = page.rect
        pages_out.append({
            "page_number": idx + 1,
            "text":        text,
            "markdown":    text,
            "tables":      [],
            "formulas":    [],
            "image_count": len(page.get_images()),
            "dimensions":  {"width": round(rect.width, 2), "height": round(rect.height, 2)},
        })
    doc.close()

    full_text = "\n\n".join(p["text"] for p in pages_out if p["text"])
    return {"pages": pages_out, "full_text": full_text, "full_markdown": full_text, "warnings": warnings_list}


# ══════════════════════════════════════════════════════════════════════════════
# ██  TIER 6 — pypdf (last resort)
# ══════════════════════════════════════════════════════════════════════════════

def _parse_pypdf(pdf_path: str, settings: PDFParserSettings) -> dict:
    warnings_list = []
    pages_out     = []

    try:
        from pypdf import PdfReader
    except ImportError:
        from PyPDF2 import PdfReader  # type: ignore

    reader = PdfReader(pdf_path)
    for idx in _resolve_page_indices(settings.pages, len(reader.pages)):
        try:
            text = reader.pages[idx].extract_text() or ""
        except Exception as exc:
            text = ""
            warnings_list.append(f"Page {idx+1}: {exc}")
        pages_out.append({
            "page_number": idx + 1,
            "text":        text.strip(),
            "markdown":    text.strip(),
            "tables":      [],
            "formulas":    [],
        })

    full_text = "\n\n".join(p["text"] for p in pages_out if p["text"])
    return {"pages": pages_out, "full_text": full_text, "full_markdown": full_text, "warnings": warnings_list}


# ══════════════════════════════════════════════════════════════════════════════
# ██  PDF METADATA
# ══════════════════════════════════════════════════════════════════════════════

def _get_pdf_metadata(pdf_path: str) -> dict:
    meta: dict = {
        "filename": Path(pdf_path).name,
        "file_size_bytes": os.path.getsize(pdf_path),
        "page_count": None, "title": None, "author": None,
        "subject": None, "producer": None,
        "creation_date": None, "modification_date": None, "encrypted": False,
    }
    if _LIBS.get("fitz"):
        try:
            import fitz
            doc = fitz.open(pdf_path)
            meta["page_count"] = len(doc)
            m = doc.metadata or {}
            for src, dst in [("title","title"),("author","author"),("subject","subject"),
                             ("producer","producer"),("creationDate","creation_date"),
                             ("modDate","modification_date")]:
                meta[dst] = m.get(src) or None
            meta["encrypted"] = doc.is_encrypted
            doc.close()
            return meta
        except Exception:
            pass
    if _LIBS.get("pdfplumber"):
        try:
            import pdfplumber
            with pdfplumber.open(pdf_path) as pdf:
                meta["page_count"] = len(pdf.pages)
                info = pdf.metadata or {}
                for k in ("Title","Author","Subject","Producer"):
                    meta[k.lower()] = info.get(k) or None
        except Exception:
            pass
    return meta


# ══════════════════════════════════════════════════════════════════════════════
# ██  HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _resolve_page_indices(pages: Optional[list[int]], total: int) -> list[int]:
    if not pages:
        return list(range(total))
    return sorted({p - 1 for p in pages if 0 < p <= total})


def _table_to_markdown(table: list) -> str:
    if not table:
        return ""
    rows = []
    for i, row in enumerate(table):
        cells = [str(c or "").replace("\n", " ").strip() for c in row]
        rows.append("| " + " | ".join(cells) + " |")
        if i == 0:
            rows.append("| " + " | ".join(["---"] * len(row)) + " |")
    return "\n".join(rows)


def _available_libs_summary() -> dict:
    return {
        "glmocr_sdk":           _LIBS.get("glmocr", False),
        "glmocr_transformers":  _LIBS.get("transformers_glm", False),
        "pdfplumber":           _LIBS.get("pdfplumber", False),
        "pymupdf":              _LIBS.get("fitz", False),
        "pypdf":                _LIBS.get("pypdf", False) or _LIBS.get("PyPDF2", False),
    }


# ══════════════════════════════════════════════════════════════════════════════
# ██  MAIN ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════

def parse_pdf(
    pdf_path: str,
    settings: Optional[PDFParserSettings] = None,
) -> dict:
    """
    Parse a PDF and return a unified JSON-serialisable result dict.

    Returns
    -------
    dict with keys:
        parser_used          : str   — which tier ran
        parser_version       : str
        settings_used        : dict
        available_parsers    : dict
        metadata             : dict
        pages                : list  — per-page results
        full_text            : str
        full_markdown        : str
        warnings             : list
        errors               : list  — tiers that failed (with reason)
        processing_time_sec  : float
    """
    if settings is None:
        settings = PDFParserSettings()

    pdf_path = str(Path(pdf_path).resolve())
    if not os.path.isfile(pdf_path):
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    t0     = time.perf_counter()
    errors: list[dict] = []

    metadata   = _get_pdf_metadata(pdf_path)
    glmocr_ok  = _LIBS.get("glmocr", False)
    trans_ok   = _LIBS.get("transformers_glm", False)
    plumb_ok   = _LIBS.get("pdfplumber", False)
    fitz_ok    = _LIBS.get("fitz", False)
    pypdf_ok   = _LIBS.get("pypdf", False) or _LIBS.get("PyPDF2", False)

    def _attempt(tier_name: str, fn) -> Optional[dict]:
        try:
            return fn()
        except Exception as exc:
            errors.append({"tier": tier_name, "error": str(exc),
                           "traceback": traceback.format_exc()})
            return None

    force = (settings.force_tier or "").lower().strip()
    result_data: Optional[dict] = None
    parser_used = "none"

    if force == "fallback":
        tier_order = [
            ("pdfplumber",  plumb_ok,  lambda: _parse_pdfplumber(pdf_path, settings)),
            ("pymupdf",     fitz_ok,   lambda: _parse_pymupdf(pdf_path, settings)),
            ("pypdf",       pypdf_ok,  lambda: _parse_pypdf(pdf_path, settings)),
        ]
    elif force == "vllm":
        tier_order = [
            ("glmocr_vllm", glmocr_ok and _vllm_available(settings),
             lambda: _parse_glmocr_vllm(pdf_path, settings)),
        ]
    elif force == "ollama":
        tier_order = [
            ("glmocr_ollama", glmocr_ok and _ollama_available(settings),
             lambda: _parse_glmocr_ollama(pdf_path, settings)),
        ]
    elif force == "transformers":
        tier_order = [
            ("glmocr_transformers", trans_ok,
             lambda: _parse_transformers(pdf_path, settings)),
        ]
    elif force in ("pdfplumber", "pymupdf", "pypdf"):
        fn_map = {
            "pdfplumber": lambda: _parse_pdfplumber(pdf_path, settings),
            "pymupdf":    lambda: _parse_pymupdf(pdf_path, settings),
            "pypdf":      lambda: _parse_pypdf(pdf_path, settings),
        }
        tier_order = [(force, True, fn_map[force])]
    else:
        # Auto order: best quality → fastest fallback
        tier_order = [
            ("glmocr_vllm",
             glmocr_ok and _vllm_available(settings),
             lambda: _parse_glmocr_vllm(pdf_path, settings)),

            ("glmocr_ollama",
             glmocr_ok and _ollama_available(settings),
             lambda: _parse_glmocr_ollama(pdf_path, settings)),

            ("glmocr_transformers",
             trans_ok and _LIBS.get("fitz", False),
             lambda: _parse_transformers(pdf_path, settings)),

            ("pdfplumber",  plumb_ok,  lambda: _parse_pdfplumber(pdf_path, settings)),
            ("pymupdf",     fitz_ok,   lambda: _parse_pymupdf(pdf_path, settings)),
            ("pypdf",       pypdf_ok,  lambda: _parse_pypdf(pdf_path, settings)),
        ]

    for tier_name, available, fn in tier_order:
        if not available:
            errors.append({"tier": tier_name, "error": "not available (lib not installed or server not running)"})
            continue
        result_data = _attempt(tier_name, fn)
        if result_data is not None:
            parser_used = tier_name
            break

    if result_data is None:
        raise RuntimeError(
            "All parsing tiers failed.\n"
            "Install at least one of: glmocr[selfhosted] + vLLM/Ollama, pdfplumber, pymupdf, pypdf\n"
            "Errors:\n" + json.dumps(errors, indent=2)
        )

    elapsed = time.perf_counter() - t0
    return {
        "parser_used":          parser_used,
        "parser_version":       __version__,
        "settings_used":        asdict(settings),
        "available_parsers":    _available_libs_summary(),
        "metadata":             metadata,
        "pages":                result_data["pages"],
        "full_text":            result_data["full_text"],
        "full_markdown":        result_data["full_markdown"],
        "warnings":             result_data.get("warnings", []),
        "errors":               errors,
        "processing_time_sec":  round(elapsed, 3),
    }


# ══════════════════════════════════════════════════════════════════════════════
# ██  CLI
# ══════════════════════════════════════════════════════════════════════════════

def _build_cli_parser():
    import argparse
    p = argparse.ArgumentParser(
        prog="pdf_parser",
        description=(
            "Zenith PDF Parser — GLM-OCR self-hosted + multi-tier fallback.\n"
            "Tiers: glmocr+vLLM → glmocr+Ollama → transformers → pdfplumber → pymupdf → pypdf"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("input", nargs="?", default=None, help="Path to input PDF file")
    p.add_argument("-o", "--output", default=None, help="Output file (.json or .md). Default: stdout.")
    p.add_argument("--format", choices=["json", "markdown", "text"], default="json",
                   help="Output format (default: json)")
    p.add_argument("--tier", default=None,
                   choices=["vllm", "ollama", "transformers", "pdfplumber", "pymupdf", "pypdf", "fallback"],
                   help="Force a specific tier (default: auto)")
    p.add_argument("--pages", default=None, help="Comma-separated 1-based page numbers, e.g. '1,2,5'")
    p.add_argument("--task", choices=["auto","text","structured","markdown"], default="auto",
                   help="GLM-OCR task mode for transformers tier (default: auto)")
    p.add_argument("--device", default="auto", help="OCR device for transformers tier (default: auto)")
    p.add_argument("--layout-device", default="cpu", help="Layout detection device (default: cpu)")
    p.add_argument("--dpi", type=int, default=150, help="DPI for PDF→PNG in transformers tier (default: 150)")
    p.add_argument("--max-tokens", type=int, default=8192, help="Max new tokens per page (default: 8192)")
    p.add_argument("--vllm-host", default="127.0.0.1")
    p.add_argument("--vllm-port", type=int, default=8080)
    p.add_argument("--ollama-host", default="127.0.0.1")
    p.add_argument("--ollama-port", type=int, default=11434)
    p.add_argument("--ollama-model", default="glm-ocr")
    p.add_argument("--no-tables", action="store_true", help="Disable table extraction")
    p.add_argument("--no-formulas", action="store_true", help="Disable formula extraction")
    p.add_argument("--pretty", action="store_true", help="Pretty-print JSON")
    p.add_argument("--libs", action="store_true", help="Print available library status and exit")
    return p


def main():
    parser = _build_cli_parser()
    args   = parser.parse_args()

    if args.libs or args.input is None:
        if args.input is None and not args.libs:
            parser.print_help()
            return

        libs = _available_libs_summary()
        print("Available parsing libraries / backends:")
        for k, v in libs.items():
            status = "[OK]  installed" if v else "[--] NOT installed"
            print(f"  {k:<28} {status}")

        print()
        print("Self-hosted GLM-OCR setup:")
        print("  Option A — vLLM/SGLang backend:")
        print('    pip install "glmocr[selfhosted]"')
        print('    vllm serve zai-org/GLM-OCR --port 8080')
        print('    python pdf_parser.py paper.pdf --tier vllm')
        print()
        print("  Option B — Ollama backend (CPU-friendly):")
        print('    pip install "glmocr[selfhosted]"')
        print('    winget install Ollama.Ollama  (or from ollama.com)')
        print('    ollama pull glm-ocr && ollama serve')
        print('    python pdf_parser.py paper.pdf --tier ollama')
        print()
        print("  Option C — Raw transformers (in-process, no server):")
        print('    pip install "transformers>=5.3.0" torch pymupdf Pillow')
        print('    python pdf_parser.py paper.pdf --tier transformers')
        return

    pages = None
    if args.pages:
        try:
            pages = [int(x.strip()) for x in args.pages.split(",") if x.strip()]
        except ValueError:
            print(f"Error: --pages must be comma-separated integers, got: {args.pages}")
            sys.exit(1)

    output_fmt = getattr(args, "format", "json")
    settings = PDFParserSettings(
        ocr_device=args.device,
        layout_device=args.layout_device,
        max_new_tokens=args.max_tokens,
        task_mode=args.task,
        extract_tables=not args.no_tables,
        extract_formulas=not args.no_formulas,
        pages=pages,
        dpi=args.dpi,
        force_tier=args.tier,
        vllm_host=args.vllm_host,
        vllm_port=args.vllm_port,
        ollama_host=args.ollama_host,
        ollama_port=args.ollama_port,
        ollama_model=args.ollama_model,
    )

    print(f"Parsing: {args.input}", file=sys.stderr)
    print(f"Settings: tier={args.tier or 'auto'}, task={args.task}, device={args.device}", file=sys.stderr)

    try:
        result = parse_pdf(args.input, settings)
    except Exception as exc:
        print(f"\nFATAL: {exc}", file=sys.stderr)
        sys.exit(1)

    print(
        f"Done — parser_used={result['parser_used']}, "
        f"pages={len(result['pages'])}, "
        f"chars={len(result['full_text'])}, "
        f"time={result['processing_time_sec']}s",
        file=sys.stderr,
    )

    if output_fmt == "text":
        output_str = result["full_text"]
    elif output_fmt == "markdown":
        output_str = result["full_markdown"]
    else:
        output_str = json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None)

    if args.output:
        Path(args.output).write_text(output_str, encoding="utf-8")
        print(f"Saved to: {args.output}", file=sys.stderr)
    else:
        print(output_str)


if __name__ == "__main__":
    main()
