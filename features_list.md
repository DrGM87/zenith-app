# Zenith — Full Technical Feature Reference

> **Generated:** 2026-05-09  
> **Version:** 0.1.0  
> **Purpose:** Exhaustive, code-verified specification of every feature, endpoint, component, and integration present in the codebase. This is a reference document, not marketing copy.

---

## 1. AI Providers

### 1.1 Text LLM (`_call_llm()` — `scripts/process_files.py:779`)

| Provider   | API Endpoint                                                | Default Model              | Auth Header          | Status                        |
| ---------- | ----------------------------------------------------------- | -------------------------- | -------------------- | ----------------------------- |
| DeepSeek   | `https://api.deepseek.com/chat/completions`                 | `deepseek-v4-pro`          | `Bearer {api_key}`   | Fully supported — text only   |
| Google     | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | `gemini-3.1-flash-lite-preview` | `?key={api_key}` (query param) | Fully supported — text only |
| OpenAI     | Not in `_call_llm()`                                        | —                          | —                    | **Text LLM NOT implemented**  |
| Anthropic  | Not in `_call_llm()`                                        | —                          | —                    | **Text LLM NOT implemented**  |
| Groq       | Not in `_call_llm()`                                        | —                          | —                    | **NOT implemented at all**    |

**DeepSeek models** (2 total, `src/components/Settings.tsx:143-145`):

| Model ID            | Label                     | Input ($/1M) | Output ($/1M) | Notes                             |
| ------------------- | ------------------------- | ------------ | ------------- | --------------------------------- |
| `deepseek-v4-flash` | DeepSeek V4 Flash         | 0.14         | 0.28          | Fast, cheap                       |
| `deepseek-v4-pro`   | DeepSeek V4 Pro (Thinking)| 0.435        | 0.87          | Reasoning + thinking mode enabled |

**DeepSeek V4 extra parameters** (`process_files.py:802-806`):
- `max_tokens`: 16384 (up from base 8192)
- `thinking`: `{"type": "enabled"}`
- `reasoning_effort`: `"high"`
- `temperature`: 0.3

**Google Gemini models** (5 total, `src/components/Settings.tsx:147-152`):

| Model ID                            | Label                         | Input ($/1M) | Output ($/1M) | Type         |
| ----------------------------------- | ----------------------------- | ------------ | ------------- | ------------ |
| `gemini-3.1-flash-lite-preview`     | Gemini 3.1 Flash Lite         | 0.075        | 0.30          | Text         |
| `gemini-3.1-flash-preview`          | Gemini 3.1 Flash              | 0.10         | 0.40          | Text         |
| `gemini-3.1-pro-preview`            | Gemini 3.1 Pro                | 1.25         | 5.00          | Text         |
| `gemini-3.1-flash-image-preview`    | Nano Banana 2 (Image Gen)     | 0.067        | 0             | Image Gen    |
| `gemini-3-pro-image-preview`        | Nano Banana Pro (Image Gen)   | 0.134        | 0             | Image Gen    |

### 1.2 Vision LLM (`_call_llm_vision()` — `scripts/process_files.py:1363`)

