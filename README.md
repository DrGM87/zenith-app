<div align="center">

# &#9889; ZENITH

<p align="center">
  <img src="icon.png" alt="Zenith Logo" width="128"/>
</p>

### The AI-Powered File Command Center for Windows

**Drop it. Organize it. Ship it. — All from the edge of your screen.**

[![Tauri](https://img.shields.io/badge/Tauri-v2-24C8D8?style=flat-square&logo=tauri&logoColor=white)](https://v2.tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Rust](https://img.shields.io/badge/Rust-stable-DEA584?style=flat-square&logo=rust&logoColor=black)](https://www.rust-lang.org)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

[![Features](https://img.shields.io/badge/Features-94+-blueviolet?style=flat-square)]()
[![AI Providers](https://img.shields.io/badge/AI_Providers-5-orange?style=flat-square)]()
[![File Actions](https://img.shields.io/badge/File_Actions-33+-success?style=flat-square)]()

*A glassmorphic floating workspace with 94+ features that transforms how you handle files, media, documents, and AI workflows on Windows.*

---

**[Features](#-core-features)** &bull; **[Auto-Studio](#-auto-studio--the-review-panel)** &bull; **[Smart Rename](#-smart-rename-engine)** &bull; **[AI Integrations](#-ai--llm-integrations)** &bull; **[Quick Start](#-quick-start)** &bull; **[Architecture](#%EF%B8%8F-architecture)** &bull; **[API](#-rest-api)** &bull; **[Plugins](#-plugin-system-wasm)**

</div>

---

## What is Zenith?

Zenith is an **invisible desktop command center** that floats at the edge of your screen. Drag a file near it — a beautifully animated dark-glass panel springs open. Drop files, paste text, scan for malware, convert media, organize your entire Downloads folder with AI, and drag results back out to any application — all without ever leaving what you're doing.

Think of it as a **universal file swiss-army-knife** crossed with an **AI-powered media library organizer** that lives at the edge of your screen.

> **94 features. 33+ file actions. 5 AI providers. Zero window switching.**

---

## &#10024; Core Features

### Drag & Drop Pipeline
- **Drag IN** — Drop files, folders, or entire directory trees onto the floating pill to stage them (zero-copy — stores paths only)
- **Drag OUT** — Drag processed files back out to Explorer, Photoshop, Slack, Discord, etc. via native Win32 OLE `DoDragDrop`
- **Deep folder parsing** — Dropped directories recursively expand via Rust `walkdir`, flattening hundreds of files while retaining path context
- **Multi-select** — Click to select, batch-process, or drag multiple items at once

### Glassmorphic UI
- **Pill &#8596; Panel** — Magnetic hover expands a minimal floating pill into a full dark-glass panel with spring-physics animations (Framer Motion)
- **Click-through mode** — Collapsed pill is invisible to your mouse; zero interference with your workflow
- **Pin mode** — Pin the panel open while you work; unpin to auto-collapse
- **Dynamic preview drawer** — Preview images, video, audio, code, CSV, JSON, and PDFs inline without leaving the panel

### 33+ Built-in Actions

| Category | Actions |
|----------|---------|
| **Image** | Compress, Resize, Strip EXIF, WebP Convert, Color Palette + WCAG Contrast, Base64 (Raw/HTML/CSS), OCR (Vision AI + Tesseract), OCR &#8594; Searchable PDF |
| **PDF** | Compress, Merge (multi-PDF), PDF &#8594; CSV (LLM-powered structured extraction) |
| **Media** | FFmpeg Convert (MP4, MP3, WebM, WAV, GIF) |
| **Archive** | Zip, Zip + AES-256 Encrypt, Split File into chunks |
| **Communication** | Email with Attachments (native mailto) |
| **AI-Powered** | Smart Rename (3-suggestion shimmer flow), Smart Sort, Auto-Studio Organize + Undo, Translate (15+ languages), Ask Data (RAG Q&A), Summarize, Super Summary (multi-doc with citations), Generate Dashboard (CSV &#8594; interactive Chart.js HTML) |
| **Security** | VirusTotal deep scan (file hash &#8594; upload &#8594; poll), VirusTotal URL scan, batch scan |
| **Utility** | QR Code generator, File Preview, Copy Path, Reveal in Explorer |

### Clipboard Superpowers
- **Stack Mode** — Toggle on, hit `Ctrl+C` multiple times, then merge all clipboard entries with one click
- **Text & URL staging** — Paste any text or URL directly into Zenith as a card
- **Global shortcut** — `Ctrl+Shift+V` stages clipboard content instantly from anywhere

### Self-Destruct & Ephemeral Files
- Set **5 min / 30 min / 1 hour / 24 hour** self-destruct timers on any staged item
- Live countdown badge with automatic cleanup

### Crash-Resilient State
- Every add/remove is persisted to `state.json` — restart, crash, or reboot without losing anything
- Automatic rehydration on launch

---

## &#127916; Auto-Studio — The Review Panel

> *Drop 50 messy files. Click one button. Review a beautiful plan. Execute with one click. Undo with one click.*

The **Auto-Studio** is Zenith's flagship feature — a sliding auxiliary panel that turns chaotic file dumps into perfectly organized media libraries.

### How It Works

1. **Drop** a messy folder (or 50 mixed files) into Zenith
2. Click **&#10024; Smart Organize** — the Review Studio panel slides out
3. A progress bar tracks API lookups as Zenith analyzes every file
4. You see a **tree view** of proposed changes:
   - &#127925; `The Weeknd - After Hours (2020)/` — renamed MP3s + fetched album art
   - &#127916; `Dune Part Two (2024)/` — renamed MKV + downloaded OMDB posters
   - &#128196; `Financial/` — 4 renamed PDF invoices (AI-categorized)
   - &#128248; `Photos - 2026-03/` — 10 photos grouped by EXIF date
5. **Tweak** any name with inline editing, toggle items on/off, pick grouping options
6. Click **&#128640; Execute Plan** — all disk operations happen transactionally
7. Changed your mind? Click **&#8617; Undo** — everything reverts perfectly

### Media Intelligence Engine

| File Type | Intelligence | API |
|-----------|-------------|-----|
| **Music** (.mp3, .flac, .wav, .ogg, .aac, .m4a) | Album, year, artist, genre, cover art lookup | [TheAudioDB](https://www.theaudiodb.com) |
| **Video** (.mp4, .mkv, .avi, .mov, .webm) | Title, year, director, rating, poster download; SxxExx series detection | [OMDB](https://www.omdbapi.com) |
| **Images** (.jpg, .png, .gif, .webp, .heic) | EXIF date grouping **or** AI Vision semantic titles | LLM Vision |
| **Documents** (.pdf, .docx, .txt, .csv, .xlsx) | Semantic categorization (Business/Financial/Legal/Personal) **or** type grouping **or** date grouping | LLM Analysis |

### Grouping Options (User-Controlled)

Dropdowns in the Review Studio let you choose how files are organized:

- **Images:** *By Date* (EXIF month) or *By AI Vision* (semantic descriptive names)
- **Documents:** *By Category* (LLM semantic), *By Type* (PDFs, Spreadsheets, etc.), or *By Date* (modification month)

### Safety & Undo

- Every execution saves a **Transaction JSON** (`tx_UUID.json`) with full move history + poster paths
- **1-click Undo** reverts all file moves, deletes downloaded posters, and removes empty folders
- Recursive empty folder cleanup (deepest-first traversal)

---

## &#10024; Smart Rename Engine

Zenith doesn't just rename files — it **reads their soul**.

### 3-Step Context Pipeline

1. **Content Extraction** — Vision AI for images, first-page text for PDFs, EXIF/ID3 for media, first 50 lines for code
2. **Format Enforcement** — AI strictly follows your naming convention (PascalCase, snake_case, kebab-case, or custom)
3. **Extension Locking** — Rust physically separates stem from extension. The AI never touches `.pdf` or `.mp3`. Ever.

### The UX Flow

- **Single file:** Click &#10024; — the filename transforms into a shimmering skeleton loader, then smoothly morphs into `2026_03_DEWA_Utility_Bill.pdf`
- **3 inline controls:** &#9989; Accept &bull; &#127922; Cycle alternate suggestion &bull; &#9999;&#65039; Manual edit
- **Batch rename:** Select 15 files &#8594; click &#10024; Batch Rename &#8594; diff-like list view with `Old Name &#8594; New Name` for every file
- **Undo/Redo:** Permanent &#8617;/&#8618; icons in the header — one click reverts actual files on disk

---

## &#128737;&#65039; Security & Scanning

### VirusTotal Deep Integration

Not just a hash lookup — Zenith implements the **full VirusTotal v3 pipeline**:

- **Files:** SHA-256 hash check &#8594; if unknown, **uploads the file** &#8594; polls analysis &#8594; full detection report
- **URLs:** Base64 lookup &#8594; if unknown, **submits for scanning** &#8594; polls analysis &#8594; verdict
- **Folders:** Recursively finds and scans the first file inside
- **Batch scanning** from the multi-select toolbar
- **Results:** &#128994; Safe / &#128308; Malicious badge with detection count, engine names, and community score
- Supports files up to **650MB** via the large-file upload endpoint

---

## &#129302; AI & LLM Integrations

Zenith connects to **5 LLM providers** with **14+ models**. API keys are stored locally and never leave your machine except to the provider you choose.

| Provider | Models | Best For |
|----------|--------|----------|
| **OpenAI** | GPT-4.1-nano, GPT-4.1-mini, GPT-4.1, GPT-4o, o4-mini | Rename, Sort, Summarize, Dashboard |
| **Anthropic** | Claude Haiku 4.5, Sonnet 4, Opus 4 | Ask Data, Deep Analysis, Organize |
| **Google** | Gemini 2.5 Flash, 2.5 Pro, 3.1 Pro | OCR Vision, Super Summary |
| **DeepSeek** | Chat (V3), Reasoner (R1) | Budget-friendly bulk processing |
| **Groq** | Llama 3.3 70B, Llama 3.1 8B | Ultra-fast inference |

### AI Features at a Glance

- **Token tracking** with real-time per-provider cost estimation (USD)
- **9 customizable system prompts** — tune every AI behavior from Settings
- **Model picker** with live pricing info per provider
- **Smart cost optimization** — use cheap models for bulk, premium for precision

---

## &#128204; Settings Hub

A **full-featured settings panel** with 9 tabs — because power users deserve control:

| Tab | What You Control |
|-----|-----------------|
| **General** | Launch at startup, tray icon, update checks |
| **Appearance** | Accent color, opacity, blur intensity, corner radius, font size, border glow, animations |
| **Behavior** | Collapse delay, hover/drag expand triggers, max items, duplicate detection, screen position |
| **Processing** | Image quality, WebP quality, resize %, PDF compression level, split chunk size |
| **API Keys** | Per-provider key management with model selection, pricing display, and OMDB/VirusTotal keys |
| **AI Prompts** | All 9 system prompts editable (File Management, Document Intelligence, Vision & Data) |
| **Token Usage** | Per-provider usage cards with cost breakdown, total spend tracking, reset |
| **Shortcuts** | Configurable keyboard shortcuts (stage clipboard, toggle window, clear all) |
| **Scripts** | WASM plugin manager with enable/disable toggles |

---

## &#128640; Quick Start

### Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| **Node.js** | 18+ | Frontend build tooling |
| **Rust** | stable (via [rustup](https://rustup.rs)) | Tauri backend |
| **Python** | 3.10+ | AI & file processing sidecar |
| Tesseract OCR | *optional* | Local OCR fallback (free) |
| FFmpeg | *optional* | Media conversion (`.mov` &#8594; `.mp4`, etc.) |

### One-Click Start (Windows)

```bat
git clone https://github.com/YOUR_USERNAME/zenith-app.git
cd zenith-app
start.bat
```

`start.bat` automatically installs Node + Python dependencies and launches the dev server.

### Manual Setup

```bash
# 1. Clone
git clone https://github.com/YOUR_USERNAME/zenith-app.git
cd zenith-app

# 2. Install Node dependencies
npm install

# 3. Install Python dependencies
pip install -r scripts/requirements.txt

# 4. Run in dev mode
npm run tauri dev
```

### Build for Production

```bash
npm run tauri build
```

Outputs both `.msi` and `.exe` (NSIS) installers in `src-tauri/target/release/bundle/`.

---

## &#9881;&#65039; Architecture

```
 React 19 (UI)  ────  Rust / Tauri v2 (OS layer)  ────  Python sidecar (AI + processing)
      │                         │                               │
 Framer Motion 12        Native OLE drag-drop           33+ file actions
 Tailwind CSS 4          Window compositing             5 LLM providers
 Zustand 5               Clipboard interception         TheAudioDB / OMDB APIs
 Font Awesome 7          WASM plugin engine (wasmtime)  PDF / Image / Media / OCR
                         HTTP API server (:7890)         VirusTotal v3 integration
                         Transactional file I/O          EXIF / ID3 metadata
                         walkdir recursive traversal     FFmpeg / QR / Tesseract
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | [Tauri v2](https://v2.tauri.app) |
| **Backend** | Rust (serde, serde_json, walkdir, wasmtime, image, uuid, tauri-plugin-drag) |
| **Frontend** | React 19, TypeScript 5.8, Framer Motion 12 |
| **Styling** | Tailwind CSS 4, Glassmorphism |
| **State** | Zustand 5 |
| **AI / Processing** | Python 3 (Pillow, pdfplumber, pikepdf, pytesseract, reportlab, qrcode, requests) |
| **Media APIs** | [TheAudioDB](https://www.theaudiodb.com) (music), [OMDB](https://www.omdbapi.com) (movies/series) |
| **Security** | [VirusTotal API v3](https://docs.virustotal.com) |
| **Icons** | Font Awesome 7 Pro |

---

## &#127760; REST API

Zenith exposes a **local HTTP API** on `http://127.0.0.1:7890` for automation, scripting, and integration with other tools.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/items` | List all staged items |
| `POST` | `/stage/file` | Stage a file by path |
| `POST` | `/stage/text` | Stage text/URL |
| `DELETE` | `/items/:id` | Remove a staged item |
| `POST` | `/process` | Run any processing action |
| `GET` | `/settings` | Read current settings |
| `PUT` | `/settings` | Update settings |
| `GET` | `/health` | Health check |

Full documentation: [`docs/API.md`](docs/API.md)

---

## &#129513; Plugin System (WASM)

Extend Zenith with WebAssembly plugins:

- **wasmtime engine** — Load `.wasm` plugins from `%APPDATA%/Zenith/plugins/`
- **Host API** — Plugins access staged items via `zenith_get_items()`
- **Settings UI** — Enable/disable and manage plugins from the Scripts tab

---

## &#128193; Project Structure

```
zenith-app/
├── src/                           # React frontend
│   ├── components/
│   │   ├── Bubble.tsx             # Floating pill/panel + batch actions + pin mode
│   │   ├── StagedItemCard.tsx     # File card with 33+ per-item actions
│   │   ├── ReviewStudio.tsx       # Auto-Studio auxiliary panel (tree view + execute)
│   │   ├── PreviewDrawer.tsx      # Dynamic multi-format preview panel
│   │   ├── Settings.tsx           # Full settings modal (9 tabs)
│   │   ├── FolderTree.tsx         # Recursive navigable folder tree
│   │   └── ScriptWindow.tsx       # WASM plugin runner UI
│   ├── store.ts                   # Zustand store (items, studio, previews, settings, tokens)
│   ├── utils.ts                   # Helpers (icons, colors, formatting)
│   └── App.tsx                    # Root component
├── src-tauri/
│   └── src/
│       ├── lib.rs                 # 35+ Tauri commands (file ops, studio, walk, rename)
│       ├── api_server.rs          # HTTP REST API server (:7890)
│       ├── settings.rs            # Settings structs (Rust ↔ JSON ↔ React)
│       └── plugins.rs             # WASM plugin engine (wasmtime)
├── scripts/
│   ├── process_files.py           # 33+ Python processing actions + Auto-Studio engine
│   └── requirements.txt           # Python dependencies
├── docs/
│   └── API.md                     # Full REST API documentation
├── start.bat                      # One-click dev launcher (Windows)
├── package.json
└── README.md
```

---

## &#128230; Storage Locations

| Data | Path |
|------|------|
| Settings | `%APPDATA%/Zenith/settings.json` |
| Staged items | `%LOCALAPPDATA%/Zenith/state.json` |
| WASM plugins | `%APPDATA%/Zenith/plugins/` |
| Temp / output files | `%TEMP%/Zenith/` |
| Undo history | `%TEMP%/Zenith/mapping_history.json` |
| Studio transactions | `%TEMP%/Zenith/tx_*.json` |

---

## &#128202; Feature Coverage Matrix

| Capability | Single File | Folder | Multi-Select | Global | URL | Text |
|:-----------|:----------:|:------:|:------------:|:------:|:---:|:----:|
| AI Smart Rename | &#9989; | &#9989; | &#9989; | &#9989; | — | — |
| Compress / Resize / Convert | &#9989; | — | — | — | — | — |
| Zip / Encrypt / Split | &#9989; | &#9989; | &#9989; | &#9989; | — | — |
| VirusTotal Scan | &#9989; | &#9989; | &#9989; | — | &#9989; | — |
| OCR / OCR &#8594; PDF | &#9989; | — | — | — | — | — |
| Ask Data / Summarize / Translate | &#9989; | — | — | — | — | — |
| Generate Dashboard | &#9989; | — | — | — | — | — |
| Merge PDFs | — | — | &#9989; | &#9989; | — | — |
| Auto-Studio Organize | — | — | — | &#9989; | — | — |
| Super Summary | — | — | — | &#9989; | — | — |
| QR Code | — | — | — | &#9989; | &#9989; | — |
| Preview | &#9989; | &#9989; | — | — | &#9989; | &#9989; |
| Self-Destruct Timer | &#9989; | &#9989; | — | — | — | — |

---

## &#129309; Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## &#128220; License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built with Rust &#9881;&#65039;, React &#9889;, Python &#128013;, and mass amounts of caffeine &#9749;**

*94 features. 5 AI providers. 1 invisible tool that does everything.*

**&#11088; Star this repo if Zenith blew your mind!**

</div>
