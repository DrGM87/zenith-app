# Zenith v9 Update Plan — Full Audit Remediation & Optimization

## Overview

**Duration:** ~9 phases, ordered by criticality  
**Goal:** Fix every gap from the audit, modularize both Rust backend and Python sidecar, complete wiring, add test coverage, and harden for production.

---

## Phase 0: Safety Net — Core Tests BEFORE Refactor

> **CRITICAL:** Write the safety net before walking the tightrope. Splitting 1776 lines of `lib.rs` without tests is the riskiest move in this entire plan.

### 0.1 Rust unit tests (minimum viable)
- **File:** `src-tauri/src/tests/` (NEW directory)
- **Create these tests FIRST before any refactoring:**

| Test file | Tests |
|-----------|-------|
| `tests/staging.rs` | `create_staged_item_from_path` success + file not found, `stage_file` duplicates, `clear_all` |
| `tests/mime.rs` | `get_mime_type` for all 30+ extensions, unknown falls back to octet-stream |
| `tests/rename.rs` | `apply_rename` success + collision + empty stem, `undo_rename`, `redo_rename`, `get_counts` |
| `tests/persistence.rs` | `persist_items` + `load_persisted_items` round-trip, tags, activity log, clipboard history |

- **Verification:** `cargo test` passes against current (unrefactored) `lib.rs`. These tests prove behavioural equivalence after the split.

### 0.2 Python unit tests (minimum viable)
- **File:** `scripts/tests/` (NEW directory)
- **Create these tests FIRST before Python refactoring:**

| Test file | Tests |
|-----------|-------|
| `tests/test_image_ops.py` | compress_image, convert_image, resize_image, strip_exif, extract_palette |
| `tests/test_pdf_ops.py` | merge_pdf, compress_pdf, pdf_to_csv |
| `tests/test_archive_ops.py` | zip_file, split_file |

- **Verification:** `python -m pytest scripts/tests/` passes against current `process_files.py`.

### 0.3 Frontend baseline
- Run existing vitest suite (`npm test`): `store.test.ts`, `utils.test.ts`, `helpers.test.ts`
- Capture baseline; every subsequent phase must keep these green.

---

## Phase 1: Security Fire Drill

### 1.1 Rotate leaked Gemini API key
- **File:** `scripts/.env`
- **Action:** Delete the `.env` file, regenerate the Gemini key in Google AI Studio, store the new key via the app's Settings → API Keys UI (which writes to OS Credential Manager)
- **Verification:** `scripts/.env` no longer exists; the app uses credential-manager-stored key

### 1.2 Enable Content Security Policy
- **File:** `src-tauri/tauri.conf.json`
- **Change:** Replace `"csp": null` with a minimal CSP:

```json
"csp": "default-src 'self'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; script-src 'self' https://cdn.jsdelivr.net; img-src 'self' data: blob: https:; connect-src 'self' https: ws://localhost:1420 http://localhost:7890; font-src 'self' data:; frame-src 'none'; object-src 'none'"
```

> **Note:** `ws://localhost:1420` is for Vite HMR (dev only — in production builds CSP can drop this). `http://localhost:7890` is the API server port.

### 1.3 Remove dangerous TLS
- **File:** `src-tauri/src/lib.rs` (line 594)
- **Change:** Remove `.danger_accept_invalid_certs(true)` from `ping_url`
- **Verification:** `ping_url` no longer accepts invalid HTTPS certificates

### 1.4 Tighten asset protocol scope
- **File:** `src-tauri/tauri.conf.json`
- **Change:** Replace `"allow": ["**"]` with `"allow": ["$APPDATA/**", "$TEMP/Zenith/**", "$HOME/**"]`
- **Warning:** Verify that no workflows break (e.g. drag-drop from system paths). If needed, selectively add `"$DOWNLOAD/**"` or `"$DESKTOP/**"`.

### 1.5 Fix Tauri capabilities
- **File:** `src-tauri/capabilities/default.json`
- **Change:** Create separate capability files per window:
  - `main.json` → drag-drop + clipboard
  - `settings.json` → settings permissions
  - `editor.json` → filesystem read
  - `script.json` → process spawn
- **Verification:** Tauri security audit passes with `npm run tauri info`

---

## Phase 2: Rust Backend Modularization

