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
const MEDIA_EXTS = new Set(["mov", "avi", "mkv", "wmv", "flv", "webm", "m4v", "mp4", "mp3", "wav", "flac", "aac", "ogg", "wma"]);
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
    actions.push({ icon: "fa-solid fa-compress", label: "Compress", action: "compress_image", color: "#22d3ee" });
    actions.push({ icon: "fa-solid fa-expand", label: "Resize", action: "resize_image", color: "#06b6d4" });
    actions.push({ icon: "fa-solid fa-palette", label: "Palette", action: "extract_palette", color: "#ec4899" });
    actions.push({ icon: "fa-solid fa-eye-slash", label: "Strip EXIF", action: "strip_exif", color: "#f59e0b" });
    if (ext !== "webp") {
      actions.push({ icon: "fa-solid fa-arrow-right-arrow-left", label: "WebP", action: "convert_webp", color: "#8b5cf6" });
    }
    actions.push({ icon: "fa-solid fa-code", label: "Base64", action: "file_to_base64", color: "#6366f1" });
    actions.push({ icon: "fa-solid fa-font", label: "OCR", action: "ocr", color: "#14b8a6" });
    actions.push({ icon: "fa-solid fa-file-pdf", label: "OCR → PDF", action: "ocr_to_pdf", color: "#0ea5e9" });
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

  // ── Media conversion (FFmpeg) ──
  if (hasPath && MEDIA_EXTS.has(ext)) {
    actions.push({ icon: "fa-solid fa-film", label: "Convert", action: "convert_media", color: "#a855f7" });
  }

  // ── Security scan (ALL files and folders) ──
  if (hasPath) {
    actions.push({ icon: "fa-solid fa-shield-halved", label: "Scan", action: "scan_virustotal_file", color: "#22d3ee" });
  }

  // ── Universal file actions ──
  if (hasPath) {
    actions.push({ icon: "fa-solid fa-up-right-from-square", label: "Open", action: "open_file", color: "#34d399" });
    actions.push({ icon: "fa-solid fa-folder-open", label: "Reveal", action: "reveal_in_folder", color: "#60a5fa" });
    actions.push({ icon: "fa-solid fa-file-zipper", label: "Zip", action: "zip_file", color: "#eab308" });
    actions.push({ icon: "fa-solid fa-lock", label: "Zip + Encrypt", action: "zip_encrypt", color: "#f472b6" });
    actions.push({ icon: "fa-solid fa-scissors", label: "Split", action: "split_file", color: "#fb923c" });
    actions.push({ icon: "fa-solid fa-envelope", label: "Email", action: "email_files", color: "#a78bfa" });
    actions.push({ icon: "fa-solid fa-wand-magic-sparkles", label: "AI Rename", action: "smart_rename", color: "#c084fc" });
  }
  // ── Preview ──
  actions.push({ icon: "fa-solid fa-eye", label: "Preview", action: "preview_file", color: "#38bdf8" });
  actions.push({ icon: "fa-regular fa-copy", label: hasPath ? "Copy Path" : "Copy Text", action: "copy_path", color: "#64748b" });

  return actions;
}

