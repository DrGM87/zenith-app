#!/usr/bin/env python3
"""
pdf_parser.py — Intelligent PDF parser using GLM-OCR (in-process) + fallbacks.

All tiers are fully local — no external servers or applications required.

  Tier 1 — Raw Transformers (GLM-OCR in-process)
            Loads zai-org/GLM-OCR weights directly via HuggingFace transformers.
            No server, no Ollama, no vLLM — pure Python + PyTorch.
            Requires: pip install "transformers>=5.3.0" torch pymupdf Pillow
            GPU optional; CPU works (slower).

  Tier 2 — pdfplumber   : Native PDF text + table extraction (text-layer PDFs).
  Tier 3 — pymupdf      : Fast layout-aware text extraction.
  Tier 4 — pypdf        : Minimal pure-Python extraction, last resort.

Every result includes "parser_used" indicating which tier ran.

Usage (CLI):
  python pdf_parser.py paper.pdf
  python pdf_parser.py paper.pdf --output result.json --pretty
  python pdf_parser.py paper.pdf --format markdown
  python pdf_parser.py paper.pdf --tier fallback       # skip GLM, go to pdfplumber
  python pdf_parser.py paper.pdf --tier pdfplumber
  python pdf_parser.py paper.pdf --tier transformers
  python pdf_parser.py paper.pdf --pages 1,3,5
  python pdf_parser.py --libs                          # show installed libs

Usage (module):
  from pdf_parser import parse_pdf, PDFParserSettings
  s = PDFParserSettings(task_mode="text", dpi=200)
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

__version__ = "3.0.0"

# ── Feature flags ─────────────────────────────────────────────────────────────
# Set to True to re-enable GLM-OCR (Tier 1). Requires:
#   pip install "transformers>=5.3.0" torch pymupdf Pillow
# Note: ~44 min/page on CPU; GPU recommended for practical use.
_GLM_OCR_ENABLED: bool = False

# ══════════════════════════════════════════════════════════════════════════════
# ██  SETTINGS
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class PDFParserSettings:
    """
    All user-configurable knobs for the PDF parser.

    GLM-OCR (Tier 1) settings
    ─────────────────────────
    model_id : str
        HuggingFace model ID for the GLM-OCR weights.
        Default: "zai-org/GLM-OCR"

    ocr_device : str
        Torch device for inference. "auto" lets torch decide (GPU if available,
        else CPU). Examples: "cpu", "cuda", "cuda:0", "mps".
        Default: "auto"

    max_new_tokens : int
        Maximum tokens to generate per page / per region.
        Default: 8192

    task_mode : str
        Which GLM-OCR task prompts to run:
          "auto"       — text + tables + formulas detected per-region
          "text"       — plain text recognition only
          "markdown"   — force markdown output (includes tables)
          "structured" — key-value JSON extraction
        Default: "auto"

    dpi : int
        Resolution for PDF-to-PNG rasterisation (higher = sharper, slower).
        Default: 150

    PDF processing settings
    ───────────────────────
    pages : Optional[list[int]]
        1-based page numbers to process (e.g. [1, 3, 5]). None = all pages.

    extract_tables : bool
        Request table extraction in "auto" / "markdown" task modes.
        Default: True

    extract_formulas : bool
        Request LaTeX formula extraction in "auto" task mode.
        Default: True

    pdfplumber_extract_tables : bool
        Use pdfplumber's native table finder (Tier 2).
        Default: True

    pdfplumber_table_settings : Optional[dict]
        Custom settings dict forwarded to pdfplumber.extract_tables().
        Default: None

    pymupdf_preserve_layout : bool
        Use block-level layout extraction in PyMuPDF tier (Tier 3).
        Default: True

    include_page_images : bool
        Embed base64 page thumbnail PNGs in output JSON.
        Default: False

    Tier selection
    ──────────────
    force_tier : Optional[str]
        Force a specific tier, bypassing auto-detection:
          None           — auto (try tiers 1-4 in order)
          "transformers" — Tier 1: GLM-OCR in-process
          "pdfplumber"   — Tier 2
          "pymupdf"      — Tier 3
          "pypdf"        — Tier 4
          "fallback"     — alias for pdfplumber (skip GLM-OCR)
        Default: None
    """

    # GLM-OCR model (Tier 1)
    model_id:                    str                 = "zai-org/GLM-OCR"
    ocr_device:                  str                 = "auto"
    max_new_tokens:              int                 = 8192
    task_mode:                   str                 = "auto"

    # PDF rasterisation
    dpi:                         int                 = 150

    # Page selection
    pages:                       Optional[list[int]] = None

    # Feature flags
    extract_tables:              bool                = True
    extract_formulas:            bool                = True
    include_page_images:         bool                = False

    # pdfplumber (Tier 2) options
    pdfplumber_extract_tables:   bool                = True
    pdfplumber_table_settings:   Optional[dict]      = None

    # PyMuPDF (Tier 3) options
    pymupdf_preserve_layout:     bool                = True

    # Tier selection
    force_tier:                  Optional[str]       = None


# ── GLM-OCR task prompts ──────────────────────────────────────────────────────
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

    # Standard PDF libs
    for name in ["pdfplumber", "fitz", "pypdf", "PyPDF2"]:
        try:
            __import__(name)
            libs[name] = True
        except ImportError:
            libs[name] = False

    # pymupdf may expose itself as "pymupdf" instead of "fitz"
    if not libs["fitz"]:
        try:
            import pymupdf  # noqa: F401
            libs["fitz"] = True
        except ImportError:
            pass

    # transformers GLM-OCR support (requires >=5.3.0 for AutoModelForImageTextToText)
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
# ██  TIER 1 — Raw Transformers (GLM-OCR fully in-process)
# ══════════════════════════════════════════════════════════════════════════════

_TRANSFORMERS_CACHE: dict = {}


def _load_glm_ocr_model(settings: PDFParserSettings):
    """Load GLM-OCR processor + model into process memory, with caching."""
    import torch
    from transformers import AutoProcessor, AutoModelForImageTextToText

    key = (settings.model_id, settings.ocr_device)
    if key not in _TRANSFORMERS_CACHE:
        dtype      = torch.bfloat16 if torch.cuda.is_available() else torch.float32
        device_map = settings.ocr_device if settings.ocr_device != "auto" else "auto"

        processor = AutoProcessor.from_pretrained(settings.model_id)
        model = AutoModelForImageTextToText.from_pretrained(
            settings.model_id,
            dtype=dtype,
            device_map=device_map,
        )
        model.eval()
        _TRANSFORMERS_CACHE[key] = (processor, model)

    return _TRANSFORMERS_CACHE[key]


def _glm_infer_raw(processor, model, image_path: str, prompt: str, max_new_tokens: int) -> str:
    """Run one GLM-OCR inference pass on a PNG file path.

    GLM-OCR expects {"type": "image", "url": "<file_path>"} — NOT a PIL object.
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
    """Parse PDF using raw GLM-OCR weights loaded directly in-process."""
    import fitz  # pymupdf — PDF to PNG rasterisation

    processor, model = _load_glm_ocr_model(settings)

    doc          = fitz.open(pdf_path)
    total_pages  = len(doc)
    page_indices = _resolve_page_indices(settings.pages, total_pages)

    # Decide which task prompts to run
    task_mode = settings.task_mode
    prompts: dict[str, str] = {}
    if task_mode in ("auto", "text", "structured"):
        prompts["text"] = _TASK_PROMPTS["text"]
    if settings.extract_tables and task_mode in ("auto", "markdown"):
        prompts["table"] = _TASK_PROMPTS["table"]
    if settings.extract_formulas and task_mode == "auto":
        prompts["formula"] = _TASK_PROMPTS["formula"]
    if not prompts:
        prompts["text"] = _TASK_PROMPTS["text"]

    pages_out:    list  = []
    warnings_list: list = []

    for idx in page_indices:
        page = doc[idx]
        mat  = fitz.Matrix(settings.dpi / 72, settings.dpi / 72)
        pix  = page.get_pixmap(matrix=mat, alpha=False)

        # GLM-OCR needs a real file path — save page render to a temp PNG
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".png", prefix=f"zenith_p{idx+1}_")
        try:
            os.close(tmp_fd)
            pix.save(tmp_path)

            page_results: dict[str, str] = {}
            for task_name, prompt in prompts.items():
                try:
                    out = _glm_infer_raw(
                        processor, model, tmp_path, prompt, settings.max_new_tokens
                    )
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
    return {
        "pages":        pages_out,
        "full_text":    full_text,
        "full_markdown": full_markdown,
        "warnings":     warnings_list,
    }


