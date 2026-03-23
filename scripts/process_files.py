#!/usr/bin/env python3
"""Zenith file processing pipeline.
Usage: python process_files.py <action> <json_args>
Actions: compress_image, strip_exif, zip_files, zip_file, convert_webp,
         merge_pdf, compress_pdf, zip_encrypt, resize_image, split_file,
         smart_rename, smart_sort, ocr, auto_organize, translate_file,
         extract_palette, file_to_base64, ask_data, summarize_file,
         super_summary, generate_dashboard
Outputs JSON result to stdout.
"""
import sys, os, json, tempfile, zipfile, hashlib, shutil, subprocess, math

TEMP_DIR = os.path.join(tempfile.gettempdir(), "Zenith")
os.makedirs(TEMP_DIR, exist_ok=True)

# Global token usage accumulator for the current invocation
_usage_accumulator = {"input_tokens": 0, "output_tokens": 0, "provider": "", "model": ""}


def compress_image(args):
    """Compress image, optionally resize. Returns new path."""
    from PIL import Image
    path = args["path"]
    quality = args.get("quality", 80)
    max_dim = args.get("max_dimension", None)

    img = Image.open(path)
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGBA")
    else:
        img = img.convert("RGB")

    if max_dim:
        img.thumbnail((max_dim, max_dim), Image.LANCZOS)

    name = os.path.splitext(os.path.basename(path))[0]
    out = os.path.join(TEMP_DIR, f"{name}_compressed.webp")
    img.save(out, "WEBP", quality=quality, method=4)

    orig_size = os.path.getsize(path)
    new_size = os.path.getsize(out)
    return {"path": out, "original_size": orig_size, "new_size": new_size,
            "savings_pct": round((1 - new_size / orig_size) * 100, 1) if orig_size > 0 else 0}


def strip_exif(args):
    """Remove EXIF metadata from image. Returns new path."""
    from PIL import Image
    path = args["path"]
    img = Image.open(path)
    data = list(img.getdata())
    clean = Image.new(img.mode, img.size)
    clean.putdata(data)

    ext = os.path.splitext(path)[1].lower()
    name = os.path.splitext(os.path.basename(path))[0]
    out = os.path.join(TEMP_DIR, f"{name}_noexif{ext}")
    clean.save(out)
    return {"path": out}


def convert_webp(args):
    """Convert image to WebP format."""
    from PIL import Image
    path = args["path"]
    quality = args.get("quality", 85)
    img = Image.open(path)
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGBA")
    else:
        img = img.convert("RGB")
    name = os.path.splitext(os.path.basename(path))[0]
    out = os.path.join(TEMP_DIR, f"{name}.webp")
    img.save(out, "WEBP", quality=quality, method=4)
    return {"path": out, "size": os.path.getsize(out)}