### 2.1 Split `lib.rs` into module tree (NEW FILES)

```
src-tauri/src/
├── main.rs                    (unchanged — thin entry point)
├── lib.rs                     (shrunk to ~100 lines — only state structs, run() bootstrap)
├── commands/
│   ├── mod.rs                 (re-exports all)
│   ├── staging.rs             (stage_file, stage_text, remove_staged_item, clear_all_items, get_staged_items, set_self_destruct)
│   ├── window.rs              (resize_window, set_ignore_cursor, all open_*_window, open_settings)
│   ├── file_ops.rs            (read_file_base64, read_file_preview, open_file, list_directory, reveal_in_folder, walk_directory, save_clipboard_image)
│   ├── rename.rs              (apply_rename, undo_last_rename, redo_last_rename, get_rename_history_counts)
│   ├── studio.rs              (execute_studio_plan, move_files, undo_moves, smart_organize bridge)
│   ├── process.rs             (process_file, launch_script, stop_script, cancel_all_scripts, is_script_running)
│   ├── drag.rs                (start_drag_out, email_files)
│   ├── settings_cmd.rs        (get_settings, save_settings, export_settings, import_settings)
│   ├── security.rs            (store_api_key, get_api_key, delete_api_key, store_secret_key, get_secret_key, ping_url)
│   ├── plugins_cmd.rs         (list_plugins, run_plugin)
│   ├── script_window.rs       (open_script_window, update_script_window, close_script_window, get_script_window_content)
│   ├── editor.rs              (open_editor_window, open_editor_window_blank, take_pending_editor_image)
│   ├── music.rs               (record_and_recognize, get_music_discovery, save_music_track, delete_music_track)
│   ├── activity.rs            (log_activity, get_activity_log, clear_activity_log)
│   ├── tags.rs                (get_tags, set_tag, remove_tag)
│   ├── clipboard.rs           (save_clipboard_entry, get_clipboard_history, clear_clipboard_history)
│   └── snipping.rs            (launch_snipping_tool)
├── state/
│   ├── mod.rs                 (re-exports all state types)
│   ├── app_state.rs           (AppState, EditorImageState, ScriptWindowState, ScriptProcessState)
│   ├── persistence.rs         (persist_items, load_persisted_items, state_path, tags_path, activity_log_path, clipboard_history_path, rename_history_path)
│   └── keyring.rs             (KEYRING_SERVICE const, keyring helper wrappers)
├── api_server.rs              (unchanged — already a separate module)
├── plugins.rs                 (unchanged)
├── settings.rs                (unchanged)
├── tests/                     (moved here; see Phase 0)
└── utils.rs                   (NEW: shared utilities — get_mime_type, generate_thumbnail, create_staged_item_from_path)
```

### 2.2 Replace non-cryptographic UUIDs
- **Files:** `commands/*.rs`, `api_server.rs`
- **Action:** Replace all instances of `chrono_id()` and manual `uuid_v4()` with `uuid::Uuid::new_v4().to_string()`
- **Remove:** `fn chrono_id()` — delete from utils.rs
- **Remove:** `fn uuid_v4()` and `fn rand_u32()` from `api_server.rs` (lines ~473, ~482)
- **Verification:** IDs are RFC 9562-compliant random UUIDv4, not system-time derived

### 2.3 Replace unwrap() calls with proper error handling
- **Files:** All `commands/*.rs` AND `api_server.rs` (30 calls total: 11 in lib.rs, 19 in api_server.rs)
- **Action:** Replace `lock().unwrap()` → `lock().map_err(|e| e.to_string())?` throughout
- **Fix self-destruct thread** (lib.rs lines 1833-1862): Use `tauri::async_runtime::spawn` + `Arc<Mutex<HashMap<...>>>` clone instead of raw `std::thread::spawn` with `app.state()`
- **Fix API server thread** (api_server.rs line 18): Same pattern — convert `std::thread::spawn` to `tauri::async_runtime::spawn`
- **Performance consideration:** For read-heavy app state, prefer `Arc<RwLock<T>>` over `Arc<Mutex<T>>`
- **Verification:** `cargo check` with `#[deny(clippy::unwrap_used)]` passes with zero warnings

