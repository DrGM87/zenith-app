<div align="center">

# &#9889; ZENITH

### The AI-Powered File Staging Dropzone for Windows

**Drop it. Process it. Ship it.**

[![Tauri](https://img.shields.io/badge/Tauri-v2-24C8D8?style=flat-square&logo=tauri&logoColor=white)](https://v2.tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![Rust](https://img.shields.io/badge/Rust-stable-DEA584?style=flat-square&logo=rust&logoColor=black)](https://www.rust-lang.org)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

*A glassmorphic floating workspace that transforms how you handle files, text, and AI workflows on Windows.*

---

**[Features](#-features)** &bull; **[Quick Start](#-quick-start)** &bull; **[Architecture](#%EF%B8%8F-architecture)** &bull; **[AI Integrations](#-ai--llm-integrations)** &bull; **[API](#-rest-api)** &bull; **[Plugins](#-plugin-system-wasm)**

</div>

---

## What is Zenith?

Zenith is a **desktop productivity tool** that floats invisibly above your taskbar. When you drag a file near it or hover over the edge of your screen, a beautifully animated glass panel springs open. Drop files, paste text, run 27+ AI-powered actions, and drag results back out to any application — all without ever opening a separate app window.

Think of it as a **universal file swiss-army-knife** crossed with an **AI command palette** that lives at the edge of your screen.

---

## &#10024; Features

### Drag & Drop Pipeline
- **Drag IN** — Drop files/folders onto the floating pill or expanded panel to stage them (zero-copy — stores paths only)
- **Drag OUT** — Drag processed files back out to Explorer, Photoshop, Slack, etc. via native Win32 OLE `DoDragDrop`
- **Folder tree** — Dropped directories auto-expand into navigable tree views
- **Multi-select** — Click to select, batch-process, or drag multiple items at once

### Glassmorphic UI
- **Pill &#8596; Panel** — Magnetic hover expands a minimal floating pill into a full dark-glass panel with spring-physics animations (Framer Motion)
- **Click-through mode** — Collapsed pill is invisible to your mouse; no accidental clicks
- **Pin mode** — Pin the panel open while you work; unpin to auto-collapse
- **Dynamic preview drawer** — Preview images, video, audio, code, CSV, JSON, and PDFs inline without leaving the panel

### 27 Built-in File Actions

| Category | Actions |
|----------|---------|
| **Image** | Compress, Resize, Strip EXIF, WebP Convert, Color Palette (WCAG), Base64 (Raw/HTML/CSS), OCR, OCR &#8594; Searchable PDF |
| **PDF** | Compress, Merge, PDF &#8594; CSV (LLM-powered structured extraction) |
| **Media** | FFmpeg Convert (MP4, MP3, WebM, WAV, GIF) |
| **Universal** | Zip, Zip + AES-256 Encrypt, Split File, Email w/ Attachments |
| **AI-Powered** | Smart Rename, Smart Sort, Auto-Organize + Undo, Translate (15 languages), Ask Data (RAG Q&A), Summarize, Super Summary (multi-doc), Generate Dashboard (CSV &#8594; interactive Chart.js HTML) |
| **Security** | VirusTotal file scan (SHA-256), VirusTotal URL scan |
| **Utility** | QR Code from URL/text, File Preview |

### Clipboard Superpowers
- **Stack Mode** — Toggle on, hit Ctrl+C multiple times, then merge all copies with one click
- **Text staging** — Paste any text/URL directly into Zenith as a card
- **Global shortcut** — `Ctrl+Shift+V` stages clipboard content instantly

### Self-Destruct & Ephemeral Files
- Set **1-hour** or **24-hour** self-destruct timers on any staged item
- Live countdown badge on timed items

### Crash-Resilient State
- Every add/remove is persisted to `state.json` — restart without losing anything
- Auto-rehydration on launch

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

`start.bat` will automatically install Node + Python dependencies and launch the dev server.

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

The compiled `.msi` / `.exe` installer will be in `src-tauri/target/release/bundle/`.

---

## &#9881;&#65039; Architecture

```
 React 19 (UI)  ───  Rust / Tauri v2 (OS layer)  ───  Python sidecar (AI + processing)
    │                        │                              │
 Framer Motion        Drag-and-drop (OLE)           27 file actions
 Tailwind CSS 4       Window compositing            LLM API calls
 Zustand 5            Clipboard interception         PDF / Image / Media
 Font Awesome 7       WASM plugin engine             OCR / QR / FFmpeg
                      HTTP API (port 7890)
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | [Tauri v2](https://v2.tauri.app) |
| **Backend** | Rust (serde, wasmtime, image, tauri-plugin-drag) |
| **Frontend** | React 19, TypeScript 5.8, Framer Motion 12 |
| **Styling** | Tailwind CSS 4 |
| **State** | Zustand 5 |
| **AI / Processing** | Python 3 (Pillow, pdfplumber, pikepdf, pytesseract, reportlab, qrcode) |
| **Icons** | Font Awesome 7 Pro |

---

## &#129302; AI & LLM Integrations

Zenith connects to **5 LLM providers** for smart file processing. Keys are stored locally and sent only to the respective APIs.

| Provider | Models | Use Cases |
|----------|--------|-----------|
| **OpenAI** | GPT-4.1-nano, GPT-4.1-mini, GPT-4.1, GPT-4o, o4-mini | Rename, Sort, Summarize, Dashboard |
| **Anthropic** | Claude Haiku 4.5, Sonnet 4, Opus 4 | Ask Data, Translate, Organize |
| **Google** | Gemini 2.5 Flash, 2.5 Pro, 3.1 Pro | OCR Vision, Super Summary |
| **DeepSeek** | Chat (V3), Reasoner (R1) | Budget-friendly processing |
| **Groq** | Llama 3.3 70B, Llama 3.1 8B | Ultra-fast inference |

- **Token tracking** with per-provider cost estimation (USD)
- **9 customizable AI prompts** — tune behavior from Settings
- **Model picker** with pricing info per provider

---

## &#127760; REST API

Zenith exposes a **local HTTP API** on `http://127.0.0.1:7890` for automation and scripting.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/items` | List all staged items |
| `POST` | `/stage/file` | Stage a file by path |
| `POST` | `/stage/text` | Stage text/URL |
| `DELETE` | `/items/:id` | Remove a staged item |
| `POST` | `/process` | Run any of 27 processing actions |
| `GET` | `/settings` | Read current settings |
| `PUT` | `/settings` | Update settings |
| `GET` | `/health` | Health check |

Full documentation: [`docs/API.md`](docs/API.md)

---

## &#129513; Plugin System (WASM)

Extend Zenith with WebAssembly plugins:

- **wasmtime engine** — Load `.wasm` plugins from `%APPDATA%/Zenith/plugins/`
- **Host API** — Plugins access staged items via `zenith_get_items()`
- **Settings UI** — Enable/disable plugins from the Scripts tab

---

## &#128204; Settings Hub

Zenith has a **full-featured settings panel** with 9 tabs:

- **General** — Launch at startup, tray icon, update checks
- **Appearance** — Accent color, opacity, blur, corner radius, font size, animations
- **Behavior** — Collapse delay, hover/drag expand, max items, duplicate detection, position
- **Processing** — Image quality, WebP quality, resize %, PDF compression, split chunk size
- **API Keys** — Per-provider key management with model selection and pricing
- **AI Prompts** — All 9 system prompts editable (File Management, Document Intelligence, Vision & Data)
- **Token Usage** — Usage cards with per-provider breakdown, estimated costs, reset
- **Shortcuts** — Configurable keyboard shortcuts
- **Scripts** — WASM plugin manager

---

## &#128193; Project Structure

```
zenith-app/
├── src/                           # React frontend
│   ├── components/
│   │   ├── Bubble.tsx             # Floating pill/panel + batch actions + pin
│   │   ├── StagedItemCard.tsx     # File card with 27 per-item actions
│   │   ├── PreviewDrawer.tsx      # Dynamic multi-file preview panel
│   │   ├── Settings.tsx           # Full settings modal (9 tabs)
│   │   ├── FolderTree.tsx         # Navigable folder tree
│   │   └── ScriptWindow.tsx       # WASM plugin runner UI
│   ├── store.ts                   # Zustand store (items, previews, settings, tokens)
│   ├── utils.ts                   # Helpers (icons, colors, formatting)
│   └── App.tsx                    # Root component
├── src-tauri/
│   └── src/
│       ├── lib.rs                 # Tauri commands (30+ commands)
│       ├── api_server.rs          # HTTP REST API server (:7890)
│       ├── settings.rs            # Settings structs (Rust ↔ JSON)
│       └── plugins.rs             # WASM plugin engine
├── scripts/
│   ├── process_files.py           # 27 Python processing actions
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

**Built with Rust, React, and a lot of caffeine.**

**&#11088; Star this repo if you find it useful!**

</div>