# ══════════════════════════════════════════════════════════════════════════════
# ██  TIER 2 — pdfplumber
# ══════════════════════════════════════════════════════════════════════════════

def _parse_pdfplumber(pdf_path: str, settings: PDFParserSettings) -> dict:
    import pdfplumber
    warnings_list: list = []
    pages_out:     list = []

    with pdfplumber.open(pdf_path) as pdf:
        page_indices = _resolve_page_indices(settings.pages, len(pdf.pages))
        for idx in page_indices:
            pg   = pdf.pages[idx]
            text = pg.extract_text() or ""
            tables, tables_md = [], []
            if settings.pdfplumber_extract_tables:
                try:
                    for tbl in (pg.extract_tables(
                        table_settings=settings.pdfplumber_table_settings
                    ) or []):
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
                "dimensions":     {
                    "width":  round(float(pg.width),  2),
                    "height": round(float(pg.height), 2),
                },
            })

    full_text     = "\n\n".join(p["text"] for p in pages_out if p["text"])
    full_markdown = "\n\n---\n\n".join(p["markdown"] for p in pages_out if p["markdown"])
    return {
        "pages":        pages_out,
        "full_text":    full_text,
        "full_markdown": full_markdown,
        "warnings":     warnings_list,
    }


# ══════════════════════════════════════════════════════════════════════════════
# ██  TIER 3 — PyMuPDF (fitz)
# ══════════════════════════════════════════════════════════════════════════════

