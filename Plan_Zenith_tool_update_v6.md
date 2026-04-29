# ZENITH v0.2.0 — PRODUCTIVITY REFACTOR PLAN

## PHASE 1: STRIP RESEARCH/MEDICAL (Remove Only)

### 1.1 Frontend Deletions

| # | File/Dir to Delete | Reason |
|---|-------------------|--------|
| 1 | `src/components/ZenithResearch.tsx` | Entire research orchestrator (668 lines) |
| 2 | `src/components/research/` (entire directory) | 11 files: HeaderBar, ThreadSidebar, ChatView, PipelineView, SettingsPanel, PaperBrowser, ManuscriptPreview, AgentActivityFeed, ExtractionTable, shared/, effects/ |
| 3 | `src/stores/useResearchStore.ts` | Research-specific Zustand store (460 lines) |
| 4 | `src/assets/react.svg` | Unused |

### 1.2 Python Script Deletions

| # | File to Delete | Why |
|---|---------------|-----|
| 5 | `scripts/research_engine.py` | 15-phase medical research pipeline (82 nodes, largest file) |
| 6 | `scripts/scihub.py` | Sci-Hub PDF acquisition (15 nodes) |
| 7 | `scripts/zenith_api.py` | Legacy API client overlapping with api_server.rs |
| 8 | `scripts/ai_summarizer.py` | Replaced by process_files.py summarization |

### 1.3 Frontend Cleanup (Modify Existing Files)

| # | File | Change |
|---|------|--------|
| 9 | `src/App.tsx` | Remove `ZenithResearch` import and `?window=research` route block |
| 10 | `src/App.tsx` | Remove `"zenith_research_pipeline"` localStorage clear from ErrorBoundary reset button |
| 11 | `src/components/Bubble.tsx` | Remove research window open button (microscope icon at lines 378-386) |
| 12 | `src/store.ts` | Remove `research` from `AiPrompts` interface (line 68) |
| 13 | `src/components/Settings.tsx` | Remove `Research Agents` tab (lines 160-161, entire tab content) |
| 14 | `src/components/Settings.tsx` | Remove `PipelineConfig`/`PipelineStepConfig` interfaces and `updatePipelineStep` function |
| 15 | `src/components/Settings.tsx` | Remove `RESEARCH_TOOLS` constant, `pipeline_config` field from ZenithSettings interface |
| 16 | `src/components/Settings.tsx` | Remove Tavily, Brave Search, Firecrawl API key sections |
| 17 | `src/components/Settings.tsx` | Remove Sci-Hub Mirrors section and all mirror-related state/functions |
| 18 | `src/components/Settings.tsx` | Remove research-specific AI prompts from `AiPrompts`: `research`, `research_pipeline`, `subject_review`, `educational`, `case_study`, `comparative`, `exploratory` |
| 19 | `src/components/ZenithEditor.tsx` | Remove imports from `./research/effects/` and `./research/shared/constants` — use `ReactBits.tsx` only |
| 20 | `src/components/ScriptWindow.tsx` | No changes needed (kept as-is) |
| 21 | Remove `research/`-specific effects CSS from `index.css` (if the effects CSS is duplicated there) |

### 1.4 Rust Backend Cleanup

| # | File | Change |
|---|------|--------|
| 22 | `src-tauri/src/lib.rs` | Remove `open_research_window` command function (~40 lines) |
| 23 | `src-tauri/src/lib.rs` | Remove `"open_research_window"` from `invoke_handler` macro |
| 24 | `src-tauri/src/settings.rs` | Remove `research`, `research_pipeline`, `subject_review`, `educational`, `case_study`, `comparative`, `exploratory` prompt fields and their defaults |
| 25 | `src-tauri/src/settings.rs` | Remove `PipelineConfig`/`PipelineStepConfig` structs and their defaults |
| 26 | `src-tauri/src/settings.rs` | Remove `tavily_api_key`, `brave_api_key`, `firecrawl_api_key`, `scihub_mirrors` from `ZenithSettings` |
| 27 | `src-tauri/src/api_server.rs` | Remove `open_research_window` emission if present |
| 28 | `src-tauri/capabilities/default.json` | Remove `"zenith_research"` from `windows` array |
| 29 | `scripts/` | Remove `gRAG_core.py`, `gRAG_index.py`, `gRAG_query.py`, `gRAG_visualizer.py` (now in separate app) |

