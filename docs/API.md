# Zenith API Reference (v4.0)

Zenith exposes a local HTTP API on `http://127.0.0.1:7890` that lets external scripts interact with every feature: stage files, run processing actions, manage settings, and control the Script Window. The API starts automatically when Zenith launches.

## Authentication

No authentication required — the API binds to `127.0.0.1` only.

---

## Staging Endpoints

### `GET /health`

```json
{ "status": "ok", "app": "zenith", "version": "4.0" }
```

### `GET /items`

List all staged items (files, text, URLs).

### `POST /stage/file`

Stage a file by absolute path.

**Request:** `{ "path": "C:\\Users\\you\\file.pdf" }`

**Response:** Full `StagedItem` JSON object.

### `POST /stage/text`

Stage a text snippet or URL.

**Request:** `{ "text": "https://example.com" }`

### `DELETE /items`

Clear all staged items.

**Response:** `{ "status": "cleared" }`

### `DELETE /items/:id`

Remove a single staged item by ID.

**Response:** `{ "status": "removed" }`

**Error (404):** `{ "error": "Item not found" }`

### `POST /items/:id/self-destruct`

Set a self-destruct timer on a staged item.

**Request:** `{ "destruct_at": 1711000000000 }` (Unix ms timestamp, or `null` to cancel)

**Response:** `{ "status": "ok" }`

---

## Processing Endpoint

### `POST /process`

Run any of the 26 Python processing actions. This is the main power endpoint — it invokes `process_files.py` with the specified action and arguments.

**Request:**

```json
{
  "action": "compress_image",
  "args": {
    "path": "C:\\Users\\you\\photo.jpg",
    "quality": 80
  }
}
```

**Response:** The JSON output from the Python action (varies per action).

#### Available Actions

| Action | Args | Description |
|--------|------|-------------|
| `compress_image` | `path`, `quality?` | Compress image (JPEG/PNG/WebP) |
| `resize_image` | `path`, `width?`, `height?`, `percentage?` | Resize image |
| `strip_exif` | `path` | Remove EXIF metadata |
| `convert_webp` | `path`, `quality?` | Convert image to WebP |
| `extract_palette` | `path`, `num_colors?` | Extract dominant colors with WCAG check |
| `file_to_base64` | `path`, `format?` | Encode file as Base64 (raw/html_img/css_url) |
| `ocr` | `path`, `api_key?`, `provider?`, `model?` | OCR text extraction (LLM vision or Tesseract) |
| `ocr_to_pdf` | `path` | Convert image to searchable PDF |
| `compress_pdf` | `path` | Compress PDF |
| `merge_pdf` | `paths`, `name?` | Merge multiple PDFs |
| `pdf_to_csv` | `path` or `paths`, `api_key`, `provider`, `model` | LLM-powered PDF to CSV extraction |
| `zip_file` | `path` | Zip a single file/folder |
| `zip_files` | `paths`, `name?` | Bundle multiple files into zip |
| `zip_encrypt` | `path` or `paths`, `password` | AES-256 encrypted zip |
| `split_file` | `path`, `chunk_size_mb?` | Split file into chunks |
| `email_files` | `paths`, `to?`, `subject?` | Open mail client with attachments |
| `smart_rename` | `path`, `api_key`, `provider`, `model` | AI-suggested filename |
| `smart_sort` | `paths`, `api_key`, `provider`, `model` | AI file categorization |
| `auto_organize` | `paths`, `api_key`, `provider`, `model` | AI file organization with move plan |
| `translate_file` | `path`, `target_language`, `api_key`, `provider`, `model` | Translate document |
| `ask_data` | `path`, `question`, `api_key`, `provider`, `model` | RAG Q&A on document |
| `summarize_file` | `path`, `api_key`, `provider`, `model` | Summarize document |
| `super_summary` | `paths`, `api_key`, `provider`, `model` | Multi-doc executive summary |
| `generate_dashboard` | `path`, `api_key`, `provider`, `model` | CSV to interactive HTML dashboard |
| `scan_virustotal` | `path` or `url`, `vt_api_key` | VirusTotal security scan |
| `url_to_qr` | `url` | Generate QR code PNG from URL |
| `convert_media` | `path`, `output_format?` | FFmpeg media conversion (.mov→.mp4 etc.) |