def zip_files(args):
    """Bundle multiple files into a zip. Returns zip path."""
    paths = args["paths"]
    zip_name = args.get("name", "zenith_bundle")
    out = os.path.join(TEMP_DIR, f"{zip_name}.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in paths:
            if os.path.isfile(p):
                zf.write(p, os.path.basename(p))
            elif os.path.isdir(p):
                for root, _, files in os.walk(p):
                    for f in files:
                        fp = os.path.join(root, f)
                        arc = os.path.relpath(fp, os.path.dirname(p))
                        zf.write(fp, arc)
    return {"path": out, "size": os.path.getsize(out), "file_count": len(paths)}


def zip_encrypt(args):
    """Create a password-protected zip using 7z or pyminizip."""
    paths = args["paths"] if "paths" in args else [args["path"]]
    password = args.get("password", "")
    zip_name = args.get("name", "zenith_encrypted")
    out = os.path.join(TEMP_DIR, f"{zip_name}.zip")

    if not password:
        return {"error": "Password is required for encrypted zip"}

    # Try 7z first (best encryption support)
    seven_z = shutil.which("7z") or shutil.which("7za")
    if seven_z:
        cmd = [seven_z, "a", "-tzip", f"-p{password}", "-mem=AES256", out] + paths
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            return {"error": f"7z failed: {result.stderr}"}
        return {"path": out, "size": os.path.getsize(out), "encrypted": True}

    # Fallback: pyminizip
    try:
        import pyminizip
        flat_files = []
        for p in paths:
            if os.path.isfile(p):
                flat_files.append(p)
            elif os.path.isdir(p):
                for root, _, files in os.walk(p):
                    for f in files:
                        flat_files.append(os.path.join(root, f))
        prefixes = [""] * len(flat_files)
        pyminizip.compress_multiple(flat_files, prefixes, out, password, 5)
        return {"path": out, "size": os.path.getsize(out), "encrypted": True}
    except ImportError:
        pass

    return {"error": "No encryption tool found. Install 7-Zip or: pip install pyminizip"}


def merge_pdf(args):
    """Merge multiple PDF files into one."""
    paths = args["paths"]
    out_name = args.get("name", "merged")
    out = os.path.join(TEMP_DIR, f"{out_name}.pdf")

    try:
        from PyPDF2 import PdfMerger
        merger = PdfMerger()
        for p in paths:
            if p.lower().endswith(".pdf") and os.path.isfile(p):
                merger.append(p)
        if len(merger.pages) == 0:
            return {"error": "No valid PDF files to merge"}
        merger.write(out)
        merger.close()
        return {"path": out, "size": os.path.getsize(out), "page_count": len(merger.pages)}
    except ImportError:
        pass

    try:
        import pikepdf
        pdf = pikepdf.new()
        for p in paths:
            if p.lower().endswith(".pdf") and os.path.isfile(p):
                src = pikepdf.open(p)
                pdf.pages.extend(src.pages)
        if len(pdf.pages) == 0:
            return {"error": "No valid PDF files to merge"}
        page_count = len(pdf.pages)
        pdf.save(out)
        return {"path": out, "size": os.path.getsize(out), "page_count": page_count}
    except ImportError:
        pass

    return {"error": "No PDF library found. Install: pip install PyPDF2 or pip install pikepdf"}


def compress_pdf(args):
    """Compress a PDF file by rewriting it."""
    path = args["path"]
    out_name = os.path.splitext(os.path.basename(path))[0]
    out = os.path.join(TEMP_DIR, f"{out_name}_compressed.pdf")

    try:
        import pikepdf
        pdf = pikepdf.open(path)
        pdf.save(out, linearize=True, compress_streams=True,
                 object_stream_mode=pikepdf.ObjectStreamMode.generate)
        pdf.close()
        orig_size = os.path.getsize(path)
        new_size = os.path.getsize(out)
        return {"path": out, "original_size": orig_size, "new_size": new_size,
                "savings_pct": round((1 - new_size / orig_size) * 100, 1) if orig_size > 0 else 0}
    except ImportError:
        pass

    try:
        from PyPDF2 import PdfReader, PdfWriter
        reader = PdfReader(path)
        writer = PdfWriter()
        for page in reader.pages:
            page.compress_content_streams()
            writer.add_page(page)
        with open(out, "wb") as f:
            writer.write(f)
        orig_size = os.path.getsize(path)
        new_size = os.path.getsize(out)
        return {"path": out, "original_size": orig_size, "new_size": new_size,
                "savings_pct": round((1 - new_size / orig_size) * 100, 1) if orig_size > 0 else 0}
    except ImportError:
        pass

    return {"error": "No PDF library found. Install: pip install PyPDF2 or pip install pikepdf"}


def zip_file(args):
    """Zip a single file or folder (no encryption)."""
    path = args["path"]
    name = args.get("name", os.path.splitext(os.path.basename(path))[0])
    out = os.path.join(TEMP_DIR, f"{name}.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        if os.path.isfile(path):
            zf.write(path, os.path.basename(path))
        elif os.path.isdir(path):
            for root, _, files in os.walk(path):
                for f in files:
                    fp = os.path.join(root, f)
                    arc = os.path.relpath(fp, os.path.dirname(path))
                    zf.write(fp, arc)
    orig_size = os.path.getsize(path) if os.path.isfile(path) else sum(
        os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(path) for f in fs
    )
    new_size = os.path.getsize(out)
    return {"path": out, "original_size": orig_size, "new_size": new_size,
            "savings_pct": round((1 - new_size / orig_size) * 100, 1) if orig_size > 0 else 0}


def resize_image(args):
    """Resize image to exact width/height or by percentage."""
    from PIL import Image
    path = args["path"]
    width = args.get("width")
    height = args.get("height")
    percentage = args.get("percentage")
    maintain_aspect = args.get("maintain_aspect", True)

    img = Image.open(path)
    orig_w, orig_h = img.size

    if percentage:
        new_w = int(orig_w * percentage / 100)
        new_h = int(orig_h * percentage / 100)
    elif width and height and not maintain_aspect:
        new_w, new_h = int(width), int(height)
    elif width:
        ratio = int(width) / orig_w
        new_w = int(width)
        new_h = int(orig_h * ratio)
    elif height:
        ratio = int(height) / orig_h
        new_w = int(orig_w * ratio)
        new_h = int(height)
    else:
        return {"error": "Specify width, height, or percentage"}

    resized = img.resize((new_w, new_h), Image.LANCZOS)
    ext = os.path.splitext(path)[1].lower()
    name = os.path.splitext(os.path.basename(path))[0]
    out = os.path.join(TEMP_DIR, f"{name}_{new_w}x{new_h}{ext}")
    if resized.mode == "RGBA" and ext in (".jpg", ".jpeg"):
        resized = resized.convert("RGB")
    resized.save(out)
    return {"path": out, "width": new_w, "height": new_h,
            "original_width": orig_w, "original_height": orig_h}


def split_file(args):
    """Split a file into chunks of specified size (MB)."""
    path = args["path"]
    chunk_mb = args.get("chunk_size_mb", 25)
    chunk_size = int(chunk_mb * 1024 * 1024)
    file_size = os.path.getsize(path)

    if file_size <= chunk_size:
        return {"error": f"File is only {file_size / 1024 / 1024:.1f} MB, smaller than chunk size {chunk_mb} MB"}

    name = os.path.basename(path)
    num_parts = math.ceil(file_size / chunk_size)
    parts = []

    with open(path, "rb") as f:
        for i in range(num_parts):
            part_path = os.path.join(TEMP_DIR, f"{name}.part{i + 1:03d}")
            with open(part_path, "wb") as pf:
                pf.write(f.read(chunk_size))
            parts.append(part_path)

    return {"paths": parts, "part_count": num_parts,
            "chunk_size_mb": chunk_mb, "total_size": file_size}


def smart_rename(args):
    """Content-aware smart rename: extracts file 'soul' then generates 3 suggestions."""
    path = args["path"]
    api_key = args.get("api_key", "")
    provider = args.get("provider", "openai")
    model = args.get("model", "")
    naming_format = args.get("naming_format", "Date_Context_Detail")
    max_length = args.get("max_length", 60)
    date_prefix = args.get("date_prefix", False)

    if not api_key:
        return {"error": "API key required. Set it in Settings > API Keys."}

    name = os.path.basename(path)
    ext = os.path.splitext(name)[1].lower()
    file_size = os.path.getsize(path)

    # ── Step 1: Content Extraction (the "soul" of the file) ──
    file_context = ""
    context_method = "filename_only"

    image_exts = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp", ".tiff", ".tif", ".heic", ".svg"}
    code_exts = {".py", ".js", ".ts", ".tsx", ".jsx", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".rb", ".php", ".swift", ".kt", ".sh", ".bat", ".ps1"}
    text_exts = {".txt", ".md", ".log", ".rtf"}
    data_exts = {".csv", ".tsv", ".json", ".xml", ".yaml", ".yml", ".toml", ".ini", ".conf"}
    doc_exts = {".html", ".htm", ".tex", ".rst"}

    if ext in image_exts:
        # Vision model: send low-res base64 to LLM
        try:
            import base64
            with open(path, "rb") as f:
                raw = f.read(500_000)  # limit to 500KB
            img_b64 = base64.b64encode(raw).decode()
            mime = "image/png" if ext == ".png" else "image/jpeg"
            vision_result = _call_llm_vision(provider, api_key, model,
                "Describe this image in 2-3 sentences for file naming purposes. Focus on: subject, location, date if visible, key objects.",
                img_b64, mime)
            if "text" in vision_result:
                file_context = vision_result["text"][:500]
                context_method = "vision"
        except Exception:
            pass

    elif ext == ".pdf":
        # Extract first page text
        try:
            import pdfplumber
            with pdfplumber.open(path) as pdf:
                if pdf.pages:
                    file_context = (pdf.pages[0].extract_text() or "")[:1500]
                    context_method = "pdf_text"
        except ImportError:
            try:
                from PyPDF2 import PdfReader
                reader = PdfReader(path)
                if reader.pages:
                    file_context = (reader.pages[0].extract_text() or "")[:1500]
                    context_method = "pdf_text"
            except ImportError:
                pass

    elif ext in code_exts:
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                file_context = f.read(2000)
            context_method = "code_preview"
        except:
            pass

    elif ext in text_exts | data_exts | doc_exts:
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                file_context = f.read(2000)
            context_method = "text_preview"
        except:
            pass

    else:
        # Audio/Video: try to read EXIF/metadata via file header
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                file_context = f.read(500)
            context_method = "header_preview"
        except:
            pass

    # ── Step 2: LLM Prompt with format enforcement ──
    today = __import__("datetime").date.today().isoformat()
    sys_prompt = args.get("system_prompt",
        "You are an expert file organizer. Based on the file content provided, "
        "generate exactly 3 highly descriptive, concise filename stems (NO extension). "
        f"Use the naming format: {naming_format}. "
        f"Maximum {max_length} characters per name. "
        "Return STRICTLY a JSON array of 3 strings, nothing else.")

    content_block = ""
    if file_context:
        content_block = f"\nExtracted content ({context_method}):\n{file_context[:1200]}"

    full_prompt = (
        f"Current filename: {name}\n"
        f"File size: {file_size} bytes\n"
        f"Extension: {ext}\n"
        f"Today's date: {today}"
        f"{content_block}\n\n"
        f"Generate 3 filename suggestions (stems only, no extension). "
        f"Return as JSON array: [\"name1\", \"name2\", \"name3\"]"
    )
    if date_prefix:
        full_prompt += f"\nAlways prepend today's date ({today}) to each name."

    result = _call_llm(provider, api_key, model, full_prompt, system_prompt=sys_prompt)
    if "error" in result:
        return result

    # ── Step 3: Parse suggestions ──
    text = result["text"].strip()
    suggestions = []
    try:
        # Extract JSON array from response (handles markdown code blocks)
        if "```" in text:
            start = text.index("[")
            end = text.rindex("]") + 1
            text = text[start:end]
        elif text.startswith("["):
            pass
        else:
            # Try to find array in text
            start = text.index("[")
            end = text.rindex("]") + 1
            text = text[start:end]
        parsed = json.loads(text)
        if isinstance(parsed, list):
            suggestions = [str(s).strip().strip('"').strip("'")[:max_length] for s in parsed[:3]]
    except (json.JSONDecodeError, ValueError):
        # Fallback: treat entire response as single suggestion
        clean = text.strip().strip('"').strip("'").strip("[]")
        suggestions = [clean[:max_length]]

    if not suggestions:
        return {"error": "LLM returned no suggestions"}

    # Build full paths for each suggestion (extension always preserved by Rust)
    original_dir = os.path.dirname(path)
    results = []
    for stem in suggestions:
        full_name = stem + ext
        results.append({
            "stem": stem,
            "full_name": full_name,
            "new_path": os.path.join(original_dir, full_name)
        })

    return {
        "suggestions": results,
        "original_name": name,
        "original_stem": os.path.splitext(name)[0],
        "extension": ext,
        "context_method": context_method,
        "preview": True
    }


def smart_sort(args):
    """Use LLM to suggest categories/tags for files."""
    paths = args.get("paths", [args["path"]] if "path" in args else [])
    api_key = args.get("api_key", "")
    provider = args.get("provider", "openai")
    model = args.get("model", "")
    prompt = args.get("prompt", "Categorize these files into logical groups. Return JSON array of objects with 'file' and 'category' keys.")

    if not api_key:
        return {"error": "API key required. Set it in Settings > API Keys."}

    file_list = []
    for p in paths:
        name = os.path.basename(p)
        size = os.path.getsize(p) if os.path.isfile(p) else 0
        ext = os.path.splitext(name)[1]
        file_list.append(f"  - {name} ({size} bytes, {ext})")

    full_prompt = f"{prompt}\n\nFiles:\n" + "\n".join(file_list)
    sys_prompt = args.get("system_prompt", "")
    result = _call_llm(provider, api_key, model, full_prompt, system_prompt=sys_prompt)
    if "error" in result:
        return result

    try:
        categories = json.loads(result["text"])
        return {"categories": categories}
    except json.JSONDecodeError:
        return {"raw_response": result["text"]}


def ocr(args):
    """Extract text from images using LLM vision or Tesseract."""
    path = args["path"]
    api_key = args.get("api_key", "")
    provider = args.get("provider", "openai")
    model = args.get("model", "")
    prompt = args.get("prompt", "Extract all text from this image. Return only the extracted text, preserving layout where possible.")

    # Try Tesseract first (free, local)
    tesseract = shutil.which("tesseract")
    if tesseract and not api_key:
        try:
            result = subprocess.run(
                [tesseract, path, "stdout"],
                capture_output=True, text=True, timeout=30
            )
            if result.returncode == 0 and result.stdout.strip():
                text = result.stdout.strip()
                out = os.path.join(TEMP_DIR, os.path.splitext(os.path.basename(path))[0] + "_ocr.txt")
                with open(out, "w", encoding="utf-8") as f:
                    f.write(text)
                return {"text": text, "path": out, "engine": "tesseract"}
        except Exception:
            pass

    # Use LLM vision API
    if api_key:
        import base64
        with open(path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode()

        ext = os.path.splitext(path)[1].lower().lstrip(".")
        mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                "gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp"}.get(ext, "image/png")

        result = _call_llm_vision(provider, api_key, model, prompt, img_b64, mime)
        if "error" in result:
            return result

        text = result["text"]
        out = os.path.join(TEMP_DIR, os.path.splitext(os.path.basename(path))[0] + "_ocr.txt")
        with open(out, "w", encoding="utf-8") as f:
            f.write(text)
        return {"text": text, "path": out, "engine": provider}

    return {"error": "No OCR engine available. Install Tesseract or provide an API key in Settings."}


def _call_llm(provider, api_key, model, prompt, system_prompt=""):
    """Call an LLM text API. Returns {text, usage: {input_tokens, output_tokens}}."""
    import urllib.request, urllib.error

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    if provider == "openai":
        url = "https://api.openai.com/v1/chat/completions"
        mdl = model or "gpt-4.1-nano"
        payload = json.dumps({"model": mdl, "messages": messages,
                              "max_tokens": 4096, "temperature": 0.3}).encode()
        req = urllib.request.Request(url, data=payload, headers={
            "Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
    elif provider == "anthropic":
        url = "https://api.anthropic.com/v1/messages"
        mdl = model or "claude-sonnet-4-20250514"
        body = {"model": mdl, "max_tokens": 4096, "messages": messages}
        if system_prompt:
            body["system"] = system_prompt
            body["messages"] = [{"role": "user", "content": prompt}]
        payload = json.dumps(body).encode()
        req = urllib.request.Request(url, data=payload, headers={
            "x-api-key": api_key, "Content-Type": "application/json",
            "anthropic-version": "2023-06-01"})
    elif provider == "google":
        mdl = model or "gemini-2.5-flash"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{mdl}:generateContent?key={api_key}"
        contents = []
        if system_prompt:
            contents.append({"role": "user", "parts": [{"text": system_prompt}]})
            contents.append({"role": "model", "parts": [{"text": "Understood."}]})
        contents.append({"role": "user", "parts": [{"text": prompt}]})
        payload = json.dumps({"contents": contents}).encode()
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    elif provider == "deepseek":
        url = "https://api.deepseek.com/chat/completions"
        mdl = model or "deepseek-chat"
        payload = json.dumps({"model": mdl, "messages": messages,
                              "max_tokens": 4096, "temperature": 0.3}).encode()
        req = urllib.request.Request(url, data=payload, headers={
            "Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
    elif provider == "groq":
        url = "https://api.groq.com/openai/v1/chat/completions"
        mdl = model or "llama-3.3-70b-versatile"
        payload = json.dumps({"model": mdl, "messages": messages,
                              "max_tokens": 4096, "temperature": 0.3}).encode()
        req = urllib.request.Request(url, data=payload, headers={
            "Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
    else:
        return {"error": f"Unknown provider: {provider}"}

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())

        text = ""
        usage = {"input_tokens": 0, "output_tokens": 0}

        if provider in ("openai", "groq", "deepseek"):
            text = data["choices"][0]["message"]["content"]
            u = data.get("usage", {})
            usage = {"input_tokens": u.get("prompt_tokens", 0),
                     "output_tokens": u.get("completion_tokens", 0)}
        elif provider == "anthropic":
            text = data["content"][0]["text"]
            u = data.get("usage", {})
            usage = {"input_tokens": u.get("input_tokens", 0),
                     "output_tokens": u.get("output_tokens", 0)}
        elif provider == "google":
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            u = data.get("usageMetadata", {})
            usage = {"input_tokens": u.get("promptTokenCount", 0),
                     "output_tokens": u.get("candidatesTokenCount", 0)}

        _usage_accumulator["input_tokens"] += usage["input_tokens"]
        _usage_accumulator["output_tokens"] += usage["output_tokens"]
        _usage_accumulator["provider"] = provider
        _usage_accumulator["model"] = mdl

        return {"text": text, "usage": usage}
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        return {"error": f"API error {e.code}: {body[:200]}"}
    except Exception as e:
        return {"error": str(e)}


def auto_organize(args):
    """Use LLM to suggest file organization: rename + categorize into folders."""
    paths = args.get("paths", [])
    base_dir = args.get("base_dir", "")
    api_key = args.get("api_key", "")
    provider = args.get("provider", "openai")
    model = args.get("model", "")
    prompt = args.get("prompt", "")

    if not api_key:
        return {"error": "API key required. Set it in Settings > API Keys."}
    if not paths:
        return {"error": "No files to organize."}

    # Build file info list with content previews
    file_info = []
    text_exts = {".txt", ".md", ".log", ".csv", ".json", ".xml", ".html", ".py", ".js", ".ts"}
    for p in paths:
        name = os.path.basename(p)
        ext = os.path.splitext(name)[1].lower()
        size = os.path.getsize(p) if os.path.isfile(p) else 0
        preview = ""
        if ext in text_exts:
            try:
                with open(p, "r", encoding="utf-8", errors="ignore") as f:
                    preview = f.read(200).replace("\n", " ").strip()
            except:
                pass
        elif ext == ".pdf":
            try:
                import pdfplumber
                with pdfplumber.open(p) as pdf:
                    if pdf.pages:
                        preview = (pdf.pages[0].extract_text() or "")[:200]
            except:
                pass
        entry = f"  - {name} ({size}B, {ext})"
        if preview:
            entry += f" preview: {preview[:100]}"
        file_info.append(entry)

    default_prompt = (
        "You are a file organizer. Given the following files, suggest a clean organization.\n"
        "Return ONLY a JSON array of objects: [{\"old_path\": \"...\", \"new_name\": \"...\", \"folder\": \"...\"}]\n"
        "- 'folder' is a category subfolder name (e.g. 'Receipts', 'Photos', 'Documents')\n"
        "- 'new_name' is a descriptive filename (keep extension). If the name is already good, keep it.\n"
        "- Use clear, human-readable names. No underscores unless necessary."
    )
    full_prompt = (prompt or default_prompt) + "\n\nFiles:\n" + "\n".join(file_info)
    sys_prompt = args.get("system_prompt", "")
    result = _call_llm(provider, api_key, model, full_prompt, system_prompt=sys_prompt)
    if "error" in result:
        return result

    try:
        text = result["text"].strip()
        # Extract JSON from markdown code blocks if present
        if "```" in text:
            start = text.index("[", text.index("```"))
            end = text.rindex("]") + 1
            text = text[start:end]
        mapping = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return {"error": "LLM returned invalid JSON", "raw_response": result["text"]}

    # Build the actual move plan
    if not base_dir:
        base_dir = os.path.dirname(paths[0]) if paths else TEMP_DIR

    moves = []
    path_lookup = {os.path.basename(p): p for p in paths}
    for entry in mapping:
        old_name = os.path.basename(entry.get("old_path", ""))
        old_path = path_lookup.get(old_name)
        if not old_path:
            continue
        folder = entry.get("folder", "Unsorted")
        new_name = entry.get("new_name", old_name)
        dest_dir = os.path.join(base_dir, folder)
        new_path = os.path.join(dest_dir, new_name)
        moves.append({"old_path": old_path, "new_path": new_path, "folder": folder})

    return {"moves": moves, "preview": True}


def translate_file(args):
    """Translate text/PDF content to another language using LLM."""
    path = args["path"]
    target_lang = args.get("target_language", "Spanish")
    api_key = args.get("api_key", "")
    provider = args.get("provider", "openai")
    model = args.get("model", "")

    if not api_key:
        return {"error": "API key required. Set it in Settings > API Keys."}

    ext = os.path.splitext(path)[1].lower()
    text = ""

    if ext == ".pdf":
        try:
            import pdfplumber
            with pdfplumber.open(path) as pdf:
                text = "\n".join(page.extract_text() or "" for page in pdf.pages[:20])
        except ImportError:
            try:
                from PyPDF2 import PdfReader
                reader = PdfReader(path)
                text = "\n".join(page.extract_text() or "" for page in reader.pages[:20])
            except ImportError:
                return {"error": "Install pdfplumber or PyPDF2 for PDF translation"}
    else:
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read(50000)
        except:
            return {"error": "Cannot read file as text"}

    if not text.strip():
        return {"error": "No text content found in file"}

    # Chunk if very long
    max_chunk = 8000
    chunks = [text[i:i+max_chunk] for i in range(0, len(text), max_chunk)]
    translated_parts = []

    sys_prompt = args.get("system_prompt", "")
    for i, chunk in enumerate(chunks[:10]):
        prompt = f"Translate the following text to {target_lang}. Return ONLY the translated text, preserving formatting.\n\n{chunk}"
        result = _call_llm(provider, api_key, model, prompt, system_prompt=sys_prompt)
        if "error" in result:
            return result
        translated_parts.append(result["text"])

    translated = "\n".join(translated_parts)
    lang_code = target_lang[:2].upper()
    name = os.path.splitext(os.path.basename(path))[0]
    out = os.path.join(TEMP_DIR, f"{name}_{lang_code}.txt")
    with open(out, "w", encoding="utf-8") as f:
        f.write(translated)

    return {"path": out, "language": target_lang, "size": os.path.getsize(out)}


def extract_palette(args):
    """Extract dominant colors from an image using KMeans."""
    from PIL import Image
    path = args["path"]
    num_colors = args.get("num_colors", 5)

    img = Image.open(path).convert("RGB")
    # Downsample for speed
    img = img.resize((150, 150), Image.LANCZOS)
    pixels = list(img.getdata())

    # Simple KMeans without sklearn
    import random
    random.seed(42)
    centers = [list(pixels[random.randint(0, len(pixels)-1)]) for _ in range(num_colors)]

    for _ in range(15):
        clusters = [[] for _ in range(num_colors)]
        for px in pixels:
            dists = [sum((px[c] - centers[i][c])**2 for c in range(3)) for i in range(num_colors)]
            clusters[dists.index(min(dists))].append(px)
        for i in range(num_colors):
            if clusters[i]:
                centers[i] = [int(sum(c)/len(clusters[i])) for c in zip(*clusters[i])]

    colors = []
    for center in centers:
        r, g, b = center
        hex_color = f"#{r:02x}{g:02x}{b:02x}"
        # WCAG contrast ratio against white and black
        lum = 0.2126 * (r/255)**2.2 + 0.7152 * (g/255)**2.2 + 0.0722 * (b/255)**2.2
        contrast_white = (1.05) / (lum + 0.05) if lum < 1 else 1
        contrast_black = (lum + 0.05) / 0.05
        wcag_white = contrast_white >= 4.5
        wcag_black = contrast_black >= 4.5
        colors.append({
            "hex": hex_color, "rgb": [r, g, b],
            "wcag_on_white": wcag_white, "wcag_on_black": wcag_black
        })

    # Sort by luminance
    colors.sort(key=lambda c: sum(c["rgb"]), reverse=True)

    # Build tailwind config string
    tw = "colors: {\n" + "\n".join(f'  "{c["hex"].lstrip("#")}": "{c["hex"]}",' for c in colors) + "\n}"

    return {"colors": colors, "tailwind_config": tw}


def file_to_base64(args):
    """Convert file to base64 string in various formats."""
    import base64
    path = args["path"]
    fmt = args.get("format", "raw")  # raw, html_img, css_url

    with open(path, "rb") as f:
        data = f.read()

    ext = os.path.splitext(path)[1].lower().lstrip(".")

    # Minify SVG
    if ext == "svg":
        import re
        text = data.decode("utf-8", errors="ignore")
        text = re.sub(r'<!--.*?-->', '', text, flags=re.DOTALL)
        text = re.sub(r'>\s+<', '><', text)
        text = re.sub(r'\s+', ' ', text).strip()
        data = text.encode("utf-8")

    b64 = base64.b64encode(data).decode()
    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml",
            "ico": "image/x-icon", "bmp": "image/bmp"}.get(ext, "application/octet-stream")

    if fmt == "html_img":
        result = f'<img src="data:{mime};base64,{b64}" alt="{os.path.basename(path)}" />'
    elif fmt == "css_url":
        result = f'url("data:{mime};base64,{b64}")'
    else:
        result = b64

    return {"base64": result, "format": fmt, "size": len(data), "encoded_size": len(b64)}


def ask_data(args):
    """RAG-lite: chunk a document and answer a question using relevant chunks."""
    path = args["path"]
    question = args.get("question", "")
    api_key = args.get("api_key", "")
    provider = args.get("provider", "openai")
    model = args.get("model", "")

    if not api_key:
        return {"error": "API key required. Set it in Settings > API Keys."}
    if not question.strip():
        return {"error": "Please provide a question."}

    text = _extract_text(path)
    if not text:
        return {"error": "Could not extract text from file"}

    # Chunk the document
    chunks = _chunk_text(text, chunk_size=1500, overlap=200)

    # Simple keyword retrieval (no embeddings needed)
    q_words = set(question.lower().split())
    scored = []
    for i, chunk in enumerate(chunks):
        words = set(chunk.lower().split())
        overlap = len(q_words & words)
        scored.append((overlap, i, chunk))
    scored.sort(reverse=True)
    top_chunks = [c for _, _, c in scored[:5]]

    context = "\n---\n".join(f"[Chunk {i+1}]\n{c}" for i, c in enumerate(top_chunks))
    prompt = (
        f"Answer the following question based ONLY on the provided document chunks. "
        f"Cite which chunk(s) support your answer.\n\n"
        f"Question: {question}\n\nDocument chunks:\n{context}"
    )

    sys_prompt = args.get("system_prompt", "")
    result = _call_llm(provider, api_key, model, prompt, system_prompt=sys_prompt)
    if "error" in result:
        return result

    answer = result["text"]
    out = os.path.join(TEMP_DIR, os.path.splitext(os.path.basename(path))[0] + "_answer.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write(f"# Q: {question}\n\n{answer}\n")

    return {"answer": answer, "path": out, "chunks_used": len(top_chunks)}


def summarize_file(args):
    """Summarize a document with a TL;DR header."""
    path = args["path"]
    api_key = args.get("api_key", "")
    provider = args.get("provider", "openai")
    model = args.get("model", "")

    if not api_key:
        return {"error": "API key required. Set it in Settings > API Keys."}

    text = _extract_text(path)
    if not text:
        return {"error": "Could not extract text from file"}

    # For large docs, chunk and summarize each, then merge
    chunks = _chunk_text(text, chunk_size=4000, overlap=200)

    sys_prompt = args.get("system_prompt", "")
    if len(chunks) <= 3:
        # Small doc: summarize directly
        prompt = (
            "Provide a summary of the following document. Start with a single TL;DR sentence, "
            "then provide a detailed summary with key points.\n\n" + "\n".join(chunks)
        )
        result = _call_llm(provider, api_key, model, prompt, system_prompt=sys_prompt)
    else:
        # Large doc: summarize chunks, then merge
        chunk_summaries = []
        for i, chunk in enumerate(chunks[:15]):
            r = _call_llm(provider, api_key, model,
                          f"Summarize the following section concisely (section {i+1}/{min(len(chunks),15)}):\n\n{chunk}",
                          system_prompt=sys_prompt)
            if "error" in r:
                return r
            chunk_summaries.append(r["text"])

        merged = "\n\n".join(f"Section {i+1}: {s}" for i, s in enumerate(chunk_summaries))
        result = _call_llm(provider, api_key, model,
            f"Combine these section summaries into one cohesive summary. Start with TL;DR.\n\n{merged}",
            system_prompt=sys_prompt)

    if "error" in result:
        return result

    summary = result["text"]
    name = os.path.splitext(os.path.basename(path))[0]
    out = os.path.join(TEMP_DIR, f"{name}_summary.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write(f"# Summary: {os.path.basename(path)}\n\n{summary}\n")

    return {"summary": summary[:300], "path": out, "chunks_processed": len(chunks)}


def super_summary(args):
    """Multi-document cited summary with TL;DR."""
    paths = args.get("paths", [])
    api_key = args.get("api_key", "")
    provider = args.get("provider", "openai")
    model = args.get("model", "")

    if not api_key:
        return {"error": "API key required. Set it in Settings > API Keys."}
    if len(paths) < 2:
        return {"error": "Need at least 2 documents for super summary."}

    sys_prompt = args.get("system_prompt", "")
    doc_summaries = []
    for i, path in enumerate(paths[:10]):
        text = _extract_text(path)
        if not text:
            continue
        # Take first 3000 chars per doc
        truncated = text[:3000]
        name = os.path.basename(path)
        r = _call_llm(provider, api_key, model,
            f"Summarize this document concisely. This is Doc {i+1} titled '{name}'.\n\n{truncated}",
            system_prompt=sys_prompt)
        if "error" in r:
            return r
        doc_summaries.append(f"[Doc {i+1}: {name}]\n{r['text']}")

    if not doc_summaries:
        return {"error": "Could not extract text from any documents"}

    merged = "\n\n".join(doc_summaries)
    result = _call_llm(provider, api_key, model,
        f"Create an executive summary combining these document summaries. "
        f"Start with a single TL;DR paragraph. Use citations like [Doc 1, pg. 1] to reference sources. "
        f"Group related findings together.\n\n{merged}",
        system_prompt=sys_prompt)

    if "error" in result:
        return result

    out = os.path.join(TEMP_DIR, "super_summary.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write(f"# Executive Summary ({len(doc_summaries)} documents)\n\n{result['text']}\n")

    return {"summary": result["text"][:300], "path": out, "docs_processed": len(doc_summaries)}


def generate_dashboard(args):
    """Generate an interactive HTML dashboard from a CSV file using LLM."""
    import csv as csv_mod
    path = args["path"]
    api_key = args.get("api_key", "")
    provider = args.get("provider", "openai")
    model = args.get("model", "")

    if not api_key:
        return {"error": "API key required. Set it in Settings > API Keys."}

    ext = os.path.splitext(path)[1].lower()
    if ext not in (".csv", ".tsv"):
        return {"error": "Only CSV/TSV files are supported"}

    # Read headers and sample rows
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        delimiter = "\t" if ext == ".tsv" else ","
        reader = csv_mod.reader(f, delimiter=delimiter)
        rows = []
        for i, row in enumerate(reader):
            rows.append(row)
            if i >= 10:
                break

    if len(rows) < 2:
        return {"error": "CSV has no data rows"}

    headers = rows[0]
    sample = rows[1:]
    sample_text = "Headers: " + ", ".join(headers) + "\n"
    for row in sample:
        sample_text += ", ".join(row) + "\n"

    # Count total rows
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        total_rows = sum(1 for _ in f) - 1

    # Read all data for embedding in HTML
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        all_data = f.read(500000)  # cap at 500KB

    prompt = (
        f"Generate a SINGLE self-contained HTML file that creates an interactive dashboard for this CSV data.\n"
        f"Total rows: {total_rows}. Sample data:\n{sample_text}\n"
        f"Requirements:\n"
        f"- Use Chart.js from CDN for charts\n"
        f"- Use a clean, modern dark theme (dark bg, light text)\n"
        f"- Include a search/filter bar at the top\n"
        f"- Show 2-3 relevant charts based on the data types\n"
        f"- Include a sortable data table below the charts\n"
        f"- Add an 'Export PNG' button using html2canvas CDN\n"
        f"- Embed the CSV data as a JS variable inside the HTML\n"
        f"- The page must work offline once loaded\n"
        f"- Return ONLY the HTML code, no explanation"
    )

    sys_prompt = args.get("system_prompt", "")
    result = _call_llm(provider, api_key, model, prompt, system_prompt=sys_prompt)
    if "error" in result:
        return result

    html = result["text"].strip()
    # Extract HTML from code blocks if wrapped
    if html.startswith("```"):
        lines = html.split("\n")
        html = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    # Inject the actual data if LLM used placeholder
    if "REPLACE_WITH_DATA" in html or "YOUR_DATA_HERE" in html:
        escaped = all_data.replace("`", "\\`").replace("${", "\\${")
        html = html.replace("REPLACE_WITH_DATA", escaped).replace("YOUR_DATA_HERE", escaped)

    name = os.path.splitext(os.path.basename(path))[0]
    out = os.path.join(TEMP_DIR, f"{name}_dashboard.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)

    return {"path": out, "size": os.path.getsize(out), "rows": total_rows, "columns": len(headers)}


def _extract_text(path, max_chars=50000):
    """Extract text from PDF or text file."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        try:
            import pdfplumber
            with pdfplumber.open(path) as pdf:
                pages = []
                for page in pdf.pages:
                    t = page.extract_text()
                    if t:
                        pages.append(t)
                    if sum(len(p) for p in pages) > max_chars:
                        break
                return "\n".join(pages)[:max_chars]
        except ImportError:
            pass
        try:
            from PyPDF2 import PdfReader
            reader = PdfReader(path)
            pages = []
            for page in reader.pages:
                t = page.extract_text()
                if t:
                    pages.append(t)
                if sum(len(p) for p in pages) > max_chars:
                    break
            return "\n".join(pages)[:max_chars]
        except ImportError:
            pass
        return ""
    else:
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read(max_chars)
        except:
            return ""


def _chunk_text(text, chunk_size=1500, overlap=200):
    """Split text into overlapping chunks."""
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start = end - overlap
    return chunks


def _call_llm_vision(provider, api_key, model, prompt, img_b64, mime):
    """Call an LLM vision API with an image. Returns {text, usage}."""
    import urllib.request, urllib.error

    if provider == "openai":
        url = "https://api.openai.com/v1/chat/completions"
        mdl = model or "gpt-4.1-nano"
        payload = json.dumps({"model": mdl, "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{img_b64}"}}
        ]}], "max_tokens": 4096}).encode()
        req = urllib.request.Request(url, data=payload, headers={
            "Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
    elif provider == "anthropic":
        url = "https://api.anthropic.com/v1/messages"
        mdl = model or "claude-sonnet-4-20250514"
        payload = json.dumps({"model": mdl, "max_tokens": 4096,
                              "messages": [{"role": "user", "content": [
                                  {"type": "image", "source": {"type": "base64", "media_type": mime, "data": img_b64}},
                                  {"type": "text", "text": prompt}
                              ]}]}).encode()
        req = urllib.request.Request(url, data=payload, headers={
            "x-api-key": api_key, "Content-Type": "application/json",
            "anthropic-version": "2023-06-01"})
    elif provider == "google":
        mdl = model or "gemini-2.5-flash"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{mdl}:generateContent?key={api_key}"
        payload = json.dumps({"contents": [{"parts": [
            {"text": prompt},
            {"inline_data": {"mime_type": mime, "data": img_b64}}
        ]}]}).encode()
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    else:
        return {"error": f"Vision not supported for provider: {provider}"}

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())

        text = ""
        usage = {"input_tokens": 0, "output_tokens": 0}

        if provider == "openai":
            text = data["choices"][0]["message"]["content"]
            u = data.get("usage", {})
            usage = {"input_tokens": u.get("prompt_tokens", 0), "output_tokens": u.get("completion_tokens", 0)}
        elif provider == "anthropic":
            text = data["content"][0]["text"]
            u = data.get("usage", {})
            usage = {"input_tokens": u.get("input_tokens", 0), "output_tokens": u.get("output_tokens", 0)}
        elif provider == "google":
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            u = data.get("usageMetadata", {})
            usage = {"input_tokens": u.get("promptTokenCount", 0), "output_tokens": u.get("candidatesTokenCount", 0)}

        _usage_accumulator["input_tokens"] += usage["input_tokens"]
        _usage_accumulator["output_tokens"] += usage["output_tokens"]
        _usage_accumulator["provider"] = provider
        _usage_accumulator["model"] = mdl

        return {"text": text, "usage": usage}
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        return {"error": f"Vision API error {e.code}: {body[:200]}"}
    except Exception as e:
        return {"error": str(e)}


def _vt_parse_report(data, scan_type, identifier):
    """Parse a VT API v3 response into a rich result dict for the GUI."""
    attrs = data.get("data", {}).get("attributes", {})
    stats = attrs.get("last_analysis_stats", {})
    results = attrs.get("last_analysis_results", {})
    malicious = stats.get("malicious", 0) + stats.get("suspicious", 0)
    total = sum(stats.values()) if stats else 0
    verdict = "malicious" if malicious > 0 else "safe"

    # Build per-engine detections list (only flagged engines)
    detections = []
    for eng_name, eng_data in results.items():
        cat = eng_data.get("category", "")
        if cat in ("malicious", "suspicious"):
            detections.append({
                "engine": eng_name,
                "category": cat,
                "result": eng_data.get("result", ""),
                "version": eng_data.get("engine_version", ""),
            })
    detections.sort(key=lambda d: d["engine"])

    report = {
        "scan_type": scan_type,
        "verdict": verdict,
        "malicious": malicious,
        "total": total,
        "stats": stats,
        "detections": detections,
    }

    if scan_type == "file":
        report["hash"] = identifier
        report["sha1"] = attrs.get("sha1", "")
        report["md5"] = attrs.get("md5", "")
        report["file_type"] = attrs.get("type_description", "")
        report["file_size"] = attrs.get("size", 0)
        report["names"] = attrs.get("names", [])[:5]
        report["tags"] = attrs.get("tags", [])[:10]
        report["reputation"] = attrs.get("reputation", 0)
        votes = attrs.get("total_votes", {})
        report["community_votes"] = {"harmless": votes.get("harmless", 0), "malicious": votes.get("malicious", 0)}
        report["last_analysis_date"] = attrs.get("last_analysis_date", 0)
        report["first_submission_date"] = attrs.get("first_submission_date", 0)
        report["magic"] = attrs.get("magic", "")
    else:
        report["url"] = identifier
        report["last_final_url"] = attrs.get("last_final_url", identifier)
        report["title"] = attrs.get("title", "")
        report["last_analysis_date"] = attrs.get("last_analysis_date", 0)
        cats = attrs.get("categories", {})
        report["categories"] = list(set(cats.values()))[:5] if cats else []
        report["reputation"] = attrs.get("reputation", 0)
        votes = attrs.get("total_votes", {})
        report["community_votes"] = {"harmless": votes.get("harmless", 0), "malicious": votes.get("malicious", 0)}

    return report


def scan_virustotal(args):
    """Scan a file hash or URL via the VirusTotal API v3."""
    import urllib.request, urllib.error, hashlib
    vt_key = args.get("vt_api_key", "")
    if not vt_key:
        return {"error": "VirusTotal API key required. Add it in Settings > API Keys."}

    path = args.get("path", "")
    url = args.get("url", "")

    headers = {"x-apikey": vt_key}

    if path and os.path.isfile(path):
        # File scan: compute SHA-256 and look up the hash
        sha256 = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                sha256.update(chunk)
        file_hash = sha256.hexdigest()
        api_url = f"https://www.virustotal.com/api/v3/files/{file_hash}"
        try:
            req = urllib.request.Request(api_url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
            return _vt_parse_report(data, "file", file_hash)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"scan_type": "file", "hash": file_hash, "verdict": "unknown",
                        "message": "File not found in VirusTotal database. Upload it at virustotal.com for analysis."}
            return {"error": f"VirusTotal API error {e.code}"}
        except Exception as e:
            return {"error": str(e)}

    elif url:
        # URL scan: look up URL report, submit if not found
        import base64 as b64mod
        url_id = b64mod.urlsafe_b64encode(url.encode()).decode().rstrip("=")
        api_url = f"https://www.virustotal.com/api/v3/urls/{url_id}"
        try:
            req = urllib.request.Request(api_url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
            return _vt_parse_report(data, "url", url)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                # URL not yet scanned — submit it
                try:
                    submit_data = urllib.parse.urlencode({"url": url}).encode()
                    submit_req = urllib.request.Request(
                        "https://www.virustotal.com/api/v3/urls",
                        data=submit_data, headers={**headers, "Content-Type": "application/x-www-form-urlencoded"})
                    with urllib.request.urlopen(submit_req, timeout=30) as resp:
                        json.loads(resp.read().decode())
                    return {"scan_type": "url", "url": url, "verdict": "submitted",
                            "message": "URL submitted for analysis. Re-scan in a minute for results."}
                except Exception as ex:
                    return {"error": f"Failed to submit URL: {ex}"}
            return {"error": f"VirusTotal API error {e.code}"}
        except Exception as e:
            return {"error": str(e)}
    else:
        return {"error": "No file path or URL provided for scanning."}


def url_to_qr(args):
    """Generate a QR code PNG from a URL string."""
    url = args.get("url", "")
    if not url:
        return {"error": "No URL provided."}

    try:
        import qrcode
    except ImportError:
        # Fallback: generate QR using a minimal pure-python approach
        # Use the qrcode library if available, otherwise error
        return {"error": "Python 'qrcode' package not installed. Run: pip install qrcode[pil]"}

    img = qrcode.make(url)
    name = url.replace("https://", "").replace("http://", "").replace("/", "_")[:40]
    out = os.path.join(TEMP_DIR, f"qr_{name}.png")
    img.save(out)
    return {"path": out, "url": url}


def ocr_to_pdf(args):
    """Convert an image to a searchable PDF using OCR."""
    path = args["path"]
    ext = os.path.splitext(path)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp", ".gif"):
        return {"error": f"Not an image file: {ext}"}

    # Try pytesseract first
    try:
        import pytesseract
        from PIL import Image as PILImage
    except ImportError:
        return {"error": "pytesseract and Pillow are required. Run: pip install pytesseract Pillow"}

    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfgen import canvas as rl_canvas
        from reportlab.lib.utils import ImageReader
    except ImportError:
        return {"error": "reportlab is required. Run: pip install reportlab"}

    img = PILImage.open(path)
    img_w, img_h = img.size

    # Get OCR data with bounding boxes
    ocr_data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)

    # Create PDF with image + invisible text overlay
    name = os.path.splitext(os.path.basename(path))[0]
    out = os.path.join(TEMP_DIR, f"{name}_searchable.pdf")

    # Scale image to fit letter page
    page_w, page_h = letter
    scale = min(page_w / img_w, page_h / img_h)
    scaled_w = img_w * scale
    scaled_h = img_h * scale
    x_off = (page_w - scaled_w) / 2
    y_off = page_h - scaled_h  # top-align

    c = rl_canvas.Canvas(out, pagesize=letter)
    c.drawImage(ImageReader(path), x_off, y_off, width=scaled_w, height=scaled_h)

    # Overlay invisible text
    c.setFillAlpha(0)  # Invisible text
    n_boxes = len(ocr_data["text"])
    for i in range(n_boxes):
        text = ocr_data["text"][i].strip()
        if not text:
            continue
        x = ocr_data["left"][i] * scale + x_off
        # PDF y-axis is bottom-up, OCR is top-down
        y = page_h - (ocr_data["top"][i] + ocr_data["height"][i]) * scale
        font_size = max(ocr_data["height"][i] * scale * 0.8, 4)
        try:
            c.setFont("Helvetica", font_size)
            c.drawString(x, y, text)
        except:
            pass

    c.save()
    word_count = sum(1 for t in ocr_data["text"] if t.strip())
    return {"path": out, "words": word_count, "original": os.path.basename(path)}


def pdf_to_csv(args):
    """Extract structured data from PDF invoices/forms to CSV using LLM."""
    path = args.get("path", "")
    paths = args.get("paths", [path] if path else [])
    api_key = args.get("api_key", "")
    provider = args.get("provider", "openai")
    model = args.get("model", "")

    if not api_key:
        return {"error": "API key required. Set it in Settings > API Keys."}
    if not paths:
        return {"error": "No PDF files provided."}

    try:
        import pdfplumber
    except ImportError:
        return {"error": "pdfplumber required. Run: pip install pdfplumber"}

    # Extract text from all PDFs
    all_texts = []
    for p in paths[:10]:
        try:
            with pdfplumber.open(p) as pdf:
                text = "\n".join(page.extract_text() or "" for page in pdf.pages[:20])
                if text.strip():
                    all_texts.append({"file": os.path.basename(p), "text": text[:5000]})
        except Exception as e:
            all_texts.append({"file": os.path.basename(p), "text": f"[Error reading: {e}]"})

    if not all_texts:
        return {"error": "Could not extract text from any PDFs."}

    # Ask LLM to extract structured data
    docs_preview = "\n\n".join(
        f"=== {d['file']} ===\n{d['text'][:3000]}" for d in all_texts
    )
    prompt = (
        "Extract structured data from these PDF documents into a flat CSV format.\n"
        "Rules:\n"
        "- Identify the best column headers from the content (e.g. Date, Vendor, Amount, Description, Invoice#).\n"
        "- Return ONLY valid CSV text (comma-separated, with header row first).\n"
        "- One row per document/invoice/record found.\n"
        "- If a field is missing or unclear, use 'N/A'.\n"
        "- Do NOT include markdown code fences or explanation.\n\n"
        f"Documents:\n{docs_preview}"
    )
    sys_prompt = args.get("system_prompt", "")
    result = _call_llm(provider, api_key, model, prompt, system_prompt=sys_prompt)
    if "error" in result:
        return result

    csv_text = result["text"].strip()
    # Strip markdown code fences if present
    if csv_text.startswith("```"):
        lines = csv_text.split("\n")
        csv_text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

    out = os.path.join(TEMP_DIR, "extracted_data.csv")
    with open(out, "w", encoding="utf-8") as f:
        f.write(csv_text)

    # Count rows and check for N/A fields
    rows = [r for r in csv_text.strip().split("\n") if r.strip()]
    has_missing = "N/A" in csv_text
    return {"path": out, "rows": len(rows) - 1, "has_missing_fields": has_missing,
            "docs_processed": len(all_texts)}


def convert_media(args):
    """Convert media files using FFmpeg (e.g. .mov to .mp4, .wav to .mp3)."""
    import subprocess
    path = args["path"]
    output_format = args.get("output_format", "mp4")
    if not os.path.isfile(path):
        return {"error": f"File not found: {path}"}

    base = os.path.splitext(os.path.basename(path))[0]
    out_dir = os.path.join(tempfile.gettempdir(), "Zenith")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"{base}.{output_format}")

    # Find ffmpeg
    ffmpeg = "ffmpeg"
    for candidate in [
        os.path.join(os.environ.get("ProgramFiles", ""), "ffmpeg", "bin", "ffmpeg.exe"),
        os.path.join(os.environ.get("ProgramFiles(x86)", ""), "ffmpeg", "bin", "ffmpeg.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "ffmpeg", "bin", "ffmpeg.exe"),
    ]:
        if os.path.isfile(candidate):
            ffmpeg = candidate
            break

    cmd = [ffmpeg, "-y", "-i", path]
    # Format-specific encoding flags
    if output_format == "mp4":
        cmd += ["-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", "-b:a", "128k"]
    elif output_format == "mp3":
        cmd += ["-vn", "-c:a", "libmp3lame", "-b:a", "192k"]
    elif output_format == "wav":
        cmd += ["-vn", "-c:a", "pcm_s16le"]
    elif output_format == "webm":
        cmd += ["-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-c:a", "libopus"]
    elif output_format == "gif":
        cmd += ["-vf", "fps=15,scale=480:-1:flags=lanczos", "-loop", "0"]
    # else: let ffmpeg figure it out from extension
    cmd.append(out)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            stderr = result.stderr[-500:] if len(result.stderr) > 500 else result.stderr
            return {"error": f"FFmpeg failed: {stderr}"}
        return {"path": out, "format": output_format, "size": os.path.getsize(out),
                "original_size": os.path.getsize(path)}
    except FileNotFoundError:
        return {"error": "FFmpeg not found. Install FFmpeg and add it to PATH."}
    except subprocess.TimeoutExpired:
        return {"error": "Conversion timed out (5 min limit)."}


ACTIONS = {
    "compress_image": compress_image,
    "strip_exif": strip_exif,
    "convert_webp": convert_webp,
    "zip_files": zip_files,
    "zip_file": zip_file,
    "zip_encrypt": zip_encrypt,
    "merge_pdf": merge_pdf,
    "compress_pdf": compress_pdf,
    "resize_image": resize_image,
    "split_file": split_file,
    "smart_rename": smart_rename,
    "smart_sort": smart_sort,
    "ocr": ocr,
    "auto_organize": auto_organize,
    "translate_file": translate_file,
    "extract_palette": extract_palette,
    "file_to_base64": file_to_base64,
    "ask_data": ask_data,
    "summarize_file": summarize_file,
    "super_summary": super_summary,
    "generate_dashboard": generate_dashboard,
    "scan_virustotal": scan_virustotal,
    "url_to_qr": url_to_qr,
    "ocr_to_pdf": ocr_to_pdf,
    "pdf_to_csv": pdf_to_csv,
    "convert_media": convert_media,
}

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: process_files.py <action> <json_args>"}))
        sys.exit(1)

    action = sys.argv[1]
    try:
        args = json.loads(sys.argv[2])
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON: {e}"}))
        sys.exit(1)

    if action not in ACTIONS:
        print(json.dumps({"error": f"Unknown action: {action}. Available: {list(ACTIONS.keys())}"}))
        sys.exit(1)

    try:
        result = ACTIONS[action](args)
        output = {"ok": True, **result}
        if _usage_accumulator["input_tokens"] > 0 or _usage_accumulator["output_tokens"] > 0:
            output["token_usage"] = {
                "input_tokens": _usage_accumulator["input_tokens"],
                "output_tokens": _usage_accumulator["output_tokens"],
                "provider": _usage_accumulator["provider"],
                "model": _usage_accumulator["model"],
            }
        print(json.dumps(output))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)