| Provider   | Default Model                 | API Endpoint                                         | Auth                          |
| ---------- | ----------------------------- | ---------------------------------------------------- | ----------------------------- |
| OpenAI     | `gpt-4.1-nano`                | `https://api.openai.com/v1/chat/completions`         | `Bearer {api_key}`            |
| Anthropic  | `claude-sonnet-4-20250514`    | `https://api.anthropic.com/v1/messages`              | `x-api-key: {api_key}`        |
| Google     | `gemini-3.1-flash-lite-preview`| `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | `?key={api_key}` |

**Note:** OpenAI and Anthropic are supported **only** for vision calls (`_call_llm_vision`). They are **not** selectable in the Settings UI (only DeepSeek and Google appear in the provider dropdown). Text-only LLM routes exclusively through DeepSeek and Google.

### 1.3 Image Generation (`generate_image()` — `scripts/process_files.py:2817`)

| Provider | Supported | Models                               |
| -------- | --------- | ------------------------------------ |
| Google   | Yes       | `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview` |
| OpenAI   | No        | —                                    |

**Gemini image gen parameters:**

| Parameter         | Values                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `aspect_ratio`    | `"1:1"`, `"1:4"`, `"1:8"`, `"2:3"`, `"3:2"`, `"3:4"`, `"4:1"`, `"4:3"`, `"4:5"`, `"5:4"`, `"8:1"`, `"9:16"`, `"16:9"`, `"21:9"` |
| `image_size`      | `"512"`, `"1K"`, `"2K"`, `"4K"` (Flash models only)                                                                 |
| `thinking_level`  | `"minimal"`, `"low"`, `"medium"`, `"high"` (Flash image preview model only)                                         |
| `temperature`     | 0.05–1.0 float                                                                                                      |
| `adherence`       | 0–100 (inverse map to temperature)                                                                                   |
| `negative_prompt` | String — injected into main prompt                                                                                   |
| `style`           | `"photorealistic"`, `"digital_art"`, `"vector"`, `"anime"`, `"watercolor"`, `"oil_painting"`, `"3d_render"`, `"pixel_art"`, `"sketch"` |

**Per-image cost** (`process_files.py:2853-2856`):
- Nano Banana 2: $0.067/image
- Nano Banana Pro: $0.134/image

---

## 2. File Actions (Python Dispatch)

**Source:** `scripts/process_files.py:3251-3294` — the `ACTIONS` dict.

All 42 actions, grouped by category with function definition line numbers:

### Image (10 actions)
| #  | Action              | Line | Description                                      |
| -- | ------------------- | -----| ------------------------------------------------ |
| 1  | `compress_image`    | 27   | Compress image with quality + optional max_dim resize |
| 2  | `strip_exif`        | 53   | Remove EXIF metadata from image                  |
| 3  | `show_exif`         | 69   | Read and return EXIF metadata (read-only)        |
| 4  | `convert_image`     | 104  | Convert between PNG/JPG/WebP/BMP/TIFF/GIF formats|
| 5  | `convert_webp`      | 232  | Convert image to WebP with quality control       |
| 6  | `save_palette_image`| 161  | Save extracted color palette as a swatch image   |
| 7  | `ocr_save_text`     | 192  | OCR image via LLM vision or Tesseract → .txt file|
| 8  | `resize_image`      | 426  | Resize to exact dims or percentage, with fill_color|
| 9  | `extract_palette`   | 988  | Extract dominant colors via KMeans + WCAG ratios |
| 10 | `file_to_base64`    | 1037 | Convert file to base64 (raw, html_img, css_url formats) |

### PDF (4 actions)
| #  | Action          | Line | Description                                         |
| -- | --------------- | ----- | --------------------------------------------------- |
| 11 | `merge_pdf`     | 305  | Merge multiple PDFs into one                        |
| 12 | `compress_pdf`  | 343  | Compress PDF by rewriting                           |
| 13 | `ocr_to_pdf`    | 1756 | Convert image to searchable PDF via OCR             |
| 14 | `pdf_to_csv`    | 1820 | Extract structured data from PDF to CSV via LLM     |

### Archive (4 actions)
| #  | Action       | Line | Description                                           |
| -- | ------------ | ----- | ----------------------------------------------------- |
| 15 | `zip_file`   | 381  | Zip single file/folder with compression level (1–9)   |
| 16 | `zip_files`  | 248  | Bundle multiple files into a zip                      |
| 17 | `zip_encrypt`| 266  | Password-protected zip via 7z or pyminizip (AES-256)  |
| 18 | `split_file` | 511  | Split file into chunks of specified MB size           |

### AI / LLM (10 actions)
| #  | Action              | Line | Description                                        |
| -- | ------------------- | ------ | -------------------------------------------------- |
| 19 | `smart_rename`      | 536  | Content-aware rename: extracts "soul" → 3 suggestions |
| 20 | `smart_sort`        | 700  | LLM-suggested categories/tags for files            |
| 21 | `ocr`               | 731  | Extract text from images via LLM vision or Tesseract|
| 22 | `auto_organize`     | 844  | LLM file organization: rename + categorize into folders |
| 23 | `translate_file`    | 929  | Translate text/PDF content via LLM, chunked        |
| 24 | `ask_data`          | 1081 | RAG-lite: chunk + keyword retrieval → answer       |
| 25 | `summarize_file`    | 1131 | Summarize document with TL;DR                       |
| 26 | `super_summary`     | 1184 | Multi-document cited summary with TL;DR             |
| 27 | `generate_dashboard`| 1232 | Interactive HTML dashboard from CSV via LLM + Chart.js |
| 28 | `email_draft`       | 209  | LLM-drafted email subject + body for file attachment |

### Audio (3 actions)
| #  | Action                | Line | Description                                    |
| -- | --------------------- | ------ | ---------------------------------------------- |
| 29 | `recognize_audio`     | 2471 | Shazam fingerprint → TheAudioDB enrichment    |
| 30 | `apply_audio_metadata`| 2539 | Write metadata tags + cover art to audio file  |
| 31 | `undo_audio_metadata` | 2779 | Revert metadata + rename for one audio file    |

### Media (2 actions)
| #  | Action         | Line | Description                                    |
| -- | -------------- | ------ | ---------------------------------------------- |
| 32 | `convert_media`| 1888 | Convert media via FFmpeg (e.g. .mov → .mp4)   |
| 33 | `url_to_qr`    | 1736 | Generate QR code PNG from URL string           |

### Security (1 action)
| #  | Action           | Line | Description                                             |
| -- | ---------------- | ------ | ------------------------------------------------------- |
| 34 | `scan_virustotal`| 1615 | VirusTotal API v3 file/URL scan (hash lookup → upload → poll) |

### Studio (1 action)
| #  | Action                 | Line | Description                                          |
| -- | ---------------------- | ------ | ---------------------------------------------------- |
| 35 | `smart_organize_studio`| 1957 | Auto-Studio: analyze files by type, call APIs, return plan |

### Editor (6 actions)
| #  | Action              | Line | Description                                          |
| -- | ------------------- | ------ | ---------------------------------------------------- |
| 36 | `generate_image`    | 2817 | Generate/edit image via Gemini image APIs            |
| 37 | `enhance_prompt`    | 2977 | Rewrite rough prompt via DeepSeek V4 for Nano Banana |
| 38 | `auto_title_prompt` | 3015 | Summarize image prompt into 2–4 word title           |
| 39 | `save_editor_image` | 3174 | Save base64 image to file with format + quality      |
| 40 | `remove_background` | 3037 | AI green-screen then local chroma-key bg removal     |
| 41 | `reset_editor`      | 3212 | Clear the Zenith Editor temp folder                  |

### Export (1 action)
| #  | Action          | Line | Description                                   |
| -- | --------------- | ------ | --------------------------------------------- |
| 42 | `export_content`| 3231 | Write manuscript/bibliography content to file |

---

## 3. Staged Item Card Actions (UI)

**Source:** `src/components/StagedItemCard.tsx:47-135` — `getActionsForItem()`

27 total UI actions, context-dependent:

| #  | Action                   | Icon                              | Label         | Context                           |
| -- | ------------------------ | --------------------------------- | ------------- | --------------------------------- |
| 1  | `url_to_qr`              | `fa-qrcode`                      | QR Code       | URL items only                    |
| 2  | `scan_virustotal_url`    | `fa-shield-halved`               | Scan URL      | URL items only                    |
| 3  | `convert_image`          | `fa-arrow-right-arrow-left`      | Convert       | Image extensions                  |
| 4  | `exif_panel`             | `fa-tags`                        | EXIF          | Image extensions                  |
| 5  | `extract_palette`        | `fa-palette`                     | Palette       | Image extensions                  |
| 6  | `resize_image`           | `fa-expand`                      | Resize        | Image extensions                  |
| 7  | `file_to_base64`         | `fa-code`                        | Base64        | Image extensions                  |
| 8  | `ocr_save_text`          | `fa-font`                        | OCR           | Image extensions                  |
| 9  | `compress_pdf`           | `fa-file-pdf`                    | Compress PDF  | PDF extensions                    |
| 10 | `pdf_to_csv`             | `fa-table`                       | PDF → CSV     | PDF extensions                    |
| 11 | `ask_data`               | `fa-comments`                    | Ask Data      | PDF + text extensions             |
| 12 | `summarize_file`         | `fa-book-open`                   | Summarize     | PDF + text extensions             |
| 13 | `translate_file`         | `fa-language`                    | Translate     | PDF + text extensions             |
| 14 | `generate_dashboard`     | `fa-chart-column`                | Dashboard     | CSV/TSV extensions                |
| 15 | `recognize_audio`        | `fa-music`                       | Recognize     | Audio extensions                  |
| 16 | `convert_audio`          | `fa-headphones`                  | Convert Audio | Audio extensions                  |
| 17 | `convert_media`          | `fa-film`                        | Convert Video | Video extensions                  |
| 18 | `scan_virustotal_file`   | `fa-shield-halved`               | Scan          | All file/folder items (has path)  |
| 19 | `open_file`              | `fa-play` (audio) / `fa-up-right-from-square` (other) | Play / Open | Audio → Play; other → Open file   |
| 20 | `reveal_in_folder`       | `fa-folder-open`                 | Reveal        | All file/folder items             |
| 21 | `open_editor`            | `fa-paintbrush`                  | Editor        | Image extensions only             |
| 22 | `archive_file`           | `fa-file-zipper`                 | Archive       | All file/folder items             |
| 23 | `email_files`            | `fa-envelope`                    | Email         | All file/folder items             |
| 24 | `smart_rename`           | `fa-wand-magic-sparkles`         | AI Rename     | All (non-audio) file items        |
| 25 | `smart_rename_audio_ask` | `fa-wand-magic-sparkles`         | AI Rename     | Audio extensions only             |
| 26 | `preview_file`           | `fa-eye`                         | Preview       | Non-audio, non-image items        |
| 27 | `copy_path` / `copy_text`| `fa-copy`                        | Copy Path / Copy Text | All items              |

**MIME extension sets** (defined as `Set` constants in `StagedItemCard.tsx`):
- `IMAGE_EXTS`: jpg, jpeg, png, gif, webp, bmp, tiff, tif, svg, ico, heic
- `PDF_EXTS`: pdf
- `TEXT_EXTS`: txt, md, log, csv, tsv, json, xml, html, htm, py, js, ts, jsx, tsx, css, scss, rs, toml, yaml, yml
- `AUDIO_EXTS`: mp3, flac, wav, ogg, aac, m4a, wma
- `VIDEO_EXTS`: mp4, mkv, avi, mov, wmv, flv, webm, m4v
- `DATA_EXTS`: csv, tsv

---

## 4. Generative Editor

**Source:** `src/components/ZenithEditor.tsx`, `scripts/process_files.py:2817-3210`

### 4.1 Models (2, Google only)

| ID                                   | Label              | Cost/Image | Thinking Levels                    |
| ------------------------------------ | ------------------ | ---------- | ---------------------------------- |
| `gemini-3.1-flash-image-preview`     | Nano Banana 2      | $0.067     | minimal, low, medium, high (4)    |
| `gemini-3-pro-image-preview`         | Nano Banana Pro    | $0.134     | Not supported (Pro model)          |

### 4.2 Aspect Ratios (14)
`"1:1"`, `"1:4"`, `"1:8"`, `"2:3"`, `"3:2"`, `"3:4"`, `"4:1"`, `"4:3"`, `"4:5"`, `"5:4"`, `"8:1"`, `"9:16"`, `"16:9"`, `"21:9"`

### 4.3 Image Sizes (4, Flash models only)
`"512"`, `"1K"`, `"2K"`, `"4K"`

### 4.4 Features
- **Thread management**: create, rename, delete generation threads
- **History**: full undo/redo with step counter, duplicate thread
- **Prompt library**: save/load/import/export prompts
- **Prompt enhancement**: DeepSeek V4-powered prompt rewriting, with revert and re-enhance
- **Background removal**: AI green-screen → local chroma-key pipeline, with cancel
- **Quick save**: `save_editor_image` (saves to disk) + stage-to-bubble
- **Gen-to-gen comparison**: toggle between two generated images side-by-side
- **Expanded image overlay**: full-view overlay with zoom/pan actions
- **Parameter reset**: reset all generation params to defaults
- **50-item limit warning**: warns when gallery exceeds 50 images
- **Thread backup/restore**: export/import full thread state

### 4.5 Data Storage
- **LocalStorage keys**: `zenith_editor_threads`, `zenith_editor_prompts`, `zenith_presets`, `zenith_onboarding_seen`

---

## 5. Visual Effects (ReactBits)

**Source:** `src/components/effects/index.ts` — 15 effect components, all re-exported from `@/components/ReactBits`

| #  | Component            | Description                                                |
| -- | -------------------- | ---------------------------------------------------------- |
| 1  | `AuroraBg`           | Animated aurora borealis background effect                 |
| 2  | `BorderGlow`         | Animated glowing border effect on containers               |
| 3  | `Carousel`           | Horizontal scrolling carousel with configurable items      |
| 4  | `ClickSpark`         | Particle burst animation at click/tap location             |
| 5  | `FloatingParticles`  | Floating/drifting particle field overlay                   |
| 6  | `GlareHover`         | Mouse-tracking glare/shine effect on hover                 |
| 7  | `GlowOrbs`           | Floating glowing orb animations in background              |
| 8  | `GradientText`       | Text with animated gradient color fill                     |
| 9  | `MagicRings`         | Animated ring/circle patterns                              |
| 10 | `ShinyBar`           | Animated shimmer bar (loading/progress indicator)          |
| 11 | `ShinyText`          | Text with shimmering highlight animation                   |
| 12 | `SoftAurora`         | Softer, subtler aurora background variant                  |
| 13 | `SpotlightCard`      | Card with mouse-tracking spotlight/radial highlight        |
| 14 | `SquaresBg`          | Animated grid/checkerboard background pattern              |
| 15 | `StarBorder`         | Animated star/dot border decoration on containers          |

These are configured in `Settings.tsx` and rendered through `ReactBits.tsx` (re-export barrel) and controlled via `AppearanceSettings`:
- `border_glow` (boolean)
- `border_glow_speed` (float)
- `aurora_bg` (boolean)
- `aurora_speed` (float)
- `spotlight_cards` (boolean)

---

## 6. Settings

**Source:** `src/components/Settings.tsx:120-131`

### 6.1 Tabs (10)

| #  | Tab ID        | Label       | Icon                        | Contents                                         |
| -- | ------------- | ----------- | --------------------------- | ------------------------------------------------ |
| 1  | `general`     | General     | `fa-sliders`                | Launch on startup, tray icon, check for updates, plugins directory |
| 2  | `appearance`  | Appearance  | `fa-palette`                | Theme (dark/light/system), opacity, blur, corner radius, accent color, font size, animation speed, border glow, aurora bg, spotlight cards |
| 3  | `behavior`    | Behavior    | `fa-brain`                  | Collapse delay, expand on hover/drag, auto-collapse on blur, confirm clear all, max staged items, duplicate detection, position |
| 4  | `processing`  | Processing  | `fa-compress`               | Image quality, WebP quality, PDF compression level (low/medium/high), default resize %, split chunk size MB |
| 5  | `api_keys`    | API Keys    | `fa-key`                    | API key management: provider (DeepSeek/Google), label, key, model, default flag. Delete/add entries. |
| 6  | `ai_tools`    | AI Prompts  | `fa-wand-magic-sparkles`   | Custom system prompts for: smart_rename, smart_sort, ocr, auto_organize, translate, ask_data, summarize, super_summary, dashboard |
| 7  | `token_usage` | Token Usage | `fa-chart-line`             | Aggregated token usage + cost: entries per provider, total input/output tokens, total USD cost |
| 8  | `activity`    | Activity    | `fa-history`                | Activity log viewer with clear option             |
| 9  | `shortcuts`   | Shortcuts   | `fa-keyboard`               | Keyboard shortcut configuration: stage clipboard, toggle window, clear all |
| 10 | `scripts`     | Scripts     | `fa-puzzle-piece`           | Script plugin management: add/enable/disable/remove custom scripts |

### 6.2 Additional Settings (non-tab)
- `vt_api_key`: VirusTotal API key (string)
- `omdb_api_key`: OMDB API key (string)
- `audiodb_api_key`: TheAudioDB API key (string)
- `imdb_api_key`: IMDB API key (string)
- `shazam_auto_recognize`: Boolean toggle for automatic audio recognition

### 6.3 Accent Color Presets
`#22d3ee`, `#8b5cf6`, `#f43f5e`, `#10b981`, `#f59e0b`, `#3b82f6`, `#ec4899`, `#14b8a6`