### 2.4 Add structured logging
- **File:** `src-tauri/Cargo.toml` — add `tracing = "0.1"` and `tracing-subscriber = { version = "0.3", features = ["json", "env-filter"] }`
- **Initialize** in `run()` before the builder with `tracing_subscriber::fmt().with_env_filter("info").init()`
- **Replace** all `eprintln!`/`println!` with `tracing::info!`/`tracing::warn!`/`tracing::error!`
- **Log format:** JSON for production (`RUST_LOG_FORMAT=json`), pretty for dev
- **Target scope:** `commands/*.rs`, `api_server.rs`, `plugins.rs`, `settings.rs`

### 2.5 Fix async blocking
- **Files:** `commands/process.rs`, `commands/music.rs`, `commands/studio.rs`
- **Action:** Mark long-running commands as `async` and use `tokio::task::spawn_blocking` for:
  - `record_and_recognize` (cpal recording blocks the thread)
  - `process_file` (waiting on Python subprocess)
  - `execute_studio_plan` (curl downloads + file moves)
- **Verification:** UI remains responsive during 30s microphone recording

### 2.6 Wasmtime plugin sandboxing audit
- **File:** `plugins.rs`
- **Action:** Add the following wasmtime `Config` safety limits **before** Phase 6 (LLM wiring can invoke plugins):
  - **Fuel metering:** `config.consume_fuel(true)` with a per-invocation fuel limit
  - **Memory limit:** `config.static_memory_maximum_size(16 * 1024 * 1024)` (16 MB)
  - **Epoch interruption:** `config.epoch_interruption(true)` with 1ms deadline ticks
- **Audit:** List every host function exposed to WASM guests — ensure none escape the sandbox (filesystem access, network access, process spawning)
- **Verification:** Malicious WASM binary test — plug a plugin that tries infinite loop / excessive allocation; confirm it gets killed within the fuel/epoch limit

---

## Phase 3: Python Sidecar Refactor

### 3.1 PyInstaller compatibility check (DO FIRST)
- **File:** `scripts/process_files.spec`
- **Action:** Before splitting `process_files.py`, verify the current spec builds and runs
- **Command:** `cd scripts && pyinstaller process_files.spec`
- **After refactoring:** Regenerate/review the spec to include `--hidden-import=zenith_proc.*` for all new modules
- **Verification:** The bundled executable runs `zenith_proc.main` with identical behaviour to the pre-refactor binary

### 3.2 Split `process_files.py` into package (NEW FILES)

```
scripts/
├── zenith_proc/
│   ├── __init__.py
│   ├── main.py                 (CLI entry — dispatches to handlers)
│   ├── image_ops.py            (compress_image, convert_image, resize_image, strip_exif, extract_palette, save_palette_image, file_to_base64, convert_webp)
│   ├── pdf_ops.py              (merge_pdf, compress_pdf, ocr_to_pdf, pdf_to_csv)
│   ├── llm_ops.py              (_call_llm, _call_llm_vision, smart_rename, smart_sort, ocr, auto_organize, translate_file, email_draft, ask_data, summarize_file, super_summary, generate_dashboard)
│   ├── vt_ops.py               (scan_virustotal, _vt_api_get, _vt_upload_file, _vt_poll_analysis, _vt_parse_report_*)
│   ├── media_ops.py            (convert_media, url_to_qr)
│   ├── archive_ops.py          (zip_file, zip_files, zip_encrypt, split_file)
│   ├── studio.py               (smart_organize_studio — TheAudioDB, OMDB, imdbapi.dev, Shazam fallback, EXIF grouping, doc categorization)
│   ├── audio_ops.py            (ocr_save_text, recognize_audio bridge from shazam_recognize.py)
│   └── utils.py                (_extract_text, _chunk_text, TEMP_DIR, usage accumulator)
├── tests/                      (moved here; see Phase 0 & 5.2)
├── process_files.py            (shrunk to ~30 lines — thin wrapper importing zenith_proc.main)
├── shazam_recognize.py         (unchanged)
└── requirements.txt            (unchanged)
```

