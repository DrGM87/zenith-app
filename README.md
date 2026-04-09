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

[![Features](https://img.shields.io/badge/Features-175+-blueviolet?style=flat-square)]()
[![AI Providers](https://img.shields.io/badge/AI_Providers-5-orange?style=flat-square)]()
[![File Actions](https://img.shields.io/badge/File_Actions-40+-success?style=flat-square)]()
[![Research Tools](https://img.shields.io/badge/Research_Tools-50+-cyan?style=flat-square)]()
[![Pipeline Steps](https://img.shields.io/badge/Pipeline_Steps-44-purple?style=flat-square)]()

*A glassmorphic floating workspace with 175+ features that transforms how you handle files, media, documents, and AI workflows on Windows.*

---

**[Features](#-core-features)** &bull; **[Auto-Studio](#-auto-studio--the-review-panel)** &bull; **[Research v6.1](#-zenith-research-window--v61)** &bull; **[Smart Rename](#-smart-rename-engine)** &bull; **[AI Integrations](#-ai--llm-integrations)** &bull; **[Quick Start](#-quick-start)** &bull; **[Architecture](#%EF%B8%8F-architecture)** &bull; **[API](#-rest-api)** &bull; **[Plugins](#-plugin-system-wasm)**

</div>

---

## What is Zenith?

Zenith is an **invisible desktop command center** that floats at the edge of your screen. Drag a file near it — a beautifully animated dark-glass panel springs open. Drop files, paste text, scan for malware, convert media, organize your entire Downloads folder with AI, and drag results back out to any application — all without ever leaving what you're doing.

Think of it as a **universal file swiss-army-knife** crossed with an **AI-powered media library organizer** and a **full clinical research intelligence platform** that lives at the edge of your screen.

> **175+ features. 40+ file actions. 5 AI providers. Generative AI image editor. Zenith Research v6.1 — 44-step autonomous research pipeline with 50+ free academic data tools. Shazam music recognition. Zero window switching.**

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

### 40+ Built-in Actions

| Category | Actions |
|----------|---------|
| **Image** | Convert Format, Resize (+ fill color for ratio changes), EXIF Strip/Preview, Color Palette + WCAG + Ink Dropper, Base64 (Raw/HTML/CSS/TXT), OCR (Vision AI + Tesseract), Open in Generative Editor |
| **AI Image Gen** | Zenith Generative Editor — text-to-image, image-to-image, conversational multi-turn editing, 3 models (Nano Banana 2/Pro, GPT-Image 1.5), thread/session management, 10 aspect ratios, 9 style presets, image size control, prompt library, cost tracking |
| **PDF** | Compress, Merge (multi-PDF), PDF &#8594; CSV (LLM-powered structured extraction) |
| **Audio** | Shazam Music Recognition (fingerprint &#8594; identify &#8594; metadata) |
| **Media** | FFmpeg Convert (MP4, MP3, WebM, WAV, GIF) |
| **Archive** | Zip / 7z with compression level (1–9), AES-256 Encrypt, Split File into chunks |
| **Communication** | Email with Attachments (native mailto) + LLM auto-draft Subject/Body |
| **AI-Powered** | Smart Rename (3-suggestion shimmer flow), Smart Sort, Auto-Studio Organize + Undo, Translate (15+ languages), Ask Data (RAG Q&A), Summarize, Super Summary (multi-doc with citations), Generate Dashboard (CSV &#8594; interactive Chart.js HTML), Prompt Enhancement |
| **Security** | VirusTotal deep scan (file hash &#8594; upload &#8594; poll), VirusTotal URL scan, batch scan |
| **Utility** | QR Code generator, File Preview, Copy Path, Reveal in Explorer |

### Clipboard Superpowers
- **Stack Mode** — Toggle on, hit `Ctrl+C` multiple times, then merge all clipboard entries with one click
- **Text & URL staging** — Paste any text or URL directly into Zenith as a card
- **Image paste** — Hit PrintScreen then `Ctrl+V` inside Zenith to stage a screenshot as a PNG card instantly
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
| **Music** (.mp3, .flac, .wav, .ogg, .aac, .m4a) | Album, year, artist, genre, cover art lookup &#8594; Shazam fingerprint fallback | [TheAudioDB](https://www.theaudiodb.com) + [Shazam](https://www.shazam.com) via [SongRec](https://github.com/marin-m/SongRec) |
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

## &#127775; Zenith Generative Editor

> *Drop an image, click Editor. Type a prompt. Watch the AI repaint it. Chain 10 edits. Compare. Save. Stage.*

The **Zenith Generative Editor** is a full-window AI image creation and editing studio that opens alongside your main workspace.

### Two Ways to Open

- **From a staged image card** → click the **Editor** action button to open the image pre-loaded
- **From the panel header** → click **✨ Canvas** to open in blank text-to-image mode

### Supported Models

| Model | API String | Provider | Best For |
|-------|-----------|----------|----------|
| **Nano Banana 2** | `gemini-3.1-flash-image-preview` | Google | Fast iterations, daily use |
| **Nano Banana Pro** | `gemini-3-pro-image-preview` | Google | High-quality, deep thinking |
| **GPT-Image 1.5** | `gpt-image-1.5` | OpenAI | Photorealism, high-adherence edits |

### Key Features

- **Thread / session management** — left panel has two tabs: **Threads** (all sessions with title, date, cost, delete) and **Images** (current thread's generations with thumbnails); create, switch, and delete threads freely
- **Conversational editing** — each generation uses the current output as the next input; chain unlimited edits within a thread
- **Thread auto-naming** — first generation's LLM auto-title becomes the thread name (e.g. "Cyberpunk Skyline")
- **Persistent threads** — metadata survives window close (localStorage); images saved to disk; max 30 threads × 50 images
- **Before/After toggle** — hold the comparison pill to flip between original and current AI version
- **Prompt enhancement (✨)** — rough idea → LLM rewrites to a detailed professional prompt automatically
- **Prompt library** — save, load, rename, delete, and upload prompts; full management UI
- **Session cost tracker** — live cumulative USD cost in the Command Deck; per-thread totals in Threads tab
- **Model controls** — aspect ratio (10 options for Google, 3 for OpenAI), image size (512/1K/2K/4K), 9 style presets, thinking level (Pro), resolution and adherence (GPT)
- **Send to Stage** — save current canvas to temp and stage it back into the main panel with one click; instant sync via Tauri event
- **New Canvas** — creates a new thread and switches to blank canvas; current thread auto-saved
- **Reset** — clears all threads, canvas, cost tracker, and all temp files

---

## &#128300; Zenith Research Window — v6.1

> *Click Research. Ask a question — or launch a full autonomous 44-step pipeline. Get papers, PICO extractions, meta-analyses, forest plots, PRISMA flowcharts, and publication-ready manuscripts — fully configurable down to each agent's system prompt.*

The **Zenith Research Window v6.1** is a PhD-level autonomous research intelligence platform for medical, biomedical, clinical, and pharmaceutical research. Built on a fully modular component architecture with 50+ free academic APIs and a mathematically rigorous statistical analysis engine.

### How to Open

- Click the **Research** button in the main panel header

---

### Dual-Mode Operation

#### Chat Mode (Interactive)
Conversational AI with LLM-driven tool dispatch. Access all 30+ research tools directly from the chat interface. Ask questions, search 6 databases simultaneously, verify citations with NLI cross-encoders, check retractions, run meta-analyses, generate plots, and draft sections interactively.

#### Pipeline Mode (Autonomous v6.1 — 44 Atomic Steps)
Launch a fully automated systematic research pipeline. **Each step does exactly one thing** — the output of step N is the exact input of step N+1. Zero compound operations.

---

### The 44-Step Atomic Pipeline

#### &#128269; Search Phase (Steps 1–8)

| Step | Agent | Action | Output |
|------|-------|--------|--------|
| 1 | **Gatekeeper** | Validate research question for specificity, scope, ethics | `{is_valid, domain, keywords, pico}` |
| 2 | **Query Architect** | Generate Boolean/MeSH search strings per database | `{queries: [{db, query_string}]}` |
| 3 | **PubMed Searcher** | Search MEDLINE via E-utilities with MeSH terms | `{pubmed_papers[]}` |
| 4 | **S2 Searcher** | Search Semantic Scholar API | `{s2_papers[]}` |
| 5 | **OpenAlex Searcher** | Search OpenAlex (10K/day free) | `{oa_papers[]}` |
| 6 | **arXiv Searcher** | Search arXiv preprints | `{arxiv_papers[]}` |
| 7 | **Europe PMC Searcher** | Search Europe PMC REST API | `{epmc_papers[]}` |
| 8 | **Deduplicator** | Merge + deduplicate across all sources | `{unique_papers[], duplicates_removed}` |

#### &#128203; Screen Phase (Steps 9–12)

| Step | Agent | Action | Output |
|------|-------|--------|--------|
| 9 | **Design Classifier** | Classify study design per paper | `{papers[] + study_design}` |
| 10 | **Title-Abstract Screener** | Include/exclude by PICO criteria | `{papers[] + inclusion_decision}` |
| 11 | **Retraction Checker** | Check DOIs via CrossRef + Retraction Watch CSV | `{papers[] + retraction_status}` |
| 12 | **Journal Checker** | Check Beall's predatory journal list | `{papers[] + journal_quality}` |

#### &#128229; Acquire Phase (Steps 13–16)

| Step | Agent | Action | Output |
|------|-------|--------|--------|
| 13 | **Unpaywall Fetcher** | Check open-access availability per DOI | `{oa_urls[], not_oa_dois[]}` |
| 14 | **OA Downloader** | Download PDFs from OA URLs | `{downloaded_pdfs[], failed[]}` |
| 15 | **Sci-Hub Fetcher** | Try Sci-Hub mirrors for remaining DOIs | `{scihub_pdfs[], captcha_needed[]}` |
| 16 | **PMC Fetcher** | Fetch structured XML from PubMed Central | `{pmc_texts[]}` |

#### &#128196; Parse Phase (Steps 17–19)

| Step | Agent | Action | Output |
|------|-------|--------|--------|
| 17 | **PDF Text Extractor** | Extract raw text from PDFs (pdfplumber) | `{raw_texts[]}` |
| 18 | **Section Parser** | Parse raw text into structured sections | `{structured_papers[{sections[]}]}` |
| 19 | **Reference Extractor** | Extract reference list from full text | `{papers[] + references_raw}` |

#### &#128200; Store Phase (Steps 20–22)

| Step | Agent | Action | Output |
|------|-------|--------|--------|
| 20 | **Text Chunker** | Chunk texts with section metadata | `{chunks[]}` |
| 21 | **Vector Ingestor** | Embed & store chunks in ChromaDB | `{chunks_stored, collection_size}` |
| 22 | **BM25 Indexer** | Build keyword index for hybrid search | `{bm25_index_ready}` |

#### &#128202; Extract Phase (Steps 23–26)

| Step | Agent | Action | Output |
|------|-------|--------|--------|
| 23 | **PICO Extractor** | LLM-powered PICO extraction per paper | `{pico_extractions[]}` |
| 24 | **Outcome Extractor** | Extract effect sizes, CIs, p-values | `{outcome_data[]}` |
| 25 | **Drug Profiler** | Extract drug names, doses, regimens (RxNorm) | `{drug_profiles[]}` |
| 26 | **AE Extractor** | Extract adverse events (OpenFDA) | `{adverse_events[]}` |

#### &#9878;&#65039; Assess Phase (Steps 27–29)

| Step | Agent | Action | Output |
|------|-------|--------|--------|
| 27 | **Bias Assessor** | RoB-2 / ROBINS-I / NOS per paper | `{bias_assessments[]}` |
| 28 | **GRADE Assessor** | Rate certainty per outcome (⊕⊕⊕⊕ scale) | `{grade_table[]}` |
| 29 | **Publication Bias Detector** | Egger's + Begg's + trim-fill | `{pub_bias_result}` |

#### &#128221; Synthesize Phase (Steps 30–37)

| Step | Agent | Action | Output |
|------|-------|--------|--------|
| 30 | **Meta-Analyst** | DerSimonian-Laird pooled effect calculation | `{pooled_effect, ci, i_squared, tau²}` |
| 31 | **Blueprint Architect** | Design manuscript structure per guidelines | `{sections[], figure_plan[], table_plan[]}` |
| 32 | **Section Drafter** | Draft ONE section (loops N times) | `{section_text, citations_used[]}` |
| 33 | **Table Generator** | Generate comparison / summary tables | `{tables[]}` |
| 34 | **Forest Plot Generator** | matplotlib forest plot → base64 PNG | `{image_base64}` |
| 35 | **Funnel Plot Generator** | Egger's / Begg's funnel plot | `{image_base64, egger_p}` |
| 36 | **PRISMA Generator** | PRISMA 2020 flow diagram | `{image_base64, svg}` |
| 37 | **RoB Plot Generator** | Risk of bias traffic-light grid | `{image_base64}` |

#### &#9989; Verify Phase (Steps 38–41)

| Step | Agent | Action | Output |
|------|-------|--------|--------|
| 38 | **Citation Verifier** | NLI cross-encoder claim verification | `{verified[], hallucinated[]}` |
| 39 | **Guidelines Checker** | PRISMA / MOOSE / CARE / STROBE compliance | `{compliant[], violations[]}` |
| 40 | **Consistency Checker** | Text-vs-table contradiction detection | `{inconsistencies[]}` |
| 41 | **Final Retraction Check** | Re-verify all cited DOIs pre-publish | `{all_clear, retractions_found[]}` |

#### &#10024; Polish Phase (Steps 42–44)

| Step | Agent | Action | Output |
|------|-------|--------|--------|
| 42 | **Prose Smoother** | Unify voice, fix grammar, add transitions | `{polished_sections[]}` |
| 43 | **Citation Formatter** | Format bibliography (Vancouver/APA/MLA) | `{bibliography, bibtex}` |
| 44 | **LaTeX Compiler** | Compile final document | `{tex, pdf_path}` |

---

### Free Academic Data APIs (50+ Tools — No Paid Keys Required)

| API | Tool Name | What It Provides |
|-----|-----------|-----------------|
| **PubMed E-utilities** | `PUBMED_SEARCH` | MEDLINE search, MeSH terms, PMID fetch, XML metadata |
| **Semantic Scholar** | `LITERATURE_SEARCH` | 200M+ papers, citation graphs, open access links |
| **OpenAlex** | `LITERATURE_SEARCH` | 240M+ works, 10K/day free, full metadata |
| **arXiv** | `LITERATURE_SEARCH` | Preprints in physics, CS, bio, math |
| **Europe PMC** | `EUROPE_PMC_SEARCH` | Full-text biomedical literature, PMC IDs |
| **ClinicalTrials.gov v2** | `CLINICAL_TRIALS_SEARCH` | Registered trials, phases, outcomes, enrollment |
| **OpenFDA (Adverse Events)** | `OPENFDA_ADVERSE_EVENTS` | Drug adverse event reports by reaction type |
| **OpenFDA (Drug Labels)** | `OPENFDA_DRUG_LABELS` | FDA prescribing info, warnings, dosage, contraindications |
| **NLM MeSH E-utilities** | `MESH_LOOKUP` | Controlled vocabulary, synonyms, entry terms |
| **NLM RxNorm** | `RXNORM_LOOKUP` | Drug RxCUI, brand names, drug classes, ingredients |
| **CrossRef** | `RETRACTION_CHECK` | DOI validation, citation counts, journal metadata |
| **Retraction Watch CSV** | `RETRACTION_CHECK` | Retraction status, reason, date for 50K+ papers |
| **Beall's List Mirror** | Predatory Journal Check | Flag predatory/questionable journals |
| **Unpaywall** | OA Fetcher | Legal open-access PDF links by DOI |
| **Sci-Hub** | Acquisition | Full-text PDF download (6 mirrors + CAPTCHA dialog) |
| **DuckDuckGo / Brave / Tavily / Firecrawl** | `WEB_SEARCH` | Grey literature, clinical guidelines, news |

---

### Statistical Analysis Engine

All tools run locally — no external API, no data leaves your machine.

| Tool | Function | Method |
|------|----------|--------|
| **Meta-Analysis** | `META_ANALYSIS` | DerSimonian-Laird random effects; fixed effects; Q-stat; I²; τ² |
| **Forest Plot** | `FOREST_PLOT` | matplotlib — per-study CI bars + pooled diamond; dark theme |
| **Funnel Plot** | `FUNNEL_PLOT` | Egger's linear regression test; Begg's rank correlation; 95% funnel lines |
| **PRISMA 2020** | `PRISMA_FLOWCHART` | Full 4-phase flowchart with identification/screening/eligibility/included boxes |
| **Risk of Bias Plot** | `ROB_PLOT` | Traffic-light grid per study × domain (RoB-2 / ROBINS-I / NOS) |
| **GRADE Assessment** | `GRADE_ASSESS` | Certainty scoring (⊕⊕⊕⊕ → ⊕◯◯◯); downgrade/upgrade domains |
| **PICO Extraction** | `PICO_EXTRACT` | LLM-powered structured extraction of P/I/C/O + sample size + effect + CI + p |

---

### Study Designs Supported

| Design | Pipeline Prompt | Reporting Guideline |
|--------|----------------|---------------------|
| Systematic Review | `research_pipeline` | PRISMA 2020 |
| Meta-Analysis | `research_pipeline` | PRISMA-MA + MOOSE |
| Narrative Review | `research_pipeline` | PRISMA (adapted) |
| Scoping Review | `research_pipeline` | PRISMA-ScR |
| Subject Review | `subject_review` | Custom |
| Educational | `educational` | Custom |
| Case Study | `case_study` | CARE |
| Comparative Analysis | `comparative` | Custom |
| Exploratory Research | `exploratory` | Custom |

---

### Component Architecture — "Clinical Laboratory Command Center"

The Research Window was rebuilt from a 2,000-line monolith into 14 focused, independently maintainable components:

```
src/components/research/
├── ZenithResearch.tsx          — Shell: layout, routing, settings, toast (~180 lines)
├── HeaderBar.tsx               — Mode toggle, title editing, export dropdown, sidebar toggles
├── ThreadSidebar.tsx           — Date-grouped threads, search, inline delete
├── ChatView.tsx                — Multi-turn chat + MessageBubble (tool badge, copy, edit)
├── PipelineView.tsx            — 44-step pipeline orchestration with progress tracking
├── AgentActivityFeed.tsx       — Dynamic event timeline replacing hardcoded phase list
├── PaperBrowser.tsx            — Sortable/filterable paper list with expandable abstracts
├── ExtractionTable.tsx         — PICO data grid with monospace statistics columns
├── ManuscriptPreview.tsx       — 4-tab viewer: manuscript / figures / tables / bibliography
├── SettingsPanel.tsx           — Full per-agent configurator (prompts, temp, tokens, thinking)
└── shared/
    ├── constants.ts            — THEME design tokens, PROVIDER_MODELS, PRICING, RESEARCH_TOOLS
    ├── types.ts                — AiPrompts, ZenithSettings, AgentEvent, PICOExtraction
    └── helpers.ts              — uid(), fmtCost(), estimateCost(), trackTokenUsage()
```

**Design system:** Dark "Clinical Laboratory" aesthetic — `#06080d` void background, `#22d3ee` cyan accents, `#10b981` emerald for success states, Geist Sans + Geist Mono typography, animated AgentActivityFeed timeline with pulse rings and glow borders on active agents.

---

### Full Settings Configurability (Zero Hardcoded Prompts)

Every pipeline parameter is loaded from `%APPDATA%/Zenith/settings.json` and editable in the Settings panel. **Nothing is hardcoded.**

| Setting | Where | What |
|---------|-------|------|
| **Pipeline Prompts** | Prompts tab → Pipeline | Per-design system prompt (research_pipeline, subject_review, educational, case_study, comparative, exploratory) |
| **Chat System Prompt** | Prompts tab → Chat Mode | The AI's persona for interactive chat |
| **Per-Agent System Prompt** | Agents tab → select agent | Step-specific override (empty = use global pipeline prompt) |
| **Per-Agent Model Tier** | Agents tab | Fast (cheap screening) vs Strong (capable drafting) |
| **Per-Agent Temperature** | Agents tab | 0.0–1.0 per agent |
| **Per-Agent Max Tokens** | Agents tab | 512–65,536 per agent |
| **Per-Agent Thinking** | Agents tab | Enable extended thinking + budget per agent |
| **Structured Output** | Agents tab | Force JSON schema for gatekeeper/triage/query-architect |
| **API Keys** | Model tab | Per-provider keys (OpenAI, Anthropic, Google, DeepSeek, Groq) |
| **Web Search Keys** | Model tab | Tavily, Brave, Firecrawl |
| **Tool Toggles** | Tools tab | Enable/disable each of the 28+ research tools for chat mode |

**Agents configurable:** Gatekeeper · Query Architect · Triage Agent · Blueprint Architect · Lead Author · Citation Verifier · Guidelines Checker · Prose Smoother

---

### Research Window Features

- **44 atomic pipeline steps** — each does exactly one thing; full audit trail
- **50+ free data tools** — zero paid academic APIs required
- **6 new statistical visualization tools** — forest/funnel plots, PRISMA flowchart, RoB grid, GRADE table, meta-analysis — all running locally with matplotlib/scipy
- **Dynamic Agent Activity Feed** — live timeline showing each agent's phase, tool calls, results, and errors; replaces static progress bar
- **Paper Browser** — sortable by title/year/citations; source filter pills (PubMed/S2/OpenAlex/Europe PMC/arXiv); expandable rows with abstract, DOI, OA link, acquisition status
- **PICO Extraction Table** — structured grid: Population · Intervention · Comparator · Outcome · N · Effect Size · 95% CI · p-value per included study
- **Manuscript Preview** — 4-tab viewer with lightweight markdown renderer; no external markdown library
- **Export (5 formats)** — Markdown (`.md`), LaTeX (`.tex`), BibTeX (`.bib`), JSON — saved to `%TEMP%/Zenith/Research/exports/` with toast confirmation
- **Multi-turn chat** — full conversation history + auto-rename on first message
- **Thread management** — date-grouped sidebar (Today / Yesterday / Older); inline delete; search filter
- **Token + cost tracking** — per-pipeline and total; syncs to Settings token usage via Rust `save_settings`
- **CAPTCHA dialog** — pipeline pauses when Sci-Hub requires CAPTCHA; dialog shows URL with copy button and browser-open shortcut
- **Test Connection** — one-click API key verification before running pipeline
- **Retraction alerts** — any retracted paper in the citation list is flagged before export

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

Zenith connects to **5 LLM providers** with **16+ models**. API keys are stored locally and never leave your machine except to the provider you choose.

| Provider | Models | Best For |
|----------|--------|----------|
| **OpenAI** | GPT-4.1-nano, GPT-4.1-mini, GPT-4.1, GPT-4o, o3-mini, o4-mini | Rename, Sort, Summarize, Dashboard, Pipeline Strong |
| **Anthropic** | Claude Haiku 4.5, Sonnet 4, Sonnet 4.5, Opus 4, Opus 4.6 | Ask Data, Deep Analysis, Lead Author, Prose Smoother |
| **Google** | Gemini 3.1 Flash Lite, 3.1 Flash, 3.1 Pro | OCR Vision, Super Summary, Fast Pipeline |
| **DeepSeek** | Chat (V3), Reasoner (R1) | Budget-friendly bulk processing, reasoning steps |
| **Groq** | Llama 3.3 70B, Llama 3.1 8B, Gemma 2 9B | Ultra-fast screening and triage phases |

### AI Features at a Glance

- **Token tracking** with real-time per-provider cost estimation (USD) — synced to Rust settings via `save_settings`
- **16+ customizable prompts** — tune every AI behavior from Settings (chat mode, all 9 pipeline study designs, all 8 pipeline agents)
- **Model picker** with live pricing info per provider
- **Per-agent model tier** — assign Fast vs Strong independently for each pipeline step
- **Extended Thinking** — enable Claude's extended reasoning with configurable budget per agent
- **Smart cost optimization** — use cheap models for bulk screening, premium for drafting

---

## &#128204; Settings Hub

A **full-featured settings panel** with 9 tabs for the main app, plus an in-window configuration panel for the Research module:

### Main Settings (9 Tabs)

| Tab | What You Control |
|-----|-----------------|
| **General** | Launch at startup, tray icon, update checks |
| **Appearance** | Accent color, opacity, blur intensity, corner radius, font size, border glow, aurora background, spotlight cards |
| **Behavior** | Collapse delay, hover/drag expand triggers, max items, duplicate detection, screen position |
| **Processing** | Image quality, WebP quality, resize %, PDF compression level, split chunk size |
| **API Keys** | Per-provider key management with model selection, pricing display, OMDB/VirusTotal/Brave/Firecrawl/Tavily/Firecrawl keys |
| **AI Prompts** | All 16 system prompts editable (File Management, Document Intelligence, Vision & Data, Research pipeline per design) |
| **Token Usage** | Per-provider usage cards with cost breakdown, total spend tracking, reset |
| **Shortcuts** | Configurable keyboard shortcuts (stage clipboard, toggle window, clear all) |
| **Scripts** | WASM plugin manager with enable/disable toggles |

### Research Settings Panel (in-window, 4 tabs)

| Tab | What You Control |
|-----|-----------------|
| **Model** | Provider, model, API key, Tavily/Brave/Firecrawl keys, temperature, max tokens, connection test |
| **Tools** | Enable/disable each of 28 research tools for chat mode (with toggle switches) |
| **Prompts** | Chat system prompt + all 6 pipeline study design prompts (expandable, editable) |
| **Agents** | Per-agent: system prompt override, model tier, temperature, max tokens, extended thinking toggle + budget, structured output |

---

## &#128640; Quick Start

### Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| **Node.js** | 18+ | Frontend build tooling |
| **Rust** | stable (via [rustup](https://rustup.rs)) | Tauri backend |
| **Python** | 3.10+ | AI & file processing sidecar |
| **scipy + matplotlib** | latest | Meta-analysis & statistical plots (Research v6.1) |
| **chromadb** | latest | Local vector database for RAG (Research v6.1) |
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

# 4. (Optional) Install research dependencies for statistical analysis
pip install scipy matplotlib numpy chromadb

# 5. Run in dev mode
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
 Framer Motion 12        Native OLE drag-drop           50+ file actions
 Tailwind CSS 4          Multi-window architecture      5 LLM providers + image gen
 Zustand 5               Clipboard interception         TheAudioDB / OMDB / imdbapi.dev
                         Clipboard image paste          Shazam fingerprint recognition
 Font Awesome 7          WASM plugin engine (wasmtime)  PDF / Image / Media / OCR
                         HTTP API server (:7890)         VirusTotal v3 integration
                         Transactional file I/O          Research v6.1 engine:
                         walkdir recursive traversal       ├── 44-step atomic pipeline
                         Rust settings ↔ Python args       ├── 50+ free academic APIs
                         (no hardcoded prompts)            ├── Statistical analysis engine
                                                           │   (scipy/matplotlib/numpy)
                                                           ├── ChromaDB local vector DB
                                                           ├── Retraction Watch checker
                                                           └── GRADE/RoB/PRISMA tools
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | [Tauri v2](https://v2.tauri.app) |
| **Backend** | Rust (serde, serde_json, walkdir, wasmtime, image, uuid, tauri-plugin-drag) |
| **Frontend** | React 19, TypeScript 5.8, Framer Motion 12 |
| **Styling** | Tailwind CSS 4, Glassmorphism + Clinical Laboratory dark theme |
| **State** | Zustand 5 |
| **AI / Processing** | Python 3 (Pillow, pdfplumber, pikepdf, pytesseract, reportlab, qrcode, requests, numpy, pydub, scipy, matplotlib, chromadb) |
| **Research APIs** | PubMed E-utilities, Semantic Scholar, OpenAlex, arXiv, Europe PMC, ClinicalTrials.gov v2, OpenFDA, NLM MeSH, NLM RxNorm, CrossRef, Retraction Watch, Unpaywall, Sci-Hub |
| **Statistics** | scipy (meta-analysis, Egger's test), matplotlib (forest/funnel/PRISMA/RoB plots), numpy |
| **Vector DB** | ChromaDB (local, no API key) |
| **Media APIs** | [TheAudioDB](https://www.theaudiodb.com) (music), [OMDB](https://www.omdbapi.com) (movies/series), [imdbapi.dev](https://imdbapi.dev) (primary movie lookup) |
| **Audio Recognition** | [SongRec](https://github.com/marin-m/SongRec) algorithm (Shazam-compatible fingerprinting) |
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
│   │   ├── Bubble.tsx             # Floating pill/panel + batch actions + pin mode + ✨ Canvas button
│   │   ├── StagedItemCard.tsx     # File card with 40+ per-item actions
│   │   ├── ZenithEditor.tsx       # Generative AI image editor (full window, /editor route)
│   │   ├── ZenithResearch.tsx     # Research shell: layout, routing, settings, toast (~180 lines)
│   │   ├── ReviewStudio.tsx       # Auto-Studio auxiliary panel (tree view + execute)
│   │   ├── PreviewDrawer.tsx      # Dynamic multi-format preview panel
│   │   ├── Settings.tsx           # Full settings modal (9 tabs)
│   │   ├── FolderTree.tsx         # Recursive navigable folder tree
│   │   ├── ScriptWindow.tsx       # WASM plugin runner UI
│   │   └── research/              # Research v6.1 components (14 files)
│   │       ├── HeaderBar.tsx      # Mode toggle, title editing, export, toggles
│   │       ├── ThreadSidebar.tsx  # Date-grouped threads, search, delete
│   │       ├── ChatView.tsx       # Multi-turn chat + tool badge MessageBubble
│   │       ├── PipelineView.tsx   # 44-step pipeline orchestration
│   │       ├── AgentActivityFeed.tsx # Dynamic event timeline (replaces hardcoded phases)
│   │       ├── PaperBrowser.tsx   # Sortable/filterable paper list
│   │       ├── ExtractionTable.tsx # PICO data grid
│   │       ├── ManuscriptPreview.tsx # 4-tab manuscript/figures/tables/bibliography
│   │       ├── SettingsPanel.tsx  # Per-agent configurator (prompts/temp/tokens/thinking)
│   │       └── shared/
│   │           ├── constants.ts   # THEME tokens, PROVIDER_MODELS, PRICING, RESEARCH_TOOLS
│   │           ├── types.ts       # AiPrompts, ZenithSettings, AgentEvent, PICOExtraction
│   │           └── helpers.ts     # uid(), fmtCost(), estimateCost(), trackTokenUsage()
│   ├── store.ts                   # Zustand store (items, studio, previews, settings, tokens)
│   ├── stores/
│   │   └── useResearchStore.ts    # Research Zustand store (threads, params, pipeline state)
│   ├── utils.ts                   # Helpers (icons, colors, formatting)
│   └── App.tsx                    # Root component
├── src-tauri/
│   └── src/
│       ├── lib.rs                 # 38+ Tauri commands (file ops, studio, walk, rename, editor, clipboard)
│       ├── api_server.rs          # HTTP REST API server (:7890)
│       ├── settings.rs            # Settings structs with 16+ AI prompts + 8 pipeline step configs
│       └── plugins.rs             # WASM plugin engine (wasmtime)
├── scripts/
│   ├── process_files.py           # 55+ Python processing actions + Auto-Studio + export_content
│   ├── research_engine.py         # Research v6.1 engine (6,000+ lines):
│   │                              #   44-step pipeline, 50+ free API tools,
│   │                              #   meta-analysis, forest/funnel/PRISMA/RoB plots,
│   │                              #   GRADE, PICO extraction, retraction check
│   ├── shazam_recognize.py        # Shazam audio fingerprinting (adapted from SongRec)
│   └── requirements.txt           # Python dependencies
├── Zenith v6.1.md                 # Research engine blueprint (44-step pipeline + architecture)
├── docs/
│   └── API.md                     # Full REST API documentation
├── .claude/
│   └── launch.json                # Dev server configurations (Vite :1420, Tauri dev)
├── zenith.bat                     # Unified launcher (build/launch/dev with 5s auto-select)
├── package.json
└── README.md
```

---

## &#128230; Storage Locations

| Data | Path |
|------|------|
| Settings (all prompts + pipeline configs) | `%APPDATA%/Zenith/settings.json` |
| Staged items | `%LOCALAPPDATA%/Zenith/state.json` |
| WASM plugins | `%APPDATA%/Zenith/plugins/` |
| Temp / output files | `%TEMP%/Zenith/` |
| Undo history | `%TEMP%/Zenith/mapping_history.json` |
| Studio transactions | `%TEMP%/Zenith/tx_*.json` |
| Editor generated images | `%TEMP%/Zenith/Zenith_Editor/` |
| Clipboard pastes | `%TEMP%/Zenith/clipboard_paste_*.png` |
| Research exports (.md / .tex / .bib) | `%TEMP%/Zenith/Research/exports/` |
| Research PDFs (acquired) | `%TEMP%/Zenith/Research/papers/` |
| Research vector database | `%TEMP%/Zenith/Research/vector_db/` |
| Research experiments | `%TEMP%/Zenith/Research/experiments/` |
| Retraction Watch cache | `scripts/retraction_watch_cache.csv` |
| Beall's list cache | `scripts/bealls_list_cache.txt` |
| Editor prompt library | `localStorage` key `zenith_editor_prompts` |
| Editor threads | `localStorage` keys `zenith_editor_threads`, `zenith_editor_active_thread` |
| Research threads | `localStorage` keys `zenith_research_threads`, `zenith_research_active_thread`, `zenith_research_params` |

---

## &#128202; Feature Coverage Matrix

| Capability | Single File | Folder | Multi-Select | Global | URL | Text |
|:-----------|:----------:|:------:|:------------:|:------:|:---:|:----:|
| AI Smart Rename | &#9989; | &#9989; | &#9989; | &#9989; | — | — |
| Convert / Resize / EXIF / Palette | &#9989; (Image) | — | — | — | — | — |
| Generative Editor (Image-to-image) | &#9989; (Image) | — | — | — | — | — |
| Generative Editor (Text-to-image) | — | — | — | &#9989; (Canvas btn) | — | — |
| Zip / Encrypt / Split / Archive | &#9989; | &#9989; | &#9989; | &#9989; | — | — |
| VirusTotal Scan | &#9989; | &#9989; | &#9989; | — | &#9989; | — |
| OCR | &#9989; | — | — | — | — | — |
| Ask Data / Summarize / Translate | &#9989; | — | — | — | — | — |
| Generate Dashboard | &#9989; | — | — | — | — | — |
| Merge PDFs | — | — | &#9989; | &#9989; | — | — |
| Auto-Studio Organize | — | — | — | &#9989; | — | — |
| Super Summary | — | — | — | &#9989; | — | — |
| QR Code | — | — | — | &#9989; | &#9989; | — |
| Preview | &#9989; | &#9989; | — | — | &#9989; | &#9989; |
| Self-Destruct Timer | &#9989; | &#9989; | — | — | — | — |
| Clipboard Image Paste | — | — | — | &#9989; (Ctrl+V) | — | — |
| Research Chat (30+ tools) | — | — | — | &#9989; (Research btn) | — | — |
| 44-Step Pipeline | — | — | — | &#9989; (Research) | — | — |
| Meta-Analysis + Forest Plot | — | — | — | &#9989; (Research) | — | — |
| PRISMA Flowchart | — | — | — | &#9989; (Research) | — | — |
| GRADE Assessment | — | — | — | &#9989; (Research) | — | — |
| ClinicalTrials Search | — | — | — | &#9989; (Research) | — | — |
| Drug AE / Label Lookup | — | — | — | &#9989; (Research) | — | — |
| Export (MD/LaTeX/BibTeX/JSON) | — | — | — | &#9989; (Research) | — | — |

---

## &#129309; Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## &#128220; License

This project is licensed under the **Zenith Personal Use License** — free for personal, non-commercial use. Commercial use requires a separate license. See the [LICENSE](LICENSE) file for full terms.

---

## &#128588; Acknowledgments

- **[AutoResearchClaw](https://github.com/aiming-lab/AutoResearchClaw)** by [Aiming Lab](https://github.com/aiming-lab) — Autonomous research pipeline architecture. Zenith's Research Window is inspired by AutoResearchClaw's research pipeline design and uses select concepts from its codebase for literature search, citation verification, and experiment sandbox capabilities.
- **[SongRec](https://github.com/marin-m/SongRec)** by [marin-m](https://github.com/marin-m) — Open-source Shazam client and audio fingerprinting algorithm. Zenith's music recognition module (`scripts/shazam_recognize.py`) is adapted from SongRec's Python implementation. Licensed under [GPL-3.0](https://github.com/marin-m/SongRec/blob/main/LICENSE).
- **[TheAudioDB](https://www.theaudiodb.com)** — Music metadata API (album, artist, year, genre, cover art).
- **[imdbapi.dev](https://imdbapi.dev)** — Primary movie/series metadata lookup API.
- **[OMDB API](https://www.omdbapi.com)** — Fallback movie/series metadata (ratings, plot, director).
- **[VirusTotal](https://www.virustotal.com)** — File and URL security scanning.
- **[PubMed E-utilities](https://www.ncbi.nlm.nih.gov/home/develop/api/)** — MEDLINE literature search and MeSH vocabulary (National Library of Medicine).
- **[Europe PMC](https://europepmc.org/RestfulWebService)** — Full-text biomedical literature REST API (EMBL-EBI).
- **[OpenAlex](https://openalex.org)** — Open catalog of the global research system.
- **[Semantic Scholar API](https://api.semanticscholar.org)** — Academic paper search and citation graphs (Allen Institute for AI).
- **[ClinicalTrials.gov v2 API](https://clinicaltrials.gov/data-api/api)** — Registry of clinical studies (U.S. National Library of Medicine).
- **[OpenFDA API](https://open.fda.gov/apis/)** — Drug adverse events and prescribing labels (U.S. FDA).
- **[NLM RxNorm API](https://lhncbc.nlm.nih.gov/RxNav/)** — Drug nomenclature and classification (National Library of Medicine).
- **[Unpaywall](https://unpaywall.org/products/api)** — Legal open-access paper discovery by DOI.

---

<div align="center">

**Built with Rust &#9881;&#65039;, React &#9889;, Python &#128013;, and mass amounts of caffeine &#9749;**

*175+ features. 5 AI providers. Generative image editor. Research v6.1 — 44-step pipeline, 50+ free APIs, statistical engine. Shazam music ID. 1 invisible tool that does everything.*

**&#11088; Star this repo if Zenith blew your mind!**

</div>