### 6.4 Bubble Position Options
`bottom-right`, `bottom-left`, `top-right`, `top-left`

### 6.5 LLM Provider Dropdown
Only 2 providers selectable: `deepseek`, `google`

---

## 7. REST API

**Source:** `src-tauri/src/api_server.rs` — listens on `http://127.0.0.1:7890`

18 endpoints:

| #  | Method  | Path                              | Description                                                   |
| -- | ------- | --------------------------------- | ------------------------------------------------------------- |
| 1  | `GET`   | `/items`                          | List all staged items as JSON array                           |
| 2  | `POST`  | `/stage/file`                     | Stage a file by path (`{"path": "..."}`)                      |
| 3  | `POST`  | `/stage/text`                     | Stage raw text as a text item (`{"text": "..."}`)             |
| 4  | `DELETE`| `/items`                          | Clear all staged items                                        |
| 5  | `DELETE`| `/items/{id}`                     | Remove a single staged item by ID                             |
| 6  | `POST`  | `/process`                        | Execute a Python action (`{"action": "...", "args": {...}}`)  |
| 7  | `GET`   | `/settings`                       | Read full settings JSON                                       |
| 8  | `PUT`   | `/settings`                       | Write full settings JSON                                      |
| 9  | `POST`  | `/items/{id}/self-destruct`       | Set self-destruct timer (`{"destruct_at": <timestamp|null>}`) |
| 10 | `GET`   | `/health`                         | Health check → `{"status":"ok","app":"zenith","version":"4.0"}`|
| 11 | `GET`   | `/browse/{id}`                    | Browse directory children of a staged folder item             |
| 12 | `POST`  | `/window/open`                    | Open/replace script window content                            |
| 13 | `POST`  | `/window/update`                  | Update script window content (no close/reopen)                |
| 14 | `DELETE`| `/window`                         | Close script window                                           |
| 15 | `GET`   | `/window/content`                 | Get current script window content (or `null`)                 |
| 16 | `POST`  | `/window/event`                   | Push event to script window event queue                       |
| 17 | `GET`   | `/window/events`                  | Drain and return script window event queue                    |
| 18 | `POST`  | `/browse`                         | Browse arbitrary directory (`{"path": "..."}`)                |

