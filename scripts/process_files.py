#!/usr/bin/env python3
"""Zenith file processing pipeline.
Usage: python process_files.py <action> <json_args>
Actions: compress_image, strip_exif, zip_files, zip_file, convert_webp,
         merge_pdf, compress_pdf, zip_encrypt, resize_image, split_file,
         smart_rename, smart_sort, ocr, auto_organize, translate_file,
         extract_palette, file_to_base64, ask_data, summarize_file,
         super_summary, generate_dashboard, generate_image, enhance_prompt,
         auto_title_prompt, save_editor_image, reset_editor
Outputs JSON result to stdout.
"""
import sys, os, json, tempfile, zipfile, shutil, subprocess, math

# Force UTF-8 on Windows (stdin/stdout default to system codepage otherwise)
if sys.platform == "win32":
    sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

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


def show_exif(args):
    """Read and return EXIF/metadata from an image without removing it."""
    from PIL import Image
    from PIL.ExifTags import TAGS, GPSTAGS
    path = args["path"]
    img = Image.open(path)
    info = {"format": img.format, "mode": img.mode, "size": list(img.size)}
    exif_data = {}
    raw_exif = img.getexif()
    if raw_exif:
        for tag_id, value in raw_exif.items():
            tag_name = TAGS.get(tag_id, str(tag_id))
            try:
                if isinstance(value, bytes):
                    value = value.hex()[:64] + "..." if len(value) > 32 else value.hex()
                elif hasattr(value, "numerator"):
                    value = f"{value.numerator}/{value.denominator}"
                else:
                    value = str(value)
                exif_data[tag_name] = value
            except Exception:
                exif_data[tag_name] = str(value)[:200]
        # GPS sub-IFD
        gps_ifd = raw_exif.get_ifd(0x8825)
        if gps_ifd:
            gps = {}
            for k, v in gps_ifd.items():
                gps[GPSTAGS.get(k, str(k))] = str(v)
            if gps:
                exif_data["GPS"] = gps
    info["exif"] = exif_data
    info["has_exif"] = len(exif_data) > 0
    return info