def _parse_pymupdf(pdf_path: str, settings: PDFParserSettings) -> dict:
    import fitz
    warnings_list: list = []
    pages_out:     list = []

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
    return {
        "pages":        pages_out,
        "full_text":    full_text,
        "full_markdown": full_text,
        "warnings":     warnings_list,
    }


# ══════════════════════════════════════════════════════════════════════════════
# ██  TIER 4 — pypdf (last resort)
# ══════════════════════════════════════════════════════════════════════════════

def _parse_pypdf(pdf_path: str, settings: PDFParserSettings) -> dict:
    warnings_list: list = []
    pages_out:     list = []

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
    return {
        "pages":        pages_out,
        "full_text":    full_text,
        "full_markdown": full_text,
        "warnings":     warnings_list,
    }


# ══════════════════════════════════════════════════════════════════════════════
# ██  PDF METADATA
# ══════════════════════════════════════════════════════════════════════════════

def _get_pdf_metadata(pdf_path: str) -> dict:
    meta: dict = {
        "filename":          Path(pdf_path).name,
        "file_size_bytes":   os.path.getsize(pdf_path),
        "page_count":        None,
        "title":             None,
        "author":            None,
        "subject":           None,
        "producer":          None,
        "creation_date":     None,
        "modification_date": None,
        "encrypted":         False,
    }
    if _LIBS.get("fitz"):
        try:
            import fitz
            doc = fitz.open(pdf_path)
            meta["page_count"] = len(doc)
            m = doc.metadata or {}
            for src, dst in [
                ("title",        "title"),
                ("author",       "author"),
                ("subject",      "subject"),
                ("producer",     "producer"),
                ("creationDate", "creation_date"),
                ("modDate",      "modification_date"),
            ]:
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
                for k in ("Title", "Author", "Subject", "Producer"):
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
        "glmocr_transformers": _GLM_OCR_ENABLED and _LIBS.get("transformers_glm", False),
        "pdfplumber":          _LIBS.get("pdfplumber", False),
        "pymupdf":             _LIBS.get("fitz", False),
        "pypdf":               _LIBS.get("pypdf", False) or _LIBS.get("PyPDF2", False),
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

    metadata  = _get_pdf_metadata(pdf_path)
    trans_ok  = _GLM_OCR_ENABLED and _LIBS.get("transformers_glm", False) and _LIBS.get("fitz", False)
    plumb_ok  = _LIBS.get("pdfplumber", False)
    fitz_ok   = _LIBS.get("fitz", False)
    pypdf_ok  = _LIBS.get("pypdf", False) or _LIBS.get("PyPDF2", False)

    def _attempt(tier_name: str, fn) -> Optional[dict]:
        try:
            return fn()
        except Exception as exc:
            errors.append({
                "tier":      tier_name,
                "error":     str(exc),
                "traceback": traceback.format_exc(),
            })
            return None

    force = (settings.force_tier or "").lower().strip()
    result_data: Optional[dict] = None
    parser_used = "none"

    # Build tier list based on force_tier
    if force in ("fallback", "pdfplumber"):
        tier_order = [
            ("pdfplumber", plumb_ok, lambda: _parse_pdfplumber(pdf_path, settings)),
            ("pymupdf",    fitz_ok,  lambda: _parse_pymupdf(pdf_path, settings)),
            ("pypdf",      pypdf_ok, lambda: _parse_pypdf(pdf_path, settings)),
        ]
    elif force == "transformers":
        tier_order = [
            ("glmocr_transformers", trans_ok,
             lambda: _parse_transformers(pdf_path, settings)),
        ]
    elif force == "pymupdf":
        tier_order = [("pymupdf", fitz_ok, lambda: _parse_pymupdf(pdf_path, settings))]
    elif force == "pypdf":
        tier_order = [("pypdf", pypdf_ok, lambda: _parse_pypdf(pdf_path, settings))]
    else:
        # Auto: GLM-OCR first, then text-layer fallbacks
        tier_order = [
            ("glmocr_transformers", trans_ok,
             lambda: _parse_transformers(pdf_path, settings)),
            ("pdfplumber",  plumb_ok,  lambda: _parse_pdfplumber(pdf_path, settings)),
            ("pymupdf",     fitz_ok,   lambda: _parse_pymupdf(pdf_path, settings)),
            ("pypdf",       pypdf_ok,  lambda: _parse_pypdf(pdf_path, settings)),
        ]

    for tier_name, available, fn in tier_order:
        if not available:
            errors.append({
                "tier":  tier_name,
                "error": "not available (library not installed)",
            })
            continue
        result_data = _attempt(tier_name, fn)
        if result_data is not None:
            parser_used = tier_name
            break

    if result_data is None:
        raise RuntimeError(
            "All parsing tiers failed.\n"
            "Install at least one of: pdfplumber, pymupdf, pypdf\n"
            "For GLM-OCR (Tier 1): pip install 'transformers>=5.3.0' torch pymupdf Pillow\n"
            "Errors:\n" + json.dumps(errors, indent=2)
        )

    elapsed = time.perf_counter() - t0
    return {
        "parser_used":         parser_used,
        "parser_version":      __version__,
        "settings_used":       asdict(settings),
        "available_parsers":   _available_libs_summary(),
        "metadata":            metadata,
        "pages":               result_data["pages"],
        "full_text":           result_data["full_text"],
        "full_markdown":       result_data["full_markdown"],
        "warnings":            result_data.get("warnings", []),
        "errors":              errors,
        "processing_time_sec": round(elapsed, 3),
    }