### 3.3 Add OpenAI, Anthropic, Groq support to `_call_llm`
- **File:** `scripts/zenith_proc/llm_ops.py`
- **Action:** Add branches for `provider == "openai"`, `"anthropic"`, `"groq"` using the same `urllib.request` pattern as existing `deepseek` and `google`
- **Model defaults:**
  | Provider | Default Model | Input $/1M | Output $/1M |
  |----------|--------------|------------|-------------|
  | `openai` | `gpt-4.1-nano` | $0.10 | $0.40 |
  | `anthropic` | `claude-haiku-4-5-20250514` | $0.80 | $4.00 |
  | `google` | `gemini-2.5-flash` | (existing) | (existing) |
  | `deepseek` | `deepseek-v4-flash` | (existing) | (existing) |
  | `groq` | `llama-3.3-70b-versatile` | $0.59 | $0.79 |

### 3.4 Add process health + timeout
- **File:** `zenith_proc/main.py`
- **Action:** Add `signal.signal(signal.SIGTERM, cleanup_temp_files)`, timeout wrapper for each action (default 300s), and streaming stdout for progress
- **Rust side** (`commands/process.rs`): Read stdout line-by-line and emit `process-progress` events
- **Health check:** Add a `--health` flag that prints `{"status": "ok", "version": "..."}` and exits 0 — Rust can call this to verify the sidecar is functional before dispatching work

### 3.5 Clean up orphaned scripts
- **Action:** Delete or move to `scripts/disabled/`: `clinical_trials.py`, `fda_drug_label.py`, `gRAG_integration.py`, `gRAG_prompt_tuning.py`
- **Or** add them as registered scripts with `enabled: false` in the default settings

---

## Phase 4: Frontend Improvements

### 4.1 Split `Bubble.tsx` (1513 lines)
- **File:** Create `src/components/` with:

```
components/
├── Bubble.tsx                 (shrunk to ~200 lines — layout, drag handlers, footer)
├── BubbleActionBar.tsx        (action buttons grid — Convert, EXIF, Resize, etc.)
├── BubbleFooter.tsx           (Batch, Clipboard, Settings, Clear, Pin, More menu)
├── BubbleHeader.tsx           (Pill/collapsed state, screenshot button, undo/redo)
├── BatchQueuePanel.tsx        (BatchQueueModal extracted from Bubble)
├── ClipboardHistoryPanel.tsx  (clipboard history panel extracted)
├── RecognitionPanel.tsx       (audio recognition results panel)
├── FolderTree.tsx             (unchanged)
├── PreviewDrawer.tsx          (unchanged)
├── ReviewStudio.tsx           (unchanged)
├── Settings.tsx               (unchanged)
├── StagedItemCard.tsx         (unchanged)
├── ZenithEditor.tsx           (unchanged)
├── MusicDiscoveryPage.tsx     (unchanged)
├── ScriptWindow.tsx           (unchanged)
├── DraggablePanel.tsx         (unchanged)
└── effects/                   (unchanged)
```

### 4.2 Replace silent error swallowing
- **File:** `src/store.ts`
- **Affected functions (4 instances):**
  - `loadTags` (line 307): `catch { /* ignore */ }` → `catch (e) { console.error("[Zenith Store] loadTags failed:", e); }`
  - `setItemTag` (line 313): `catch { /* ignore */ }` → `catch (e) { console.error("[Zenith Store] setItemTag failed:", e); }`
  - `removeItemTag` (line 323): `catch { /* ignore */ }` → `catch (e) { console.error("[Zenith Store] removeItemTag failed:", e); }`
  - `refreshRenameCounts` (line 504): `catch { /* ignore */ }` → `catch (e) { console.error("[Zenith Store] refreshRenameCounts failed:", e); }`
- **Add:** `errorToast: string | null` to Zustand state + `setErrorToast`/`clearErrorToast` actions

### 4.3 Complete `pricing.ts`
- **File:** `src/shared/pricing.ts`
- **Action:** Add all models from README:

```typescript
export const PRICING: Record<string, Record<string, { input: number; output: number }>> = {
  openai: {
    "gpt-4.1-nano": { input: 0.10, output: 0.40 },
    "gpt-4.1-mini": { input: 0.40, output: 1.60 },
    "gpt-4.1": { input: 2.00, output: 8.00 },
    "gpt-4o": { input: 2.50, output: 10.00 },
    "gpt-4o-mini": { input: 0.15, output: 0.60 },
    "o3-mini": { input: 1.10, output: 4.40 },
    "o4-mini": { input: 1.10, output: 4.40 },
    "gpt-image-1.5": { input: 0.05, output: 0 },
  },
  anthropic: {
    "claude-haiku-4-5-20250514": { input: 0.80, output: 4.00 },
    "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
    "claude-opus-4-20250514": { input: 15.00, output: 75.00 },
  },
  google: { /* existing — keep */ },
  deepseek: { /* existing — keep */ },
  groq: {
    "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
    "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
    "gemma2-9b-it": { input: 0.20, output: 0.20 },
  },
};
```