**CORS:** `Access-Control-Allow-Origin: http://localhost:1420` (Tauri dev server)

---

## 8. Tech Stack

### 8.1 Frontend

| Technology       | Version | Purpose                        |
| ---------------- | ------- | ------------------------------ |
| React            | 19      | UI framework                   |
| TypeScript       | 5.8     | Type-safe language             |
| Tailwind CSS     | 4       | Utility-first CSS              |
| Framer Motion    | 12      | Animation library              |
| Zustand          | 5       | State management               |
| Vite             | (bundled via Tauri) | Build tool             |
| Font Awesome     | 6 (via CDN) | Icon library              |
| Chart.js         | (via CDN, generated dashboards) | Charts         |
| html2canvas      | (via CDN, generated dashboards) | PNG export       |

### 8.2 Tauri v2 (Rust Backend)

**Source:** `src-tauri/Cargo.toml`

| Crate                          | Version | Purpose                                      |
| ------------------------------ | ------- | -------------------------------------------- |
| `tauri`                        | 2       | App framework (features: protocol-asset, tray-icon, image-png) |
| `tauri-plugin-opener`          | 2       | Open files/URLs in OS default handler         |
| `tauri-plugin-clipboard-manager`| 2      | Clipboard read/write                          |
| `tauri-plugin-global-shortcut` | 2       | Global keyboard shortcuts                     |
| `serde`                        | 1       | Serialization (with derive)                   |
| `serde_json`                   | 1       | JSON parsing/writing                          |
| `base64`                       | 0.22    | Base64 encode/decode                          |
| `image`                        | 0.25    | Image loading/processing (png, jpeg, gif, bmp, ico, webp) |
| `drag`                         | 2       | Drag-and-drop file handling                   |
| `wasmtime`                     | 29      | WebAssembly runtime (plugin sandbox)          |
| `uuid`                         | 1       | UUID v4 generation                            |
| `walkdir`                      | 2       | Recursive directory walking                   |
| `reqwest`                      | 0.13.2  | HTTP client                                   |
| `keyring`                      | 3       | OS-native credential storage (API key encryption) |
| `cpal`                         | 0.15    | Low-level audio I/O (microphone recording)    |
| `hound`                        | 3       | WAV audio file reading/writing                |