# ══════════════════════════════════════════════════════════════════════════════
# ██  CLI
# ══════════════════════════════════════════════════════════════════════════════

def _build_cli_parser():
    import argparse
    p = argparse.ArgumentParser(
        prog="pdf_parser",
        description=(
            "Zenith PDF Parser  -  GLM-OCR (in-process) + text-layer fallbacks.\n"
            "Tiers: glmocr/transformers -> pdfplumber -> pymupdf -> pypdf\n"
            "All tiers are fully local; no external server required."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("input", nargs="?", default=None,
                   help="Path to input PDF file")
    p.add_argument("-o", "--output", default=None,
                   help="Output file (.json or .md). Default: stdout.")
    p.add_argument("--format", choices=["json", "markdown", "text"], default="json",
                   help="Output format (default: json)")
    p.add_argument("--tier", default=None,
                   choices=["transformers", "pdfplumber", "pymupdf", "pypdf", "fallback"],
                   help="Force a specific parsing tier (default: auto)")
    p.add_argument("--pages", default=None,
                   help="Comma-separated 1-based page numbers, e.g. '1,2,5'")
    p.add_argument("--task",
                   choices=["auto", "text", "structured", "markdown"], default="auto",
                   help="GLM-OCR task mode (default: auto)")
    p.add_argument("--device", default="auto",
                   help="Torch device for GLM-OCR: auto|cpu|cuda|cuda:0|mps (default: auto)")
    p.add_argument("--dpi", type=int, default=150,
                   help="DPI for PDF-to-PNG rasterisation in GLM-OCR tier (default: 150)")
    p.add_argument("--max-tokens", type=int, default=8192,
                   help="Max new tokens per page in GLM-OCR tier (default: 8192)")
    p.add_argument("--model-id", default="zai-org/GLM-OCR",
                   help="HuggingFace model ID for GLM-OCR (default: zai-org/GLM-OCR)")
    p.add_argument("--no-tables",   action="store_true", help="Disable table extraction")
    p.add_argument("--no-formulas", action="store_true", help="Disable formula extraction")
    p.add_argument("--pretty",      action="store_true", help="Pretty-print JSON output")
    p.add_argument("--libs",        action="store_true",
                   help="Print available library status and exit")
    return p


def main():
    parser = _build_cli_parser()
    args   = parser.parse_args()

    if args.libs or args.input is None:
        if args.input is None and not args.libs:
            parser.print_help()
            return

        libs = _available_libs_summary()
        print("Available parsing libraries:")
        for k, v in libs.items():
            status = "[OK]  installed" if v else "[--]  NOT installed"
            print(f"  {k:<28} {status}")

        print()
        print("To enable Tier 1 (GLM-OCR in-process):")
        print('  pip install "transformers>=5.3.0" torch pymupdf Pillow')
        print('  python pdf_parser.py paper.pdf --tier transformers')
        print()
        print("Text-layer fallbacks (no GPU / model needed):")
        print('  pip install pdfplumber pymupdf pypdf')
        print('  python pdf_parser.py paper.pdf --tier fallback')
        return

    pages = None
    if args.pages:
        try:
            pages = [int(x.strip()) for x in args.pages.split(",") if x.strip()]
        except ValueError:
            print(f"Error: --pages must be comma-separated integers, got: {args.pages}",
                  file=sys.stderr)
            sys.exit(1)

    output_fmt = getattr(args, "format", "json")
    settings = PDFParserSettings(
        model_id=args.model_id,
        ocr_device=args.device,
        max_new_tokens=args.max_tokens,
        task_mode=args.task,
        dpi=args.dpi,
        extract_tables=not args.no_tables,
        extract_formulas=not args.no_formulas,
        pages=pages,
        force_tier=args.tier,
    )

    print(f"Parsing: {args.input}", file=sys.stderr)
    print(f"Settings: tier={args.tier or 'auto'}, task={args.task}, device={args.device}",
          file=sys.stderr)

    try:
        result = parse_pdf(args.input, settings)
    except Exception as exc:
        print(f"\nFATAL: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"Parser used: {result['parser_used']}  "
          f"({result['processing_time_sec']}s, "
          f"{len(result['pages'])} page(s))",
          file=sys.stderr)

    if result["warnings"]:
        for w in result["warnings"]:
            print(f"  Warning: {w}", file=sys.stderr)

    # ── Output ────────────────────────────────────────────────────────────────
    if output_fmt == "markdown":
        content = result["full_markdown"]
    elif output_fmt == "text":
        content = result["full_text"]
    else:
        indent  = 2 if args.pretty else None
        content = json.dumps(result, indent=indent, ensure_ascii=False)

    if args.output:
        out_path = Path(args.output)
        out_path.write_text(content, encoding="utf-8")
        print(f"Output written to: {out_path}", file=sys.stderr)
    else:
        sys.stdout.write(content)
        if not content.endswith("\n"):
            sys.stdout.write("\n")


if __name__ == "__main__":
    main()