### 4.4 Consolidate data directory paths
- **File:** `src/shared/paths.ts` (NEW)
- **Action:** Export a single `DATA_DIR` function using `invoke("get_data_dir")` or `%LOCALAPPDATA%/Zenith` fallback
- **Migrate:** `persist_items`, `tags_path`, `activity_log_path`, `clipboard_history_path`, `rename_history_path` in Rust to use this single location
- **Remove** usage of `%TEMP%/Zenith/` except for actual temp files (clipboard paste output, intermediate conversion files)

### 4.5 Fix clipboard image truncation
- **File:** `src-tauri/src/commands/clipboard.rs` (new) or the existing code
- **Change:** Store full image base64 (no 4KB truncation). If too large (>1MB), save to a temp file and store the path reference instead.

### 4.6 TypeScript & Linting
- **File:** `tsconfig.json` — set `"strict": true` and fix resulting type errors
- **File:** `package.json` — add `eslint` + `@typescript-eslint/parser` + `eslint-plugin-react-hooks` dev deps
- **File:** `.eslintrc.json` (NEW) — extend recommended TypeScript + React hooks rules
- **Action:** Run `tsc --noEmit` and fix all errors before proceeding to Phase 6

### 4.7 Accessibility baseline
- **File:** `Bubble.tsx`, `BubbleHeader.tsx`, `BubbleActionBar.tsx`
- **Action:** Add `aria-label` to icon-only buttons. Add `role="button"` to clickable non-button elements. Support `prefers-reduced-motion: reduce` in effect components (skip animations).
- **File:** `effects/*.tsx` — wrap all animation triggers in `window.matchMedia('(prefers-reduced-motion: reduce)').matches` guard

---

## Phase 5: Full Test Coverage

### 5.1 Rust tests (complete the suite from Phase 0)
- **Files:** `src-tauri/src/tests/` (extend existing)
- **Additional test files to create:**

| Test file | Tests |
|-----------|-------|
| `tests/staging.rs` | (Phase 0 — already done) |
| `tests/mime.rs` | (Phase 0 — already done) |
| `tests/rename.rs` | (Phase 0 — already done) |
| `tests/persistence.rs` | (Phase 0 — already done) |
| `tests/settings.rs` | `ZenithSettings::default()`, `load()`, `save()` round-trip, JSON deserialization of old format |
| `tests/api_server.rs` | GET /health, GET /items, POST /stage/file, DELETE /items/\<id\>, 404 paths, oversized body rejection, path traversal rejection |
| `tests/plugins.rs` | Load a no-op WASM plugin, verify fuel/memory sandboxing kills bad plugins |

### 5.2 Python tests (complete the suite from Phase 0)
- **Files:** `scripts/tests/` (extend existing)

| Test file | Tests |
|-----------|-------|
| `tests/test_image_ops.py` | (Phase 0 — already done) |
| `tests/test_pdf_ops.py` | (Phase 0 — already done) |
| `tests/test_archive_ops.py` | (Phase 0 — already done) |
| `tests/test_llm_ops.py` | _chunk_text, _extract_text, smart_sort parse (mock LLM), auto_organize parse, _call_llm for all 5 providers (mock HTTP responses) |
| `tests/test_vt_ops.py` | scan_virustotal error on missing key, URL base64 encoding |
| `tests/test_studio.py` | smart_organize_studio parse, Shazam fallback parse |

### 5.3 Frontend store integration tests
- **File:** `src/__tests__/store.integration.test.ts` (NEW)
- **Tests:** Mock `invoke` to return controlled data; test `stageFile` → item appears, `removeItem` → item gone, `clearAll` → empty, `trackTokenUsage` → correct cost calculation, `loadSettings` → store populated
- **File:** `src/__tests__/components/` (NEW directory)
- **Tests:** Smoke render `Bubble`, `Settings`, `StagedItemCard` with mocked store; verify they don't crash. Snapshot test for `Bubble` collapsed + expanded states.