All AI actions accept optional `system_prompt` to override the default prompt.

---

## Settings Endpoints

### `GET /settings`

Get the full Zenith settings object (API keys, prompts, appearance, behavior, etc.).

### `PUT /settings`

Save updated settings. Send the full `ZenithSettings` JSON object.

**Response:** `{ "status": "saved" }`

---

## Browse Endpoints

### `GET /browse/:item_id`

Browse contents of a staged directory by item ID.

### `POST /browse`

Browse any directory by absolute path.

**Request:** `{ "path": "C:\\Users\\you\\Documents" }`

---

## Script Window Endpoints

### `POST /window/open`

Open the script window with UI components.

```json
{
  "title": "My Script",
  "components": [
    { "type": "label", "text": "Hello World", "style": "heading" },
    { "type": "button", "id": "btn1", "label": "Click Me", "variant": "primary" }
  ],
  "width": 400,
  "height": 480,
  "pinned": true,
  "collapse_delay": 8000
}
```

### `POST /window/update`

Update the window content without re-opening. Same schema as `/window/open`.

### `DELETE /window`

Close the script window.

### `GET /window/content`

Read current window content (or `null`).

### `POST /window/event`

Push an event: `{ "type": "click", "id": "btn1" }`

### `GET /window/events`

Poll and drain the event queue.

---

## UI Component Types

| Type | Key Fields | Description |
|------|-----------|-------------|
| `label` | `text`, `style` | Static text (heading/muted/success/error/warning) |
| `text` | `text` | Multi-line preformatted text |
| `button` | `id`, `label`, `variant`, `disabled`, `loading` | Clickable button |
| `button_group` | `children` | Horizontal button row |
| `input` | `id`, `label`, `placeholder`, `value`, `password` | Text input field |
| `multiline` | `id`, `label`, `value`, `rows`, `readonly` | Textarea |
| `select` | `id`, `label`, `value`, `options` | Dropdown select |
| `toggle` | `id`, `label`, `value` | On/off switch |
| `slider` | `id`, `label`, `min`, `max`, `step`, `value` | Range slider |
| `progress` | `label`, `value` | Progress bar (0-100) |
| `stat` | `label`, `value` | Large stat display |
| `divider` | — | Horizontal rule |
| `spacer` | `height` | Vertical space (default 8px) |
| `grid` | `columns`, `children` | Grid layout |
| `card` | `title`, `children` | Card container |

---

## Python Client

```python
from zenith_api import ZenithAPI

api = ZenithAPI()
api.health()
api.stage_file(r"C:\Users\you\report.pdf")
api.stage_text("Meeting notes: ...")
items = api.list_items()
api.clear_all()
```

CLI: `python scripts/zenith_api.py health|list|stage-file|stage-text|clear`

---

## cURL Examples

```bash
# Health check
curl http://127.0.0.1:7890/health

# Stage a file
curl -X POST http://127.0.0.1:7890/stage/file \
  -H "Content-Type: application/json" \
  -d "{\"path\": \"C:\\\\Users\\\\you\\\\file.txt\"}"

# Run a processing action
curl -X POST http://127.0.0.1:7890/process \
  -H "Content-Type: application/json" \
  -d "{\"action\": \"compress_image\", \"args\": {\"path\": \"C:\\\\photo.jpg\"}}"

# Get settings
curl http://127.0.0.1:7890/settings

# Remove a single item
curl -X DELETE http://127.0.0.1:7890/items/1710891234567_myfile.txt

# Set self-destruct (1 hour from now)
curl -X POST http://127.0.0.1:7890/items/1710891234567_myfile.txt/self-destruct \
  -H "Content-Type: application/json" \
  -d "{\"destruct_at\": 1711000000000}"

# Clear all
curl -X DELETE http://127.0.0.1:7890/items
```

---

## Error Handling

| Status | Meaning |
|--------|---------|
| `200 OK` | Success |
| `204 No Content` | CORS preflight (OPTIONS) |
| `400 Bad Request` | Malformed JSON body |
| `404 Not Found` | Item/file not found or unknown endpoint |
| `500 Internal Server Error` | Server-side failure |

## CORS

Permissive CORS headers included. Callable from browser tools on localhost.

## Port

Default: **7890** (localhost only, not configurable).