**NOT included** (contrary to prior README claims): `aes-gcm`, `argon2`, `sha2`, `hex`, `rand`

### 8.3 Python Sidecar

**Source:** `scripts/requirements.txt`

| Package                    | Min Version | Purpose                                         |
| -------------------------- | ----------- | ----------------------------------------------- |
| `requests`                 | 2.31.0      | HTTP client — Shazam API                        |
| `urllib3`                  | 1.26.0      | HTTP internals — SSL warning suppression        |
| `beautifulsoup4`           | 4.12.0      | HTML parsing                                    |
| `Pillow`                   | 10.0.0      | Image processing (EXIF, resize, compress, palette)|
| `numpy`                    | 1.24.0      | Numeric arrays — Shazam fingerprinting, RAG     |
| `packaging`                | 23.0        | Version comparison for PDF lib detection        |
| `pdfplumber`               | 0.10.0      | PDF text + table extraction (Tier 2)            |
| `pymupdf`                  | 1.24.0      | Fast layout-aware PDF extraction + PDF→PNG     |
| `pypdf`                    | 3.0.0       | Pure-Python PDF extraction (Tier 4, last resort)|
| `pikepdf`                  | 8.0.0       | PDF compression (lossless)                      |
| `reportlab`                | 4.0.0       | PDF generation (research export, OCR→PDF)       |
| `chromadb`                 | 0.4.0       | Local vector store for RAG                      |
| `sentence-transformers`    | 2.7.0       | Embedding models (SPECTER2/NOMIC/MedEmbed)     |
| `peft`                     | 0.10.0      | Parameter-efficient fine-tuning adapters        |
| `einops`                   | 0.7.0       | Tensor operations for embeddings                |
| `adapters`                 | 1.0.0       | Adapter-based model loading                     |
| `rank-bm25`                | 0.2.2       | BM25 sparse retrieval for RAG                   |
| `nltk`                     | 3.8.0       | Tokenization for BM25 + text chunking           |
| `pydub`                    | 0.25.1      | Audio file loading / format conversion          |
| `mutagen`                  | 1.47.0      | Audio metadata read/write (ID3, MP4, Vorbis, ASF)|
| `qrcode[pil]`              | 7.4         | QR code generation                              |
| `pyminizip`                | 0.2.6       | Encrypted ZIP (AES-256) fallback                |
| `google-genai`             | 0.8.0       | Gemini API client — text-embedding-004          |