def convert_image(args):
    """Convert image between formats (PNG, JPG, WebP, BMP, TIFF, GIF) with quality control."""
    from PIL import Image
    path = args["path"]
    target_format = args.get("format", "png").lower()
    quality = args.get("quality", 85)

    FORMAT_MAP = {
        "png": ("PNG", ".png"),
        "jpg": ("JPEG", ".jpg"),
        "jpeg": ("JPEG", ".jpg"),
        "webp": ("WEBP", ".webp"),
        "bmp": ("BMP", ".bmp"),
        "tiff": ("TIFF", ".tiff"),
        "gif": ("GIF", ".gif"),
        "ico": ("ICO", ".ico"),
    }
    if target_format not in FORMAT_MAP:
        return {"error": f"Unsupported format: {target_format}. Supported: {list(FORMAT_MAP.keys())}"}

    pil_format, ext = FORMAT_MAP[target_format]
    img = Image.open(path)

    # Handle transparency
    if target_format in ("jpg", "jpeg", "bmp") and img.mode in ("RGBA", "LA", "PA"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "RGBA":
            bg.paste(img, mask=img.split()[3])
        else:
            bg.paste(img)
        img = bg
    elif target_format in ("png", "webp", "gif", "tiff") and img.mode == "P":
        img = img.convert("RGBA")
    elif img.mode not in ("RGB", "RGBA", "L"):
        img = img.convert("RGB")

    name = os.path.splitext(os.path.basename(path))[0]
    out = os.path.join(TEMP_DIR, f"{name}_converted{ext}")

    save_kwargs = {}
    if pil_format in ("JPEG", "WEBP"):
        save_kwargs["quality"] = quality
    if pil_format == "WEBP":
        save_kwargs["method"] = 4
    if pil_format == "PNG":
        save_kwargs["optimize"] = True

    img.save(out, pil_format, **save_kwargs)
    orig_size = os.path.getsize(path)
    new_size = os.path.getsize(out)
    return {
        "path": out, "format": target_format, "width": img.size[0], "height": img.size[1],
        "original_size": orig_size, "new_size": new_size,
        "savings_pct": round((1 - new_size / orig_size) * 100, 1) if orig_size > 0 else 0,
    }


def save_palette_image(args):
    """Save extracted color palette as a swatch image."""
    from PIL import Image, ImageDraw, ImageFont
    colors = args.get("colors", [])
    if not colors:
        return {"error": "No colors provided"}

    swatch_w, swatch_h = 80, 100
    padding = 10
    width = padding + len(colors) * (swatch_w + padding)
    height = swatch_h + padding * 3 + 20
    img = Image.new("RGB", (width, height), (30, 30, 30))
    draw = ImageDraw.Draw(img)

    for i, c in enumerate(colors):
        hex_color = c if isinstance(c, str) else c.get("hex", "#000000")
        r_val = int(hex_color[1:3], 16)
        g_val = int(hex_color[3:5], 16)
        b_val = int(hex_color[5:7], 16)
        x = padding + i * (swatch_w + padding)
        y = padding
        draw.rounded_rectangle([x, y, x + swatch_w, y + swatch_h], radius=8, fill=(r_val, g_val, b_val))
        # Hex label below
        draw.text((x + swatch_w // 2, y + swatch_h + 8), hex_color, fill=(200, 200, 200), anchor="mt")

    name = args.get("name", "palette")
    out = os.path.join(TEMP_DIR, f"{name}_palette.png")
    img.save(out, "PNG")
    return {"path": out, "color_count": len(colors)}


def ocr_save_text(args):
    """Run OCR (LLM vision or Tesseract) and save result as .txt file."""
    # Reuse the existing ocr function
    result = ocr(args)
    if "error" in result:
        return result
    text = result.get("text", "")
    if not text:
        return {"error": "OCR produced no text"}

    name = os.path.splitext(os.path.basename(args["path"]))[0]
    out = os.path.join(TEMP_DIR, f"{name}_ocr.txt")
    with open(out, "w", encoding="utf-8") as f:
        f.write(text)
    return {"path": out, "text": text, "words": len(text.split())}


def email_draft(args):
    """Use LLM to draft email subject and body for file attachment."""
    path = args.get("path", "")
    filename = os.path.basename(path) if path else args.get("filename", "file")
    api_key = args.get("api_key", "")
    provider = args.get("provider", "")
    model = args.get("model", "")
    if not api_key:
        return {"subject": f"Sending: {filename}", "body": f"Hi,\n\nPlease find attached: {filename}\n\nBest regards"}

    prompt = f"Draft a short professional email for sending a file attachment named '{filename}'. Return JSON with 'subject' and 'body' keys only. Keep it brief and professional."
    try:
        resp = _call_llm(api_key, provider, model, prompt, "You are a professional email assistant. Return only valid JSON.")
        import re
        json_match = re.search(r'\{[^}]+\}', resp, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group())
            return {"subject": data.get("subject", f"Sending: {filename}"), "body": data.get("body", f"Attached: {filename}")}
    except Exception:
        pass
    return {"subject": f"Sending: {filename}", "body": f"Hi,\n\nPlease find attached: {filename}\n\nBest regards"}


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
    """Zip a single file or folder. Supports compression_level (1=fast, 9=best)."""
    path = args["path"]
    name = args.get("name", os.path.splitext(os.path.basename(path))[0])
    compression_level = int(args.get("compression_level", 6))  # 1-9
    fmt = args.get("format", "zip").lower()
    password = args.get("password", "")

    # Route to 7z if format is 7z or password requested
    if fmt == "7z" or (password and fmt in ("7z",)):
        seven_z = shutil.which("7z") or shutil.which("7za")
        if seven_z:
            out = os.path.join(TEMP_DIR, f"{name}.7z")
            cmd = [seven_z, "a", f"-mx={compression_level}", out, path]
            if password:
                cmd += [f"-p{password}", "-mhe=on"]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                return {"error": f"7z failed: {result.stderr[:200]}"}
            orig_size = os.path.getsize(path) if os.path.isfile(path) else sum(
                os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(path) for f in fs)
            new_size = os.path.getsize(out)
            return {"path": out, "original_size": orig_size, "new_size": new_size, "format": "7z",
                    "savings_pct": round((1 - new_size / orig_size) * 100, 1) if orig_size > 0 else 0}

    # Default: zip
    out = os.path.join(TEMP_DIR, f"{name}.zip")
    compress = zipfile.ZIP_DEFLATED
    with zipfile.ZipFile(out, "w", compress, compresslevel=compression_level) as zf:
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
    return {"path": out, "original_size": orig_size, "new_size": new_size, "format": "zip",
            "savings_pct": round((1 - new_size / orig_size) * 100, 1) if orig_size > 0 else 0}


def resize_image(args):
    """Resize image to exact width/height or by percentage. Supports fill_color for canvas padding."""
    from PIL import Image
    path = args["path"]
    width = args.get("width")
    height = args.get("height")
    percentage = args.get("percentage")
    maintain_aspect = args.get("maintain_aspect", True)
    fill_color = args.get("fill_color", None)  # hex string e.g. "#ffffff"

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

    # If both W and H specified with a fill color and aspect ratio changes, pad the canvas
    if fill_color and width and height and not maintain_aspect:
        target_w, target_h = int(width), int(height)
        orig_ratio = orig_w / orig_h
        target_ratio = target_w / target_h

        if abs(orig_ratio - target_ratio) > 0.01:
            # Scale image to fit within target bounds
            if orig_ratio > target_ratio:
                scale_w = target_w
                scale_h = int(target_w / orig_ratio)
            else:
                scale_h = target_h
                scale_w = int(target_h * orig_ratio)

            resized = img.resize((scale_w, scale_h), Image.LANCZOS)

            # Parse hex fill color
            try:
                hex_c = fill_color.lstrip("#")
                fill_rgb = tuple(int(hex_c[i:i+2], 16) for i in (0, 2, 4))
            except Exception:
                fill_rgb = (255, 255, 255)

            canvas_mode = "RGBA" if img.mode == "RGBA" else "RGB"
            if canvas_mode == "RGBA":
                canvas = Image.new("RGBA", (target_w, target_h), (*fill_rgb, 255))
            else:
                canvas = Image.new("RGB", (target_w, target_h), fill_rgb)

            offset_x = (target_w - scale_w) // 2
            offset_y = (target_h - scale_h) // 2
            if canvas_mode == "RGBA":
                canvas.paste(resized, (offset_x, offset_y), resized if resized.mode == "RGBA" else None)
            else:
                canvas.paste(resized, (offset_x, offset_y))

            new_w, new_h = target_w, target_h
            resized = canvas
        else:
            resized = img.resize((target_w, target_h), Image.LANCZOS)
            new_w, new_h = target_w, target_h
    else:
        resized = img.resize((new_w, new_h), Image.LANCZOS)

    ext = os.path.splitext(path)[1].lower()
    name = os.path.splitext(os.path.basename(path))[0]
    out = os.path.join(TEMP_DIR, f"{name}_{new_w}x{new_h}{ext}")
    if resized.mode == "RGBA" and ext in (".jpg", ".jpeg"):
        resized = resized.convert("RGB")
    resized.save(out)
    return {"path": out, "width": new_w, "height": new_h,
            "original_width": orig_w, "original_height": orig_h,
            "fill_used": fill_color is not None}


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
    """Convert file to base64 string in various formats. Optionally save as .txt file."""
    import base64
    path = args["path"]
    fmt = args.get("format", "raw")  # raw, html_img, css_url
    save_as_txt = args.get("save_as_txt", False)

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

    txt_path = None
    if save_as_txt:
        name = os.path.splitext(os.path.basename(path))[0]
        txt_path = os.path.join(TEMP_DIR, f"{name}.b64.txt")
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(result)

    return {"base64": result, "format": fmt, "size": len(data), "encoded_size": len(b64),
            "txt_path": txt_path}


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


def _vt_api_get(api_url, headers, timeout=30):
    """Helper: GET a VT API v3 endpoint. Returns (data_dict, None) or (None, error_dict)."""
    import urllib.request, urllib.error
    try:
        req = urllib.request.Request(api_url, headers={**headers, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode()), None
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode()
        except Exception:
            pass
        if e.code == 401:
            return None, {"error": "Invalid VirusTotal API key. Check Settings > API Keys."}
        if e.code == 403:
            return None, {"error": "VirusTotal API: forbidden. Your key may lack permissions or quota is exceeded."}
        if e.code == 404:
            return None, {"_not_found": True}
        if e.code == 429:
            return None, {"error": "VirusTotal API rate limit reached. Wait a minute and try again."}
        return None, {"error": f"VirusTotal API HTTP {e.code}: {body[:200]}"}
    except Exception as e:
        return None, {"error": f"VirusTotal request failed: {e}"}


def _vt_upload_file(path, headers):
    """Upload a file to VT via POST /files (multipart/form-data). Returns analysis_id or error."""
    import urllib.request, urllib.error
    file_size = os.path.getsize(path)
    filename = os.path.basename(path)

    # For files > 32MB, get a special upload URL
    upload_url = "https://www.virustotal.com/api/v3/files"
    if file_size > 32 * 1024 * 1024:
        data, err = _vt_api_get("https://www.virustotal.com/api/v3/files/upload_url", headers)
        if err:
            return None, err
        upload_url = data.get("data", "")
        if not upload_url:
            return None, {"error": "Failed to get upload URL for large file."}

    # Build multipart/form-data body
    boundary = f"----ZenithVTBoundary{os.urandom(8).hex()}"
    with open(path, "rb") as f:
        file_data = f.read()

    body = (
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode() + file_data + f"\r\n--{boundary}--\r\n".encode()

    try:
        req = urllib.request.Request(
            upload_url, data=body,
            headers={**headers, "Content-Type": f"multipart/form-data; boundary={boundary}",
                     "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode())
        analysis_id = result.get("data", {}).get("id", "")
        if not analysis_id:
            return None, {"error": "Upload succeeded but no analysis ID returned."}
        return analysis_id, None
    except urllib.error.HTTPError as e:
        body_text = ""
        try:
            body_text = e.read().decode()[:200]
        except Exception:
            pass
        if e.code == 413:
            return None, {"error": f"File too large for VirusTotal ({file_size // (1024*1024)}MB). Max ~650MB."}
        if e.code == 429:
            return None, {"error": "VirusTotal API rate limit. Wait a minute and retry."}
        return None, {"error": f"Upload failed HTTP {e.code}: {body_text}"}
    except Exception as e:
        return None, {"error": f"Upload failed: {e}"}


def _vt_poll_analysis(analysis_id, headers, max_wait=120, interval=10):
    """Poll GET /analyses/{id} until status is 'completed'. Returns (data, None) or (None, error)."""
    import time
    api_url = f"https://www.virustotal.com/api/v3/analyses/{analysis_id}"
    elapsed = 0
    while elapsed < max_wait:
        data, err = _vt_api_get(api_url, headers, timeout=30)
        if err:
            return None, err
        status = data.get("data", {}).get("attributes", {}).get("status", "")
        if status == "completed":
            return data, None
        if status not in ("queued", "in-progress", ""):
            return None, {"error": f"Unexpected analysis status: {status}"}
        time.sleep(interval)
        elapsed += interval
    return None, {"error": f"Analysis still running after {max_wait}s. Try re-scanning in a minute."}


def _vt_parse_report_from_object(data, scan_type, identifier):
    """Parse a VT file/URL object response (GET /files/{id} or GET /urls/{id})."""
    attrs = data.get("data", {}).get("attributes", {})
    stats = attrs.get("last_analysis_stats", {})
    results = attrs.get("last_analysis_results", {})
    malicious = stats.get("malicious", 0) + stats.get("suspicious", 0)
    total = sum(stats.values()) if stats else 0
    verdict = "malicious" if malicious > 0 else "safe"

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
        "scan_type": scan_type, "verdict": verdict, "malicious": malicious,
        "total": total, "stats": stats, "detections": detections,
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


def _vt_parse_report_from_analysis(data, scan_type, identifier):
    """Parse a VT analysis object response (GET /analyses/{id})."""
    attrs = data.get("data", {}).get("attributes", {})
    stats = attrs.get("stats", {})
    results = attrs.get("results", {})
    malicious = stats.get("malicious", 0) + stats.get("suspicious", 0)
    total = sum(stats.values()) if stats else 0
    verdict = "malicious" if malicious > 0 else "safe"

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
        "scan_type": scan_type, "verdict": verdict, "malicious": malicious,
        "total": total, "stats": stats, "detections": detections,
    }
    if scan_type == "file":
        report["hash"] = identifier
    else:
        report["url"] = identifier
    return report


def scan_virustotal(args):
    """Scan a file or URL via the VirusTotal API v3.

    File flow:
      1. SHA-256 hash lookup via GET /files/{hash}
      2. If not found → upload file via POST /files
      3. Poll GET /analyses/{id} until completed
      4. Try GET /files/{hash} again for the full rich report
      5. Fallback to analysis object if the file report isn't ready yet

    URL flow:
      1. Base64-encoded URL lookup via GET /urls/{id}
      2. If not found → submit via POST /urls
      3. Poll GET /analyses/{id} until completed
      4. Try GET /urls/{id} again for the full report
    """
    vt_key = args.get("vt_api_key", "")
    if not vt_key:
        return {"error": "VirusTotal API key required. Add it in Settings > API Keys."}

    path = args.get("path", "")
    url_target = args.get("url", "")
    headers = {"x-apikey": vt_key}

    # ── FILE SCAN ──
    if path and os.path.isfile(path):
        import hashlib as _hl
        sha256 = _hl.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                sha256.update(chunk)
        file_hash = sha256.hexdigest()

        # Step 1: try hash lookup (fast path — file already known to VT)
        data, err = _vt_api_get(f"https://www.virustotal.com/api/v3/files/{file_hash}", headers)
        if data and not err:
            return _vt_parse_report_from_object(data, "file", file_hash)

        # If error is NOT a 404, return the error
        if err and not err.get("_not_found"):
            return err

        # Step 2: file not in VT — upload it
        analysis_id, upload_err = _vt_upload_file(path, headers)
        if upload_err:
            return upload_err

        # Step 3: poll analysis until completed
        analysis_data, poll_err = _vt_poll_analysis(analysis_id, headers, max_wait=120, interval=10)
        if poll_err:
            return poll_err

        # Step 4: try to get the full file report now (richer data)
        data2, err2 = _vt_api_get(f"https://www.virustotal.com/api/v3/files/{file_hash}", headers)
        if data2 and not err2:
            return _vt_parse_report_from_object(data2, "file", file_hash)

        # Fallback: use the analysis object results directly
        return _vt_parse_report_from_analysis(analysis_data, "file", file_hash)

    # ── URL SCAN ──
    elif url_target:
        import base64 as _b64
        url_id = _b64.urlsafe_b64encode(url_target.encode()).decode().rstrip("=")

        # Step 1: try URL report lookup (fast path)
        data, err = _vt_api_get(f"https://www.virustotal.com/api/v3/urls/{url_id}", headers)
        if data and not err:
            return _vt_parse_report_from_object(data, "url", url_target)

        if err and not err.get("_not_found"):
            return err

        # Step 2: URL not known — submit for scanning
        import urllib.request, urllib.error, urllib.parse
        try:
            submit_data = urllib.parse.urlencode({"url": url_target}).encode()
            submit_req = urllib.request.Request(
                "https://www.virustotal.com/api/v3/urls",
                data=submit_data,
                headers={**headers, "Content-Type": "application/x-www-form-urlencoded",
                         "Accept": "application/json"})
            with urllib.request.urlopen(submit_req, timeout=30) as resp:
                submit_result = json.loads(resp.read().decode())
            analysis_id = submit_result.get("data", {}).get("id", "")
            if not analysis_id:
                return {"error": "URL submitted but no analysis ID returned."}
        except urllib.error.HTTPError as e:
            if e.code == 429:
                return {"error": "VirusTotal API rate limit. Wait a minute and retry."}
            return {"error": f"Failed to submit URL: HTTP {e.code}"}
        except Exception as ex:
            return {"error": f"Failed to submit URL: {ex}"}

        # Step 3: poll analysis
        analysis_data, poll_err = _vt_poll_analysis(analysis_id, headers, max_wait=60, interval=8)
        if poll_err:
            return poll_err

        # Step 4: get the full URL report
        data2, err2 = _vt_api_get(f"https://www.virustotal.com/api/v3/urls/{url_id}", headers)
        if data2 and not err2:
            return _vt_parse_report_from_object(data2, "url", url_target)

        # Fallback: use analysis results
        return _vt_parse_report_from_analysis(analysis_data, "url", url_target)

    # ── FOLDER SCAN (hash first file inside) ──
    elif path and os.path.isdir(path):
        # For folders, scan the first file found inside
        for root, dirs, files in os.walk(path):
            for fname in files:
                fpath = os.path.join(root, fname)
                if os.path.isfile(fpath) and os.path.getsize(fpath) > 0:
                    return scan_virustotal({**args, "path": fpath})
        return {"error": "No scannable files found in folder."}

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

    audio_bitrate = args.get("audio_bitrate", "")  # e.g. "192k"
    audio_only_fmts = {"mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "opus"}

    cmd = [ffmpeg, "-y", "-i", path]
    # Format-specific encoding flags
    if output_format == "mp4":
        cmd += ["-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", "-b:a", audio_bitrate or "128k"]
    elif output_format == "mp3":
        cmd += ["-vn", "-c:a", "libmp3lame", "-b:a", audio_bitrate or "192k"]
    elif output_format == "wav":
        cmd += ["-vn", "-c:a", "pcm_s16le"]
    elif output_format == "flac":
        cmd += ["-vn", "-c:a", "flac"]
    elif output_format == "aac" or output_format == "m4a":
        cmd += ["-vn", "-c:a", "aac", "-b:a", audio_bitrate or "192k"]
    elif output_format == "ogg":
        cmd += ["-vn", "-c:a", "libvorbis", "-b:a", audio_bitrate or "192k"]
    elif output_format == "opus":
        cmd += ["-vn", "-c:a", "libopus", "-b:a", audio_bitrate or "128k"]
    elif output_format == "wma":
        cmd += ["-vn", "-c:a", "wmav2", "-b:a", audio_bitrate or "192k"]
    elif output_format == "webm":
        cmd += ["-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-c:a", "libopus"]
    elif output_format == "gif":
        cmd += ["-vf", "fps=15,scale=480:-1:flags=lanczos", "-loop", "0"]
    elif output_format in audio_only_fmts:
        cmd += ["-vn"]
        if audio_bitrate:
            cmd += ["-b:a", audio_bitrate]
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


def smart_organize_studio(args):
    """v4.6 Auto-Studio: Analyze files by type, call APIs, return a structured plan.

    Routes:
      - Music (.mp3/.flac/.wav/.ogg/.aac/.m4a) → TheAudioDB lookup
      - Video (.mp4/.mkv/.avi/.mov/.wmv/.flv/.webm) → OMDB lookup
      - Images (.jpg/.png/.gif/.bmp/.webp/.tiff/.heic) → LLM vision or EXIF grouping
      - Documents (.pdf/.doc/.docx/.txt/.md/.csv/.xlsx) → LLM categorization
      - Other → generic grouping

    Returns a StudioPlan JSON: { folders: [...], base_dir, total_items }
    """
    import urllib.request, urllib.error, urllib.parse, re, time, uuid as _uuid

    paths = args.get("paths", [])
    api_key = args.get("api_key", "")
    provider = args.get("provider", "openai")
    model = args.get("model", "")
    omdb_key = args.get("omdb_key", "")
    imdb_api_key = args.get("imdb_api_key", "")
    audiodb_key = args.get("audiodb_key", "") or "523532"  # free key fallback
    base_dir = args.get("base_dir", "")
    group_images_by = args.get("group_images_by", "date")
    video_hint = args.get("video_hint", "auto")  # "auto", "movie", "personal"
    audio_hint = args.get("audio_hint", "auto")  # "auto", "music", "personal"

    if not paths:
        return {"error": "No files to organize."}
    if not base_dir:
        base_dir = os.path.dirname(paths[0]) if paths else TEMP_DIR

    MUSIC_EXT = {".mp3", ".flac", ".wav", ".ogg", ".aac", ".m4a", ".wma"}
    VIDEO_EXT = {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v"}
    IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff", ".tif", ".heic", ".heif"}
    DOC_EXT = {".pdf", ".doc", ".docx", ".txt", ".md", ".csv", ".xlsx", ".xls", ".pptx", ".rtf", ".log"}

    music_files, video_files, image_files, doc_files, other_files = [], [], [], [], []
    for p in paths:
        if not os.path.isfile(p):
            continue
        ext = os.path.splitext(p)[1].lower()
        if ext in MUSIC_EXT:
            music_files.append(p)
        elif ext in VIDEO_EXT:
            video_files.append(p)
        elif ext in IMAGE_EXT:
            image_files.append(p)
        elif ext in DOC_EXT:
            doc_files.append(p)
        else:
            other_files.append(p)

    folders = []
    item_counter = [0]

    def _make_item(old_path, new_name, folder_name, file_type, metadata=None, poster_url=""):
        item_counter[0] += 1
        new_path = os.path.join(base_dir, folder_name, new_name)
        return {
            "id": f"si_{item_counter[0]}_{_uuid.uuid4().hex[:6]}",
            "old_path": old_path,
            "old_name": os.path.basename(old_path),
            "new_name": new_name,
            "new_path": new_path,
            "folder": folder_name,
            "type": file_type,
            "enabled": True,
            "metadata": metadata or {},
            "poster_url": poster_url,
            "poster_local": "",
        }

    # ── MUSIC: TheAudioDB v2 lookup ──
    if music_files:
        music_items = []
        for p in music_files:
            name = os.path.splitext(os.path.basename(p))[0]
            ext = os.path.splitext(p)[1]
            # Try to extract artist - title from filename
            parts = re.split(r"\s*[-\u2013\u2014]\s*", name, maxsplit=1)
            artist = parts[0].strip() if len(parts) > 1 else ""
            track = parts[1].strip() if len(parts) > 1 else name.strip()
            # Strip leading track numbers like "01 ", "01. ", "1 - "
            track_clean = re.sub(r'^\d{1,3}[\s\.\-]+', '', track).strip() or track

            folder_name = "Music"
            new_name = os.path.basename(p)
            metadata = {}
            poster_url = ""

            # If user says "personal", skip API lookup entirely
            if audio_hint == "personal":
                folder_name = "Voice Recordings"
                # If we have an LLM key, ask it for a descriptive title
                if api_key:
                    try:
                        result = _call_llm(provider, api_key, model,
                            f"Give a short 3-5 word descriptive filename for this audio recording (no extension, use underscores): {name}",
                            system_prompt="You are a file naming assistant. Return ONLY the filename, nothing else.")
                        if "error" not in result:
                            new_stem = result["text"].strip().replace(" ", "_").replace('"', '')[:50]
                            new_name = f"{new_stem}{ext}"
                    except Exception:
                        pass
            else:
                # Try TheAudioDB v2 API: first with artist+track, then track-only
                api_searched = False
                for attempt_artist, attempt_track in [
                    (artist, track_clean),
                    ("", track_clean),  # fallback: search by track name only
                ]:
                    if api_searched:
                        break
                    if not attempt_track:
                        continue
                    try:
                        safe_artist = urllib.parse.quote(attempt_artist)
                        safe_track = urllib.parse.quote(attempt_track)
                        api_url = f"https://www.theaudiodb.com/api/v1/json/{audiodb_key}/searchtrack.php?s={safe_artist}&t={safe_track}"
                        req = urllib.request.Request(api_url, headers={"Accept": "application/json", "User-Agent": "Zenith/4.6"})
                        with urllib.request.urlopen(req, timeout=10) as resp:
                            data = json.loads(resp.read().decode())
                        tracks_list = data.get("track")
                        if tracks_list and len(tracks_list) > 0:
                            t = tracks_list[0]
                            album = t.get("strAlbum", "Unknown Album")
                            year = t.get("intYearReleased") or t.get("strReleaseFormat") or ""
                            art_url = t.get("strTrackThumb") or t.get("strTrack3DCase") or ""
                            genre = t.get("strGenre", "")
                            found_artist = t.get("strArtist", artist or "Unknown Artist")
                            folder_name = f"{found_artist} - {album} ({year})" if year else f"{found_artist} - {album}"
                            clean_track = t.get("strTrack", track_clean)
                            new_name = f"{clean_track}{ext}"
                            metadata = {"album": album, "year": str(year), "artist": found_artist, "genre": genre}
                            poster_url = art_url
                            api_searched = True
                        time.sleep(1.5)  # Rate limiting for free tier
                    except Exception as e:
                        metadata["_api_error"] = f"TheAudioDB: {str(e)[:80]}"
                        import sys; print(f"[Zenith] TheAudioDB error for '{attempt_track}': {e}", file=sys.stderr)

                # Fallback: Shazam fingerprint recognition if TheAudioDB found nothing
                if not api_searched:
                    try:
                        scripts_dir = os.path.dirname(os.path.abspath(__file__))
                        if scripts_dir not in sys.path:
                            sys.path.insert(0, scripts_dir)
                        from shazam_recognize import recognize_file as shazam_recognize
                        shazam_result = shazam_recognize(p, max_seconds=12)
                        if shazam_result.get("ok") and shazam_result.get("title"):
                            s_title = shazam_result["title"]
                            s_artist = shazam_result.get("artist", "Unknown Artist")
                            s_album = shazam_result.get("album", "")
                            s_year = shazam_result.get("year", "")
                            s_genre = shazam_result.get("genre", "")
                            s_cover = shazam_result.get("cover_url", "")
                            folder_name = f"{s_artist} - {s_album} ({s_year})" if s_album and s_year else (f"{s_artist} - {s_album}" if s_album else s_artist)
                            new_name = f"{s_title}{ext}"
                            metadata = {"album": s_album, "year": str(s_year), "artist": s_artist, "genre": s_genre, "source": "shazam"}
                            if shazam_result.get("shazam_url"):
                                metadata["shazam_url"] = shazam_result["shazam_url"]
                            if shazam_result.get("apple_music_url"):
                                metadata["apple_music_url"] = shazam_result["apple_music_url"]
                            poster_url = s_cover
                            api_searched = True
                            import sys; print(f"[Zenith] Shazam recognized: {s_artist} - {s_title}", file=sys.stderr)
                    except Exception as e:
                        metadata["_shazam_error"] = f"Shazam: {str(e)[:80]}"
                        import sys; print(f"[Zenith] Shazam error for '{name}': {e}", file=sys.stderr)

            music_items.append(_make_item(p, new_name, folder_name, "music", metadata, poster_url))

        # Group music items by folder
        music_groups = {}
        for item in music_items:
            music_groups.setdefault(item["folder"], []).append(item)
        for folder_name, items in music_groups.items():
            folders.append({
                "name": folder_name,
                "icon": "\U0001f3b5",
                "items": items,
                "color": "#a78bfa",
            })

    # ── VIDEO: imdbapi.dev + OMDB fallback ──
    if video_files:
        video_items = []
        for p in video_files:
            name = os.path.splitext(os.path.basename(p))[0]
            ext = os.path.splitext(p)[1]
            folder_name = "Videos"
            new_name = os.path.basename(p)
            metadata = {}
            poster_url = ""

            # If user says "personal", skip API lookup — use LLM for descriptive name
            if video_hint == "personal":
                folder_name = "Personal Videos"
                if api_key:
                    try:
                        result = _call_llm(provider, api_key, model,
                            f"Give a short 3-5 word descriptive filename for this personal video (no extension, use underscores): {name}",
                            system_prompt="You are a file naming assistant. Return ONLY the filename, nothing else.")
                        if "error" not in result:
                            new_stem = result["text"].strip().replace(" ", "_").replace('"', '')[:50]
                            new_name = f"{new_stem}{ext}"
                    except Exception:
                        pass
                video_items.append(_make_item(p, new_name, folder_name, "video", metadata, poster_url))
                continue

            # Detect SxxExx pattern (TV series)
            series_match = re.search(r'[Ss](\d{1,2})[Ee](\d{1,3})', name)
            # Detect year pattern
            year_match = re.search(r'[\.\s\(\[]?((?:19|20)\d{2})[\.\s\)\]]?', name)

            # Clean the name for API lookup
            clean = name
            # Remove common quality/codec tags
            clean = re.sub(r'[\.\s](1080p|720p|480p|2160p|4[kK]|[Hh]\.?264|[Hh]\.?265|[Hh][Ee][Vv][Cc]|[Xx]264|[Xx]265|BluRay|WEB[\.\-]?DL|WEB[\.\-]?Rip|HDRip|BRRip|DVDRip|HDTV|AMZN|NF|REPACK|PROPER|REMUX|AAC|AC3|DTS|Atmos).*', '', clean, flags=re.IGNORECASE)
            if series_match:
                clean = clean[:series_match.start()]
            elif year_match:
                clean = clean[:year_match.start()]
            # Replace dots/underscores with spaces
            clean = re.sub(r'[\._]+', ' ', clean).strip()

            api_found = False

            # Primary: imdbapi.dev (free, no key needed — or use key for premium)
            if clean:
                try:
                    safe_title = urllib.parse.quote(clean)
                    imdb_url = f"https://imdbapi.dev/search?query={safe_title}"
                    if imdb_api_key:
                        imdb_url += f"&apiKey={imdb_api_key}"
                    req = urllib.request.Request(imdb_url, headers={"Accept": "application/json", "User-Agent": "Zenith/4.6"})
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        results = json.loads(resp.read().decode())
                    # imdbapi.dev returns a list of results
                    hits = results if isinstance(results, list) else results.get("results", [])
                    if hits and len(hits) > 0:
                        best = hits[0]
                        title = best.get("title") or best.get("name") or clean
                        year = str(best.get("year", "")).split("\u2013")[0].split("-")[0].strip()
                        poster = best.get("poster") or best.get("image") or ""
                        imdb_id = best.get("imdbId") or best.get("id") or ""
                        media_type = best.get("type", "movie").lower()

                        if ("series" in media_type or "tv" in media_type) and series_match:
                            s_num = int(series_match.group(1))
                            e_num = int(series_match.group(2))
                            folder_name = f"{title}/Season {s_num}"
                            new_name = f"{title} S{s_num:02d}E{e_num:02d}{ext}"
                        else:
                            folder_name = f"{title} ({year})" if year else title
                            new_name = f"{title} ({year}){ext}" if year else f"{title}{ext}"

                        metadata = {
                            "title": title, "year": year, "type": media_type,
                            "imdb_id": imdb_id,
                        }
                        poster_url = poster
                        api_found = True
                except Exception as e:
                    metadata["_api_error"] = f"imdbapi.dev: {str(e)[:80]}"
                    import sys; print(f"[Zenith] imdbapi.dev error for '{clean}': {e}", file=sys.stderr)

            # Fallback: OMDB if imdbapi.dev failed and we have an OMDB key
            if not api_found and omdb_key and clean:
                try:
                    safe_title = urllib.parse.quote(clean)
                    omdb_url = f"https://www.omdbapi.com/?t={safe_title}&apikey={omdb_key}"
                    if year_match:
                        omdb_url += f"&y={year_match.group(1)}"
                    if series_match:
                        omdb_url += "&type=series"
                    req = urllib.request.Request(omdb_url, headers={"Accept": "application/json", "User-Agent": "Zenith/4.6"})
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        data = json.loads(resp.read().decode())
                    if data.get("Response") == "True":
                        title = data.get("Title", clean)
                        year = data.get("Year", "").split("\u2013")[0].split("-")[0].strip()
                        poster = data.get("Poster", "")
                        if poster == "N/A":
                            poster = ""
                        media_type = data.get("Type", "movie")

                        if media_type == "series" and series_match:
                            s_num = int(series_match.group(1))
                            e_num = int(series_match.group(2))
                            folder_name = f"{title}/Season {s_num}"
                            new_name = f"{title} S{s_num:02d}E{e_num:02d}{ext}"
                        else:
                            folder_name = f"{title} ({year})" if year else title
                            new_name = f"{title} ({year}){ext}" if year else f"{title}{ext}"

                        metadata = {
                            "title": title, "year": year, "type": media_type,
                            "genre": data.get("Genre", ""), "director": data.get("Director", ""),
                            "imdbRating": data.get("imdbRating", ""), "plot": data.get("Plot", "")[:100],
                        }
                        poster_url = poster
                    else:
                        metadata["_api_error"] = f"OMDB: {data.get('Error', 'Not found')}"
                except Exception as e:
                    metadata["_api_error"] = f"OMDB: {str(e)[:80]}"
                    import sys; print(f"[Zenith] OMDB error for '{clean}': {e}", file=sys.stderr)

            video_items.append(_make_item(p, new_name, folder_name, "video", metadata, poster_url))

        video_groups = {}
        for item in video_items:
            video_groups.setdefault(item["folder"], []).append(item)
        for folder_name, items in video_groups.items():
            folders.append({
                "name": folder_name,
                "icon": "\U0001f3ac",
                "items": items,
                "color": "#f472b6",
            })

    # ── IMAGES: EXIF date grouping (default) or LLM vision ──
    if image_files:
        image_items = []
        if group_images_by == "date":
            for p in image_files:
                name = os.path.basename(p)
                folder_name = "Photos"
                try:
                    from PIL import Image as PILImage
                    from PIL.ExifTags import Base as ExifBase
                    img = PILImage.open(p)
                    exif = img.getexif()
                    date_str = exif.get(ExifBase.DateTimeOriginal) or exif.get(ExifBase.DateTime) or ""
                    if date_str:
                        # Format: "2026:03:15 14:30:00" → "2026-03"
                        parts = date_str.split(" ")[0].split(":")
                        if len(parts) >= 2:
                            folder_name = f"Photos - {parts[0]}-{parts[1]}"
                except Exception:
                    pass
                image_items.append(_make_item(p, name, folder_name, "image"))
        else:
            # LLM-based naming — batch describe for efficiency
            if api_key:
                for p in image_files:
                    name = os.path.basename(p)
                    ext_str = os.path.splitext(p)[1]
                    try:
                        result = _call_llm(provider, api_key, model,
                            f"Give a short 3-5 word descriptive filename for this image (no extension, use underscores): {name}",
                            system_prompt="You are a file naming assistant. Return ONLY the filename, nothing else.")
                        if "error" not in result:
                            new_stem = result["text"].strip().replace(" ", "_").replace('"', '')[:50]
                            image_items.append(_make_item(p, f"{new_stem}{ext_str}", "Photos", "image"))
                            continue
                    except Exception:
                        pass
                    image_items.append(_make_item(p, name, "Photos", "image"))
            else:
                for p in image_files:
                    image_items.append(_make_item(p, os.path.basename(p), "Photos", "image"))

        img_groups = {}
        for item in image_items:
            img_groups.setdefault(item["folder"], []).append(item)
        for folder_name, items in img_groups.items():
            folders.append({
                "name": folder_name,
                "icon": "\U0001f5bc\ufe0f",
                "items": items,
                "color": "#34d399",
            })

    # ── DOCUMENTS: grouping by category (LLM), type, or date ──
    group_docs_by = args.get("group_docs_by", "category")
    if doc_files:
        doc_items = []

        if group_docs_by == "type":
            # Simple extension-based grouping
            type_map = {
                ".pdf": "PDFs", ".doc": "Word Documents", ".docx": "Word Documents",
                ".txt": "Text Files", ".md": "Markdown", ".csv": "Spreadsheets",
                ".xlsx": "Spreadsheets", ".xls": "Spreadsheets", ".pptx": "Presentations",
                ".rtf": "Rich Text", ".log": "Logs",
            }
            for p in doc_files:
                name = os.path.basename(p)
                ext = os.path.splitext(name)[1].lower()
                folder = type_map.get(ext, "Documents")
                doc_items.append(_make_item(p, name, folder, "document"))

        elif group_docs_by == "date":
            # Group by file modification date (YYYY-MM)
            for p in doc_files:
                name = os.path.basename(p)
                try:
                    mtime = os.path.getmtime(p)
                    import datetime
                    dt = datetime.datetime.fromtimestamp(mtime)
                    folder = f"Documents - {dt.strftime('%Y-%m')}"
                except Exception:
                    folder = "Documents"
                doc_items.append(_make_item(p, name, folder, "document"))

        else:
            # category (default) — LLM semantic categorization
            if api_key:
                file_info = []
                for p in doc_files:
                    name = os.path.basename(p)
                    ext = os.path.splitext(name)[1].lower()
                    preview = ""
                    if ext in {".txt", ".md", ".log", ".csv", ".json", ".xml"}:
                        try:
                            with open(p, "r", encoding="utf-8", errors="ignore") as f:
                                preview = f.read(300).replace("\n", " ").strip()
                        except Exception:
                            pass
                    elif ext == ".pdf":
                        try:
                            import pdfplumber
                            with pdfplumber.open(p) as pdf:
                                if pdf.pages:
                                    preview = (pdf.pages[0].extract_text() or "")[:300]
                        except Exception:
                            pass
                    file_info.append({"name": name, "path": p, "ext": ext, "preview": preview[:200]})

                prompt = (
                    "Categorize these documents. For each, provide a category folder and a clean descriptive filename.\n"
                    "Return ONLY a JSON array: [{\"name\": \"original.pdf\", \"folder\": \"Financial\", \"new_name\": \"Invoice_March_2026.pdf\"}]\n"
                    "Categories should be: Business, Personal, Financial, Academic, Legal, Technical, or Misc.\n"
                    "Keep file extensions. Use clean readable names.\n\nDocuments:\n"
                )
                for fi in file_info:
                    prompt += f"- {fi['name']} ({fi['ext']})"
                    if fi["preview"]:
                        prompt += f" preview: {fi['preview'][:100]}"
                    prompt += "\n"

                try:
                    result = _call_llm(provider, api_key, model, prompt,
                        system_prompt=args.get("system_prompt", ""))
                    if "error" not in result:
                        text = result["text"].strip()
                        if "```" in text:
                            start = text.index("[", text.index("```"))
                            end = text.rindex("]") + 1
                            text = text[start:end]
                        mapping = json.loads(text)
                        path_lookup = {os.path.basename(p): p for p in doc_files}
                        mapped_paths = set()
                        for entry in mapping:
                            old_name = entry.get("name", "")
                            old_path = path_lookup.get(old_name)
                            if not old_path:
                                continue
                            mapped_paths.add(old_path)
                            folder = entry.get("folder", "Documents")
                            new_name = entry.get("new_name", old_name)
                            doc_items.append(_make_item(old_path, new_name, folder, "document"))
                        for p in doc_files:
                            if p not in mapped_paths:
                                doc_items.append(_make_item(p, os.path.basename(p), "Documents", "document"))
                except Exception:
                    for p in doc_files:
                        doc_items.append(_make_item(p, os.path.basename(p), "Documents", "document"))
            else:
                for p in doc_files:
                    doc_items.append(_make_item(p, os.path.basename(p), "Documents", "document"))

        doc_groups = {}
        for item in doc_items:
            doc_groups.setdefault(item["folder"], []).append(item)
        for folder_name, items in doc_groups.items():
            folders.append({
                "name": folder_name,
                "icon": "\U0001f4c4",
                "items": items,
                "color": "#60a5fa",
            })

    # ── OTHER FILES ──
    if other_files:
        other_items = [_make_item(p, os.path.basename(p), "Other", "other") for p in other_files]
        folders.append({
            "name": "Other",
            "icon": "\U0001f4e6",
            "items": other_items,
            "color": "#94a3b8",
        })

    total_items = sum(len(f["items"]) for f in folders)
    folders_json = []
    for f in folders:
        folders_json.append({
            "name": f["name"],
            "icon": f["icon"],
            "color": f["color"],
            "items": f["items"],
        })

    return {
        "plan": {
            "folders": folders_json,
            "base_dir": base_dir,
            "total_items": total_items,
        }
    }


def recognize_audio(args):
    """Recognize a song using Shazam fingerprinting, then enrich with TheAudioDB.
    Args: { path: str, max_seconds?: float, audiodb_key?: str }
    Returns: { title, artist, album, year, genre, cover_url, shazam_url, track_number, ... }
    """
    import requests as _req

    file_path = args.get("path", "")
    if not file_path or not os.path.isfile(file_path):
        return {"error": f"File not found: {file_path}"}

    max_seconds = float(args.get("max_seconds", 12))
    audiodb_key = args.get("audiodb_key", "2")  # free v1 key

    # Import from our bundled shazam module
    scripts_dir = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, scripts_dir)
    from shazam_recognize import recognize_file

    result = recognize_file(file_path, max_seconds=max_seconds)
    result.pop("raw", None)

    if not result.get("ok") or not result.get("title"):
        return result

    # ── Enrich with TheAudioDB ──────────────────────────────────────────────
    artist = result.get("artist", "")
    title = result.get("title", "")
    try:
        adb_url = f"https://www.theaudiodb.com/api/v1/json/{audiodb_key}/searchtrack.php"
        resp = _req.get(adb_url, params={"s": artist, "t": title}, timeout=10)
        tracks = resp.json().get("track") or []
        if tracks:
            t = tracks[0]
            # Fill in any missing fields from TheAudioDB
            if not result.get("album"):
                result["album"] = t.get("strAlbum", "")
            if not result.get("year"):
                result["year"] = t.get("intYearReleased") or t.get("strReleaseDate", "")[:4] if t.get("strReleaseDate") else ""
            if not result.get("genre"):
                result["genre"] = t.get("strGenre", "")
            result["track_number"] = t.get("intTrackNumber", "")
            result["duration_ms"] = t.get("intDuration", "")
            result["mood"] = t.get("strMood", "")
            result["style"] = t.get("strStyle", "")
            result["description"] = (t.get("strDescriptionEN") or "")[:300]
            # Higher-quality cover from TheAudioDB
            thumb = t.get("strTrackThumb", "")
            if thumb:
                result["cover_url"] = thumb
            # Album art fallback
            if not result.get("cover_url"):
                result["cover_url"] = t.get("strAlbumThumb", "") or t.get("strArtistThumb", "")
            result["audiodb_track_id"] = t.get("idTrack", "")
            result["audiodb_album_id"] = t.get("idAlbum", "")
            result["audiodb_artist_id"] = t.get("idArtist", "")
            result["musicbrainz_id"] = t.get("strMusicBrainzID", "")
    except Exception:
        pass  # TheAudioDB enrichment is best-effort; Shazam data is still good

    # Make year a clean string
    if result.get("year"):
        result["year"] = str(result["year"]).strip()[:4]

    return result


def apply_audio_metadata(args):
    """Write metadata tags + cover art to an audio file, optionally rename it.
    Args: {
        path: str,
        title?: str, artist?: str, album?: str, year?: str, genre?: str,
        track_number?: str, cover_url?: str,
        rename?: bool (default true — rename to "Artist - Title.ext"),
        new_stem?: str (custom stem override)
    }
    Returns: { new_path, new_name, tags_written: [...], cover_embedded: bool }
    """
    import requests as _req

    file_path = args.get("path", "")
    if not file_path or not os.path.isfile(file_path):
        return {"error": f"File not found: {file_path}"}

    title = args.get("title", "")
    artist = args.get("artist", "")
    album = args.get("album", "")
    year = str(args.get("year", "")).strip()[:4]
    genre = args.get("genre", "")
    track_number = str(args.get("track_number", ""))
    cover_url = args.get("cover_url", "")
    do_rename = args.get("rename", True)
    new_stem = args.get("new_stem", "")

    ext = os.path.splitext(file_path)[1].lower()
    tags_written = []
    cover_embedded = False

    # Download cover art if URL provided
    cover_data = None
    cover_mime = "image/jpeg"
    if cover_url:
        try:
            cr = _req.get(cover_url, timeout=15)
            if cr.status_code == 200 and len(cr.content) > 1000:
                cover_data = cr.content
                ct = cr.headers.get("content-type", "image/jpeg")
                cover_mime = ct.split(";")[0].strip()
        except Exception:
            pass

    try:
        from mutagen import File as MutagenFile
        from mutagen.id3 import ID3, TIT2, TPE1, TALB, TDRC, TCON, TRCK, APIC, ID3NoHeaderError
    except ImportError:
        return {"error": "mutagen is required. Install: pip install mutagen"}

    try:
        if ext == ".mp3":
            # ── MP3: ID3 tags ──
            try:
                tags = ID3(file_path)
            except ID3NoHeaderError:
                from mutagen.mp3 import MP3
                audio = MP3(file_path)
                audio.add_tags()
                audio.save()
                tags = ID3(file_path)

            if title:
                tags["TIT2"] = TIT2(encoding=3, text=title); tags_written.append("title")
            if artist:
                tags["TPE1"] = TPE1(encoding=3, text=artist); tags_written.append("artist")
            if album:
                tags["TALB"] = TALB(encoding=3, text=album); tags_written.append("album")
            if year:
                tags["TDRC"] = TDRC(encoding=3, text=year); tags_written.append("year")
            if genre:
                tags["TCON"] = TCON(encoding=3, text=genre); tags_written.append("genre")
            if track_number:
                tags["TRCK"] = TRCK(encoding=3, text=track_number); tags_written.append("track_number")
            if cover_data:
                tags["APIC"] = APIC(encoding=3, mime=cover_mime, type=3, desc="Cover", data=cover_data)
                cover_embedded = True
            tags.save()

        elif ext == ".flac":
            # ── FLAC: Vorbis comments + picture ──
            from mutagen.flac import FLAC, Picture
            audio = FLAC(file_path)
            if title:
                audio["title"] = title; tags_written.append("title")
            if artist:
                audio["artist"] = artist; tags_written.append("artist")
            if album:
                audio["album"] = album; tags_written.append("album")
            if year:
                audio["date"] = year; tags_written.append("year")
            if genre:
                audio["genre"] = genre; tags_written.append("genre")
            if track_number:
                audio["tracknumber"] = track_number; tags_written.append("track_number")
            if cover_data:
                pic = Picture()
                pic.type = 3
                pic.mime = cover_mime
                pic.desc = "Cover"
                pic.data = cover_data
                audio.clear_pictures()
                audio.add_picture(pic)
                cover_embedded = True
            audio.save()

        elif ext in (".m4a", ".aac", ".mp4"):
            # ── M4A/AAC: MP4 atoms ──
            from mutagen.mp4 import MP4, MP4Cover
            audio = MP4(file_path)
            if audio.tags is None:
                audio.add_tags()
            if title:
                audio["\xa9nam"] = [title]; tags_written.append("title")
            if artist:
                audio["\xa9ART"] = [artist]; tags_written.append("artist")
            if album:
                audio["\xa9alb"] = [album]; tags_written.append("album")
            if year:
                audio["\xa9day"] = [year]; tags_written.append("year")
            if genre:
                audio["\xa9gen"] = [genre]; tags_written.append("genre")
            if track_number:
                try:
                    audio["trkn"] = [(int(track_number), 0)]
                    tags_written.append("track_number")
                except ValueError:
                    pass
            if cover_data:
                fmt = MP4Cover.FORMAT_JPEG if "jpeg" in cover_mime or "jpg" in cover_mime else MP4Cover.FORMAT_PNG
                audio["covr"] = [MP4Cover(cover_data, imageformat=fmt)]
                cover_embedded = True
            audio.save()

        elif ext in (".ogg", ".opus"):
            # ── OGG/Opus: Vorbis comments ──
            audio = MutagenFile(file_path)
            if audio is None:
                return {"error": f"Cannot open {ext} file with mutagen"}
            if audio.tags is None:
                audio.add_tags()
            if title:
                audio["title"] = [title]; tags_written.append("title")
            if artist:
                audio["artist"] = [artist]; tags_written.append("artist")
            if album:
                audio["album"] = [album]; tags_written.append("album")
            if year:
                audio["date"] = [year]; tags_written.append("year")
            if genre:
                audio["genre"] = [genre]; tags_written.append("genre")
            if track_number:
                audio["tracknumber"] = [track_number]; tags_written.append("track_number")
            # Cover art in OGG is complex (METADATA_BLOCK_PICTURE), skip for now
            audio.save()

        elif ext == ".wma":
            from mutagen.asf import ASF
            audio = ASF(file_path)
            if title:
                audio["Title"] = [title]; tags_written.append("title")
            if artist:
                audio["Author"] = [artist]; tags_written.append("artist")
            if album:
                audio["WM/AlbumTitle"] = [album]; tags_written.append("album")
            if year:
                audio["WM/Year"] = [year]; tags_written.append("year")
            if genre:
                audio["WM/Genre"] = [genre]; tags_written.append("genre")
            if track_number:
                audio["WM/TrackNumber"] = [track_number]; tags_written.append("track_number")
            audio.save()

        elif ext == ".wav":
            # WAV has limited tag support; try RIFF INFO
            audio = MutagenFile(file_path)
            if audio is not None and audio.tags is not None:
                if title:
                    audio["TIT2"] = TIT2(encoding=3, text=title); tags_written.append("title")
                if artist:
                    audio["TPE1"] = TPE1(encoding=3, text=artist); tags_written.append("artist")
                audio.save()
            else:
                tags_written.append("skipped_wav")

        else:
            return {"error": f"Unsupported audio format for tagging: {ext}"}

    except Exception as e:
        return {"error": f"Failed to write tags: {e}"}

    # ── Rename file ──
    result = {
        "tags_written": tags_written,
        "cover_embedded": cover_embedded,
        "old_path": file_path,
    }

    if do_rename and (new_stem or (artist and title)):
        stem = new_stem if new_stem else (f"{artist} - {title}" if artist else title)
        # Sanitize filename
        for ch in '<>:"/\\|?*':
            stem = stem.replace(ch, "_")
        stem = stem.strip(". ")
        if not stem:
            result["new_path"] = file_path
            result["new_name"] = os.path.basename(file_path)
            return result

        directory = os.path.dirname(file_path)
        new_name = f"{stem}{ext}"
        new_path = os.path.join(directory, new_name)

        # Avoid overwriting existing files
        if new_path != file_path:
            if os.path.exists(new_path):
                counter = 2
                while os.path.exists(os.path.join(directory, f"{stem} ({counter}){ext}")):
                    counter += 1
                new_name = f"{stem} ({counter}){ext}"
                new_path = os.path.join(directory, new_name)
            try:
                os.rename(file_path, new_path)
                result["new_path"] = new_path
                result["new_name"] = new_name
                result["renamed"] = True
            except Exception as e:
                result["rename_error"] = str(e)
                result["new_path"] = file_path
                result["new_name"] = os.path.basename(file_path)
        else:
            result["new_path"] = file_path
            result["new_name"] = os.path.basename(file_path)
    else:
        result["new_path"] = file_path
        result["new_name"] = os.path.basename(file_path)

    return result


def undo_audio_metadata(args):
    """Revert metadata + rename for one audio file.
    Args: { new_path: str, old_path: str, old_tags: {...} }
    Renames file back and restores old tags (simplified: clears our tags).
    """
    new_path = args.get("new_path", "")
    old_path = args.get("old_path", "")

    if not new_path or not os.path.isfile(new_path):
        return {"error": f"File not found: {new_path}"}

    result = {"reverted": False}

    # Rename back if paths differ
    if new_path != old_path and old_path:
        try:
            if not os.path.exists(old_path):
                os.rename(new_path, old_path)
                result["path"] = old_path
                result["name"] = os.path.basename(old_path)
                result["reverted"] = True
            else:
                result["path"] = new_path
                result["name"] = os.path.basename(new_path)
                result["rename_skip"] = "Original path already exists"
        except Exception as e:
            result["path"] = new_path
            result["name"] = os.path.basename(new_path)
            result["rename_error"] = str(e)
    else:
        result["path"] = new_path
        result["name"] = os.path.basename(new_path)

    # Note: full tag revert would require storing original tag data before writing.
    # For now we just handle the rename revert. Tags remain as-is (metadata is additive).
    return result


def generate_image(args):
    """Generate or edit an image via Gemini or OpenAI image APIs.

    Gemini params (via generationConfig.imageConfig):
      aspectRatio  – "1:1","1:4","1:8","2:3","3:2","3:4","4:1","4:3",
                     "4:5","5:4","8:1","9:16","16:9","21:9"
      imageSize    – "512","1K","2K","4K"
    Gemini thinkingConfig (Pro model):
      thinkingLevel – "minimal" | "High"

    Text-to-image: { model, prompt, api_key, provider, aspect_ratio, image_size,
                     style, thinking_level }
    Image-to-image: add { image_b64 } to edit the provided image.
    Returns: { image_b64, cost, model, path, format }
    """
    import base64, urllib.request, urllib.error

    model = args.get("model", "gemini-3.1-flash-image-preview")
    prompt = args.get("prompt", "")
    api_key = args.get("api_key", "")
    provider = args.get("provider", "google")
    image_b64 = args.get("image_b64", None)
    aspect_ratio = args.get("aspect_ratio", "1:1")
    image_size = args.get("image_size", "1K")
    quality = args.get("quality", "standard")       # OpenAI "standard" | "hd"
    style = args.get("style", "")                   # style hint text for Gemini
    thinking_level = args.get("thinking_level", "")  # "minimal"|"High" (Pro only)
    temperature = args.get("temperature", None)

    if not api_key:
        return {"error": "API key required. Set it in Settings > API Keys."}
    if not prompt:
        return {"error": "Prompt is required."}

    COST_MAP = {
        "gemini-3.1-flash-image-preview": 0.067,
        "gemini-3-pro-image-preview": 0.134,
        "gpt-image-1.5": 0.133,
    }
    cost = COST_MAP.get(model, 0.10)

    # ── Google Gemini ──────────────────────────────────────────────────────
    if provider == "google":
        url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
               f"{model}:generateContent?key={api_key}")

        parts = []

        # If editing, put the reference image FIRST, then the text prompt
        if image_b64:
            parts.append({"inline_data": {"mime_type": "image/png",
                                          "data": image_b64}})

        # Inject optional style hint into prompt text
        if style:
            STYLE_MAP = {
                "photorealistic": "photorealistic, ultra-detailed photograph",
                "digital_art": "digital art, vibrant illustration",
                "vector": "clean vector art, flat design, minimal shading",
                "anime": "anime / manga art style, cel-shaded",
                "watercolor": "watercolor painting, soft blending, paper texture",
                "oil_painting": "oil painting, rich impasto texture, gallery quality",
                "3d_render": "3D render, octane, studio lighting, high detail",
                "pixel_art": "pixel art, retro 8-bit style",
                "sketch": "pencil sketch, hand-drawn, crosshatch shading",
            }
            hint = STYLE_MAP.get(style, style)
            full_prompt = f"{prompt}. Style: {hint}"
        else:
            full_prompt = prompt

        parts.append({"text": full_prompt})

        # Build generationConfig with imageConfig
        generation_config = {
            "responseModalities": ["IMAGE", "TEXT"],
            "imageConfig": {
                "aspectRatio": aspect_ratio,
            },
        }
        # Only add imageSize when model supports it (flash models)
        if image_size and "flash" in model:
            generation_config["imageConfig"]["imageSize"] = image_size

        if temperature is not None:
            generation_config["temperature"] = float(temperature)

        body = {
            "contents": [{"parts": parts}],
            "generationConfig": generation_config,
        }

        # Thinking config — only supported for gemini-3.1-flash-image-preview
        if thinking_level and model == "gemini-3.1-flash-image-preview":
            body["generationConfig"]["thinkingConfig"] = {
                "thinkingLevel": thinking_level,
            }

        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            url, data=payload,
            headers={"Content-Type": "application/json; charset=utf-8"})

        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            body_text = e.read().decode() if e.fp else ""
            return {"error": f"Gemini image API error {e.code}: {body_text[:500]}"}
        except Exception as e:
            return {"error": str(e)}

        # Extract image from response
        candidates = data.get("candidates", [])
        if not candidates:
            # Check for promptFeedback block reason
            feedback = data.get("promptFeedback", {})
            block = feedback.get("blockReason", "")
            if block:
                return {"error": f"Blocked by Gemini safety filter: {block}"}
            return {"error": "No image returned by Gemini. Check your API key and quota."}

        result_b64 = None
        response_text = ""
        for part in candidates[0].get("content", {}).get("parts", []):
            if "inlineData" in part:
                result_b64 = part["inlineData"]["data"]
            elif "text" in part:
                response_text = part["text"]

        if not result_b64:
            # Sometimes Gemini returns only text (e.g. safety refusal)
            err_hint = response_text[:300] if response_text else "No image in response."
            return {"error": f"Gemini returned no image. {err_hint}"}

        import uuid
        tmp_name = f"gen_{uuid.uuid4().hex[:8]}.png"
        tmp_path = os.path.join(TEMP_DIR, "Zenith_Editor")
        os.makedirs(tmp_path, exist_ok=True)
        out_path = os.path.join(tmp_path, tmp_name)
        with open(out_path, "wb") as f:
            f.write(base64.b64decode(result_b64))

        return {"image_b64": result_b64, "path": out_path, "cost": cost,
                "model": model, "format": "png"}

    # ── OpenAI GPT-Image ──────────────────────────────────────────────────
    elif provider == "openai":
        ASPECT_SIZE = {"1:1": "1024x1024", "16:9": "1792x1024", "9:16": "1024x1792"}
        size = ASPECT_SIZE.get(aspect_ratio, "1024x1024")
        qual = "high" if quality == "hd" else "standard"

        import uuid
        tmp_path = os.path.join(TEMP_DIR, "Zenith_Editor")
        os.makedirs(tmp_path, exist_ok=True)

        if image_b64:
            boundary = f"ZenithBoundary{uuid.uuid4().hex}"
            img_bytes = base64.b64decode(image_b64)

            body_parts = []
            def _field(name, value):
                return (f"--{boundary}\r\nContent-Disposition: form-data; "
                        f"name=\"{name}\"\r\n\r\n{value}\r\n").encode()
            def _file(name, filename, fdata, content_type):
                header = (f"--{boundary}\r\nContent-Disposition: form-data; "
                          f"name=\"{name}\"; filename=\"{filename}\"\r\n"
                          f"Content-Type: {content_type}\r\n\r\n").encode()
                return header + fdata + b"\r\n"

            body_parts.append(_field("model", model))
            body_parts.append(_field("prompt", prompt))
            body_parts.append(_field("n", "1"))
            body_parts.append(_field("size", size))
            body_parts.append(_field("response_format", "b64_json"))
            body_parts.append(_file("image", "image.png", img_bytes, "image/png"))
            body_parts.append(f"--{boundary}--\r\n".encode())

            req_body = b"".join(body_parts)
            req = urllib.request.Request(
                "https://api.openai.com/v1/images/edits",
                data=req_body,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": f"multipart/form-data; boundary={boundary}",
                },
            )
        else:
            payload = json.dumps({
                "model": model, "prompt": prompt, "n": 1,
                "size": size, "quality": qual, "response_format": "b64_json",
            }).encode()
            req = urllib.request.Request(
                "https://api.openai.com/v1/images/generations",
                data=payload,
                headers={"Authorization": f"Bearer {api_key}",
                         "Content-Type": "application/json"},
            )

        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            body_text = e.read().decode() if e.fp else ""
            return {"error": f"OpenAI image API error {e.code}: {body_text[:500]}"}
        except Exception as e:
            return {"error": str(e)}

        result_b64 = data["data"][0].get("b64_json", "")
        if not result_b64:
            return {"error": "OpenAI returned no image data."}

        tmp_name = f"gen_{uuid.uuid4().hex[:8]}.png"
        out_path = os.path.join(tmp_path, tmp_name)
        with open(out_path, "wb") as f:
            f.write(base64.b64decode(result_b64))

        return {"image_b64": result_b64, "path": out_path, "cost": cost,
                "model": model, "format": "png"}

    return {"error": f"Unsupported provider for image generation: {provider}"}


def enhance_prompt(args):
    """Rewrite a rough prompt into a detailed, professional image generation prompt using LLM."""
    prompt = args.get("prompt", "")
    api_key = args.get("api_key", "")
    provider = args.get("provider", "google")
    model = args.get("model", "")

    if not api_key:
        return {"error": "API key required to enhance prompts."}
    if not prompt.strip():
        return {"error": "No prompt provided."}

    system = ("You are an expert image prompt engineer. Rewrite the user's rough image description "
              "into a highly detailed, professional prompt for an AI image generator. "
              "Include: lighting, composition, style, mood, camera angle, and quality keywords. "
              "Return ONLY the enhanced prompt text, nothing else.")

    result = _call_llm(provider, api_key, model, prompt, system_prompt=system)
    if "error" in result:
        return result
    return {"enhanced_prompt": result["text"].strip()}


def auto_title_prompt(args):
    """Summarize an image generation prompt into a 2-4 word title for history display."""
    prompt = args.get("prompt", "")
    api_key = args.get("api_key", "")
    provider = args.get("provider", "google")
    model = args.get("model", "")

    if not api_key or not prompt.strip():
        # Fallback: take first 3 words
        words = prompt.strip().split()[:3]
        return {"title": " ".join(words).title() or "Untitled"}

    system = "You are a concise title generator. Return ONLY a 2-4 word title for the described image. No punctuation, no quotes."
    result = _call_llm(provider, api_key, model, prompt, system_prompt=system)
    if "error" in result:
        words = prompt.strip().split()[:3]
        return {"title": " ".join(words).title() or "Untitled"}

    title = result["text"].strip().strip('"').strip("'")[:40]
    return {"title": title}


def remove_background(args):
    """Remove background via AI green-screen then local chroma-key.

    Step 1: Send the image to Gemini with a prompt that replaces the
            background with flat lime-green (#00FF00) while keeping the
            main subject perfectly intact.
    Step 2: Locally chroma-key out the lime-green to produce an RGBA PNG
            with a transparent background.

    Required: { image_b64, api_key }
    Optional: { model, tolerance (0-100, default 40) }
    Returns:  { image_b64, path, cost, model, format }
    """
    import base64, urllib.request, urllib.error, uuid
    from PIL import Image
    import numpy as np

    image_b64 = args.get("image_b64", "")
    api_key = args.get("api_key", "")
    model = args.get("model", "gemini-3.1-flash-image-preview")
    tolerance = int(args.get("tolerance", 40))

    if not image_b64:
        return {"error": "No image provided for background removal."}
    if not api_key:
        return {"error": "API key required. Set it in Settings > API Keys."}

    # ── Step 1: Ask Gemini to paint the background lime-green ──────────
    green_prompt = (
        "Replace the ENTIRE background of this image with a perfectly flat, "
        "uniform, solid lime-green color (exactly hex #00FF00, RGB 0,255,0). "
        "Keep the main subject COMPLETELY unchanged — every single pixel of "
        "the subject must remain exactly as it is with zero modifications, "
        "zero artifacts, zero color shifts. Only the background should change "
        "to flat solid #00FF00 green. Do NOT add shadows, gradients, or any "
        "variation to the green — it must be perfectly uniform #00FF00."
    )

    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{model}:generateContent?key={api_key}")

    parts = [
        {"inline_data": {"mime_type": "image/png", "data": image_b64}},
        {"text": green_prompt},
    ]

    body = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE", "TEXT"],
        },
    }

    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=payload,
        headers={"Content-Type": "application/json; charset=utf-8"})

    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode() if e.fp else ""
        return {"error": f"Gemini API error {e.code}: {body_text[:500]}"}
    except Exception as e:
        return {"error": str(e)}

    # Extract green-screen image from response
    candidates = data.get("candidates", [])
    if not candidates:
        feedback = data.get("promptFeedback", {})
        block = feedback.get("blockReason", "")
        if block:
            return {"error": f"Blocked by safety filter: {block}"}
        return {"error": "No image returned by Gemini."}

    green_b64 = None
    for part in candidates[0].get("content", {}).get("parts", []):
        if "inlineData" in part:
            green_b64 = part["inlineData"]["data"]

    if not green_b64:
        return {"error": "Gemini returned no image for green-screen step."}

    # ── Step 2: Local chroma-key removal ───────────────────────────────
    green_bytes = base64.b64decode(green_b64)
    img = Image.open(__import__("io").BytesIO(green_bytes)).convert("RGBA")
    arr = np.array(img, dtype=np.float32)

    # Target: pure lime-green (0, 255, 0)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]

    # Distance from pure green — weighted to detect green shades
    # Green has high G channel, low R and B channels
    dist = np.sqrt(r**2 + (g - 255)**2 + b**2)

    # Create alpha mask: green pixels → transparent
    # tolerance controls how aggressively green is removed (0-100 mapped to pixel distance 0-120)
    threshold = tolerance * 1.2  # 40 → 48 pixel distance
    alpha = arr[:, :, 3].copy()
    # Fully transparent where very close to green
    alpha[dist < threshold * 0.6] = 0
    # Semi-transparent edge blending for smooth cutout
    edge_mask = (dist >= threshold * 0.6) & (dist < threshold)
    alpha[edge_mask] = ((dist[edge_mask] - threshold * 0.6) / (threshold * 0.4) * 255).clip(0, 255)

    # Also suppress any green spill on edges: desaturate green channel on semi-transparent pixels
    spill_mask = (alpha > 0) & (alpha < 240) & (g > 100) & (g > r * 1.3) & (g > b * 1.3)
    if np.any(spill_mask):
        avg = (r[spill_mask] + b[spill_mask]) / 2
        arr[:, :, 1][spill_mask] = np.minimum(g[spill_mask], avg + 30)

    arr[:, :, 3] = alpha
    result_img = Image.fromarray(arr.astype(np.uint8), "RGBA")

    # Save as PNG (only format that supports alpha)
    tmp_path = os.path.join(TEMP_DIR, "Zenith_Editor")
    os.makedirs(tmp_path, exist_ok=True)
    out_path = os.path.join(tmp_path, f"nobg_{uuid.uuid4().hex[:8]}.png")
    result_img.save(out_path, "PNG")

    # Encode result as base64
    import io
    buf = io.BytesIO()
    result_img.save(buf, "PNG")
    result_b64 = base64.b64encode(buf.getvalue()).decode()

    COST_MAP = {
        "gemini-3.1-flash-image-preview": 0.067,
        "gemini-3-pro-image-preview": 0.134,
    }
    cost = COST_MAP.get(model, 0.067)

    return {"image_b64": result_b64, "path": out_path, "cost": cost,
            "model": model, "format": "png"}


def save_editor_image(args):
    """Save a base64 image to a file with chosen format and quality."""
    import base64
    from PIL import Image
    image_b64 = args.get("image_b64", "")
    fmt = args.get("format", "png").lower()
    quality = int(args.get("quality", 90))
    filename = args.get("filename", "zenith_generated")

    if not image_b64:
        return {"error": "No image data provided."}

    FORMAT_MAP = {"png": ("PNG", ".png"), "jpg": ("JPEG", ".jpg"),
                  "jpeg": ("JPEG", ".jpg"), "webp": ("WEBP", ".webp")}
    pil_fmt, ext = FORMAT_MAP.get(fmt, ("PNG", ".png"))

    img_bytes = base64.b64decode(image_b64)
    img = Image.open(__import__("io").BytesIO(img_bytes))

    if pil_fmt == "JPEG" and img.mode in ("RGBA", "LA"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[3] if img.mode == "RGBA" else None)
        img = bg

    out = os.path.join(TEMP_DIR, f"{filename}{ext}")
    save_kwargs = {}
    if pil_fmt in ("JPEG", "WEBP"):
        save_kwargs["quality"] = quality
    img.save(out, pil_fmt, **save_kwargs)
    return {"path": out, "size": os.path.getsize(out), "format": fmt}


def reset_editor(_args):
    """Clear the Zenith Editor temp folder."""
    editor_dir = os.path.join(TEMP_DIR, "Zenith_Editor")
    removed = 0
    if os.path.isdir(editor_dir):
        for f in os.listdir(editor_dir):
            fp = os.path.join(editor_dir, f)
            try:
                os.remove(fp)
                removed += 1
            except Exception:
                pass
    return {"removed": removed, "dir": editor_dir}


from research_engine import (
    research_chat, search_papers, web_search_action,
    extract_pdf_text, check_novelty, verify_citations,
    run_experiment_action, export_chat, generate_section,
)

ACTIONS = {
    "recognize_audio": recognize_audio,
    "apply_audio_metadata": apply_audio_metadata,
    "undo_audio_metadata": undo_audio_metadata,
    "compress_image": compress_image,
    "strip_exif": strip_exif,
    "show_exif": show_exif,
    "convert_image": convert_image,
    "convert_webp": convert_webp,
    "save_palette_image": save_palette_image,
    "ocr_save_text": ocr_save_text,
    "email_draft": email_draft,
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
    "smart_organize_studio": smart_organize_studio,
    "generate_image": generate_image,
    "enhance_prompt": enhance_prompt,
    "auto_title_prompt": auto_title_prompt,
    "save_editor_image": save_editor_image,
    "remove_background": remove_background,
    "reset_editor": reset_editor,
    "research_chat": research_chat,
    "search_papers": search_papers,
    "web_search": web_search_action,
    "extract_pdf_text": extract_pdf_text,
    "check_novelty": check_novelty,
    "verify_citations": verify_citations,
    "run_experiment": run_experiment_action,
    "export_chat": export_chat,
    "generate_section": generate_section,
}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: process_files.py <action>  (args JSON via stdin)"}))
        sys.exit(1)

    action = sys.argv[1]
    try:
        # Args are sent via stdin to avoid Windows 32K command-line length limit
        # (base64 image payloads easily exceed that).
        # Fallback: if a second CLI arg is provided, use it (backward compat).
        raw = sys.argv[2] if len(sys.argv) > 2 else sys.stdin.read()
        args = json.loads(raw) if raw.strip() else {}
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
        print(json.dumps(output, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)
