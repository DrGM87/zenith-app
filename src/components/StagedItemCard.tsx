import { motion, AnimatePresence } from "framer-motion";
import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useZenithStore, type StagedItem, type RenameState } from "../store";
import { formatFileSize, getFileIcon, getExtensionColor } from "../utils";
import { FolderTree } from "./FolderTree";
import { SpotlightCard, ShinyBar, ShinyText, Carousel } from "./ReactBits";

function formatTimeLeft(ms: number): string {
  if (ms <= 0) return "Expired";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

interface Props {
  item: StagedItem;
  index: number;
}

/* ── MIME-based action definitions ── */
interface ItemAction {
  icon: string;
  label: string;
  action: string;
  color?: string;
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff"]);
const PDF_EXTS = new Set(["pdf"]);
const TEXT_EXTS = new Set(["txt", "md", "log", "csv", "json", "xml", "html", "py", "js", "ts", "tsx", "rs", "css"]);
const DATA_EXTS = new Set(["csv", "tsv"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "flac", "aac", "ogg", "wma", "m4a", "opus"]);
const VIDEO_EXTS = new Set(["mov", "avi", "mkv", "wmv", "flv", "webm", "m4v", "mp4"]);
// SCANNABLE_EXTS removed — VirusTotal scan is now universal for all files/folders
const URL_REGEX = /^https?:\/\/[^\s]+$/i;

const LANGUAGES = [
  "Spanish", "French", "German", "Italian", "Portuguese", "Chinese", "Japanese",
  "Korean", "Arabic", "Russian", "Hindi", "Turkish", "Dutch", "Swedish", "Polish",
];

function getActionsForItem(item: StagedItem): ItemAction[] {
  const ext = item.extension.toLowerCase();
  const actions: ItemAction[] = [];
  const hasPath = item.path.length > 0;

  const isUrl = !hasPath && URL_REGEX.test(item.name.trim());

  // ── URL-specific ──
  if (isUrl) {
    actions.push({ icon: "fa-solid fa-qrcode", label: "QR Code", action: "url_to_qr", color: "#8b5cf6" });
    actions.push({ icon: "fa-solid fa-shield-halved", label: "Scan URL", action: "scan_virustotal_url", color: "#22d3ee" });
  }

  // ── Image-specific ──
  if (IMAGE_EXTS.has(ext)) {
    actions.push({ icon: "fa-solid fa-arrow-right-arrow-left", label: "Convert", action: "convert_image", color: "#8b5cf6" });
    actions.push({ icon: "fa-solid fa-tags", label: "EXIF", action: "exif_panel", color: "#f59e0b" });
    actions.push({ icon: "fa-solid fa-palette", label: "Palette", action: "extract_palette", color: "#ec4899" });
    actions.push({ icon: "fa-solid fa-expand", label: "Resize", action: "resize_image", color: "#06b6d4" });
    actions.push({ icon: "fa-solid fa-code", label: "Base64", action: "file_to_base64", color: "#6366f1" });
    actions.push({ icon: "fa-solid fa-font", label: "OCR", action: "ocr_save_text", color: "#14b8a6" });
  }

  // ── PDF-specific ──
  if (PDF_EXTS.has(ext)) {
    actions.push({ icon: "fa-solid fa-file-pdf", label: "Compress PDF", action: "compress_pdf", color: "#ef4444" });
    actions.push({ icon: "fa-solid fa-table", label: "PDF → CSV", action: "pdf_to_csv", color: "#f97316" });
  }

  // ── Document intelligence (PDF + text) ──
  if (hasPath && (PDF_EXTS.has(ext) || TEXT_EXTS.has(ext))) {
    actions.push({ icon: "fa-solid fa-comments", label: "Ask Data", action: "ask_data", color: "#06b6d4" });
    actions.push({ icon: "fa-solid fa-book-open", label: "Summarize", action: "summarize_file", color: "#8b5cf6" });
    actions.push({ icon: "fa-solid fa-language", label: "Translate", action: "translate_file", color: "#10b981" });
  }

  // ── Data files (CSV/TSV) ──
  if (hasPath && DATA_EXTS.has(ext)) {
    actions.push({ icon: "fa-solid fa-chart-column", label: "Dashboard", action: "generate_dashboard", color: "#f59e0b" });
  }

  // ── Audio recognition + conversion (Shazam) ──
  if (hasPath && AUDIO_EXTS.has(ext)) {
    actions.push({ icon: "fa-solid fa-music", label: "Recognize", action: "recognize_audio", color: "#10b981" });
    actions.push({ icon: "fa-solid fa-headphones", label: "Convert Audio", action: "convert_audio", color: "#a855f7" });
  }

  // ── Video conversion (FFmpeg) ──
  if (hasPath && VIDEO_EXTS.has(ext)) {
    actions.push({ icon: "fa-solid fa-film", label: "Convert Video", action: "convert_media", color: "#a855f7" });
  }

  // ── Security scan (ALL files and folders) ──
  if (hasPath) {
    actions.push({ icon: "fa-solid fa-shield-halved", label: "Scan", action: "scan_virustotal_file", color: "#22d3ee" });
  }

  // ── Universal file actions ──
  if (hasPath) {
    if (AUDIO_EXTS.has(ext)) {
      // Audio: Play + Reveal
      actions.push({ icon: "fa-solid fa-play", label: "Play", action: "open_file", color: "#34d399" });
      actions.push({ icon: "fa-solid fa-folder-open", label: "Reveal", action: "reveal_in_folder", color: "#60a5fa" });
    } else if (IMAGE_EXTS.has(ext)) {
      // Images: Reveal + Open in Editor (2 buttons per spec)
      actions.push({ icon: "fa-solid fa-folder-open", label: "Reveal", action: "reveal_in_folder", color: "#60a5fa" });
      actions.push({ icon: "fa-solid fa-paintbrush", label: "Editor", action: "open_editor", color: "#f472b6" });
    } else {
      actions.push({ icon: "fa-solid fa-up-right-from-square", label: "Open", action: "open_file", color: "#34d399" });
      actions.push({ icon: "fa-solid fa-folder-open", label: "Reveal", action: "reveal_in_folder", color: "#60a5fa" });
    }
    // Unified Archive button (zip format + encrypt + level + split all in one panel)
    actions.push({ icon: "fa-solid fa-file-zipper", label: "Archive", action: "archive_file", color: "#eab308" });
    actions.push({ icon: "fa-solid fa-envelope", label: "Email", action: "email_files", color: "#a78bfa" });
    // AI Rename
    if (AUDIO_EXTS.has(ext)) {
      actions.push({ icon: "fa-solid fa-wand-magic-sparkles", label: "AI Rename", action: "smart_rename_audio_ask", color: "#c084fc" });
    } else {
      actions.push({ icon: "fa-solid fa-wand-magic-sparkles", label: "AI Rename", action: "smart_rename", color: "#c084fc" });
    }
  }
  // ── Preview (not for audio or images — images use Editor) ──
  if (!AUDIO_EXTS.has(ext) && !IMAGE_EXTS.has(ext)) {
    actions.push({ icon: "fa-solid fa-eye", label: "Preview", action: "preview_file", color: "#38bdf8" });
  }
  actions.push({ icon: "fa-regular fa-copy", label: hasPath ? "Copy Path" : "Copy Text", action: "copy_path", color: "#64748b" });

  return actions;
}

export function StagedItemCard({ item, index }: Props) {
  const { removeItem, startDragOut, stageFile, toggleSelect, selectedIds, settings, trackTokenUsage, openPreview, setRenameState, cycleRenameSuggestion, renameStates, refreshRenameCounts, audioResults, setAudioResult, pushAudioUndo, tags, setItemTag, removeItemTag } = useZenithStore();
  const renameState = renameStates[item.id] as RenameState | undefined;
  const audioResult = audioResults[item.id] ?? null;
  const isSelected = selectedIds.has(item.id);
  const [isHovered, setIsHovered] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showTimer, setShowTimer] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [showEmailPrompt, setShowEmailPrompt] = useState(false);
  const [showCompressOpts, setShowCompressOpts] = useState(false);
  const [showResizeOpts, setShowResizeOpts] = useState(false);
  const [showSplitOpts, setShowSplitOpts] = useState(false);
  const [folderExpanded, setFolderExpanded] = useState(false);
  const [password, setPassword] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [compressQuality, setCompressQuality] = useState(settings?.processing?.image_quality ?? 80);
  const [resizeWidth, setResizeWidth] = useState("");
  const [resizeHeight, setResizeHeight] = useState("");
  const [resizePct, setResizePct] = useState(String(settings?.processing?.default_resize_percentage ?? 50));
  const [splitChunkMb, setSplitChunkMb] = useState(String(settings?.processing?.split_chunk_size_mb ?? 25));
  const [showTranslateOpts, setShowTranslateOpts] = useState(false);
  const [translateLang, setTranslateLang] = useState("Spanish");
  const [showAskPanel, setShowAskPanel] = useState(false);
  const [askQuestion, setAskQuestion] = useState("");
  const [showPaletteResult, setShowPaletteResult] = useState<null | Array<{hex: string; rgb: number[]; wcag_on_white: boolean; wcag_on_black: boolean}>>(null);
  const [showBase64Menu, setShowBase64Menu] = useState(false);
  const [showConvertMenu, setShowConvertMenu] = useState(false);
  const [showImageConvertMenu, setShowImageConvertMenu] = useState(false);
  const [imageConvertQuality, setImageConvertQuality] = useState(85);
  const [showExifData, setShowExifData] = useState<Record<string, unknown> | null>(null);
  const [showExifPanel, setShowExifPanel] = useState(false);
  const [showArchivePanel, setShowArchivePanel] = useState(false);
  const [archiveFormat, setArchiveFormat] = useState("zip");
  const [archivePassword, setArchivePassword] = useState("");
  const [archiveSplitMb, setArchiveSplitMb] = useState("");
  const [archiveLevel, setArchiveLevel] = useState(6);
  const [paletteMode, setPaletteMode] = useState<"swatches" | "dropper">("swatches");
  const [paletteSelected, setPaletteSelected] = useState<Set<number>>(new Set());
  const [dropperColor, setDropperColor] = useState<string | null>(null);
  const [dropperCanvasRef] = useState(() => ({ current: null as HTMLCanvasElement | null }));
  const [resizeFillColor, setResizeFillColor] = useState("#ffffff");
  const [emailBody, setEmailBody] = useState("");
  const [emailDraftLoading, setEmailDraftLoading] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [showAudioConvertMenu, setShowAudioConvertMenu] = useState(false);
  const TAG_COLORS = [
    { name: "red", hex: "#ef4444" }, { name: "orange", hex: "#f97316" }, { name: "amber", hex: "#f59e0b" },
    { name: "green", hex: "#10b981" }, { name: "cyan", hex: "#06b6d4" }, { name: "blue", hex: "#3b82f6" },
    { name: "violet", hex: "#8b5cf6" }, { name: "pink", hex: "#ec4899" },
  ];
  const itemTag = tags[item.id];
  const [audioBitrate, setAudioBitrate] = useState("192");
  const [showAudioTypeAsk, setShowAudioTypeAsk] = useState(false);
  const [recognitionData, setRecognitionData] = useState<Record<string, string> | null>(null);
  const [actionResult, setActionResult] = useState<{ label: string; text: string; action: string } | null>(null);
  const [scanBadge, setScanBadge] = useState<"safe" | "malicious" | "unknown" | null>(null);
  const [vtReport, setVtReport] = useState<Record<string, unknown> | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<string | null>(null);

  const hasDragPath = item.path.length > 0;
  const actions = getActionsForItem(item);
  const extColor = getExtensionColor(item.extension);
  const hasTimer = item.self_destruct_at !== null && item.self_destruct_at > 0;

  const showToastMsg = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  // Countdown timer effect
  useEffect(() => {
    if (!hasTimer) { setTimeLeft(null); return; }
    const tick = () => {
      const remaining = (item.self_destruct_at ?? 0) - Date.now();
      setTimeLeft(remaining > 0 ? formatTimeLeft(remaining) : "Expired");
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [item.self_destruct_at, hasTimer]);

  const setTimer = useCallback(async (minutes: number | null) => {
    const destructAt = minutes ? Date.now() + minutes * 60 * 1000 : null;
    await invoke("set_self_destruct", { id: item.id, destructAt });
    useZenithStore.setState((s) => ({
      items: s.items.map((i) => i.id === item.id ? { ...i, self_destruct_at: destructAt } : i),
    }));
    setShowTimer(false);
    showToastMsg(minutes ? `Self-destruct in ${minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`}` : "Timer cleared");
  }, [item.id, showToastMsg]);

  const handleDragOut = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (hasDragPath) startDragOut(item.path);
  };

  const getDefaultApiKey = useCallback(() => {
    const keys = settings?.api_keys ?? [];
    const def = keys.find((k) => k.is_default) || keys[0];
    return def ? { api_key: def.key, provider: def.provider, model: def.model } : {};
  }, [settings?.api_keys]);

  const handleAction = useCallback(async (action: string) => {
    // ── Client-side actions ──
    if (action === "preview_file") {
      openPreview(item);
      return;
    }
    if (action === "copy_path") {
      await navigator.clipboard.writeText(item.path || item.name);
      showToastMsg("Copied!");
      return;
    }
    if (action === "open_file") {
      await invoke("open_file", { path: item.path }).catch((e: unknown) => showToastMsg(String(e)));
      return;
    }
    if (action === "reveal_in_folder") {
      await invoke("reveal_in_folder", { path: item.path }).catch((e: unknown) => showToastMsg(String(e)));
      return;
    }
    // ── Actions that open inline panels ──
    if (action === "zip_encrypt") { setShowPasswordPrompt(true); return; }
    if (action === "exif_panel") { setShowExifPanel(true); return; }
    if (action === "email_files") {
      // Auto-draft subject/body via LLM, then show panel
      setShowEmailPrompt(true);
      setEmailSubject(`Sending: ${item.name}`);
      setEmailBody(`Hi,\n\nPlease find attached: ${item.name}\n\nBest regards`);
      const apiCreds = getDefaultApiKey();
      if (apiCreds.api_key) {
        setEmailDraftLoading(true);
        invoke<string>("process_file", {
          action: "email_draft",
          argsJson: JSON.stringify({ path: item.path, ...apiCreds }),
        }).then((r) => {
          const res = JSON.parse(r);
          if (res.ok && res.subject) { setEmailSubject(res.subject); setEmailBody(res.body || emailBody); }
        }).catch(() => {}).finally(() => setEmailDraftLoading(false));
      }
      return;
    }
    if (action === "compress_image") { setShowCompressOpts(true); return; }
    if (action === "resize_image") { setShowResizeOpts(true); return; }
    if (action === "split_file") { setShowSplitOpts(true); return; }
    if (action === "translate_file") { setShowTranslateOpts(true); return; }
    if (action === "ask_data") { setShowAskPanel(true); return; }
    if (action === "file_to_base64") { setShowBase64Menu(true); return; }
    if (action === "convert_media") { setShowConvertMenu(true); return; }
    if (action === "convert_audio") { setShowAudioConvertMenu(true); return; }
    if (action === "smart_rename_audio_ask") { setShowAudioTypeAsk(true); return; }
    if (action === "convert_image") { setShowImageConvertMenu(true); return; }
    if (action === "archive_file") { setShowArchivePanel(true); return; }
    // Open in Zenith Editor — emit event to open editor window with this image
    if (action === "open_editor") {
      invoke("open_editor_window", { imagePath: item.path }).catch((e: unknown) => showToastMsg(String(e)));
      return;
    }
    // Show EXIF data inline
    if (action === "show_exif") {
      setProcessing(action);
      try {
        const argsJson = JSON.stringify({ path: item.path });
        const r = JSON.parse(await invoke<string>("process_file", { action: "show_exif", argsJson }));
        if (r.ok) {
          setShowExifData(r);
          if (r.has_exif) showToastMsg(`EXIF: ${Object.keys(r.exif || {}).length} tags`);
          else showToastMsg("No EXIF data found");
        } else showToastMsg(r.error || "Failed");
      } catch (e) { showToastMsg(String(e)); }
      finally { setProcessing(null); }
      return;
    }

    // ── v4: VirusTotal scan (file) ──
    if (action === "scan_virustotal_file") {
      const vtKey = settings?.vt_api_key;
      if (!vtKey) { showToastMsg("Set VirusTotal API key in Settings"); return; }
      setProcessing(action);
      try {
        const argsJson = JSON.stringify({ path: item.path, vt_api_key: vtKey });
        const r = JSON.parse(await invoke<string>("process_file", { action: "scan_virustotal", argsJson }));
        if (r.ok && r.verdict) {
          setScanBadge(r.verdict === "malicious" ? "malicious" : r.verdict === "safe" ? "safe" : "unknown");
          setVtReport(r);
          if (r.verdict === "safe") showToastMsg(`Safe (${r.total} engines)`);
          else if (r.verdict === "malicious") showToastMsg(`Malicious! ${r.malicious}/${r.total} detections`);
          else showToastMsg(r.message || "Not in VT database");
        } else showToastMsg(r.error || "Scan failed");
      } catch (e) { showToastMsg(String(e)); }
      finally { setProcessing(null); }
      return;
    }

    // ── v4: VirusTotal scan (URL) ──
    if (action === "scan_virustotal_url") {
      const vtKey = settings?.vt_api_key;
      if (!vtKey) { showToastMsg("Set VirusTotal API key in Settings"); return; }
      setProcessing(action);
      try {
        const argsJson = JSON.stringify({ url: item.name.trim(), vt_api_key: vtKey });
        const r = JSON.parse(await invoke<string>("process_file", { action: "scan_virustotal", argsJson }));
        if (r.ok && r.verdict) {
          if (r.verdict !== "submitted") {
            setScanBadge(r.verdict === "malicious" ? "malicious" : r.verdict === "safe" ? "safe" : "unknown");
            setVtReport(r);
          }
          if (r.verdict === "safe") showToastMsg(`Safe (${r.total} engines)`);
          else if (r.verdict === "malicious") showToastMsg(`Malicious! ${r.malicious}/${r.total} detections`);
          else if (r.verdict === "submitted") showToastMsg(r.message || "Submitted for analysis");
          else showToastMsg(r.message || "Unknown");
        } else showToastMsg(r.error || "Scan failed");
      } catch (e) { showToastMsg(String(e)); }
      finally { setProcessing(null); }
      return;
    }

    // ── v4: URL to QR Code ──
    if (action === "url_to_qr") {
      setProcessing(action);
      try {
        const argsJson = JSON.stringify({ url: item.name.trim() });
        const r = JSON.parse(await invoke<string>("process_file", { action: "url_to_qr", argsJson }));
        if (r.ok && r.path) { await stageFile(r.path); showToastMsg("QR code generated"); }
        else showToastMsg(r.error || "Failed");
      } catch (e) { showToastMsg(String(e)); }
      finally { setProcessing(null); }
      return;
    }

    // ── Python processing actions ──
    setProcessing(action);
    try {
      const extraArgs: Record<string, unknown> = {};
      const prompts = settings?.ai_prompts;
      if (action === "convert_webp") extraArgs.quality = settings?.processing?.webp_quality ?? 85;
      if (action === "ocr") { Object.assign(extraArgs, getDefaultApiKey()); extraArgs.system_prompt = prompts?.ocr; }
      if (action === "smart_rename") {
        // New 3-suggestion flow: set loading state, call Python, store suggestions
        setRenameState(item.id, { itemId: item.id, path: item.path, originalName: item.name, originalStem: item.name.replace(/\.[^.]+$/, ""), extension: item.extension ? `.${item.extension}` : "", suggestions: [], activeIndex: 0, loading: true });
        try {
          const argsJson = JSON.stringify({ path: item.path, ...getDefaultApiKey(), system_prompt: prompts?.smart_rename });
          const resultStr = await invoke<string>("process_file", { action: "smart_rename", argsJson });
          const result = JSON.parse(resultStr);
          if (result.token_usage) trackTokenUsage(result.token_usage.provider, result.token_usage.model, result.token_usage.input_tokens, result.token_usage.output_tokens);
          if (result.ok && result.suggestions && result.suggestions.length > 0) {
            setRenameState(item.id, { itemId: item.id, path: item.path, originalName: result.original_name, originalStem: result.original_stem, extension: result.extension, suggestions: result.suggestions, activeIndex: 0, loading: false });
          } else {
            setRenameState(item.id, null);
            showToastMsg(result.error || "No suggestions returned");
          }
        } catch (e) {
          setRenameState(item.id, null);
          showToastMsg(String(e));
        } finally { setProcessing(null); }
        return;
      }
      if (action === "summarize_file") { Object.assign(extraArgs, getDefaultApiKey()); extraArgs.system_prompt = prompts?.summarize; }
      if (action === "generate_dashboard") { Object.assign(extraArgs, getDefaultApiKey()); extraArgs.system_prompt = prompts?.dashboard; }
      if (action === "ocr_to_pdf") { /* local only, no API key */ }
      if (action === "pdf_to_csv") { Object.assign(extraArgs, getDefaultApiKey()); }
      if (action === "extract_palette") { /* no API key needed */ }
      if (action === "recognize_audio") { extraArgs.audiodb_key = settings?.audiodb_api_key || "2"; }
      if (action === "ocr_save_text") { Object.assign(extraArgs, getDefaultApiKey()); extraArgs.system_prompt = settings?.ai_prompts?.ocr; }

      const argsJson = JSON.stringify({ path: item.path, ...extraArgs });
      const resultStr = await invoke<string>("process_file", { action, argsJson });
      const result = JSON.parse(resultStr);

      if (result.token_usage) {
        const tu = result.token_usage;
        trackTokenUsage(tu.provider, tu.model, tu.input_tokens, tu.output_tokens);
      }

      if (result.ok && result.colors) {
        setShowPaletteResult(result.colors);
        showToastMsg(`${result.colors.length} colors extracted`);
      } else if (result.ok && result.verdict) {
        if (result.verdict === "safe") showToastMsg(`Safe (${result.total} engines)`);
        else if (result.verdict === "malicious") showToastMsg(`Malicious! ${result.malicious}/${result.total}`);
        else showToastMsg(result.message || result.verdict);
      } else if (result.ok && result.path) {
        await stageFile(result.path);
        if (result.savings_pct !== undefined) showToastMsg(`Saved ${result.savings_pct}%`);
        else if (result.suggested_name) showToastMsg(`Suggested: ${result.suggested_name}`);
        else if (result.text) {
          setActionResult({ label: "OCR Result", text: result.text, action });
          showToastMsg(`OCR: ${result.text.substring(0, 40)}...`);
        }
        else if (result.summary) {
          setActionResult({ label: "Summary", text: result.summary, action });
          showToastMsg(`Summary ready`);
        }
        else if (result.answer) {
          setActionResult({ label: "Answer", text: result.answer, action });
          showToastMsg(`Answer ready`);
        }
        else if (result.words) showToastMsg(`OCR PDF: ${result.words} words`);
        else if (result.has_missing_fields !== undefined) showToastMsg(`CSV: ${result.rows} rows${result.has_missing_fields ? " (some N/A)" : ""}`);
        else if (result.rows) showToastMsg(`Dashboard: ${result.rows} rows`);
        else showToastMsg("Done!");
      } else if (result.ok && result.title && action === "recognize_audio") {
        // Store in local state for inline action result
        setRecognitionData({
          title: result.title || "",
          artist: result.artist || "",
          album: result.album || "",
          year: result.year || "",
          genre: result.genre || "",
          cover_url: result.cover_url || "",
          shazam_url: result.shazam_url || "",
        });
        // Also store in global store for batch Save All support
        setAudioResult(item.id, {
          itemId: item.id, path: item.path,
          title: result.title || "", artist: result.artist || "",
          album: result.album || "", year: result.year || "",
          genre: result.genre || "", track_number: result.track_number || "",
          cover_url: result.cover_url || "", shazam_url: result.shazam_url || "",
          mood: result.mood || "", style: result.style || "",
          description: result.description || "",
        });
        const lines = [`Title: ${result.title}`, `Artist: ${result.artist || "Unknown"}`];
        if (result.album) lines.push(`Album: ${result.album}`);
        if (result.year) lines.push(`Year: ${result.year}`);
        if (result.genre) lines.push(`Genre: ${result.genre}`);
        if (result.track_number) lines.push(`Track: #${result.track_number}`);
        setActionResult({ label: "Song Recognized", text: lines.join("\n"), action });
        showToastMsg(`Recognized: ${result.artist} — ${result.title}`);
      } else if (result.ok && !result.title && action === "recognize_audio") {
        showToastMsg("Recognition failed: no match found. Try a different audio segment.");
      } else if (result.ok && result.suggestions) {
        // Handled by smart_rename branch above
      } else if (result.ok && result.suggested_name) {
        showToastMsg(`Rename → ${result.suggested_name}`);
      } else {
        showToastMsg(result.error || "Failed");
      }
    } catch (e) {
      showToastMsg(String(e));
    } finally {
      setProcessing(null);
    }
  }, [item.path, item.name, stageFile, showToastMsg, settings, getDefaultApiKey]);

  const handleZipEncrypt = useCallback(async () => {
    if (!password.trim()) { showToastMsg("Password required"); return; }
    setShowPasswordPrompt(false);
    setProcessing("zip_encrypt");
    try {
      const argsJson = JSON.stringify({ path: item.path, password: password.trim(), name: item.name.replace(/\.[^.]+$/, "") });
      const resultStr = await invoke<string>("process_file", { action: "zip_encrypt", argsJson });
      const result = JSON.parse(resultStr);
      if (result.ok && result.path) {
        await stageFile(result.path);
        showToastMsg("Encrypted zip created!");
      } else {
        showToastMsg(result.error || "Failed");
      }
    } catch (e) {
      showToastMsg(String(e));
    } finally {
      setProcessing(null);
      setPassword("");
    }
  }, [item.path, item.name, password, stageFile, showToastMsg]);

  const handleEmailSend = useCallback(async () => {
    setShowEmailPrompt(false);
    try {
      await invoke("email_files", {
        paths: [item.path],
        to: emailTo,
        subject: emailSubject,
        body: emailBody || `Attached: ${item.name}`,
      });
      showToastMsg("Email client opened!");
    } catch (e) {
      showToastMsg(String(e));
    }
    setEmailTo(""); setEmailSubject(""); setEmailBody("");
  }, [item.path, item.name, emailTo, emailSubject, emailBody, showToastMsg]);

  const handleCompressSubmit = useCallback(async () => {
    setShowCompressOpts(false);
    setProcessing("compress_image");
    try {
      const argsJson = JSON.stringify({ path: item.path, quality: compressQuality });
      const resultStr = await invoke<string>("process_file", { action: "compress_image", argsJson });
      const result = JSON.parse(resultStr);
      if (result.ok && result.path) {
        await stageFile(result.path);
        showToastMsg(`Saved ${result.savings_pct ?? 0}%`);
      } else { showToastMsg(result.error || "Failed"); }
    } catch (e) { showToastMsg(String(e)); }
    finally { setProcessing(null); }
  }, [item.path, compressQuality, stageFile, showToastMsg]);

  const handleResizeSubmit = useCallback(async () => {
    setShowResizeOpts(false);
    setProcessing("resize_image");
    try {
      const args: Record<string, unknown> = { path: item.path };
      if (resizeWidth) args.width = parseInt(resizeWidth);
      if (resizeHeight) args.height = parseInt(resizeHeight);
      if (!resizeWidth && !resizeHeight && resizePct) args.percentage = parseInt(resizePct);
      // Include fill_color when both W and H are specified (ratio change possible)
      if (resizeWidth && resizeHeight) {
        args.maintain_aspect = false;
        args.fill_color = resizeFillColor;
      }
      const resultStr = await invoke<string>("process_file", { action: "resize_image", argsJson: JSON.stringify(args) });
      const result = JSON.parse(resultStr);
      if (result.ok && result.path) {
        await stageFile(result.path);
        showToastMsg(`Resized to ${result.width}x${result.height}${result.fill_used ? " (padded)" : ""}`);
      } else { showToastMsg(result.error || "Failed"); }
    } catch (e) { showToastMsg(String(e)); }
    finally { setProcessing(null); }
  }, [item.path, resizeWidth, resizeHeight, resizePct, resizeFillColor, stageFile, showToastMsg]);

  const handleSplitSubmit = useCallback(async () => {
    setShowSplitOpts(false);
    setProcessing("split_file");
    try {
      const argsJson = JSON.stringify({ path: item.path, chunk_size_mb: parseInt(splitChunkMb) || 25 });
      const resultStr = await invoke<string>("process_file", { action: "split_file", argsJson });
      const result = JSON.parse(resultStr);
      if (result.ok && result.paths) {
        for (const p of result.paths) await stageFile(p);
        showToastMsg(`Split into ${result.part_count} parts`);
      } else { showToastMsg(result.error || "Failed"); }
    } catch (e) { showToastMsg(String(e)); }
    finally { setProcessing(null); }
  }, [item.path, splitChunkMb, stageFile, showToastMsg]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.6, y: -10 }}
      transition={{ type: "spring", stiffness: 400, damping: 28, delay: index * 0.04 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); setShowMore(false); setShowTimer(false); setShowPasswordPrompt(false); setShowEmailPrompt(false); setShowCompressOpts(false); setShowResizeOpts(false); setShowSplitOpts(false); setShowTranslateOpts(false); setShowAskPanel(false); setShowBase64Menu(false); setShowConvertMenu(false); setShowAudioConvertMenu(false); setShowAudioTypeAsk(false); setShowImageConvertMenu(false); setShowArchivePanel(false); setShowExifPanel(false); setShowTagPicker(false); }}
      className="group relative flex flex-col rounded-xl transition-colors"
      style={{
        background: isHovered ? "rgba(255, 255, 255, 0.06)" : "rgba(255, 255, 255, 0.02)",
      }}
    >
    <SpotlightCard className="rounded-xl" spotlightColor="rgba(139,92,246,0.12)" disabled={settings?.appearance?.spotlight_cards === false}>
      {/* Main row */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Selection checkbox */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }}
          className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-all ${
            isSelected ? "bg-cyan-500 border-cyan-400" : "border-white/15 hover:border-white/30"
          }`}
        >
          {isSelected && <i className="fa-solid fa-check text-[8px] text-white" />}
        </button>
        <div
          className={`flex items-center gap-3 flex-1 min-w-0 ${hasDragPath ? "cursor-grab active:cursor-grabbing" : "cursor-default"}`}
          onMouseDown={handleDragOut}
        >
          {/* Thumbnail / Icon */}
          <motion.div
            className="relative shrink-0 w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden"
            style={{ background: item.thumbnail ? "transparent" : `${extColor}15` }}
            whileHover={{ scale: 1.1 }}
            transition={{ type: "spring", stiffness: 500, damping: 20 }}
          >
            {item.thumbnail ? (
              <img src={item.thumbnail} alt={item.name} className="w-full h-full object-cover rounded-lg" />
            ) : !item.path && URL_REGEX.test(item.name.trim()) ? (
              <i className="fa-solid fa-link text-lg text-blue-400" />
            ) : (
              <span className="text-lg leading-none">{getFileIcon(item.extension, item.is_directory)}</span>
            )}
            {item.extension && !item.is_directory && (
              <div
                className="absolute -bottom-0.5 -right-0.5 px-1 py-px text-[8px] font-bold uppercase rounded tracking-wider"
                style={{ background: extColor, color: "#0f0f0f" }}
              >
                {item.extension}
              </div>
            )}
          </motion.div>

          {/* File info */}
          <div className="flex-1 min-w-0">
            {renameState && renameState.loading ? (
              <ShinyBar />
            ) : renameState && renameState.suggestions.length > 0 ? (
              <div className="flex items-center gap-1 min-w-0" onMouseDown={(e) => e.stopPropagation()}>
                <p className="text-[13px] font-medium text-purple-300 truncate leading-tight flex-1" title={renameState.suggestions[renameState.activeIndex]?.full_name}>
                  {renameState.suggestions[renameState.activeIndex]?.full_name}
                </p>
                <button onClick={(e) => { e.stopPropagation(); cycleRenameSuggestion(item.id); }} className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-[10px] text-amber-300 hover:bg-amber-500/15 transition-colors" title="Cycle suggestion">
                  <i className="fa-solid fa-dice" />
                </button>
                <button onClick={async (e) => {
                  e.stopPropagation();
                  const s = renameState.suggestions[renameState.activeIndex];
                  try {
                    const r = JSON.parse(await invoke<string>("apply_rename", { oldPath: renameState.path, newStem: s.stem }));
                    if (r.renamed) {
                      showToastMsg(`Renamed → ${r.new_name}`);
                      setRenameState(item.id, null);
                      refreshRenameCounts();
                      useZenithStore.setState((st) => ({
                        items: st.items.map((it) => it.id === item.id ? { ...it, name: r.new_name, path: r.new_path } : it),
                      }));
                    } else showToastMsg(r.reason || "Not renamed");
                  } catch (err) { showToastMsg(String(err)); }
                }} className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-[10px] text-emerald-400 hover:bg-emerald-500/15 transition-colors" title="Accept">
                  <i className="fa-solid fa-check" />
                </button>
                <button onClick={(e) => {
                  e.stopPropagation();
                  const s = renameState.suggestions[renameState.activeIndex];
                  const newName = prompt("Edit filename (stem only, extension preserved):", s.stem);
                  if (newName && newName.trim()) {
                    (async () => {
                      try {
                        const r = JSON.parse(await invoke<string>("apply_rename", { oldPath: renameState.path, newStem: newName.trim() }));
                        if (r.renamed) {
                          showToastMsg(`Renamed → ${r.new_name}`);
                          setRenameState(item.id, null);
                          refreshRenameCounts();
                          useZenithStore.setState((st) => ({
                            items: st.items.map((it) => it.id === item.id ? { ...it, name: r.new_name, path: r.new_path } : it),
                          }));
                        } else showToastMsg(r.reason || "Not renamed");
                      } catch (err) { showToastMsg(String(err)); }
                    })();
                  }
                }} className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-[10px] text-cyan-300 hover:bg-cyan-500/15 transition-colors" title="Manual edit">
                  <i className="fa-solid fa-pen" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); setRenameState(item.id, null); }} className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-[10px] text-white/30 hover:text-white/60 transition-colors" title="Cancel">
                  <i className="fa-solid fa-xmark" />
                </button>
              </div>
            ) : (
              <p className="text-[13px] font-medium text-white/90 truncate leading-tight">{item.name}</p>
            )}
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] text-white/40">{formatFileSize(item.size)}</span>
              {itemTag && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded cursor-pointer hover:opacity-80 transition-opacity"
                  style={{ background: `${itemTag.color}20`, color: itemTag.color, border: `1px solid ${itemTag.color}30` }}
                  onClick={(e) => { e.stopPropagation(); removeItemTag(item.id); }}
                  title={`${itemTag.name} — click to remove`}>
                  {itemTag.name}
                </span>
              )}
              <button onClick={(e) => { e.stopPropagation(); setShowTagPicker(!showTagPicker); }}
                className="text-[9px] text-white/20 hover:text-white/50 transition-colors"
                title="Add tag">
                <i className="fa-solid fa-tag" />
              </button>
              {hasTimer && timeLeft && (
                <span className="text-[10px] font-medium text-red-400/80">
                  <i className="fa-solid fa-bomb text-[8px] mr-0.5" />
                  {timeLeft}
                </span>
              )}
              {scanBadge === "safe" && (
                <span className="text-[10px] font-medium text-emerald-400" title="VirusTotal: Safe">
                  <i className="fa-solid fa-shield-check text-[9px] mr-0.5" />Safe
                </span>
              )}
              {scanBadge === "malicious" && (
                <span className="text-[10px] font-bold text-red-400" title="VirusTotal: Malicious">
                  <i className="fa-solid fa-skull-crossbones text-[9px] mr-0.5" />Malicious
                </span>
              )}
              {scanBadge === "unknown" && (
                <span className="text-[10px] font-medium text-yellow-400/70" title="VirusTotal: Unknown">
                  <i className="fa-solid fa-circle-question text-[9px] mr-0.5" />Unknown
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Remove button */}
        <motion.button
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: isHovered ? 1 : 0, scale: isHovered ? 1 : 0.5 }}
          transition={{ type: "spring", stiffness: 500, damping: 25 }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); removeItem(item.id); }}
          className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-white/10 hover:bg-red-500/80 text-white/50 hover:text-white transition-colors"
        >
          <i className="fa-solid fa-xmark text-[10px]" />
        </motion.button>
      </div>

      {/* Folder tree view */}
      {item.is_directory && hasDragPath && (
        <>
          <button
            onClick={() => setFolderExpanded(!folderExpanded)}
            className="flex items-center gap-1.5 px-3 pb-1 text-[10px] text-white/30 hover:text-white/60 transition-colors"
          >
            <motion.i
              animate={{ rotate: folderExpanded ? 90 : 0 }}
              transition={{ duration: 0.15 }}
              className="fa-solid fa-chevron-right text-[7px]"
            />
            {folderExpanded ? "Collapse" : "Browse contents"}
          </button>
          <AnimatePresence>
            {folderExpanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-2 pb-2 max-h-[200px] overflow-y-auto">
                  <FolderTree path={item.path} name={item.name} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* Hover action bar */}
      <AnimatePresence>
        {isHovered && actions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-1 px-3 pb-2 relative">
              {actions.slice(0, 4).map((a) => (
                <button
                  key={a.action}
                  onClick={() => handleAction(a.action)}
                  disabled={processing !== null}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium transition-all hover:bg-white/10 disabled:opacity-40"
                  style={{ color: a.color || "#94a3b8" }}
                  title={a.label}
                >
                  {processing === a.action ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin text-[9px]" />
                      <ShinyText text={a.label} speed={1.5} color={`${a.color || "#94a3b8"}90`} shineColor={a.color || "#94a3b8"} className="text-[10px]" />
                    </>
                  ) : (
                    <>
                      <i className={`${a.icon} text-[9px]`} />
                      {a.label}
                    </>
                  )}
                </button>
              ))}
              {actions.length > 4 && (
                <button
                  onClick={() => setShowMore(!showMore)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-white/30 hover:text-white/60 hover:bg-white/10 transition-all"
                >
                  <i className="fa-solid fa-ellipsis text-[9px]" />
                </button>
              )}
              <div className="ml-auto" />
              {/* Self-destruct timer */}
              <button
                onClick={() => setShowTimer(!showTimer)}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all hover:bg-white/10 ${
                  hasTimer ? "text-red-400" : "text-white/25 hover:text-white/50"
                }`}
                title="Self-destruct timer"
              >
                <i className="fa-solid fa-bomb text-[9px]" />
              </button>
            </div>

            {/* More dropdown */}
            <AnimatePresence>
              {showMore && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-2 flex flex-wrap gap-1">
                    {actions.slice(4).map((a) => (
                      <button
                        key={a.action}
                        onClick={() => handleAction(a.action)}
                        disabled={processing !== null}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium transition-all hover:bg-white/10 disabled:opacity-40"
                        style={{ color: a.color || "#94a3b8" }}
                      >
                        <i className={`${a.icon} text-[9px]`} />
                        {a.label}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Timer dropdown */}
            <AnimatePresence>
              {showTimer && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-2 flex items-center gap-1">
                    {[
                      { label: "5m", mins: 5 },
                      { label: "30m", mins: 30 },
                      { label: "1h", mins: 60 },
                      { label: "24h", mins: 1440 },
                    ].map((opt) => (
                      <button
                        key={opt.mins}
                        onClick={() => setTimer(opt.mins)}
                        className="px-2 py-1 rounded-md text-[10px] font-medium text-red-300/80 hover:bg-red-500/15 transition-colors"
                      >
                        {opt.label}
                      </button>
                    ))}
                    {hasTimer && (
                      <button
                        onClick={() => setTimer(null)}
                        className="px-2 py-1 rounded-md text-[10px] font-medium text-white/30 hover:text-white/60 hover:bg-white/10 transition-colors"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Tag picker */}
            <AnimatePresence>
              {showTagPicker && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2 flex items-center gap-1 flex-wrap">
                    {TAG_COLORS.map((tc) => (
                      <button key={tc.name}
                        onClick={() => { setItemTag(item.id, tc.name, tc.hex); setShowTagPicker(false); }}
                        className="px-2 py-0.5 rounded text-[9px] font-medium transition-all hover:scale-105"
                        style={{ background: `${tc.hex}20`, color: tc.hex, border: `1px solid ${tc.hex}30` }}
                        title={tc.name}>
                        {tc.name}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Password prompt for zip+encrypt */}
            <AnimatePresence>
              {showPasswordPrompt && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-2 flex items-center gap-1.5">
                    <i className="fa-solid fa-lock text-[9px] text-pink-400" />
                    <input
                      type="password"
                      placeholder="Password..."
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleZipEncrypt()}
                      className="flex-1 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[11px] text-white/80 placeholder:text-white/20 outline-none focus:border-pink-400/40"
                      autoFocus
                    />
                    <button
                      onClick={handleZipEncrypt}
                      className="px-2 py-1 rounded-md text-[10px] font-medium text-pink-300 hover:bg-pink-500/15 transition-colors"
                    >
                      Encrypt
                    </button>
                    <button
                      onClick={() => { setShowPasswordPrompt(false); setPassword(""); }}
                      className="px-1.5 py-1 rounded-md text-[10px] text-white/30 hover:text-white/60 hover:bg-white/10 transition-colors"
                    >
                      <i className="fa-solid fa-xmark text-[9px]" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Email compose prompt */}
            <AnimatePresence>
              {showEmailPrompt && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-2 space-y-1.5">
                    {/* File size warning */}
                    {item.size && item.size > 25 * 1024 * 1024 && (
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20">
                        <i className="fa-solid fa-triangle-exclamation text-[9px] text-amber-400" />
                        <span className="text-[9px] text-amber-300">File is {(item.size / 1024 / 1024).toFixed(1)}MB — may exceed email limits. Consider compressing first.</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <i className={`fa-solid ${emailDraftLoading ? "fa-spinner fa-spin" : "fa-envelope"} text-[9px] text-violet-400`} />
                      <input
                        type="email"
                        placeholder="To: email@example.com"
                        value={emailTo}
                        onChange={(e) => setEmailTo(e.target.value)}
                        className="flex-1 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[11px] text-white/80 placeholder:text-white/20 outline-none focus:border-violet-400/40"
                        autoFocus
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        placeholder="Subject"
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                        className="flex-1 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[11px] text-white/80 placeholder:text-white/20 outline-none focus:border-violet-400/40 ml-[17px]"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <textarea
                        placeholder="Body (AI-drafted)"
                        value={emailBody}
                        onChange={(e) => setEmailBody(e.target.value)}
                        rows={2}
                        className="flex-1 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[11px] text-white/80 placeholder:text-white/20 outline-none focus:border-violet-400/40 ml-[17px] resize-none"
                      />
                    </div>
                    <div className="flex justify-end gap-1 mt-0.5">
                      <button
                        onClick={handleEmailSend}
                        className="px-2.5 py-1 rounded-md text-[10px] font-medium text-violet-300 hover:bg-violet-500/15 transition-colors"
                      >
                        <i className="fa-solid fa-paper-plane mr-1 text-[9px]" />Send
                      </button>
                      <button
                        onClick={() => { setShowEmailPrompt(false); setEmailTo(""); setEmailSubject(""); setEmailBody(""); }}
                        className="px-1.5 py-1 rounded-md text-[10px] text-white/30 hover:text-white/60 hover:bg-white/10 transition-colors"
                      >
                        <i className="fa-solid fa-xmark text-[9px]" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Compress options */}
            <AnimatePresence>
              {showCompressOpts && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <i className="fa-solid fa-compress text-[9px] text-cyan-400" />
                      <span className="text-[10px] text-white/50">Quality:</span>
                      <input type="range" min={10} max={100} step={5} value={compressQuality} onChange={(e) => setCompressQuality(Number(e.target.value))}
                        className="flex-1 h-1 rounded-full appearance-none cursor-pointer" style={{ background: `linear-gradient(to right, rgba(34,211,238,0.5) ${compressQuality}%, rgba(255,255,255,0.08) ${compressQuality}%)` }} />
                      <span className="text-[10px] text-cyan-300 font-mono w-8 text-right">{compressQuality}%</span>
                      <button onClick={handleCompressSubmit} className="px-2 py-1 rounded-md text-[10px] font-medium text-cyan-300 hover:bg-cyan-500/15 transition-colors">Go</button>
                      <button onClick={() => setShowCompressOpts(false)} className="px-1 py-1 text-[10px] text-white/30 hover:text-white/60"><i className="fa-solid fa-xmark text-[9px]" /></button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Resize options */}
            <AnimatePresence>
              {showResizeOpts && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2 space-y-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <i className="fa-solid fa-expand text-[9px] text-cyan-400" />
                      <input type="number" placeholder="W" value={resizeWidth} onChange={(e) => setResizeWidth(e.target.value)}
                        className="w-14 px-1.5 py-1 rounded-md bg-white/5 border border-white/10 text-[11px] text-white/80 placeholder:text-white/20 outline-none text-center" />
                      <span className="text-[10px] text-white/30">×</span>
                      <input type="number" placeholder="H" value={resizeHeight} onChange={(e) => setResizeHeight(e.target.value)}
                        className="w-14 px-1.5 py-1 rounded-md bg-white/5 border border-white/10 text-[11px] text-white/80 placeholder:text-white/20 outline-none text-center" />
                      <span className="text-[10px] text-white/30">or</span>
                      <input type="number" placeholder="%" value={resizePct} onChange={(e) => setResizePct(e.target.value)}
                        className="w-12 px-1.5 py-1 rounded-md bg-white/5 border border-white/10 text-[11px] text-white/80 placeholder:text-white/20 outline-none text-center" />
                      <span className="text-[10px] text-white/30">%</span>
                      <button onClick={handleResizeSubmit} className="px-2 py-1 rounded-md text-[10px] font-medium text-cyan-300 hover:bg-cyan-500/15 transition-colors">Go</button>
                      <button onClick={() => setShowResizeOpts(false)} className="px-1 py-1 text-[10px] text-white/30 hover:text-white/60"><i className="fa-solid fa-xmark text-[9px]" /></button>
                    </div>
                    {/* Fill color — shown when both W and H are set (ratio may change) */}
                    {resizeWidth && resizeHeight && (
                      <div className="flex items-center gap-1.5 ml-[17px]">
                        <i className="fa-solid fa-fill-drip text-[9px] text-white/30" />
                        <span className="text-[9px] text-white/40">Fill color:</span>
                        <input type="color" value={resizeFillColor} onChange={(e) => setResizeFillColor(e.target.value)}
                          className="w-6 h-5 rounded cursor-pointer border-0 bg-transparent p-0" title="Background fill color if aspect ratio changes" />
                        <input type="text" value={resizeFillColor} onChange={(e) => setResizeFillColor(e.target.value)}
                          className="w-16 px-1.5 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] text-white/60 outline-none font-mono" />
                        <span className="text-[9px] text-white/25">used if ratio changes</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Split options */}
            <AnimatePresence>
              {showSplitOpts && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2 flex items-center gap-1.5">
                    <i className="fa-solid fa-scissors text-[9px] text-orange-400" />
                    <span className="text-[10px] text-white/50">Chunk:</span>
                    <input type="number" value={splitChunkMb} onChange={(e) => setSplitChunkMb(e.target.value)}
                      className="w-14 px-1.5 py-1 rounded-md bg-white/5 border border-white/10 text-[11px] text-white/80 outline-none text-center" />
                    <span className="text-[10px] text-white/30">MB</span>
                    <button onClick={handleSplitSubmit} className="px-2 py-1 rounded-md text-[10px] font-medium text-orange-300 hover:bg-orange-500/15 transition-colors">Split</button>
                    <button onClick={() => setShowSplitOpts(false)} className="px-1 py-1 text-[10px] text-white/30 hover:text-white/60"><i className="fa-solid fa-xmark text-[9px]" /></button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Translate options */}
            <AnimatePresence>
              {showTranslateOpts && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2 flex items-center gap-1.5">
                    <i className="fa-solid fa-language text-[9px] text-emerald-400" />
                    <span className="text-[10px] text-white/50">To:</span>
                    <select value={translateLang} onChange={(e) => setTranslateLang(e.target.value)}
                      className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[11px] text-white/80 outline-none appearance-none cursor-pointer">
                      {LANGUAGES.map((l) => <option key={l} value={l} className="bg-[#1a1a24] text-white">{l}</option>)}
                    </select>
                    <button
                      disabled={processing !== null}
                      onClick={async () => {
                        setShowTranslateOpts(false);
                        setProcessing("translate_file");
                        try {
                          const argsJson = JSON.stringify({ path: item.path, target_language: translateLang, system_prompt: settings?.ai_prompts?.translate, ...getDefaultApiKey() });
                          const r = JSON.parse(await invoke<string>("process_file", { action: "translate_file", argsJson }));
                          if (r.token_usage) trackTokenUsage(r.token_usage.provider, r.token_usage.model, r.token_usage.input_tokens, r.token_usage.output_tokens);
                          if (r.ok && r.path) { await stageFile(r.path); showToastMsg(`Translated to ${r.language}`); }
                          else showToastMsg(r.error || "Failed");
                        } catch (e) { showToastMsg(String(e)); }
                        finally { setProcessing(null); }
                      }}
                      className="px-2 py-1 rounded-md text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/15 transition-colors disabled:opacity-40"
                    >
                      {processing === "translate_file" ? <i className="fa-solid fa-spinner fa-spin text-[9px]" /> : "Go"}
                    </button>
                    <button onClick={() => setShowTranslateOpts(false)} className="px-1 py-1 text-[10px] text-white/30 hover:text-white/60"><i className="fa-solid fa-xmark text-[9px]" /></button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Ask Data panel */}
            <AnimatePresence>
              {showAskPanel && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2 flex items-center gap-1.5">
                    <i className="fa-solid fa-comments text-[9px] text-cyan-400" />
                    <input
                      type="text" placeholder="Ask a question about this file..."
                      value={askQuestion} onChange={(e) => setAskQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && askQuestion.trim()) {
                          setShowAskPanel(false);
                          setProcessing("ask_data");
                          const run = async () => {
                            try {
                              const argsJson = JSON.stringify({ path: item.path, question: askQuestion.trim(), system_prompt: settings?.ai_prompts?.ask_data, ...getDefaultApiKey() });
                              const r = JSON.parse(await invoke<string>("process_file", { action: "ask_data", argsJson }));
                              if (r.token_usage) trackTokenUsage(r.token_usage.provider, r.token_usage.model, r.token_usage.input_tokens, r.token_usage.output_tokens);
                              if (r.ok && r.path) {
                                await stageFile(r.path);
                                if (r.answer) setActionResult({ label: "Answer", text: r.answer, action: "ask_data" });
                                showToastMsg("Answer ready");
                              }
                              else showToastMsg(r.error || "Failed");
                            } catch (err) { showToastMsg(String(err)); }
                            finally { setProcessing(null); setAskQuestion(""); }
                          };
                          run();
                        }
                      }}
                      className="flex-1 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[11px] text-white/80 placeholder:text-white/20 outline-none focus:border-cyan-400/40"
                      autoFocus
                    />
                    <button
                      disabled={processing !== null || !askQuestion.trim()}
                      onClick={async () => {
                        if (!askQuestion.trim()) return;
                        setShowAskPanel(false);
                        setProcessing("ask_data");
                        try {
                          const argsJson = JSON.stringify({ path: item.path, question: askQuestion.trim(), system_prompt: settings?.ai_prompts?.ask_data, ...getDefaultApiKey() });
                          const r = JSON.parse(await invoke<string>("process_file", { action: "ask_data", argsJson }));
                          if (r.token_usage) trackTokenUsage(r.token_usage.provider, r.token_usage.model, r.token_usage.input_tokens, r.token_usage.output_tokens);
                          if (r.ok && r.path) {
                            await stageFile(r.path);
                            if (r.answer) setActionResult({ label: "Answer", text: r.answer, action: "ask_data" });
                            showToastMsg("Answer ready");
                          }
                          else showToastMsg(r.error || "Failed");
                        } catch (e) { showToastMsg(String(e)); }
                        finally { setProcessing(null); setAskQuestion(""); }
                      }}
                      className="px-2 py-1 rounded-md text-[10px] font-medium text-cyan-300 hover:bg-cyan-500/15 transition-colors disabled:opacity-40"
                    >Ask</button>
                    <button onClick={() => setShowAskPanel(false)} className="px-1 py-1 text-[10px] text-white/30 hover:text-white/60"><i className="fa-solid fa-xmark text-[9px]" /></button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Palette result — enhanced with selective copy + ink dropper */}
            <AnimatePresence>
              {showPaletteResult && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2">
                    {/* Header */}
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <i className="fa-solid fa-palette text-[9px] text-pink-400" />
                      <span className="text-[10px] text-white/50">Palette</span>
                      {/* Mode toggle */}
                      <div className="flex rounded-md overflow-hidden border border-white/10 ml-1">
                        {(["swatches", "dropper"] as const).map((m) => (
                          <button key={m} onClick={() => { setPaletteMode(m); setPaletteSelected(new Set()); setDropperColor(null); }}
                            className={`px-2 py-0.5 text-[9px] font-medium transition-colors ${paletteMode === m ? "bg-pink-500/25 text-pink-300" : "text-white/30 hover:text-white/60"}`}>
                            {m === "swatches" ? "Swatches" : "Dropper"}
                          </button>
                        ))}
                      </div>
                      <div className="ml-auto flex gap-1">
                        <button
                          onClick={async () => {
                            const tw = "colors: {\n" + showPaletteResult.map(c => `  "${c.hex.slice(1)}": "${c.hex}",`).join("\n") + "\n}";
                            await navigator.clipboard.writeText(tw);
                            showToastMsg("Tailwind config copied!");
                          }}
                          className="px-1.5 py-0.5 rounded text-[9px] font-medium text-pink-300 hover:bg-pink-500/15 transition-colors"
                        >Export</button>
                        <button
                          disabled={processing !== null}
                          onClick={async () => {
                            setProcessing("save_palette_image");
                            try {
                              const argsJson = JSON.stringify({ colors: showPaletteResult, name: item.name.replace(/\.[^.]+$/, "") });
                              const r = JSON.parse(await invoke<string>("process_file", { action: "save_palette_image", argsJson }));
                              if (r.ok && r.path) { await stageFile(r.path); showToastMsg("Palette image saved!"); }
                              else showToastMsg(r.error || "Failed");
                            } catch (e) { showToastMsg(String(e)); }
                            finally { setProcessing(null); }
                          }}
                          className="px-1.5 py-0.5 rounded text-[9px] font-medium text-white/40 hover:bg-white/5 hover:text-white/70 transition-colors disabled:opacity-30"
                          title="Save palette as image"
                        ><i className="fa-solid fa-image text-[8px]" /></button>
                        <button onClick={() => { setShowPaletteResult(null); setPaletteSelected(new Set()); setDropperColor(null); }} className="px-1 py-0.5 text-[10px] text-white/30 hover:text-white/60"><i className="fa-solid fa-xmark text-[9px]" /></button>
                      </div>
                    </div>

                    {paletteMode === "swatches" ? (
                      <>
                        {/* Swatches with checkboxes */}
                        <div className="flex gap-1.5 flex-wrap">
                          {showPaletteResult.map((c, i) => (
                            <div key={i} className="relative flex flex-col items-center gap-0.5 cursor-pointer" title={`${c.hex}`}>
                              <div className="relative" onClick={async () => { await navigator.clipboard.writeText(c.hex); showToastMsg(`Copied ${c.hex}`); }}>
                                <div className="w-8 h-8 rounded-lg border border-white/10 shadow-sm" style={{ background: c.hex }} />
                                {!c.wcag_on_white && !c.wcag_on_black && (
                                  <span className="absolute -top-1 -right-1 text-[7px] text-amber-400">⚠</span>
                                )}
                              </div>
                              <input type="checkbox" checked={paletteSelected.has(i)}
                                onChange={() => setPaletteSelected((s) => { const ns = new Set(s); ns.has(i) ? ns.delete(i) : ns.add(i); return ns; })}
                                className="w-2.5 h-2.5 accent-pink-500 cursor-pointer" />
                              <span className="text-[8px] text-white/40 font-mono">{c.hex}</span>
                            </div>
                          ))}
                        </div>
                        {/* Selective copy */}
                        {paletteSelected.size > 0 && (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <span className="text-[9px] text-white/40">{paletteSelected.size} selected:</span>
                            <button
                              onClick={async () => {
                                const selected = showPaletteResult.filter((_, i) => paletteSelected.has(i)).map(c => c.hex);
                                await navigator.clipboard.writeText(selected.join(", "));
                                showToastMsg(`Copied ${selected.length} colors`);
                              }}
                              className="px-2 py-0.5 rounded text-[9px] font-medium text-pink-300 hover:bg-pink-500/15 transition-colors"
                            ><i className="fa-regular fa-copy mr-1 text-[8px]" />Copy Hex</button>
                            <button
                              onClick={async () => {
                                const selected = showPaletteResult.filter((_, i) => paletteSelected.has(i));
                                const css = selected.map((c, idx) => `--color-${idx + 1}: ${c.hex};`).join(" ");
                                await navigator.clipboard.writeText(`:root { ${css} }`);
                                showToastMsg("CSS vars copied!");
                              }}
                              className="px-2 py-0.5 rounded text-[9px] font-medium text-indigo-300 hover:bg-indigo-500/15 transition-colors"
                            >CSS vars</button>
                          </div>
                        )}
                      </>
                    ) : (
                      /* Ink Dropper mode — image canvas for pixel sampling */
                      <div className="space-y-1.5">
                        <span className="text-[9px] text-white/30">Click anywhere on the image to sample a color</span>
                        <canvas
                          ref={(el) => { dropperCanvasRef.current = el; if (el && item.thumbnail) { const img = new Image(); img.onload = () => { el.width = img.naturalWidth; el.height = img.naturalHeight; el.getContext("2d")?.drawImage(img, 0, 0); }; img.src = item.thumbnail; } }}
                          onClick={(e) => {
                            const canvas = dropperCanvasRef.current;
                            if (!canvas) return;
                            const rect = canvas.getBoundingClientRect();
                            const scaleX = canvas.width / rect.width;
                            const scaleY = canvas.height / rect.height;
                            const x = Math.round((e.clientX - rect.left) * scaleX);
                            const y = Math.round((e.clientY - rect.top) * scaleY);
                            const ctx = canvas.getContext("2d");
                            if (!ctx) return;
                            const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
                            const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
                            setDropperColor(hex);
                          }}
                          className="w-full rounded-lg cursor-crosshair border border-white/10 max-h-32 object-contain"
                          style={{ imageRendering: "pixelated" }}
                          title="Click to sample color"
                        />
                        {dropperColor && (
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded border border-white/20" style={{ background: dropperColor }} />
                            <span className="text-[10px] font-mono text-white/70">{dropperColor}</span>
                            <button onClick={async () => { await navigator.clipboard.writeText(dropperColor); showToastMsg(`Copied ${dropperColor}`); }}
                              className="px-2 py-0.5 rounded text-[9px] font-medium text-pink-300 hover:bg-pink-500/15 transition-colors">
                              <i className="fa-regular fa-copy mr-1 text-[8px]" />Copy
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Base64 format menu */}
            <AnimatePresence>
              {showBase64Menu && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2 flex items-center gap-1 flex-wrap">
                    <i className="fa-solid fa-code text-[9px] text-indigo-400" />
                    {[
                      { label: "Raw", fmt: "raw", clipboard: true },
                      { label: "HTML <img>", fmt: "html_img", clipboard: true },
                      { label: "CSS url()", fmt: "css_url", clipboard: true },
                    ].map((opt) => (
                      <button
                        key={opt.fmt}
                        disabled={processing !== null}
                        onClick={async () => {
                          setShowBase64Menu(false);
                          setProcessing("file_to_base64");
                          try {
                            const argsJson = JSON.stringify({ path: item.path, format: opt.fmt });
                            const r = JSON.parse(await invoke<string>("process_file", { action: "file_to_base64", argsJson }));
                            if (r.ok && r.base64) {
                              await navigator.clipboard.writeText(r.base64);
                              showToastMsg(`Base64 (${opt.label}) copied! ${(r.encoded_size / 1024).toFixed(1)}KB`);
                            } else showToastMsg(r.error || "Failed");
                          } catch (e) { showToastMsg(String(e)); }
                          finally { setProcessing(null); }
                        }}
                        className="px-2 py-1 rounded-md text-[10px] font-medium text-indigo-300 hover:bg-indigo-500/15 transition-colors disabled:opacity-40"
                      >{opt.label}</button>
                    ))}
                    {/* Save as .txt file */}
                    <button
                      disabled={processing !== null}
                      onClick={async () => {
                        setShowBase64Menu(false);
                        setProcessing("file_to_base64");
                        try {
                          const argsJson = JSON.stringify({ path: item.path, format: "raw", save_as_txt: true });
                          const r = JSON.parse(await invoke<string>("process_file", { action: "file_to_base64", argsJson }));
                          if (r.ok && r.txt_path) { await stageFile(r.txt_path); showToastMsg("Saved as .b64.txt!"); }
                          else showToastMsg(r.error || "Failed");
                        } catch (e) { showToastMsg(String(e)); }
                        finally { setProcessing(null); }
                      }}
                      className="px-2 py-1 rounded-md text-[10px] font-medium text-white/50 hover:bg-white/5 hover:text-white/80 transition-colors disabled:opacity-40"
                      title="Save base64 as .txt file"
                    ><i className="fa-solid fa-floppy-disk mr-1 text-[9px]" />.txt</button>
                    <button onClick={() => setShowBase64Menu(false)} className="px-1 py-1 text-[10px] text-white/30 hover:text-white/60 ml-auto"><i className="fa-solid fa-xmark text-[9px]" /></button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Image convert format menu */}
            <AnimatePresence>
              {showImageConvertMenu && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2 space-y-1.5">
                    <div className="flex items-center gap-1 flex-wrap">
                      <i className="fa-solid fa-arrow-right-arrow-left text-[9px] text-violet-400" />
                      <span className="text-[9px] text-white/40 mr-1">Convert to:</span>
                      {[
                        { label: "PNG", fmt: "png" },
                        { label: "JPG", fmt: "jpg" },
                        { label: "WebP", fmt: "webp" },
                        { label: "BMP", fmt: "bmp" },
                        { label: "TIFF", fmt: "tiff" },
                        { label: "GIF", fmt: "gif" },
                        { label: "ICO", fmt: "ico" },
                      ].filter((o) => o.fmt !== item.extension.toLowerCase()).map((opt) => (
                        <button
                          key={opt.fmt}
                          disabled={processing !== null}
                          onClick={async () => {
                            setShowImageConvertMenu(false);
                            setProcessing("convert_image");
                            try {
                              const argsJson = JSON.stringify({ path: item.path, format: opt.fmt, quality: imageConvertQuality });
                              const r = JSON.parse(await invoke<string>("process_file", { action: "convert_image", argsJson }));
                              if (r.ok && r.path) {
                                await stageFile(r.path);
                                showToastMsg(`Converted to ${opt.label}${r.savings_pct ? ` (${r.savings_pct}% size change)` : ""}`);
                              } else showToastMsg(r.error || "Conversion failed");
                            } catch (e) { showToastMsg(String(e)); }
                            finally { setProcessing(null); }
                          }}
                          className="px-2 py-1 rounded-md text-[10px] font-medium text-violet-300 hover:bg-violet-500/15 transition-colors disabled:opacity-40"
                        >{opt.label}</button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-white/40">Quality:</span>
                      <input type="range" min={10} max={100} step={5} value={imageConvertQuality} onChange={(e) => setImageConvertQuality(Number(e.target.value))}
                        className="flex-1 h-1 rounded-full appearance-none cursor-pointer" style={{ background: `linear-gradient(to right, rgba(139,92,246,0.5) ${imageConvertQuality}%, rgba(255,255,255,0.08) ${imageConvertQuality}%)` }} />
                      <span className="text-[10px] text-violet-300 font-mono w-8 text-right">{imageConvertQuality}%</span>
                      <button onClick={() => setShowImageConvertMenu(false)} className="px-1 py-1 text-[10px] text-white/30 hover:text-white/60 ml-auto"><i className="fa-solid fa-xmark text-[9px]" /></button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* EXIF action panel — Strip or Preview */}
            <AnimatePresence>
              {showExifPanel && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <i className="fa-solid fa-tags text-[9px] text-amber-400" />
                      <span className="text-[10px] text-white/50">EXIF Metadata</span>
                      <div className="flex gap-1 ml-auto">
                        <button
                          disabled={processing !== null}
                          onClick={async () => {
                            setShowExifPanel(false);
                            setProcessing("strip_exif");
                            try {
                              const r = JSON.parse(await invoke<string>("process_file", { action: "strip_exif", argsJson: JSON.stringify({ path: item.path }) }));
                              if (r.ok && r.path) { await stageFile(r.path); showToastMsg("EXIF stripped"); }
                              else showToastMsg(r.error || "Failed");
                            } catch (e) { showToastMsg(String(e)); }
                            finally { setProcessing(null); }
                          }}
                          className="px-2 py-1 rounded-md text-[10px] font-medium text-red-300 hover:bg-red-500/15 transition-colors disabled:opacity-40"
                          title="Remove all EXIF data from this image"
                        ><i className="fa-solid fa-trash-can mr-1 text-[9px]" />Strip</button>
                        <button
                          disabled={processing !== null}
                          onClick={async () => {
                            setShowExifPanel(false);
                            setProcessing("show_exif");
                            try {
                              const r = JSON.parse(await invoke<string>("process_file", { action: "show_exif", argsJson: JSON.stringify({ path: item.path }) }));
                              if (r.ok) { setShowExifData(r); showToastMsg(r.has_exif ? `${Object.keys(r.exif || {}).length} EXIF tags` : "No EXIF data"); }
                              else showToastMsg(r.error || "Failed");
                            } catch (e) { showToastMsg(String(e)); }
                            finally { setProcessing(null); }
                          }}
                          className="px-2 py-1 rounded-md text-[10px] font-medium text-amber-300 hover:bg-amber-500/15 transition-colors disabled:opacity-40"
                          title="Preview EXIF metadata"
                        ><i className="fa-solid fa-eye mr-1 text-[9px]" />Preview</button>
                        <button onClick={() => setShowExifPanel(false)} className="px-1 py-1 text-[10px] text-white/30 hover:text-white/60"><i className="fa-solid fa-xmark text-[9px]" /></button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* EXIF data display */}
            <AnimatePresence>
              {showExifData && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <i className="fa-solid fa-circle-info text-[9px] text-amber-400" />
                      <span className="text-[10px] font-medium text-white/50">Image Metadata</span>
                      <div className="ml-auto flex gap-1">
                        <button onClick={async () => {
                          const exif = showExifData.exif as Record<string, unknown> | undefined;
                          const lines = [`Format: ${showExifData.format}`, `Size: ${(showExifData.size as number[])?.[0]}x${(showExifData.size as number[])?.[1]}`, `Mode: ${showExifData.mode}`];
                          if (exif) Object.entries(exif).forEach(([k, v]) => lines.push(`${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`));
                          await navigator.clipboard.writeText(lines.join("\n"));
                          showToastMsg("EXIF copied!");
                        }} className="px-1.5 py-0.5 rounded text-[9px] font-medium text-amber-300 hover:bg-amber-500/15 transition-colors"><i className="fa-regular fa-copy text-[8px] mr-0.5" />Copy</button>
                        <button onClick={() => setShowExifData(null)} className="px-1 py-0.5 text-[10px] text-white/30 hover:text-white/60"><i className="fa-solid fa-xmark text-[9px]" /></button>
                      </div>
                    </div>
                    <div className="rounded-lg bg-black/20 border border-white/5 p-2 max-h-40 overflow-y-auto space-y-0.5">
                      <div className="text-[9px] text-white/50"><span className="text-white/30">Format:</span> {String(showExifData.format)} &bull; <span className="text-white/30">Size:</span> {(showExifData.size as number[])?.[0]}x{(showExifData.size as number[])?.[1]} &bull; <span className="text-white/30">Mode:</span> {String(showExifData.mode)}</div>
                      {showExifData.has_exif ? (
                        Object.entries(showExifData.exif as Record<string, unknown>).map(([k, v]) => (
                          <div key={k} className="text-[9px] text-white/40 flex gap-1">
                            <span className="text-white/55 font-medium shrink-0">{k}:</span>
                            <span className="truncate">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-[9px] text-white/30 italic">No EXIF data found in this image</div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Unified Archive panel (zip/7z + encrypt + level + split) */}
            <AnimatePresence>
              {showArchivePanel && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2 space-y-1.5">
                    {/* Row 1: Format + Password */}
                    <div className="flex items-center gap-1.5">
                      <i className="fa-solid fa-file-zipper text-[9px] text-yellow-400" />
                      <span className="text-[10px] text-white/50">Format:</span>
                      <select value={archiveFormat} onChange={(e) => setArchiveFormat(e.target.value)}
                        className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] text-white/80 outline-none cursor-pointer">
                        {["zip", "7z"].map((f) => <option key={f} value={f} className="bg-[#1a1a24] text-white">{f.toUpperCase()}</option>)}
                      </select>
                      <span className="text-[10px] text-white/50 ml-1">Password:</span>
                      <input type="password" placeholder="optional" value={archivePassword} onChange={(e) => setArchivePassword(e.target.value)}
                        className="w-20 px-1.5 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] text-white/80 placeholder:text-white/20 outline-none" />
                    </div>
                    {/* Row 2: Compression level */}
                    <div className="flex items-center gap-2 ml-[17px]">
                      <span className="text-[10px] text-white/50 shrink-0">Level:</span>
                      <input type="range" min={1} max={9} step={1} value={archiveLevel} onChange={(e) => setArchiveLevel(Number(e.target.value))}
                        className="flex-1 h-1 rounded-full appearance-none cursor-pointer" style={{ background: `linear-gradient(to right, rgba(234,179,8,0.5) ${(archiveLevel - 1) / 8 * 100}%, rgba(255,255,255,0.08) ${(archiveLevel - 1) / 8 * 100}%)` }} />
                      <span className="text-[10px] text-yellow-300 font-mono w-4 text-right">{archiveLevel}</span>
                      <span className="text-[8px] text-white/25">{archiveLevel <= 3 ? "Fast" : archiveLevel <= 6 ? "Balanced" : "Best"}</span>
                    </div>
                    {/* Row 3: Split + Action buttons */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-white/50 ml-[17px]">Split:</span>
                      <input type="number" placeholder="MB" value={archiveSplitMb} onChange={(e) => setArchiveSplitMb(e.target.value)}
                        className="w-14 px-1.5 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] text-white/80 placeholder:text-white/20 outline-none text-center" />
                      <span className="text-[8px] text-white/25">MB</span>
                      <div className="ml-auto flex gap-1">
                        <button
                          disabled={processing !== null}
                          onClick={async () => {
                            setShowArchivePanel(false);
                            setProcessing("archive_file");
                            try {
                              const baseName = item.name.replace(/\.[^.]+$/, "");
                              if (archivePassword.trim()) {
                                const argsJson = JSON.stringify({ path: item.path, password: archivePassword.trim(), name: baseName });
                                const r = JSON.parse(await invoke<string>("process_file", { action: "zip_encrypt", argsJson }));
                                if (r.ok && r.path) { await stageFile(r.path); showToastMsg("Encrypted archive created!"); }
                                else showToastMsg(r.error || "Failed");
                              } else if (archiveSplitMb.trim()) {
                                const splitArgs = JSON.stringify({ path: item.path, chunk_size_mb: parseInt(archiveSplitMb) || 25 });
                                const r = JSON.parse(await invoke<string>("process_file", { action: "split_file", argsJson: splitArgs }));
                                if (r.ok && r.paths) { for (const p of r.paths) await stageFile(p); showToastMsg(`Split into ${r.part_count} parts`); }
                                else showToastMsg(r.error || "Split failed");
                              } else {
                                const argsJson = JSON.stringify({ path: item.path, format: archiveFormat, compression_level: archiveLevel, name: baseName });
                                const r = JSON.parse(await invoke<string>("process_file", { action: "zip_file", argsJson }));
                                if (r.ok && r.path) { await stageFile(r.path); showToastMsg(`${archiveFormat.toUpperCase()} created! Saved ${r.savings_pct ?? 0}%`); }
                                else showToastMsg(r.error || "Failed");
                              }
                            } catch (e) { showToastMsg(String(e)); }
                            finally { setProcessing(null); setArchivePassword(""); setArchiveSplitMb(""); }
                          }}
                          className="px-2.5 py-1 rounded-md text-[10px] font-medium text-yellow-300 hover:bg-yellow-500/15 transition-colors disabled:opacity-40"
                        >
                          {processing === "archive_file" ? <i className="fa-solid fa-spinner fa-spin text-[9px]" /> : "Compress"}
                        </button>
                        <button onClick={() => { setShowArchivePanel(false); setArchivePassword(""); setArchiveSplitMb(""); }} className="px-1 py-1 text-[10px] text-white/30 hover:text-white/60"><i className="fa-solid fa-xmark text-[9px]" /></button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Media convert format menu */}
            <AnimatePresence>
              {showConvertMenu && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2 flex items-center gap-1 flex-wrap">
                    <i className="fa-solid fa-film text-[9px] text-purple-400" />
                    <span className="text-[9px] text-white/40 mr-1">Convert to:</span>
                    {[
                      { label: "MP4", fmt: "mp4" },
                      { label: "MP3", fmt: "mp3" },
                      { label: "WebM", fmt: "webm" },
                      { label: "WAV", fmt: "wav" },
                      { label: "GIF", fmt: "gif" },
                    ].map((opt) => (
                      <button
                        key={opt.fmt}
                        disabled={processing !== null}
                        onClick={async () => {
                          setShowConvertMenu(false);
                          setProcessing("convert_media");
                          try {
                            const argsJson = JSON.stringify({ path: item.path, output_format: opt.fmt });
                            const r = JSON.parse(await invoke<string>("process_file", { action: "convert_media", argsJson }));
                            if (r.ok && r.path) {
                              await stageFile(r.path);
                              showToastMsg(`Converted to ${opt.label}`);
                            } else showToastMsg(r.error || "Conversion failed");
                          } catch (e) { showToastMsg(String(e)); }
                          finally { setProcessing(null); }
                        }}
                        className="px-2 py-1 rounded-md text-[10px] font-medium text-purple-300 hover:bg-purple-500/15 transition-colors disabled:opacity-40"
                      >{opt.label}</button>
                    ))}
                    <button onClick={() => setShowConvertMenu(false)} className="px-1 py-1 text-[10px] text-white/30 hover:text-white/60 ml-auto"><i className="fa-solid fa-xmark text-[9px]" /></button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Audio convert format menu (audio-only formats + bitrate) */}
            <AnimatePresence>
              {showAudioConvertMenu && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2 space-y-1.5">
                    <div className="flex items-center gap-1 flex-wrap">
                      <i className="fa-solid fa-headphones text-[9px] text-purple-400" />
                      <span className="text-[9px] text-white/40 mr-1">Convert to:</span>
                      {[
                        { label: "MP3", fmt: "mp3" },
                        { label: "WAV", fmt: "wav" },
                        { label: "FLAC", fmt: "flac" },
                        { label: "AAC", fmt: "aac" },
                        { label: "OGG", fmt: "ogg" },
                        { label: "M4A", fmt: "m4a" },
                        { label: "WMA", fmt: "wma" },
                        { label: "OPUS", fmt: "opus" },
                      ].filter((o) => o.fmt !== item.extension.toLowerCase()).map((opt) => (
                        <button
                          key={opt.fmt}
                          disabled={processing !== null}
                          onClick={async () => {
                            setShowAudioConvertMenu(false);
                            setProcessing("convert_audio");
                            try {
                              const argsJson = JSON.stringify({ path: item.path, output_format: opt.fmt, audio_bitrate: `${audioBitrate}k` });
                              const r = JSON.parse(await invoke<string>("process_file", { action: "convert_media", argsJson }));
                              if (r.ok && r.path) {
                                await stageFile(r.path);
                                showToastMsg(`Converted to ${opt.label} (${audioBitrate}kbps)`);
                              } else showToastMsg(`Conversion failed: ${r.error || "Unknown error"}`);
                            } catch (e) { showToastMsg(`Conversion error: ${String(e)}`); }
                            finally { setProcessing(null); }
                          }}
                          className="px-2 py-1 rounded-md text-[10px] font-medium text-purple-300 hover:bg-purple-500/15 transition-colors disabled:opacity-40"
                        >{opt.label}</button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-white/40">Bitrate:</span>
                      <select value={audioBitrate} onChange={(e) => setAudioBitrate(e.target.value)}
                        className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] text-white/80 outline-none cursor-pointer">
                        {["64", "96", "128", "160", "192", "256", "320"].map((b) => (
                          <option key={b} value={b} className="bg-[#1a1a24] text-white">{b} kbps</option>
                        ))}
                      </select>
                      <span className="text-[8px] text-white/25 ml-1">Lower = smaller file, Higher = better quality</span>
                      <button onClick={() => setShowAudioConvertMenu(false)} className="px-1 py-1 text-[10px] text-white/30 hover:text-white/60 ml-auto"><i className="fa-solid fa-xmark text-[9px]" /></button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Audio type ask: Personal or Music? (for AI Rename on audio files) */}
            <AnimatePresence>
              {showAudioTypeAsk && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <i className="fa-solid fa-circle-question text-[9px] text-purple-400" />
                      <span className="text-[10px] text-white/60">What type of audio is this?</span>
                      <button onClick={() => setShowAudioTypeAsk(false)} className="px-1 py-1 text-[10px] text-white/30 hover:text-white/60 ml-auto"><i className="fa-solid fa-xmark text-[9px]" /></button>
                    </div>
                    <div className="flex gap-2">
                      <button
                        disabled={processing !== null}
                        onClick={async () => {
                          setShowAudioTypeAsk(false);
                          // Music: run Shazam recognition first, then offer rename
                          setProcessing("recognize_audio");
                          try {
                            const argsJson = JSON.stringify({ path: item.path });
                            const resultStr = await invoke<string>("process_file", { action: "recognize_audio", argsJson });
                            const result = JSON.parse(resultStr);
                            if (result.ok && result.title) {
                              setRecognitionData({
                                title: result.title || "", artist: result.artist || "",
                                album: result.album || "", year: result.year || "",
                                genre: result.genre || "", cover_url: result.cover_url || "",
                                shazam_url: result.shazam_url || "",
                              });
                              const lines = [`Title: ${result.title}`, `Artist: ${result.artist || "Unknown"}`];
                              if (result.album) lines.push(`Album: ${result.album}`);
                              if (result.year) lines.push(`Year: ${result.year}`);
                              if (result.genre) lines.push(`Genre: ${result.genre}`);
                              setActionResult({ label: "Song Recognized — Rename?", text: lines.join("\n"), action: "recognize_audio" });
                              showToastMsg(`Recognized: ${result.artist} — ${result.title}`);
                            } else {
                              showToastMsg(`Recognition failed: ${result.error || "No match found"}. Falling back to AI Rename.`);
                              handleAction("smart_rename");
                            }
                          } catch (e) {
                            showToastMsg(`Recognition error: ${String(e)}. Falling back to AI Rename.`);
                            handleAction("smart_rename");
                          } finally { setProcessing(null); }
                        }}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20 transition-all disabled:opacity-40"
                      >
                        <i className="fa-solid fa-music text-[10px]" />
                        Music — Identify & Rename
                      </button>
                      <button
                        disabled={processing !== null}
                        onClick={() => {
                          setShowAudioTypeAsk(false);
                          handleAction("smart_rename");
                        }}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-[11px] font-medium text-violet-300 hover:bg-violet-500/20 transition-all disabled:opacity-40"
                      >
                        <i className="fa-solid fa-microphone text-[10px]" />
                        Personal Audio — AI Rename
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Batch recognition result banner (from global store) */}
            <AnimatePresence>
              {audioResult && !audioResult.saved && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2">
                    {audioResult.error ? (
                      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20">
                        <i className="fa-solid fa-circle-xmark text-[9px] text-red-400" />
                        <span className="text-[10px] text-red-300">{audioResult.error}</span>
                        <button onClick={() => setAudioResult(item.id, null)} className="ml-auto text-[10px] text-white/30 hover:text-white/60"><i className="fa-solid fa-xmark text-[9px]" /></button>
                      </div>
                    ) : (
                      <div className="rounded-lg bg-emerald-500/8 border border-emerald-500/20 p-2 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <i className="fa-solid fa-music text-[9px] text-emerald-400" />
                          <span className="text-[10px] font-medium text-emerald-300">
                            {audioResult.artist} — {audioResult.title}
                          </span>
                          <button onClick={() => setAudioResult(item.id, null)} className="ml-auto text-[10px] text-white/30 hover:text-white/60"><i className="fa-solid fa-xmark text-[9px]" /></button>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-white/40">
                          {audioResult.album && <span><span className="text-white/25">Album:</span> {audioResult.album}</span>}
                          {audioResult.year && <span><span className="text-white/25">Year:</span> {audioResult.year}</span>}
                          {audioResult.genre && <span><span className="text-white/25">Genre:</span> {audioResult.genre}</span>}
                          {audioResult.track_number && <span><span className="text-white/25">Track:</span> #{audioResult.track_number}</span>}
                        </div>
                        <div className="flex gap-1.5 mt-1">
                          <button
                            disabled={processing !== null}
                            onClick={async () => {
                              const ar = audioResult;
                              setProcessing("apply_audio_metadata");
                              try {
                                const argsJson = JSON.stringify({
                                  path: ar.path, title: ar.title, artist: ar.artist,
                                  album: ar.album, year: ar.year, genre: ar.genre,
                                  track_number: ar.track_number, cover_url: ar.cover_url,
                                  rename: true,
                                });
                                const r = JSON.parse(await invoke<string>("process_file", { action: "apply_audio_metadata", argsJson }));
                                if (r.ok) {
                                  const newPath = r.new_path || ar.path;
                                  const newName = r.new_name || item.name;
                                  const oldName = item.name;
                                  pushAudioUndo([{ itemId: item.id, old_path: ar.path, new_path: newPath, old_name: oldName, new_name: newName }]);
                                  setAudioResult(item.id, { ...ar, saved: true, new_path: newPath, new_name: newName });
                                  useZenithStore.setState((st) => ({
                                    items: st.items.map((it) => it.id === item.id ? { ...it, name: newName, path: newPath } : it),
                                  }));
                                  const tagCount = r.tags_written?.length || 0;
                                  showToastMsg(`Saved: ${tagCount} tags${r.cover_embedded ? " + cover art" : ""}${r.renamed ? ` → ${newName}` : ""}`);
                                } else {
                                  showToastMsg(`Save failed: ${r.error || "Unknown error"}`);
                                }
                              } catch (e) { showToastMsg(`Save error: ${String(e)}`); }
                              finally { setProcessing(null); }
                            }}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/20 transition-all disabled:opacity-40"
                          >
                            <i className="fa-solid fa-floppy-disk text-[8px]" />
                            Save (Tags + Rename + Cover)
                          </button>
                          <button
                            disabled={processing !== null}
                            onClick={async () => {
                              const ar = audioResult;
                              const suggested = ar.artist ? `${ar.artist} - ${ar.title}` : ar.title;
                              const userInput = prompt("Edit filename:", suggested);
                              if (!userInput?.trim()) return;
                              setProcessing("apply_audio_metadata");
                              try {
                                const argsJson = JSON.stringify({
                                  path: ar.path, title: ar.title, artist: ar.artist,
                                  album: ar.album, year: ar.year, genre: ar.genre,
                                  track_number: ar.track_number, cover_url: ar.cover_url,
                                  rename: true, new_stem: userInput.trim(),
                                });
                                const r = JSON.parse(await invoke<string>("process_file", { action: "apply_audio_metadata", argsJson }));
                                if (r.ok) {
                                  const newPath = r.new_path || ar.path;
                                  const newName = r.new_name || item.name;
                                  pushAudioUndo([{ itemId: item.id, old_path: ar.path, new_path: newPath, old_name: item.name, new_name: newName }]);
                                  setAudioResult(item.id, { ...ar, saved: true, new_path: newPath, new_name: newName });
                                  useZenithStore.setState((st) => ({
                                    items: st.items.map((it) => it.id === item.id ? { ...it, name: newName, path: newPath } : it),
                                  }));
                                  showToastMsg(`Saved → ${newName}`);
                                } else showToastMsg(`Save failed: ${r.error || "Unknown"}`);
                              } catch (e) { showToastMsg(`Save error: ${String(e)}`); }
                              finally { setProcessing(null); }
                            }}
                            className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 text-[10px] font-medium text-violet-300 hover:bg-violet-500/20 transition-all disabled:opacity-40"
                            title="Edit name before saving"
                          >
                            <i className="fa-solid fa-pen-fancy text-[8px]" />
                            Edit
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
              {audioResult?.saved && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-1">
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
                      <i className="fa-solid fa-circle-check text-[9px] text-emerald-400" />
                      <span className="text-[9px] text-emerald-300/70">Saved: {audioResult.artist} — {audioResult.title}</span>
                      <button onClick={() => setAudioResult(item.id, null)} className="ml-auto text-[10px] text-white/20 hover:text-white/40"><i className="fa-solid fa-xmark text-[8px]" /></button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Action Result Drawer (with Rename button for recognition results) */}
            <AnimatePresence>
              {actionResult && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <i className={`text-[9px] ${recognitionData ? "fa-solid fa-music text-emerald-400" : "fa-solid fa-sparkles text-cyan-400"}`} />
                      <span className="text-[10px] font-medium text-white/50">{actionResult.label}</span>
                      <div className="ml-auto flex gap-1">
                        <button
                          onClick={async () => { await navigator.clipboard.writeText(actionResult.text); showToastMsg("Copied!"); }}
                          className="px-1.5 py-0.5 rounded text-[9px] font-medium text-cyan-300 hover:bg-cyan-500/15 transition-colors"
                          title="Copy to clipboard"
                        ><i className="fa-regular fa-copy text-[8px] mr-0.5" />Copy</button>
                        <button
                          onClick={() => { setActionResult(null); setRecognitionData(null); handleAction(actionResult.action); }}
                          className="px-1.5 py-0.5 rounded text-[9px] font-medium text-amber-300 hover:bg-amber-500/15 transition-colors"
                          title="Retry this action"
                        ><i className="fa-solid fa-rotate-right text-[8px] mr-0.5" />Retry</button>
                        <button onClick={() => { setActionResult(null); setRecognitionData(null); }} className="px-1 py-0.5 text-[10px] text-white/30 hover:text-white/60"><i className="fa-solid fa-xmark text-[9px]" /></button>
                      </div>
                    </div>
                    {actionResult.text.length > 500 ? (
                      <Carousel
                        baseWidth={280}
                        items={actionResult.text.match(/[\s\S]{1,480}/g)?.map((chunk, i, arr) => ({
                          id: i,
                          content: (
                            <div className="rounded-lg bg-black/20 border border-white/5 p-2 h-28 overflow-y-auto">
                              <pre className="text-[11px] text-white/70 whitespace-pre-wrap break-words font-mono leading-relaxed">{chunk}</pre>
                              <div className="text-[8px] text-white/20 text-right mt-1">{i + 1}/{arr.length}</div>
                            </div>
                          ),
                        })) ?? []}
                      />
                    ) : (
                      <div className="max-h-32 overflow-y-auto rounded-lg bg-black/20 border border-white/5 p-2">
                        <pre className="text-[11px] text-white/70 whitespace-pre-wrap break-words font-mono leading-relaxed">{actionResult.text}</pre>
                      </div>
                    )}
                    {/* Recognition-specific: Rename with recognized info */}
                    {recognitionData && recognitionData.title && (
                      <div className="flex gap-1.5 mt-1.5">
                        <button
                          disabled={processing !== null}
                          onClick={async () => {
                            const rd = recognitionData;
                            const newStem = rd.artist ? `${rd.artist} - ${rd.title}` : rd.title;
                            setProcessing("apply_rename");
                            try {
                              const r = JSON.parse(await invoke<string>("apply_rename", { oldPath: item.path, newStem }));
                              if (r.renamed) {
                                showToastMsg(`Renamed → ${r.new_name}`);
                                useZenithStore.setState((st) => ({
                                  items: st.items.map((it) => it.id === item.id ? { ...it, name: r.new_name, path: r.new_path } : it),
                                }));
                                refreshRenameCounts();
                                setActionResult(null);
                                setRecognitionData(null);
                              } else showToastMsg(`Rename failed: ${r.reason || "Unknown"}`);
                            } catch (e) { showToastMsg(`Rename error: ${String(e)}`); }
                            finally { setProcessing(null); }
                          }}
                          className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/20 transition-all disabled:opacity-40"
                        >
                          <i className="fa-solid fa-pen text-[8px]" />
                          Rename to "{recognitionData.artist ? `${recognitionData.artist} - ${recognitionData.title}` : recognitionData.title}"
                        </button>
                        <button
                          disabled={processing !== null}
                          onClick={async () => {
                            const rd = recognitionData;
                            // Let user edit the name before applying
                            const suggested = rd.artist ? `${rd.artist} - ${rd.title}` : rd.title;
                            const userInput = prompt("Edit filename (stem only, extension preserved):", suggested);
                            if (!userInput || !userInput.trim()) return;
                            setProcessing("apply_rename");
                            try {
                              const r = JSON.parse(await invoke<string>("apply_rename", { oldPath: item.path, newStem: userInput.trim() }));
                              if (r.renamed) {
                                showToastMsg(`Renamed → ${r.new_name}`);
                                useZenithStore.setState((st) => ({
                                  items: st.items.map((it) => it.id === item.id ? { ...it, name: r.new_name, path: r.new_path } : it),
                                }));
                                refreshRenameCounts();
                                setActionResult(null);
                                setRecognitionData(null);
                              } else showToastMsg(`Rename failed: ${r.reason || "Unknown"}`);
                            } catch (e) { showToastMsg(`Rename error: ${String(e)}`); }
                            finally { setProcessing(null); }
                          }}
                          className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 text-[10px] font-medium text-violet-300 hover:bg-violet-500/20 transition-all disabled:opacity-40"
                          title="Edit the name before renaming"
                        >
                          <i className="fa-solid fa-pen-fancy text-[8px]" />
                          Edit & Rename
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* VirusTotal Scan Report */}
            <AnimatePresence>
              {vtReport && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <i className="fa-solid fa-shield-halved text-[9px]" style={{ color: (vtReport as Record<string,unknown>).verdict === "safe" ? "#22c55e" : (vtReport as Record<string,unknown>).verdict === "malicious" ? "#ef4444" : "#f59e0b" }} />
                      <span className="text-[10px] font-medium text-white/50">VirusTotal Report</span>
                      <div className="ml-auto flex gap-1">
                        <button onClick={() => handleAction((vtReport as Record<string,unknown>).scan_type === "file" ? "scan_virustotal_file" : "scan_virustotal_url")} className="px-1.5 py-0.5 rounded text-[9px] font-medium text-amber-300 hover:bg-amber-500/15 transition-colors" title="Re-scan"><i className="fa-solid fa-rotate-right text-[8px] mr-0.5" />Rescan</button>
                        <button onClick={() => setVtReport(null)} className="px-1 py-0.5 text-[10px] text-white/30 hover:text-white/60"><i className="fa-solid fa-xmark text-[9px]" /></button>
                      </div>
                    </div>
                    {(() => {
                      const rpt = vtReport as Record<string, unknown>;
                      const scanType = String(rpt.scan_type || "");
                      const verdict = rpt.verdict as string;
                      const mal = rpt.malicious as number;
                      const total = rpt.total as number;
                      const stats = rpt.stats as Record<string, number> | undefined;
                      const detections = (rpt.detections ?? []) as Array<{engine: string; category: string; result: string}>;
                      const verdictColor = verdict === "safe" ? "#22c55e" : verdict === "malicious" ? "#ef4444" : "#f59e0b";
                      const safeCount = total - mal;
                      const pct = total > 0 ? Math.round((safeCount / total) * 100) : 0;
                      return (
                        <div className="rounded-lg bg-black/20 border border-white/5 p-2 space-y-2 max-h-48 overflow-y-auto">
                          {/* Verdict bar */}
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: verdictColor }}>{verdict}</span>
                                <span className="text-[10px] text-white/40">{mal}/{total} flagged</span>
                              </div>
                              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: verdictColor }} />
                              </div>
                            </div>
                          </div>
                          {/* Stats breakdown */}
                          {stats && (
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                              {Object.entries(stats).filter(([,v]) => v > 0).map(([k, v]) => (
                                <span key={k} className="text-[9px] text-white/40"><span className={`font-medium ${k === "malicious" ? "text-red-400" : k === "suspicious" ? "text-amber-400" : k === "harmless" || k === "undetected" ? "text-emerald-400/70" : "text-white/30"}`}>{v}</span> {k}</span>
                              ))}
                            </div>
                          )}
                          {/* File metadata */}
                          {scanType === "file" && (
                            <div className="space-y-0.5 text-[9px] text-white/35 font-mono">
                              {Boolean(rpt.file_type) && <div><span className="text-white/50">Type:</span> {String(rpt.file_type)}</div>}
                              {Boolean(rpt.hash) && <div><span className="text-white/50">SHA-256:</span> {String(rpt.hash).substring(0, 16)}...</div>}
                              {Boolean(rpt.magic) && <div><span className="text-white/50">Magic:</span> {String(rpt.magic).substring(0, 60)}</div>}
                              {(rpt.tags as string[] | undefined)?.length ? <div><span className="text-white/50">Tags:</span> {(rpt.tags as string[]).join(", ")}</div> : null}
                            </div>
                          )}
                          {/* URL metadata */}
                          {scanType === "url" && (
                            <div className="space-y-0.5 text-[9px] text-white/35 font-mono">
                              {Boolean(rpt.title) && <div><span className="text-white/50">Title:</span> {String(rpt.title)}</div>}
                              {(rpt.categories as string[] | undefined)?.length ? <div><span className="text-white/50">Categories:</span> {(rpt.categories as string[]).join(", ")}</div> : null}
                            </div>
                          )}
                          {/* Community */}
                          {Boolean(rpt.community_votes) && (
                            <div className="text-[9px] text-white/35">
                              <span className="text-white/50">Community:</span>{" "}
                              <span className="text-emerald-400/70">{(rpt.community_votes as Record<string,number>).harmless}↑</span>{" "}
                              <span className="text-red-400/70">{(rpt.community_votes as Record<string,number>).malicious}↓</span>
                              {rpt.reputation != null && <span className="ml-2 text-white/50">Rep: {Number(rpt.reputation)}</span>}
                            </div>
                          )}
                          {/* Detections list */}
                          {detections.length > 0 && (
                            <div>
                              <div className="text-[9px] font-medium text-red-400/80 mb-0.5">Detections ({detections.length})</div>
                              <div className="space-y-px">
                                {detections.slice(0, 15).map((d) => (
                                  <div key={d.engine} className="flex items-center gap-1.5 text-[9px]">
                                    <span className="text-red-400">●</span>
                                    <span className="text-white/50 font-medium">{d.engine}</span>
                                    <span className="text-white/30 truncate">{d.result || d.category}</span>
                                  </div>
                                ))}
                                {detections.length > 15 && <div className="text-[9px] text-white/25 pl-3">+{detections.length - 15} more</div>}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute -top-7 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md bg-black/90 text-[10px] text-white/80 font-medium whitespace-nowrap z-50 pointer-events-none"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </SpotlightCard>
    </motion.div>
  );
}