### 5.4 E2E / Tauri webdriver test
- **File:** `e2e/` (NEW directory)
- **Framework:** Tauri + `@tauri-apps/cli` webdriver or Playwright against `npm run tauri dev`
- **Minimum test:** App launches, main window exists, API server responds to GET /health
- **Regression test:** Drag-drop a sample file, verify it stages; click Clear, verify empty

---

## Phase 6: LLM Provider Completion & Wiring

### 6.1 Complete `_call_llm` for all 5 providers
- **File:** `scripts/zenith_proc/llm_ops.py`

| Provider | Endpoint | Header | Response parsing | Streaming? |
|----------|----------|--------|-----------------|------------|
| `openai` | `https://api.openai.com/v1/chat/completions` | `Authorization: Bearer` | `data.choices[0].message.content` | SSE (deferred) |
| `anthropic` | `https://api.anthropic.com/v1/messages` | `x-api-key:` + `anthropic-version: 2023-06-01` | `data.content[0].text` | SSE (deferred) |
| `google` | Done | | | |
| `deepseek` | Done | | | |
| `groq` | `https://api.groq.com/openai/v1/chat/completions` | `Authorization: Bearer` | Same as OpenAI | |

### 6.2 LLM fallback chain
- **File:** `scripts/zenith_proc/llm_ops.py`
- **Action:** Add `_call_llm_with_fallback(providers: list[str], ...)` that tries providers in order:
  ```
  [primary_provider] → [deepseek] → [gemini-2.5-flash]  (configurable)
  ```
- **Errors that trigger fallback:** HTTP 429 (rate limit), 5xx (server error), timeout, connection error. Do NOT fallback on 4xx auth errors (bad key).
- **Cost estimation:** Before each call, estimate token cost from prompt length + expected output and log it. Surface to user via `process-progress` events.

### 6.3 Unify model ID constants
- **File:** `src/shared/models.ts` (NEW from README model table)
- **Export:**
  - `MODELS_BY_PROVIDER`: Record of provider → model[] with display names
  - `IMAGE_GEN_MODELS`: Set of model IDs that support image generation
  - `VISION_MODELS`: Set of model IDs that support image input (for selecting which provider to use for OCR, etc.)
  - `DEFAULT_MODEL`: per provider (cheapest capable model as default)
- **Use in:** `Settings.tsx` model picker, `Bubble.tsx` AI action invocations, `ZenithEditor.tsx`

### 6.4 Wire token tracking end-to-end
- **Current issue:** `_call_llm` populates `_usage_accumulator` but the Rust side never reads it back
- **Fix:** Return `usage` object in every LLM response, parse it in Rust `process_file` command, emit `token-used` event, which the store's `trackTokenUsage` picks up via `listen`
- **File changes:**
  - `zenith_proc/llm_ops.py` — ensure every response includes `"usage": {"input_tokens": N, "output_tokens": N, "model": "...", "provider": "..."}`
  - `commands/process.rs` — after parsing stdout, extract `usage` field, emit event
  - `store.ts` — listen for `token-used` event, auto-call `trackTokenUsage`
- **Persist:** Accumulated usage to a JSON file in `DATA_DIR/usage.json` for lifetime cost tracking

---

## Phase 7: Production Hardening

### 7.1 Rate limiting on REST API
- **File:** `src-tauri/src/api_server.rs`
- **Action:** Add a `Arc<Mutex<HashMap<IpAddr, (Instant, u32)>>>` sliding window
- **Limit:** 60 requests/minute per IP for general endpoints, 10/min for `/process`
- **Return:** `429 Too Many Requests` with `Retry-After` header
- **Dev override:** Disable rate limiting when `RUST_ENV=development` (detected via env var or debug build)