**Optional (disabled/commented out in requirements.txt):**
- `torch>=2.0.0`, `transformers>=5.3.0`, `accelerate>=0.26.0` — GLM-OCR Tier 1 (GPU-based, disabled by default)
- `scipy>=1.11.0`, `matplotlib>=3.8.0` — research engine (removed)

---

## 9. Data Storage

### 9.1 File System

| Path                                   | File                    | Purpose                                       |
| -------------------------------------- | ----------------------- | --------------------------------------------- |
| `%APPDATA%/Zenith/`                    | `settings.json`         | All user settings (serialized ZenithSettings) |
| `%APPDATA%/Zenith/`                    | `state.json`            | Persisted staged items state                  |
| `%APPDATA%/Zenith/`                    | `tags.json`             | Item tag assignments                          |
| `%APPDATA%/Zenith/`                    | `activity_log.json`     | Chronological activity log                    |
| `%APPDATA%/Zenith/`                    | `clipboard_history.json`| Clipboard history entries                     |
| `%APPDATA%/Zenith/`                    | `music_discovery.json`  | Saved music discovery tracks                  |
| `%TEMP%/Zenith/`                       | `rename_history.json`   | Rename undo/redo history                      |
| `%TEMP%/Zenith/`                       | `mapping_history.json`  | File move/mapping history                     |
| `%TEMP%/Zenith/`                       | `tx_{id}.json`          | Transaction logs (per operation)              |

### 9.2 Browser LocalStorage

| Key                        | Purpose                                      |
| -------------------------- | -------------------------------------------- |
| `zenith_editor_threads`    | Editor generation threads (full state)       |
| `zenith_editor_prompts`    | Saved prompt library                         |
| `zenith_presets`           | Conversion presets                           |
| `zenith_onboarding_seen`   | Onboarding tour completion flag              |

---

## 10. Tauri Windows

**Source:** `src-tauri/src/lib.rs:83-277` (run function) and `src-tauri/src/commands/` (window helpers)