### 1.5 Settings Tab Restructuring

After removal, the Settings sidebar becomes:
```
General → Appearance → Behavior → Processing → API Keys → AI Prompts → Token Usage → Shortcuts → Scripts
```
(9 tabs instead of 10, "Research Agents" removed)

---

## PHASE 2: FIX ALL WIRING GAPS & NON-FUNCTIONAL FEATURES

### 2.1 Behavior Settings — Make Functional

| # | Setting | Current State | Fix |
|---|---------|---------------|-----|
| 30 | `duplicate_detection` | Defined, never checked | In `stage_file()` Rust command and `stageFile()` store action: check if path already exists in staged items, reject with toast message |
| 31 | `max_staged_items` | Defined, never enforced | In `stage_file()` and `stageFile()`: before inserting, check `items.len() >= settings.behavior.max_staged_items`, reject with toast |
| 32 | `confirm_clear_all` | Defined, never checked | In `Bubble.tsx` clearAll button: if setting is true, show a confirmation dialog before calling `clearAll()` |
| 33 | `expand_on_hover` | Defined, ignored | In `Bubble.tsx` `expand()`/`scheduleCollapse()`: wrap expand trigger in `if (bh?.expand_on_hover !== false)` |
| 34 | `expand_on_drag` | Defined, ignored | In drag enter handler: only expand if `bh?.expand_on_drag !== false` |
| 35 | `check_for_updates` | Defined, no mechanism | Remove from settings UI or implement a GitHub release check via reqwest |
| 36 | Global shortcut `toggle_window` | Not registered | Register in `Bubble.tsx` useEffect alongside `stage_clipboard`: show/hide the main window |
| 37 | Global shortcut `clear_all` | Not registered | Register: call `clearAll()` |

### 2.2 Error Handling — Add Error Boundaries

| # | Location | Fix |
|---|----------|-----|
| 38 | `src/App.tsx` main route | Wrap `<Bubble />` + `<PreviewDrawer />` + `<ReviewStudio />` in `<ErrorBoundary>` |
| 39 | `src/App.tsx` editor route | Wrap `<ZenithEditor />` in `<ErrorBoundary>` |
| 40 | `src/App.tsx` settings route | Wrap `<Settings />` in `<ErrorBoundary>` |
| 41 | `src/App.tsx` script route | Wrap `<ScriptWindow />` in `<ErrorBoundary>` |

### 2.3 Token Usage — Unify Tracking

