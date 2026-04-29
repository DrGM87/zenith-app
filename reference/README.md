# Zenith Reference Library

Cloned open-source projects for architecture and feature reference.

## Index

| # | Repo | Stars | Tech Stack | Key Reference For |
|---|------|-------|------------|-------------------|
| 1 | [EcoPaste](clipboard/EcoPaste) | 7k | Tauri + Rust + React | Clipboard manager — identical stack to Zenith |
| 2 | [PasteBar](clipboard/PasteBar) | 2k | Tauri + React + Rust | Taskbar-based clipboard manager patterns |
| 3 | [Cap](screen-capture/Cap) | 18.4k | Tauri + Rust + SolidJS | Screen capture pipeline + recording |
| 4 | [image-optimizer](image-processing/image-optimizer) | 62 | Tauri + Rust + React | Batch image compression UI |
| 5 | [oxipng](image-processing/oxipng) | 3.9k | Rust | High-performance PNG optimization |
| 6 | [Stirling-PDF](pdf-tools/Stirling-PDF) | 78k | TypeScript + Java | PDF toolkit feature set + UI patterns |
| 7 | [Picocrypt](encryption/Picocrypt) | 2.5k | Go | Clean encryption UX + crypto patterns |
| 8 | [iris](file-organization/iris) | 235 | Rust | Rules-based file organization engine |
| 9 | [ConvertX](conversion/ConvertX) | 16.7k | TypeScript + Bun | File conversion format matrix |
| 10 | [PicView](image-viewer/PicView) | 3.2k | C# + Avalonia | Image viewer + batch processing UX |

---

## Feature → Repository Mapping

### Screen Capture
→ **Cap** (`screen-capture/Cap`): `src-tauri/` for Rust capture backend, `apps/desktop/src/` for UI patterns

### Clipboard History
→ **EcoPaste** (`clipboard/EcoPaste`): `src/` for React store/hooks, `src-tauri/` for clipboard polling
→ **PasteBar** (`clipboard/PasteBar`): `packages/` for monorepo structure, `src-tauri/` for Tauri IPC

### Batch Processing Queue
→ **image-optimizer** (`image-processing/image-optimizer`): `src/` for batch UI components, `src-tauri/` for parallel processing

### PDF Toolkit
→ **Stirling-PDF** (`pdf-tools/Stirling-PDF`): `src/main/resources/static/` for web UI, `src/main/java/` for PDF operations

### Image Optimization
→ **oxipng** (`image-processing/oxipng`): `src/` for Rust optimization algorithms, perf profiling

### Encryption
→ **Picocrypt** (`encryption/Picocrypt`): `src/` for crypto primitives, `GUI/` for clean UI layout

### File Organization (Rules)
→ **iris** (`file-organization/iris`): `src/` for config-driven rules engine, YAML schema

### Format Conversion
→ **ConvertX** (`conversion/ConvertX`): `packages/` for format matrix, conversion pipeline

### Image Preview
→ **PicView** (`image-viewer/PicView`): `PicView/` for image rendering, EXIF display, gallery UI

---

## Architecture Patterns Worth Studying

### Tauri Multi-Window (from EcoPaste + PasteBar + Cap)
- How they manage multiple webview windows
- Tray icon integration patterns
- Global shortcut registration
- State management across windows

### React Store Patterns (from EcoPaste + image-optimizer)
- Zustand store structure
- IPC call patterns to Rust backend
- Settings persistence
- Dark/light theme switching

### Rust Backend Patterns (from Cap + oxipng + iris)
- File system operations (walk, watch, process)
- Native system API integration
- Image processing pipeline
- Performance benchmarking

---

## Quick Navigation per Feature

### If implementing SCREEN CAPTURE (#11)
```
1. Look at Cap/src-tauri/ for the Rust capture backend
2. Look at Cap/apps/desktop/ for the React UI overlay
3. Look at Cap for Tauri IPC between capture backend and renderer
```

### If implementing CLIPBOARD HISTORY (#12)
```
1. Look at EcoPaste/src/stores/ for clipboard state management
2. Look at PasteBar/src-tauri/ for Tauri clipboard polling
3. Look at EcoPaste for search/filter UI patterns
```

### If implementing BATCH OPERATIONS (#1)
```
1. Look at image-optimizer/src/ for batch queue UI
2. Look at PicView for batch processing UX patterns
3. Wrap existing process_file() calls in a sequential queue with progress
```

### If implementing PDF TOOLKIT (#5)
```
1. Look at Stirling-PDF for feature completeness reference
2. Extend existing process_files.py PDF operations
3. Use PyMuPDF for native PDF manipulation
```

### If implementing ENCRYPTION (#18)
```
1. Look at Picocrypt/src/ for Go crypto patterns
2. Translate to Rust: use aes-gcm + argon2 crates
3. Look at Picocrypt/GUI/ for clean encryption UX
```

### If implementing RULES-BASED ORGANIZE (#2)
```
1. Look at iris/src/ for YAML-configured rules engine
2. Extend existing auto-organize with rule matching
3. Store rules in existing settings.json
```

### If implementing CONVERSION PRESETS (#23)
```
1. Look at ConvertX for supported format matrix
2. Look at image-optimizer for preset management UI
3. Extend existing convert actions with named profiles
```