| Window Label        | Size                                       | Purpose                                     |
| ------------------- | ------------------------------------------ | ------------------------------------------- |
| `main`              | 80×80 (collapsed), 480×720 (expanded)      | Primary bubble/staging area window          |
| `settings`          | ~700×600 (estimated)                       | Settings modal window                        |
| `zenith_editor`     | ~1200×800 (estimated)                      | Image generation/editing workspace           |
| `script`            | Configurable width/height                  | Script plugin display window                 |
| `music_discovery`   | ~500×700 (estimated)                       | Music discovery browser                      |

---

## 11. Keyboard Shortcuts

| Shortcut           | Context        | Action                                        |
| ------------------ | -------------- | --------------------------------------------- |
| `Ctrl+Shift+V`     | Global         | Stage clipboard content                       |
| `Ctrl+Shift+Z`     | Global         | Toggle main window (expand/collapse)          |
| `?`                | Bubble (main)  | Show shortcuts help panel                     |
| `Ctrl+Z`           | Editor         | Undo last generation/action                   |
| `Ctrl+Shift+Z`     | Editor         | Redo last undone action                       |
| `Escape`           | Global         | Close modals, collapse panel                  |

---

## 12. Frontend Components

**Source:** `src/components/`

| #  | Component              | File                    | Purpose                                          |
| -- | ---------------------- | ----------------------- | ------------------------------------------------ |
| 1  | `Bubble`               | `Bubble.tsx`            | Main floating bubble UI with staged item grid    |
| 2  | `StagedItemCard`       | `StagedItemCard.tsx`    | Individual staged item card with action buttons  |
| 3  | `Settings`             | `Settings.tsx`          | Settings modal with 10 tabs                      |
| 4  | `PreviewDrawer`        | `PreviewDrawer.tsx`     | File content preview drawer                      |
| 5  | `ReviewStudio`         | `ReviewStudio.tsx`      | Smart organize review/approval panel             |
| 6  | `ZenithEditor`         | `ZenithEditor.tsx`      | AI image generation/editing workspace            |
| 7  | `MusicDiscoveryPage`   | `MusicDiscoveryPage.tsx`| Music discovery browser (Shazam + TheAudioDB)    |
| 8  | `ScriptWindow`         | `ScriptWindow.tsx`      | Custom script plugin display container           |
| 9  | `DraggablePanel`       | `DraggablePanel.tsx`    | Draggable/resizable floating panel wrapper       |
| 10 | `ErrorToast`           | `ErrorToast.tsx`        | Error notification toast with retry support      |
| 11 | `OnboardingTour`       | `OnboardingTour.tsx`    | First-run onboarding walkthrough                 |
| 12 | `FolderTree`           | `FolderTree.tsx`        | Directory tree browser for folder staging        |
| 13 | `ReactBits`            | `ReactBits.tsx`         | Re-export barrel for all 15 visual effect components |
| —  | `effects/AuroraBg`     | `effects/AuroraBg.tsx`  | Aurora background effect                         |
| —  | `effects/BorderGlow`   | `effects/BorderGlow.tsx`| Glowing border effect                            |
| —  | `effects/Carousel`     | `effects/Carousel.tsx`  | Horizontal scroll carousel                       |
| —  | `effects/ClickSpark`   | `effects/ClickSpark.tsx`| Click particle burst                             |
| —  | `effects/FloatingParticles`| `effects/FloatingParticles.tsx`| Drifting particles                    |
| —  | `effects/GlareHover`   | `effects/GlareHover.tsx`| Mouse-tracking glare                             |
| —  | `effects/GlowOrbs`     | `effects/GlowOrbs.tsx`  | Floating glowing orbs                            |
| —  | `effects/GradientText` | `effects/GradientText.tsx`| Animated gradient text                         |
| —  | `effects/MagicRings`   | `effects/MagicRings.tsx`| Animated ring patterns                           |
| —  | `effects/ShinyBar`     | `effects/ShinyBar.tsx`  | Shimmer loading bar                              |
| —  | `effects/ShinyText`    | `effects/ShinyText.tsx` | Shimmer text highlight                           |
| —  | `effects/SoftAurora`   | `effects/SoftAurora.tsx`| Soft aurora background                           |
| —  | `effects/SpotlightCard`| `effects/SpotlightCard.tsx`| Mouse-tracking card spotlight                 |
| —  | `effects/SquaresBg`    | `effects/SquaresBg.tsx` | Grid background pattern                          |
| —  | `effects/StarBorder`   | `effects/StarBorder.tsx`| Star/dot border decoration                       |

---

## 13. Store State Shape

**Source:** `src/store.ts:200-303` — `ZenithState` interface (Zustand store)

### 13.1 Core State Fields (~60 total)