| # | Fix |
|---|-----|
| 42 | Remove `trackImageCost()` and `trackTextTokenUsage()` from `ZenithEditor.tsx` |
| 43 | Make `ZenithEditor` import and use `useZenithStore().trackTokenUsage` consistently |
| 44 | `store.ts` `trackTokenUsage`: already has image gen model support via `PRICING` — ensure it handles `output: 0` (image gen models) correctly |
| 45 | Add image generation cost tracking: extend `PRICING` in `store.ts` to include image gen model costs (unify with Settings.tsx's `IMAGE_GEN_MODEL_IDS` logic) |

### 2.4 CSS & Effects — Deduplicate

| # | Fix |
|---|-----|
| 46 | Delete duplicated effects CSS from components that reference `research/effects/` |
| 47 | Ensure `ZenithEditor.tsx` imports all effects from `./ReactBits.tsx` — remove `./research/effects/` imports |
| 48 | If any effects used ONLY by research (`AuroraBg`, `SquaresBg`, `FloatingParticles`, `GlareHover`, `StarBorder`, `ClickSpark`, `GradientText`, `GlowOrbs`), move them into `ReactBits.tsx` or a shared `effects.tsx` |

### 2.5 Dead Code Removal

| # | Item | Action |
|---|------|--------|
| 49 | `Carousel` component in `ReactBits.tsx` | Keep if ReviewStudio or other component will use it; otherwise remove |
| 50 | `useMagneticHover` in `Bubble.tsx` | Either wire it to an element or remove the destructuring |
| 51 | `react.svg` | Already deleting in Phase 1 |
| 52 | `renamed` badge color import duplication | Audit for duplicate import paths |

### 2.6 Rename Redo — Verify Wiring

| # | Check |
|---|-------|
| 53 | Verify `redo_last_rename` Rust command is properly called from the redo button in `Bubble.tsx` (line 355) — it IS wired via `invoke<string>("redo_last_rename")` ✓ |
| 54 | Verify `refreshRenameCounts` updates both undo and redo counts on rename action — check store.ts and Rust return values |

### 2.7 Preview Drawer Wiring

| # | Check |
|---|-------|
| 55 | `PreviewDrawer` uses `convertFileSrc` from `@tauri-apps/api/core` — verify this is the correct import path for Tauri v2 (may need `@tauri-apps/api` with `tauri://localhost` protocol) |
| 56 | Null check `pane.item.path` before `convertFileSrc` — already guarded ✓ |

---

## PHASE 3: API KEY SECURITY — IMPLEMENT ENCRYPTION AT REST

### 3.1 Strategy: OS-Native Keychain via Tauri Plugin

Two approaches available:

**Option A: `tauri-plugin-stronghold`** (recommended)
- Encrypted vault with `engines` (Argon2 key derivation + XChaCha20-Poly1305)
- Requires user to set a master password (or use a device-derived key)
- Cross-platform

**Option B: OS-Native Keychain**
- Windows: Windows Credential Manager via `security-credentials` crate or direct Win32 API
- macOS: Keychain via `security-framework` crate
- Linux: `secret-service` via `libsecret`

**Recommendation: Option A (Stronghold)** for cross-platform consistency and stronger encryption guarantees.

### 3.2 Implementation Steps

| # | Task |
|---|------|
| 57 | Add `tauri-plugin-stronghold` to `Cargo.toml` dependencies |
| 58 | Add `@tauri-apps/plugin-stronghold` to `package.json` |
| 59 | Register the plugin in `lib.rs` `.plugin(tauri_plugin_stronghold::Builder::new(...))` |
| 60 | Create `src-tauri/src/crypto.rs` module with: |
|     | - `encrypt_api_keys(keys: &[ApiKeyEntry], vault_key: &[u8]) -> Vec<u8>` |
|     | - `decrypt_api_keys(encrypted: &[u8], vault_key: &[u8]) -> Vec<ApiKeyEntry>` |
|     | - `derive_vault_key(password: &str, salt: &[u8]) -> [u8; 32]` (Argon2id) |
| 61 | Modify `settings.rs` `ZenithSettings`: |
|     | - Store `api_keys` as `encrypted_keys: Option<String>` (base64-encoded encrypted blob) |
|     | - Store `keychain_salt: Option<String>` |
|     | - Keep non-sensitive settings as plain JSON |
|     | - Mark all API key fields (`vt_api_key`, `omdb_api_key`, `audiodb_api_key`, `imdb_api_key`) as also encrypted |
|     | - Remove `api_keys` from plain serialization |
| 62 | On first launch / no vault exists: |
|     | - Prompt user to create a master password (Settings > Security tab) |
|     | - Generate random salt, derive vault key |
|     | - Create Stronghold vault, store salt in settings JSON |
| 63 | On subsequent launches: |
|     | - Prompt for master password on app startup (before any AI features are used) |
|     | - Or: cache the vault password in memory for the session (key held in Rust, never exposed to JS) |
| 64 | New Rust commands: |
|     | `unlock_vault(password: String) -> Result<bool, String>` — set vault key |
|     | `lock_vault() -> Result<(), String>` — clear vault key from memory |
|     | `get_api_keys() -> Result<Vec<ApiKeyEntry>, String>` — decrypt and return (only when unlocked) |
|     | `set_api_keys(keys: Vec<ApiKeyEntry>) -> Result<(), String>` — encrypt and store |
|     | `is_vault_unlocked() -> bool` |
|     | `has_vault() -> bool` |
|     | `create_vault(password: String) -> Result<(), String>` |
|     | `change_vault_password(old: String, new: String) -> Result<(), String>` |
| 65 | Frontend changes: |
|     | - New `src/components/LockScreen.tsx` — shown if vault is locked on startup |
|     | - Wrap Settings API Keys tab with vault unlock requirement |
|     | - When vault is locked, API-dependent features show "🔒 Vault locked — enter master password in Settings" |
|     | - `trackTokenUsage()` skips saving settings when vault is locked (token usage is non-sensitive) |

### 3.3 CSP (Content Security Policy)

| # | Task |
|---|------|
| 66 | Set a proper CSP in `tauri.conf.json` instead of `null`: |
|     | `"csp": "default-src 'self'; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com; img-src 'self' data: https: asset:; media-src 'self' asset:; connect-src 'self' https://generativelanguage.googleapis.com https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com https://api.deepseek.com https://api.groq.com https://www.virustotal.com; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net"` |
| 67 | Add `asset:` protocol for local file serving via Tauri's asset protocol |

---

## PHASE 4: POLISH & HARDENING

### 4.1 Python Runtime Detection

| # | Task |
|---|------|
| 68 | In `lib.rs`, add a startup check: `which python` or `python --version` — if not found, emit event `"python-missing"` so frontend can show a banner |
| 69 | Add `src/components/PythonMissingBanner.tsx` — shows when python is unavailable, with download link |

### 4.2 API Server Port Conflict

| # | Task |
|---|------|
| 70 | In `api_server.rs`: if port 7890 is unavailable, try 7891, 7892, 7893 — store the actual port in app state |
| 71 | Expose the actual port via `get_api_server_port` Tauri command so frontend can display it |

### 4.3 MIME Type Fix

| # | Task |
|---|------|
| 72 | Fix `lib.rs:117`: change `"image/x-icon"` to `"image/vnd.microsoft.icon"` |

### 4.4 Pricing Data — Single Source of Truth

| # | Task |
|---|------|
| 73 | Move all pricing data to `src/shared/pricing.ts` (new file) — import from both `store.ts` and `Settings.tsx` |
| 74 | Remove duplicated `PRICING` constant from `store.ts` (keep the import) |
| 75 | Remove duplicated `PROVIDER_MODELS` from `Settings.tsx` (keep the import) |
| 76 | Remove duplicated pricing from `ZenithEditor.tsx` PRICING import from research/shared — move to shared module |

### 4.5 Use Unused Features

| # | Task |
|---|------|
| 77 | Wire `useMagneticHover` to the collapsed Bubble pill or remove it |
| 78 | Use `Carousel` in ReviewStudio for poster previews, or remove it |

### 4.6 Settings Cleanup

| # | Task |
|---|------|
| 79 | Remove `check_for_updates` from General settings (no mechanism) — replace with "About" section showing version |
| 80 | Remove `launch_on_startup` from General (or implement via Windows registry key / macOS LaunchAgent) |
| 81 | Keep `show_tray_icon` + `plugins_directory` which are functional |

---

## PHASE 5: TESTING STRATEGY

| # | Task |
|---|------|
| 82 | Add `src/__tests__/` directory with Vitest |
| 83 | Unit tests for `utils.ts` (formatFileSize, getFileIcon, getExtensionColor) |
| 84 | Unit tests for `store.ts` state transitions |
| 85 | Component tests for `StagedItemCard.tsx` action routing |
| 86 | Integration tests for `lib.rs` Rust commands (can be done with `#[cfg(test)]` modules) |
| 87 | E2E tests: Tauri + Playwright for critical paths (stage file, process, clear) |

---

## FILE CHANGE SUMMARY

| Phase | Files Deleted | Files Modified | Files Created | Total |
|-------|---------------|----------------|---------------|-------|
| 1 (Strip) | ~20 | ~12 | 0 | ~32 |
| 2 (Fix Gaps) | 0 | ~10 | 0 | ~10 |
| 3 (Security) | 0 | ~8 | ~3 (crypto.rs, LockScreen.tsx, security tab) | ~11 |
| 4 (Polish) | 1 (pricing duplication) | ~8 | 2 (pricing.ts, PythonMissingBanner.tsx) | ~11 |
| 5 (Tests) | 0 | 2 (package.json, vite.config) | ~6 (test files) | ~8 |
| **Total** | **~21** | **~40** | **~11** | **~72 changes** |

---

## EXECUTION ORDER

```
Week 1: Phase 1 (Strip Research) → verify app still runs, no compile errors
Week 1: Phase 2 (Fix Gaps) — items 30-55 → all settings work, all wiring verified
Week 2: Phase 3 (API Key Security) — encrypted vault system
Week 2: Phase 4 (Polish) — deduplication, hardening
Week 3: Phase 5 (Tests) — coverage from 0.18% → target 40%+
```