### 7.2 Input validation on API endpoints
- **File:** `src-tauri/src/api_server.rs`
- **Add:**
  - Max JSON body size: 10MB (reject with 413)
  - Path traversal rejection: refuse any path containing `..` in `/browse/` and `/items/` routes
  - UUID format validation on `/items/{id}` routes (regex: `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
  - Content-Type enforcement: accept only `application/json` on POST/PUT

### 7.3 Fix state persistence race conditions
- **File:** `src-tauri/src/state/persistence.rs`
- **Approach:** Atomic file write (`write to temp → fs::rename`) for `persist_items`
- **Alternative (simpler):** Debounce persists — collect changes over 200ms windows and write once

### 7.4 Add error recovery
- **File:** `commands/process.rs`
- **Action:** If `process_files.py` errors out, retry once with a clean `TEMP_DIR`. If still failing, return a structured error with a suggestion
- **File:** `lib.rs` — wrap the entire `run()` builder in a `std::panic::catch_unwind` for top-level crash recovery
- **Signal handling:** Register `ctrl+c` handler that: cancels all running scripts → persists state → shuts down API server → exits cleanly

### 7.5 Graceful shutdown
- **File:** `lib.rs` — add a `shutdown` Tauri command that:
  1. Cancels all running Python subprocesses (`taskkill` on Windows, `SIGTERM` on Unix)
  2. Persists all staged items, tags, activity log, clipboard history, rename history
  3. Closes the API server TCP listener
  4. Exits with code 0
- **Trigger:** Window close event on `main` window → call `shutdown` → wait for persist → exit

### 7.6 Build pipeline cleanup
- **File:** `package.json`
- **Add scripts:**
  - `"lint:rs": "cargo clippy -- -D warnings"`
  - `"lint:py": "ruff check scripts/"`
  - `"lint:ts": "tsc --noEmit"`
  - `"lint": "npm run lint:ts && npm run lint:rs && npm run lint:py"`
  - `"test:all": "npm test && cargo test && cd scripts && python -m pytest tests/"`
- **Add CI/CD:** `.github/workflows/ci.yml` (NEW):
  ```yaml
  on: [push, pull_request]
  jobs:
    lint: npm run lint
    test: npm run test:all
    build: npm run build && npm run tauri build -- --debug
  ```
- **Add to AGENTS.md:** Instructions to run `npm run lint && npm run test:all` before any commit

### 7.7 Fix Cargo dependency mismatch
- **File:** `src-tauri/Cargo.toml`
- **Either:** Add `aes-gcm`, `argon2`, `sha2`, `hex`, `rand` if they're genuinely used
- **Or:** Remove them from the README tech stack list if they're aspirational/not yet implemented

### 7.8 Privacy / local-only processing mode
- **File:** `ZenithSettings` struct — add `privacy_mode: bool` (default `false`)
- **When enabled:** All LLM calls route through local models only (GLM-OCR, local embedding). No external API calls. Image operations, PDF processing, and archive ops remain local.
- **UI:** Toggle in Settings → Privacy. When enabled, disable OpenAI/Anthropic/Groq/DeepSeek model selections.

### 7.9 Observability
- **File:** `src-tauri/src/observability.rs` (NEW)
- **Metrics to track:**
  - Command latency histogram (per command: `stage_file`, `process_file`, `read_file_base64`, etc.)
  - Error rate (by error type: timeout, API failure, filesystem error)
  - Sidecar health (up/down state, last heartbeat)
- **Endpoint:** `GET /debug/metrics` on the API server (only in debug builds or with `RUST_ENV=development`)
- **Endpoint:** `GET /debug/state` — dump current app state snapshot (staged item count, settings hash, etc.)

### 7.10 Performance baseline
- **Before Phase 2 refactor:** Benchmark `stage_file` (100 files), `walk_directory` (1000 files), `process_file` (10MB PDF OCR)
- **After Phase 2 refactor:** Re-run same benchmarks — confirm no regression
- **Tool:** Use `cargo bench` (criterion crate) or manual timing via `Instant::now()`

---

## Phase 8: Polish & Documentation

### 8.1 Remove commented-out code
- **File:** `src-tauri/src/settings.rs` (lines 69-80) — delete the old short prompts (12-line `/* ... */` block)
- **Additional cleanup:** Search entire codebase for any remaining dead/commented code

### 8.2 Clean up `.gitignore`
- **Add:** `scripts/__pycache__/dist/`, `src-tauri/target/`, `.code-review-graph/`, `venv/`
- **Keep `build/`:** This entry (line 49, under `# PyInstaller / Build Artifacts`) is correct for PyInstaller output and should NOT be removed. It does not conflict with `src-tauri/build.rs` (which is a build script, not output) or Vite's `dist/` directory.

### 8.3 Update README badges
- **Update:** Test count badge to reflect real test count (not "36/36")
- **Add:** Architecture diagram (ASCII updated with new module structure from Phase 2/3/4)
- **Add:** Line counts (shrunk `lib.rs` 1776→100, `process_files.py` 2919→30, `Bubble.tsx` 1513→200)
- **Remove:** References to `aes-gcm`, `argon2`, `sha2`, `hex`, `rand` from tech stack if not added to Cargo.toml (per 7.7)

### 8.4 AGENTS.md conventions
- **Add:** "Before writing any code, run `npm run lint` and `npm run test:all`"
- **Add:** "LLM pricing updates go in `src/shared/pricing.ts` only"
- **Add:** "New Tauri commands go in `src-tauri/src/commands/<domain>.rs`"
- **Add:** "Model IDs and capabilities go in `src/shared/models.ts`"

### 8.5 Release checklist
- **File:** `RELEASE.md` (NEW)
- **Checklist:**
  - [ ] `npm run lint` passes (zero warnings)
  - [ ] `npm run test:all` passes (all suites green)
  - [ ] `npm run tauri build` succeeds
  - [ ] PyInstaller sidecar builds cleanly
  - [ ] CSP + capabilities audit passes
  - [ ] API key rotation verified
  - [ ] Clean install test (fresh OS Credential Manager, no prior state)

---

## File Change Summary

| Phase | New Files | Modified Files | Deleted/Lines |
|-------|-----------|---------------|---------------|
| 0 (Safety net) | 7 (4 Rust + 3 Python test files) | 0 | 0 |
| 1 (Security) | 0 | 3 (`tauri.conf.json`, `lib.rs`, `capabilities/default.json`) | `scripts/.env` deleted |
| 2 (Rust refactor) | 23 (`commands/*.rs`, `state/*.rs`, `utils.rs`, `observability.rs`) | 5 (`lib.rs`, `Cargo.toml`, `main.rs`, `api_server.rs`, `plugins.rs`) | ~1500 lines removed from `lib.rs` |
| 3 (Python refactor) | 10 (`zenith_proc/*.py`) | 2 (`process_files.py` → wrapper, `process_files.spec`) | ~2300 lines moved, 4 orphaned scripts cleaned |
| 4 (Frontend) | 7 (`BubbleActionBar`, `BubbleFooter`, `BubbleHeader`, `BatchQueuePanel`, `ClipboardHistoryPanel`, `RecognitionPanel`, `paths.ts`) + eslint config | 4 (`Bubble.tsx`, `store.ts`, `pricing.ts`, `tsconfig.json`) | ~1000 lines extracted from `Bubble.tsx` |
| 5 (Tests) | 5 additional (2 Rust + 1 Python + 2 TS) | 0 | New (extends Phase 0 files) |
| 6 (LLM wiring) | 1 (`models.ts`) | 3 (`llm_ops.py`, `process.rs`, `store.ts`) | |
| 7 (Hardening) | 1 (`.github/workflows/ci.yml`) | 3 (`api_server.rs`, `persistence.rs`, `package.json`) | |
| 8 (Polish) | 1 (`RELEASE.md`) | 3 (`settings.rs`, `.gitignore`, `README.md`, `AGENTS.md`) | |
| **Total** | **~55 new** | **~26 modified** | **~4 deleted** |

---

## Execution Order

```
Phase 0 (Safety net tests)        ← DO FIRST, 1 day
Phase 1 (Security)                ← 1 hour
Phase 2 (Rust refactor)          ← 2-3 days (verified by Phase 0 tests)
Phase 3 (Python refactor)        ← 1-2 days (can parallel with Phase 4; VERIFY PyInstaller after)
Phase 4 (Frontend)               ← 1-2 days (can parallel with Phase 3)
Phase 5 (Full test coverage)     ← 1-2 days (ongoing as each phase completes)
Phase 6 (LLM wiring)             ← 1-2 days
Phase 7 (Hardening)              ← 1-2 days
Phase 8 (Polish)                 ← 0.5 day
```

**Parallel work:** Phases 3 + 4 can run in parallel (Python + Frontend are independent).  
**Gate check after Phase 2:** `npm run test:all` must be 100% green. If not, fix regressions before continuing.  
**Gate check after Phase 6:** Manual smoke test — stage a PDF, run smart_rename via OpenAI, verify token tracking updates.