export function StagedItemCard({ item, index }: Props) {
  const { removeItem, startDragOut, stageFile, toggleSelect, selectedIds, settings, trackTokenUsage, openPreview, setRenameState, cycleRenameSuggestion, renameStates, refreshRenameCounts } = useZenithStore();
  const renameState = renameStates[item.id] as RenameState | undefined;
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
    if (action === "email_files") { setEmailSubject(`Sending: ${item.name}`); setShowEmailPrompt(true); return; }
    if (action === "compress_image") { setShowCompressOpts(true); return; }
    if (action === "resize_image") { setShowResizeOpts(true); return; }
    if (action === "split_file") { setShowSplitOpts(true); return; }
    if (action === "translate_file") { setShowTranslateOpts(true); return; }
    if (action === "ask_data") { setShowAskPanel(true); return; }
    if (action === "file_to_base64") { setShowBase64Menu(true); return; }
    if (action === "convert_media") { setShowConvertMenu(true); return; }

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
        body: `Attached: ${item.name}`,
      });
      showToastMsg("Email client opened!");
    } catch (e) {
      showToastMsg(String(e));
    }
    setEmailTo("");
    setEmailSubject("");
  }, [item.path, item.name, emailTo, emailSubject, showToastMsg]);

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
      const resultStr = await invoke<string>("process_file", { action: "resize_image", argsJson: JSON.stringify(args) });
      const result = JSON.parse(resultStr);
      if (result.ok && result.path) {
        await stageFile(result.path);
        showToastMsg(`Resized to ${result.width}x${result.height}`);
      } else { showToastMsg(result.error || "Failed"); }
    } catch (e) { showToastMsg(String(e)); }
    finally { setProcessing(null); }
  }, [item.path, resizeWidth, resizeHeight, resizePct, stageFile, showToastMsg]);

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
      onMouseLeave={() => { setIsHovered(false); setShowMore(false); setShowTimer(false); setShowPasswordPrompt(false); setShowEmailPrompt(false); setShowCompressOpts(false); setShowResizeOpts(false); setShowSplitOpts(false); setShowTranslateOpts(false); setShowAskPanel(false); setShowBase64Menu(false); setShowConvertMenu(false); }}
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
                    <div className="flex items-center gap-1.5">
                      <i className="fa-solid fa-envelope text-[9px] text-violet-400" />
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
                        onKeyDown={(e) => e.key === "Enter" && handleEmailSend()}
                        className="flex-1 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[11px] text-white/80 placeholder:text-white/20 outline-none focus:border-violet-400/40 ml-[17px]"
                      />
                      <button
                        onClick={handleEmailSend}
                        className="px-2 py-1 rounded-md text-[10px] font-medium text-violet-300 hover:bg-violet-500/15 transition-colors"
                      >
                        Send
                      </button>
                      <button
                        onClick={() => { setShowEmailPrompt(false); setEmailTo(""); setEmailSubject(""); }}
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
                  <div className="px-3 pb-2 space-y-1">
                    <div className="flex items-center gap-1.5">
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

            {/* Palette result */}
            <AnimatePresence>
              {showPaletteResult && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <i className="fa-solid fa-palette text-[9px] text-pink-400" />
                      <span className="text-[10px] text-white/50">Extracted colors</span>
                      <div className="ml-auto flex gap-1">
                        <button
                          onClick={async () => {
                            const tw = "colors: {\n" + showPaletteResult.map(c => `  "${c.hex.slice(1)}": "${c.hex}",`).join("\n") + "\n}";
                            await navigator.clipboard.writeText(tw);
                            showToastMsg("Tailwind config copied!");
                          }}
                          className="px-1.5 py-0.5 rounded text-[9px] font-medium text-pink-300 hover:bg-pink-500/15 transition-colors"
                          title="Copy as Tailwind config"
                        >Export</button>
                        <button onClick={() => setShowPaletteResult(null)} className="px-1 py-0.5 text-[10px] text-white/30 hover:text-white/60"><i className="fa-solid fa-xmark text-[9px]" /></button>
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      {showPaletteResult.map((c, i) => (
                        <button key={i} onClick={async () => { await navigator.clipboard.writeText(c.hex); showToastMsg(`Copied ${c.hex}`); }}
                          className="relative group/color flex flex-col items-center gap-0.5 cursor-pointer" title={`${c.hex} — Click to copy`}>
                          <div className="w-8 h-8 rounded-lg border border-white/10 shadow-sm" style={{ background: c.hex }} />
                          {!c.wcag_on_white && !c.wcag_on_black && (
                            <span className="absolute -top-1 -right-1 text-[7px] text-amber-400">⚠</span>
                          )}
                          <span className="text-[8px] text-white/40 font-mono">{c.hex}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Base64 format menu */}
            <AnimatePresence>
              {showBase64Menu && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2 flex items-center gap-1">
                    <i className="fa-solid fa-code text-[9px] text-indigo-400" />
                    {[
                      { label: "Raw", fmt: "raw" },
                      { label: "HTML <img>", fmt: "html_img" },
                      { label: "CSS url()", fmt: "css_url" },
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
                    <button onClick={() => setShowBase64Menu(false)} className="px-1 py-1 text-[10px] text-white/30 hover:text-white/60 ml-auto"><i className="fa-solid fa-xmark text-[9px]" /></button>
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

            {/* Action Result Drawer */}
            <AnimatePresence>
              {actionResult && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="px-3 pb-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <i className="fa-solid fa-sparkles text-[9px] text-cyan-400" />
                      <span className="text-[10px] font-medium text-white/50">{actionResult.label}</span>
                      <div className="ml-auto flex gap-1">
                        <button
                          onClick={async () => { await navigator.clipboard.writeText(actionResult.text); showToastMsg("Copied!"); }}
                          className="px-1.5 py-0.5 rounded text-[9px] font-medium text-cyan-300 hover:bg-cyan-500/15 transition-colors"
                          title="Copy to clipboard"
                        ><i className="fa-regular fa-copy text-[8px] mr-0.5" />Copy</button>
                        <button
                          onClick={() => { setActionResult(null); handleAction(actionResult.action); }}
                          className="px-1.5 py-0.5 rounded text-[9px] font-medium text-amber-300 hover:bg-amber-500/15 transition-colors"
                          title="Retry this action"
                        ><i className="fa-solid fa-rotate-right text-[8px] mr-0.5" />Retry</button>
                        <button onClick={() => setActionResult(null)} className="px-1 py-0.5 text-[10px] text-white/30 hover:text-white/60"><i className="fa-solid fa-xmark text-[9px]" /></button>
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