```
ZenithState {
    // Items & Staging
    items: StagedItem[]
    isExpanded: boolean
    isDragOver: boolean

    // Settings
    settings: ZenithSettings | null

    // Clipboard
    clipboardStack: string[]
    isStackMode: boolean

    // Selection
    selectedIds: Set<string>

    // Preview
    previewPanes: PreviewPane[]

    // Rename
    renameStates: Record<string, RenameState>
    batchRenameMode: boolean
    renameUndoCount: number
    renameRedoCount: number

    // Tags
    tags: Record<string, { name: string; color: string }>

    // Presets
    presets: ConversionPreset[]

    // Review Studio
    isStudioOpen: boolean
    studioPlan: StudioPlan | null
    studioProgress: StudioProgress | null
    studioExecuting: boolean
    studioGroupImages: "date" | "vision"
    studioGroupDocs: "category" | "type" | "date"
    studioVideoHint: "auto" | "movie" | "personal"
    studioAudioHint: "auto" | "music" | "personal"

    // Audio Recognition
    audioResults: Record<string, AudioRecognitionResult>
    audioUndoStack: AudioUndoEntry[][]
    audioRedoStack: AudioUndoEntry[][]

    // Error Handling
    itemErrors: Record<string, string>
    zenithError: { message: string; details?: string } | null
    retryAction: (() => void) | null

    // Remove-Undo
    removedItemStack: StagedItem[]

    // Token Tracking (in settings.token_usage)
}
```

### 13.2 Actions / Methods (~45 methods)

| Category          | Methods                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------- |
| **Items**         | `stageFile`, `stageText`, `removeItem`, `clearAll`, `loadItems`, `startDragOut`, `checkItemLiveness` |
| **Expansion**     | `setExpanded`, `setDragOver`                                                                 |
| **Clipboard**     | `setStackMode`, `pushToStack`, `clearStack`, `copyStack`                                     |
| **Selection**     | `toggleSelect`, `selectAll`, `clearSelection`, `selectByPath`                                |
| **Settings**      | `loadSettings`                                                                               |
| **Token**         | `trackTokenUsage`                                                                            |
| **Rename**        | `setRenameState`, `cycleRenameSuggestion`, `setBatchRenameMode`, `setRenameUndoCounts`, `refreshRenameCounts` |
| **Preview**       | `openPreview`, `closePreview`, `closeAllPreviews`, `updatePreviewContent`, `updatePreviewError`, `setPreviewLoading` |
| **Studio**        | `setStudioOpen`, `setStudioPlan`, `setStudioProgress`, `setStudioExecuting`, `setStudioGroupImages`, `setStudioGroupDocs`, `setStudioVideoHint`, `setStudioAudioHint`, `toggleStudioItem`, `updateStudioItemName` |
| **Audio**         | `setAudioResult`, `clearAudioResults`, `pushAudioUndo`, `popAudioUndo`, `popAudioRedo`       |
| **Tags**          | `loadTags`, `setItemTag`, `removeItemTag`                                                    |
| **Presets**       | `loadPresets`, `savePreset`, `deletePreset`                                                  |
| **Errors**        | `setItemError`, `clearItemErrors`, `setZenithError`, `setRetryAction`, `clearRetry`          |
| **Remove-Undo**   | `undoRemoveLast`, `clearRemoveHistory`                                                       |

---

## 14. Tauri Commands (IPC)

**Source:** `src-tauri/src/lib.rs:209-275` — `generate_handler![]`

75 total invoke commands:

```
set_ignore_cursor, resize_window, stage_file, remove_staged_item, clear_all_items,
get_staged_items, start_drag_out, stage_text, list_plugins, run_plugin, get_settings,
save_settings, open_settings, open_script_window, update_script_window,
close_script_window, get_script_window_content, launch_script, stop_script,
is_script_running, process_file, set_self_destruct, reveal_in_folder, ping_url,
open_file, list_directory, email_files, move_files, undo_moves, execute_studio_plan,
walk_directory, apply_rename, undo_last_rename, redo_last_rename,
get_rename_history_counts, read_file_preview, cancel_all_scripts, open_editor_window,
open_editor_window_blank, open_music_discovery_window, take_pending_editor_image,
save_clipboard_image, read_file_base64, store_api_key, get_api_key, delete_api_key,
store_secret_key, get_secret_key, log_activity, get_activity_log, clear_activity_log,
get_tags, set_tag, remove_tag, export_settings, import_settings, save_clipboard_entry,
get_clipboard_history, clear_clipboard_history, launch_snipping_tool,
record_and_recognize, get_music_discovery, save_music_track, delete_music_track,
check_items_exist
```

---

## 15. Plugin System (Wasmtime Sandbox)

**Source:** `src-tauri/src/plugins/`

- Plugin Manager uses **Wasmtime** (`wasmtime = "29"`) as a WebAssembly sandbox runtime
- Plugins are user-installed scripts with a `.wasm` extension
- Managed via `plugins::PluginManager` stored in `AppState`
- Commands: `list_plugins`, `run_plugin` (load + execute in sandbox)
- Settings tab: Scripts — enable/disable/remove/add custom scripts

---

## 16. Self-Destruct Timer

- Each `StagedItem` has `self_destruct_at: Option<u64>` (Unix timestamp in milliseconds)
- Background thread runs every 10 seconds, removes expired items
- Emits `items-changed` event when items expire
- UI shows countdown timer on cards
- Settable via `set_self_destruct` command and REST API `POST /items/{id}/self-destruct`
