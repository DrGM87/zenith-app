import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { motion, AnimatePresence } from "framer-motion";
import { AuroraBg } from "./research/effects/AuroraBg";
import { GlowOrbs } from "./research/effects/GlowOrbs";
import { SpotlightCard } from "./research/effects/SpotlightCard";
import { ClickSpark } from "./research/effects/ClickSpark";
import { ShinyText } from "./research/effects/ShinyText";
import { GlareHover } from "./research/effects/GlareHover";
import { StarBorder } from "./research/effects/StarBorder";
import { FloatingParticles } from "./research/effects/FloatingParticles";
import { PRICING } from "./research/shared/constants";

// ── Types ────────────────────────────────────────────────────────────────────

interface ApiKeyEntry { provider: string; label: string; key: string; model: string; is_default: boolean; }
interface ZenithSettings {
  api_keys: ApiKeyEntry[];
  vt_api_key: string; omdb_api_key: string; audiodb_api_key: string; imdb_api_key: string;
  token_usage?: TokenUsage;
  [key: string]: unknown;
}
interface TokenUsageEntry { provider: string; input_tokens: number; output_tokens: number; cost_usd: number; }
interface TokenUsage { entries: TokenUsageEntry[]; total_input_tokens: number; total_output_tokens: number; total_cost_usd: number; }

interface HistoryItem {
  id: string;
  imageB64: string;
  prompt: string;
  title: string;
  timestamp: number;
  cost: number;
  model: string;
}

interface ItemMeta {
  id: string; prompt: string; title: string; timestamp: number;
  cost: number; model: string; filePath: string;
}

interface EditorThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  totalCost: number;
  imageCount: number;
}

interface SavedPrompt { id: string; name: string; text: string; }

type ModelId = "gemini-3.1-flash-image-preview" | "gemini-3-pro-image-preview" | "gpt-image-1.5";
type AspectRatio = "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9";
type ImageSize = "512" | "1K" | "2K" | "4K";
type ImageStyle = "photorealistic" | "digital_art" | "vector" | "anime" | "watercolor" | "oil_painting" | "3d_render" | "pixel_art" | "sketch" | "";
type SaveFormat = "png" | "jpg" | "webp";
type LeftTab = "threads" | "images";
type ThinkingLevel = "minimal" | "low" | "medium" | "high";

// ── Constants ─────────────────────────────────────────────────────────────────

const MODELS: { id: ModelId; label: string; desc: string; provider: "google" | "openai"; cost: number }[] = [
  { id: "gemini-3.1-flash-image-preview", label: "Nano Banana 2",  desc: "Fast · High quality · Google", provider: "google", cost: 0.067 },
  { id: "gemini-3-pro-image-preview",     label: "Nano Banana Pro", desc: "Deep reasoning · Google",     provider: "google", cost: 0.134 },
  { id: "gpt-image-1.5",                  label: "GPT-Image 1.5",  desc: "Ultra-realistic · OpenAI",    provider: "openai", cost: 0.133 },
];

const GEMINI_ASPECT_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: "1:1", label: "1:1" }, { value: "2:3", label: "2:3" }, { value: "3:2", label: "3:2" },
  { value: "3:4", label: "3:4" }, { value: "4:3", label: "4:3" }, { value: "4:5", label: "4:5" },
  { value: "5:4", label: "5:4" }, { value: "9:16", label: "9:16" }, { value: "16:9", label: "16:9" },
  { value: "21:9", label: "21:9" },
];
const OPENAI_ASPECT_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: "1:1", label: "1:1" }, { value: "16:9", label: "16:9" }, { value: "9:16", label: "9:16" },
];
const OPENAI_VALID_ASPECTS = new Set<AspectRatio>(["1:1", "16:9", "9:16"]);

const IMAGE_SIZE_OPTIONS: { value: ImageSize; label: string; desc: string }[] = [
  { value: "512", label: "512", desc: "Fast preview" }, { value: "1K", label: "1K", desc: "Standard" },
  { value: "2K", label: "2K", desc: "High detail" }, { value: "4K", label: "4K", desc: "Maximum quality" },
];
const STYLE_OPTIONS: { value: ImageStyle; label: string; icon: string }[] = [
  { value: "",               label: "None",       icon: "fa-ban" },
  { value: "photorealistic", label: "Photo",       icon: "fa-camera" },
  { value: "digital_art",   label: "Digital Art",  icon: "fa-palette" },
  { value: "vector",        label: "Vector",       icon: "fa-bezier-curve" },
  { value: "anime",         label: "Anime",        icon: "fa-star" },
  { value: "watercolor",    label: "Watercolor",   icon: "fa-droplet" },
  { value: "oil_painting",  label: "Oil Paint",    icon: "fa-brush" },
  { value: "3d_render",     label: "3D Render",    icon: "fa-cube" },
  { value: "pixel_art",     label: "Pixel Art",    icon: "fa-chess-board" },
  { value: "sketch",        label: "Sketch",       icon: "fa-pencil" },
];
const THINKING_OPTIONS: { value: ThinkingLevel; label: string }[] = [
  { value: "minimal", label: "Min" },
  { value: "low",     label: "Low" },
  { value: "medium",  label: "Med" },
  { value: "high",    label: "High" },
];

const PROMPTS_KEY   = "zenith_editor_prompts";
const THREADS_KEY   = "zenith_editor_threads";
const ACTIVE_KEY    = "zenith_editor_active_thread";
const THEME_KEY     = "zenith_editor_theme";
const EFFECTS_KEY   = "zenith_editor_effects";
const MAX_ITEMS_PER_THREAD = 50;
const BG_REMOVAL_TOLERANCE = 40;
const itemsKey = (tid: string) => `zenith_editor_items_${tid}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function fmtTime(ts: number): string { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function fmtDate(ts: number): string {
  const d = new Date(ts); const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function fmtCost(n: number): string { return `$${n.toFixed(3)}`; }
const IMAGE_MODEL_IDS: Set<string> = new Set(MODELS.map((m) => m.id));

// ── Thread Persistence ───────────────────────────────────────────────────────

function loadThreads(): EditorThread[] {
  try { const r = localStorage.getItem(THREADS_KEY); return r ? JSON.parse(r) : []; } catch { return []; }
}
function persistThreads(threads: EditorThread[]) {
  try { localStorage.setItem(THREADS_KEY, JSON.stringify(threads)); } catch { /* quota */ }
}
function loadItemMetas(threadId: string): ItemMeta[] {
  try { const r = localStorage.getItem(itemsKey(threadId)); return r ? JSON.parse(r) : []; } catch { return []; }
}
function persistItemMetas(threadId: string, metas: ItemMeta[]) {
  try { localStorage.setItem(itemsKey(threadId), JSON.stringify(metas.slice(0, MAX_ITEMS_PER_THREAD))); } catch { /* quota */ }
}
function deleteThreadStorage(threadId: string) {
  try { localStorage.removeItem(itemsKey(threadId)); } catch { /* ok */ }
}

async function saveItemToDisk(item: HistoryItem): Promise<string | null> {
  try {
    const r = JSON.parse(await invoke<string>("process_file", {
      action: "save_editor_image",
      argsJson: JSON.stringify({ image_b64: item.imageB64, format: "png", quality: 100, filename: `hist_${item.id}` }),
    }));
    return r.ok ? r.path : null;
  } catch { return null; }
}

async function loadThreadImages(threadId: string): Promise<HistoryItem[]> {
  const metas = loadItemMetas(threadId);
  const items: HistoryItem[] = [];
  for (const m of metas) {
    try {
      const b64 = await invoke<string>("read_file_base64", { path: m.filePath });
      items.push({ id: m.id, imageB64: b64, prompt: m.prompt, title: m.title, timestamp: m.timestamp, cost: m.cost, model: m.model });
    } catch { /* file gone — skip */ }
  }
  return items;
}

function createThread(title?: string): EditorThread {
  return { id: uid(), title: title || "Untitled", createdAt: Date.now(), updatedAt: Date.now(), totalCost: 0, imageCount: 0 };
}

// ── Cost Tracking ────────────────────────────────────────────────────────────

async function trackImageCost(provider: string, cost: number) {
  try {
    const s = await invoke<ZenithSettings>("get_settings");
    const tu = s.token_usage ?? { entries: [], total_input_tokens: 0, total_output_tokens: 0, total_cost_usd: 0 };
    const entries = [...tu.entries];
    const idx = entries.findIndex((e) => e.provider === provider);
    if (idx >= 0) entries[idx] = { ...entries[idx], cost_usd: entries[idx].cost_usd + cost };
    else entries.push({ provider, input_tokens: 0, output_tokens: 0, cost_usd: cost });
    await invoke("save_settings", { newSettings: { ...s, token_usage: { entries, total_input_tokens: tu.total_input_tokens, total_output_tokens: tu.total_output_tokens, total_cost_usd: tu.total_cost_usd + cost } } });
  } catch (e) { console.error("trackImageCost:", e); }
}

async function trackTextTokenUsage(result: { token_usage?: { provider: string; model: string; input_tokens: number; output_tokens: number } }) {
  if (!result.token_usage) return;
  const { provider, model, input_tokens, output_tokens } = result.token_usage;
  if (!input_tokens && !output_tokens) return;
  try {
    const s = await invoke<ZenithSettings>("get_settings");
    const rates = PRICING[provider]?.[model] ?? { input: 1.00, output: 2.00 };
    const cost = (input_tokens / 1_000_000) * rates.input + (output_tokens / 1_000_000) * rates.output;
    const tu = s.token_usage ?? { entries: [], total_input_tokens: 0, total_output_tokens: 0, total_cost_usd: 0 };
    const entries = [...tu.entries];
    const idx = entries.findIndex((e) => e.provider === provider);
    if (idx >= 0) entries[idx] = { ...entries[idx], input_tokens: entries[idx].input_tokens + input_tokens, output_tokens: entries[idx].output_tokens + output_tokens, cost_usd: entries[idx].cost_usd + cost };
    else entries.push({ provider, input_tokens, output_tokens, cost_usd: cost });
    await invoke("save_settings", { newSettings: { ...s, token_usage: { entries, total_input_tokens: tu.total_input_tokens + input_tokens, total_output_tokens: tu.total_output_tokens + output_tokens, total_cost_usd: tu.total_cost_usd + cost } } });
  } catch (e) { console.error("trackTextTokenUsage:", e); }
}

// ══════════════════════════════════════════════════════════════════════════════
// ██  COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

export function ZenithEditor() {
  // ── Settings
  const [settings, setSettings] = useState<ZenithSettings | null>(null);

  // ── Theme & effects
  const [editorTheme, setEditorTheme] = useState<"dark" | "light">(() => {
    try { return (localStorage.getItem(THEME_KEY) as "dark" | "light") || "dark"; } catch { return "dark"; }
  });
  const [effectsEnabled, setEffectsEnabled] = useState<boolean>(() => {
    try { const v = localStorage.getItem(EFFECTS_KEY); return v === null ? true : v === "true"; } catch { return true; }
  });

  // ── Image state
  const [currentImageB64, setCurrentImageB64] = useState<string | null>(null);
  const [originalImageB64, setOriginalImageB64] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);

  // ── Threads & History
  const [threads, setThreads] = useState<EditorThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [leftTab, setLeftTab] = useState<LeftTab>("threads");
  const [threadSwitching, setThreadSwitching] = useState(false);
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // ── Model + params
  const [selectedModel, setSelectedModel] = useState<ModelId>("gemini-3.1-flash-image-preview");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [imageSize, setImageSize] = useState<ImageSize>("1K");
  const [imageStyle, setImageStyle] = useState<ImageStyle>("");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("minimal");
  const [resolution, setResolution] = useState<"standard" | "hd">("standard");
  const [adherence, setAdherence] = useState(70);

  // ── Session cost
  const [sessionCost, setSessionCost] = useState(0);

  // ── Prompt & generation
  const [prompt, setPrompt] = useState("");
  const [negPrompt, setNegPrompt] = useState("");
  const [showNegPrompt, setShowNegPrompt] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastPrompt, setLastPrompt] = useState("");
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [promptHistoryIdx, setPromptHistoryIdx] = useState(-1);
  const [preEnhancePrompt, setPreEnhancePrompt] = useState<string | null>(null);
  const abortRef = useRef(false);
  const bgGeneratingRef = useRef(false);

  // ── Prompt library
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [showPromptLib, setShowPromptLib] = useState(false);
  const [promptLibName, setPromptLibName] = useState("");
  const promptLibBtnRef = useRef<HTMLButtonElement>(null);

  // ── Save options
  const [showSaveOptions, setShowSaveOptions] = useState(false);
  const [saveFormat, setSaveFormat] = useState<SaveFormat>("png");
  const [saveQuality, setSaveQuality] = useState(92);

  // ── Background removal
  const [isRemovingBg, setIsRemovingBg] = useState(false);

  // ── UI
  const [toast, setToast] = useState<{ msg: string; type?: "warn" | "ok" | "err" } | null>(null);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [expandedImageId, setExpandedImageId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // ── Derived state
  const isBlankCanvas = history.length === 0 && !originalImageB64;
  const currentModel = MODELS.find((m) => m.id === selectedModel) ?? MODELS[0];
  const isGoogleModel = currentModel.provider === "google";
  const chatHistory = useMemo(() => [...history].reverse(), [history]);
  const canUndo = history.length > 0 && historyIndex < history.length - 1;
  const canRedo = historyIndex > 0;

  const showToast = useCallback((msg: string, type?: "warn" | "ok" | "err", ms = 3500) => {
    setToast({ msg, type }); setTimeout(() => setToast(null), ms);
  }, []);

  // ── Theme persistence
  const toggleTheme = useCallback(() => {
    setEditorTheme((t) => { const n = t === "dark" ? "light" : "dark"; localStorage.setItem(THEME_KEY, n); return n; });
  }, []);
  const toggleEffects = useCallback(() => {
    setEffectsEnabled((e) => { localStorage.setItem(EFFECTS_KEY, String(!e)); return !e; });
  }, []);

  // ── Active thread helper
  const activeThread = useMemo(() => threads.find((t) => t.id === activeThreadId) ?? null, [threads, activeThreadId]);

  const syncActiveThread = useCallback((hist: HistoryItem[], cost: number) => {
    if (!activeThreadId) return;
    setThreads((prev) => {
      const updated = prev.map((t) =>
        t.id === activeThreadId
          ? { ...t, updatedAt: Date.now(), totalCost: cost, imageCount: hist.length,
              title: t.title === "Untitled" && hist.length > 0 && hist[0].title !== "Generating title…" ? hist[0].title : t.title }
          : t,
      );
      persistThreads(updated);
      return updated;
    });
  }, [activeThreadId]);

  // ── Load settings
  const loadSettings = useCallback(() => { invoke<ZenithSettings>("get_settings").then(setSettings).catch(() => {}); }, []);
  useEffect(() => {
    loadSettings();
    const onFocus = () => loadSettings();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadSettings]);

  // ── Load prompts
  useEffect(() => { try { const r = localStorage.getItem(PROMPTS_KEY); if (r) setSavedPrompts(JSON.parse(r)); } catch {} }, []);
  const savePromptsToStorage = useCallback((p: SavedPrompt[]) => { localStorage.setItem(PROMPTS_KEY, JSON.stringify(p)); setSavedPrompts(p); }, []);

  // ── Initialize threads on mount
  useEffect(() => {
    let saved = loadThreads();
    const lastActive = localStorage.getItem(ACTIVE_KEY);
    if (saved.length === 0) { const first = createThread(); saved = [first]; persistThreads(saved); }
    setThreads(saved);
    const startId = (lastActive && saved.some((t) => t.id === lastActive)) ? lastActive : saved[0].id;
    setActiveThreadId(startId);
    localStorage.setItem(ACTIVE_KEY, startId);
    loadThreadImages(startId).then((items) => {
      if (items.length > 0) {
        setHistory(items); setHistoryIndex(0); setCurrentImageB64(items[0].imageB64); setSessionCost(items.reduce((s, i) => s + i.cost, 0));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load initial image from Stage
  useEffect(() => {
    invoke<string>("take_pending_editor_image").then(async (path) => {
      if (path) {
        try { const b64 = await invoke<string>("read_file_base64", { path }); setCurrentImageB64(b64); setOriginalImageB64(b64); }
        catch (e) { showToast(`Failed to load image: ${String(e)}`, "err"); }
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Listen for editor-load-image
  useEffect(() => {
    const unlisten = listen<string>("editor-load-image", async (ev) => {
      const path = ev.payload;
      if (!path) { setCurrentImageB64(null); setOriginalImageB64(null); return; }
      try { const b64 = await invoke<string>("read_file_base64", { path }); setCurrentImageB64(b64); setOriginalImageB64(b64); }
      catch (e) { showToast(`Failed to load image: ${String(e)}`, "err"); }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [showToast]);

  // ── Auto-scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history.length, isGenerating]);

  // ── Focus rename input when it appears
  useEffect(() => { if (renamingThreadId) setTimeout(() => renameInputRef.current?.focus(), 50); }, [renamingThreadId]);

  // ── Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowSaveOptions(false); setShowResetConfirm(false); setShowPromptLib(false);
        setRenamingThreadId(null); setExpandedImageId(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUndo, canRedo, historyIndex, history]);

  // ── API key helpers
  const getApiCreds = useCallback(() => {
    const mi = MODELS.find((m) => m.id === selectedModel);
    const prov = mi?.provider ?? "google";
    const keys = settings?.api_keys ?? [];
    const entry = keys.find((k) => k.provider === prov && k.is_default) ?? keys.find((k) => k.provider === prov);
    return { api_key: entry?.key ?? "", provider: prov, model: selectedModel, hasKey: !!entry?.key };
  }, [settings, selectedModel]);

  const getTextLlmCreds = useCallback(() => {
    const keys = settings?.api_keys ?? [];
    const def = keys.find((k) => k.is_default && !IMAGE_MODEL_IDS.has(k.model))
             ?? keys.find((k) => !IMAGE_MODEL_IDS.has(k.model))
             ?? keys.find((k) => k.is_default) ?? keys[0];
    return def ? { api_key: def.key, provider: def.provider, model: def.model } : { api_key: "", provider: "google", model: "" };
  }, [settings]);

  const apiStatus = getApiCreds();

  // ── Model switch — reset aspect ratio if invalid for new model
  const handleModelChange = useCallback((newModel: ModelId) => {
    setSelectedModel(newModel);
    const newProvider = MODELS.find((m) => m.id === newModel)?.provider;
    if (newProvider === "openai" && !OPENAI_VALID_ASPECTS.has(aspectRatio)) {
      setAspectRatio("1:1");
    }
  }, [aspectRatio]);

  // ── Undo / Redo
  const handleUndo = useCallback(() => {
    if (!canUndo) return;
    const ni = historyIndex + 1; setHistoryIndex(ni); setCurrentImageB64(history[ni].imageB64);
  }, [canUndo, historyIndex, history]);
  const handleRedo = useCallback(() => {
    if (!canRedo) return;
    const ni = historyIndex - 1; setHistoryIndex(ni); setCurrentImageB64(history[ni].imageB64);
  }, [canRedo, historyIndex, history]);

  // ── Copy to clipboard
  const handleCopyImage = useCallback(async (b64?: string) => {
    const data = b64 ?? currentImageB64;
    if (!data) { showToast("No image to copy"); return; }
    try {
      const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      showToast("Image copied to clipboard!", "ok");
    } catch { showToast("Clipboard access denied", "err"); }
  }, [currentImageB64, showToast]);

  // ── Thread Operations
  const handleNewCanvas = useCallback(() => {
    syncActiveThread(history, sessionCost);
    const t = createThread();
    setThreads((prev) => { const up = [t, ...prev]; persistThreads(up); return up; });
    setActiveThreadId(t.id); localStorage.setItem(ACTIVE_KEY, t.id);
    setHistory([]); setHistoryIndex(-1); setCurrentImageB64(null); setOriginalImageB64(null);
    setSessionCost(0); setLastPrompt(""); setPrompt(""); setNegPrompt(""); setLeftTab("images");
    showToast("New canvas created", "ok");
    promptRef.current?.focus();
  }, [history, sessionCost, syncActiveThread, showToast]);

  const switchThread = useCallback(async (threadId: string) => {
    if (threadId === activeThreadId || threadSwitching) return;
    setThreadSwitching(true);
    syncActiveThread(history, sessionCost);
    const items = await loadThreadImages(threadId);
    setActiveThreadId(threadId); localStorage.setItem(ACTIVE_KEY, threadId);
    setHistory(items);
    if (items.length > 0) { setHistoryIndex(0); setCurrentImageB64(items[0].imageB64); }
    else { setHistoryIndex(-1); setCurrentImageB64(null); }
    setOriginalImageB64(null); setSessionCost(items.reduce((s, i) => s + i.cost, 0));
    setLastPrompt(""); setPrompt(""); setLeftTab("images");
    setThreadSwitching(false);
  }, [activeThreadId, threadSwitching, history, sessionCost, syncActiveThread]);

  const deleteThread = useCallback((threadId: string) => {
    deleteThreadStorage(threadId);
    setThreads((prev) => {
      const filtered = prev.filter((t) => t.id !== threadId);
      if (threadId === activeThreadId) {
        if (filtered.length > 0) {
          const next = filtered[0]; setActiveThreadId(next.id); localStorage.setItem(ACTIVE_KEY, next.id);
          loadThreadImages(next.id).then((items) => {
            setHistory(items); setHistoryIndex(items.length > 0 ? 0 : -1);
            setCurrentImageB64(items.length > 0 ? items[0].imageB64 : null);
            setSessionCost(items.reduce((s, i) => s + i.cost, 0));
          });
        } else {
          const fresh = createThread(); filtered.push(fresh);
          setActiveThreadId(fresh.id); localStorage.setItem(ACTIVE_KEY, fresh.id);
          setHistory([]); setHistoryIndex(-1); setCurrentImageB64(null); setSessionCost(0);
        }
      }
      persistThreads(filtered); return filtered;
    });
    showToast("Thread deleted");
  }, [activeThreadId, showToast]);

  const commitRename = useCallback(() => {
    if (!renamingThreadId || !renameValue.trim()) { setRenamingThreadId(null); return; }
    setThreads((prev) => {
      const up = prev.map((t) => t.id === renamingThreadId ? { ...t, title: renameValue.trim() } : t);
      persistThreads(up); return up;
    });
    setRenamingThreadId(null);
  }, [renamingThreadId, renameValue]);

  const handleReset = useCallback(async () => {
    setShowResetConfirm(false);
    for (const t of threads) deleteThreadStorage(t.id);
    const fresh = createThread(); setThreads([fresh]); persistThreads([fresh]);
    setActiveThreadId(fresh.id); localStorage.setItem(ACTIVE_KEY, fresh.id);
    setHistory([]); setHistoryIndex(-1); setCurrentImageB64(null); setOriginalImageB64(null);
    setSessionCost(0); setLastPrompt(""); setPrompt(""); setNegPrompt(""); setLeftTab("threads");
    try { await invoke<string>("process_file", { action: "reset_editor", argsJson: "{}" }); } catch {}
    showToast("All threads cleared");
  }, [threads, showToast]);

  // ── Delete individual history item
  const deleteHistoryItem = useCallback((itemId: string) => {
    setHistory((prev) => {
      const idx = prev.findIndex((x) => x.id === itemId);
      const filtered = prev.filter((x) => x.id !== itemId);
      if (historyIndex >= idx && historyIndex > 0) setHistoryIndex((i) => i - 1);
      if (filtered.length > 0) setCurrentImageB64(filtered[Math.min(historyIndex, filtered.length - 1)]?.imageB64 ?? null);
      else { setCurrentImageB64(null); setHistoryIndex(-1); }
      if (activeThreadId) {
        const metas = loadItemMetas(activeThreadId).filter((m) => m.id !== itemId);
        persistItemMetas(activeThreadId, metas);
      }
      return filtered;
    });
  }, [historyIndex, activeThreadId]);

  // ── Generate image
  const handleSend = useCallback(async (retryPrompt?: string) => {
    const p = retryPrompt ?? prompt.trim();
    if (!p) { showToast("Enter a prompt first"); return; }
    const { api_key, provider } = getApiCreds();
    if (!api_key) { showToast(`No ${provider} API key found. Add one in Settings > API Keys.`, "err"); return; }

    setIsGenerating(true); abortRef.current = false; bgGeneratingRef.current = false;
    setLastPrompt(p);
    if (!retryPrompt && p) setPromptHistory((h) => [p, ...h.slice(0, 49)]);
    setPromptHistoryIdx(-1);

    try {
      const args: Record<string, unknown> = {
        model: selectedModel, prompt: p, api_key, provider,
        aspect_ratio: aspectRatio, style: imageStyle || undefined,
      };
      if (negPrompt.trim()) args.negative_prompt = negPrompt.trim();
      if (provider === "google") {
        args.image_size = imageSize;
        if (selectedModel === "gemini-3.1-flash-image-preview") args.thinking_level = thinkingLevel;
      }
      if (provider === "openai") {
        args.quality = resolution;
        if (adherence !== 70) args.adherence = adherence;
      }
      if (currentImageB64) args.image_b64 = currentImageB64;

      const resultStr = await invoke<string>("process_file", { action: "generate_image", argsJson: JSON.stringify(args) });

      if (abortRef.current) {
        bgGeneratingRef.current = true;
        showToast("Cancelled — generation still running in background", "warn", 5000);
        return;
      }
      const result = JSON.parse(resultStr);
      if (!result.ok || !result.image_b64) { showToast(result.error || "Generation failed", "err"); return; }

      const newB64: string = result.image_b64;
      const cost: number = result.cost ?? currentModel.cost;

      setCurrentImageB64(newB64);
      const newSessionCost = sessionCost + cost;
      setSessionCost(newSessionCost);
      trackImageCost(provider, cost);

      const histItem: HistoryItem = { id: uid(), imageB64: newB64, prompt: p, title: "Generating title…", timestamp: Date.now(), cost, model: selectedModel };
      const newHist = [histItem, ...history];
      setHistory(newHist); setHistoryIndex(0); setLeftTab("images");

      // Save image to disk
      saveItemToDisk(histItem).then((filePath) => {
        if (filePath && activeThreadId) {
          const existing = loadItemMetas(activeThreadId);
          const meta: ItemMeta = { id: histItem.id, prompt: p, title: histItem.title, timestamp: histItem.timestamp, cost, model: selectedModel, filePath };
          persistItemMetas(activeThreadId, [meta, ...existing]);
        } else if (!filePath) {
          showToast("⚠ Image couldn't be saved to disk — it exists in this session only", "warn", 6000);
        }
      });

      // Auto-title (then sync thread metadata AFTER title is set)
      const titleArgs = { prompt: p, ...getTextLlmCreds() };
      invoke<string>("process_file", { action: "auto_title_prompt", argsJson: JSON.stringify(titleArgs) })
        .then((r) => {
          try {
            const tr = JSON.parse(r);
            if (tr.ok && tr.title) {
              const title = tr.title;
              setHistory((h) => { const up = h.map((x) => x.id === histItem.id ? { ...x, title } : x); return up; });
              if (activeThreadId) {
                const metas = loadItemMetas(activeThreadId);
                persistItemMetas(activeThreadId, metas.map((m) => m.id === histItem.id ? { ...m, title } : m));
              }
              setThreads((prev) => {
                const up = prev.map((t) => t.id === activeThreadId && t.title === "Untitled" ? { ...t, title } : t);
                persistThreads(up); return up;
              });
              syncActiveThread(newHist.map((x) => x.id === histItem.id ? { ...x, title } : x), newSessionCost);
            } else {
              syncActiveThread(newHist, newSessionCost);
            }
            trackTextTokenUsage(tr);
          } catch { syncActiveThread(newHist, newSessionCost); }
        }).catch(() => { syncActiveThread(newHist, newSessionCost); });

      if (!retryPrompt) setPrompt("");
    } catch (e) {
      if (!abortRef.current) showToast(`Error: ${String(e)}`, "err");
    } finally { setIsGenerating(false); }
  }, [prompt, negPrompt, getApiCreds, getTextLlmCreds, selectedModel, aspectRatio, imageSize, resolution, imageStyle, thinkingLevel, adherence, currentImageB64, showToast, history, sessionCost, activeThreadId, syncActiveThread, currentModel]);

  // ── Enhance prompt
  const handleEnhance = useCallback(async () => {
    if (!prompt.trim()) { showToast("Enter a rough prompt first"); return; }
    const { api_key, provider, model } = getTextLlmCreds();
    if (!api_key) { showToast("No API key found for text LLM. Add one in Settings.", "err"); return; }
    setIsEnhancing(true);
    const prev = prompt.trim();
    try {
      const r = JSON.parse(await invoke<string>("process_file", { action: "enhance_prompt", argsJson: JSON.stringify({ prompt: prev, api_key, provider, model }) }));
      if (r.ok && r.enhanced_prompt) {
        setPreEnhancePrompt(prev);
        setPrompt(r.enhanced_prompt);
        showToast("Prompt enhanced — click Revert to undo", "ok");
      } else showToast(r.error || "Enhancement failed", "err");
      trackTextTokenUsage(r);
    } catch (e) { showToast(String(e), "err"); }
    finally { setIsEnhancing(false); }
  }, [prompt, getTextLlmCreds, showToast]);

  // ── Save / Stage
  const handleSaveImage = useCallback(async () => {
    if (!currentImageB64) { showToast("Nothing to save"); return; }
    setShowSaveOptions(false);
    try {
      const r = JSON.parse(await invoke<string>("process_file", { action: "save_editor_image", argsJson: JSON.stringify({ image_b64: currentImageB64, format: saveFormat, quality: saveQuality, filename: `zenith_${Date.now()}` }) }));
      if (r.ok && r.path) { await invoke("stage_file", { path: r.path }); await emit("items-changed"); showToast(`Saved as ${saveFormat.toUpperCase()} — sent to Stage!`, "ok"); }
      else showToast(r.error || "Save failed", "err");
    } catch (e) { showToast(String(e), "err"); }
  }, [currentImageB64, saveFormat, saveQuality, showToast]);

  const handleSendToStage = useCallback(async (overrideB64?: string) => {
    const b64 = overrideB64 ?? currentImageB64;
    if (!b64) { showToast("Nothing to send"); return; }
    try {
      const r = JSON.parse(await invoke<string>("process_file", { action: "save_editor_image", argsJson: JSON.stringify({ image_b64: b64, format: "png", quality: 95, filename: `zenith_generated_${Date.now()}` }) }));
      if (r.ok && r.path) { await invoke("stage_file", { path: r.path }); await emit("items-changed"); showToast("Sent to Stage!", "ok"); }
      else showToast(r.error || "Failed", "err");
    } catch (e) { showToast(String(e), "err"); }
  }, [currentImageB64, showToast]);

  // ── Background removal
  const handleRemoveBackground = useCallback(async () => {
    if (!currentImageB64) { showToast("No image to remove background from"); return; }
    const { api_key, provider } = getApiCreds();
    if (!api_key) { showToast("No API key. Add one in Settings > API Keys.", "err"); return; }
    setIsRemovingBg(true);
    try {
      const resultStr = await invoke<string>("process_file", {
        action: "remove_background",
        argsJson: JSON.stringify({
          image_b64: currentImageB64, api_key,
          model: selectedModel.startsWith("gemini") ? selectedModel : "gemini-3.1-flash-image-preview",
          tolerance: BG_REMOVAL_TOLERANCE,
        }),
      });
      const result = JSON.parse(resultStr);
      if (!result.ok || !result.image_b64) { showToast(result.error || "Background removal failed", "err"); return; }
      const newB64: string = result.image_b64;
      const cost: number = result.cost ?? currentModel.cost;
      setCurrentImageB64(newB64);
      const newSessionCost = sessionCost + cost;
      setSessionCost(newSessionCost);
      trackImageCost(provider, cost);
      const histItem: HistoryItem = { id: uid(), imageB64: newB64, prompt: "Background removed", title: "BG Removed", timestamp: Date.now(), cost, model: selectedModel };
      const newHist = [histItem, ...history];
      setHistory(newHist); setHistoryIndex(0); setLeftTab("images");
      saveItemToDisk(histItem).then((filePath) => {
        if (filePath && activeThreadId) {
          const existing = loadItemMetas(activeThreadId);
          persistItemMetas(activeThreadId, [{ id: histItem.id, prompt: "Background removed", title: "BG Removed", timestamp: histItem.timestamp, cost, model: selectedModel, filePath }, ...existing]);
        }
      });
      syncActiveThread(newHist, newSessionCost);
      showToast("Background removed!", "ok");
    } catch (e) { showToast(`Error: ${String(e)}`, "err"); }
    finally { setIsRemovingBg(false); }
  }, [currentImageB64, getApiCreds, selectedModel, sessionCost, history, activeThreadId, syncActiveThread, showToast, currentModel]);

  // ── History navigation
  const loadHistoryItem = useCallback((item: HistoryItem) => {
    const idx = history.findIndex((h) => h.id === item.id);
    if (idx >= 0) { setHistoryIndex(idx); setCurrentImageB64(item.imageB64); }
  }, [history]);

  // ── Prompt library
  const handleImportPrompts = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json,.txt";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = reader.result as string;
          let imported: SavedPrompt[];
          if (file.name.endsWith(".json")) {
            const parsed = JSON.parse(text);
            if (!Array.isArray(parsed)) { showToast("Invalid format", "err"); return; }
            imported = parsed.map((p: { name?: string; text?: string }, i: number) => ({ id: uid(), name: p.name || `Imported ${i + 1}`, text: p.text || String(p) }));
          } else {
            imported = text.split("\n").filter((l: string) => l.trim()).map((line: string, i: number) => ({ id: uid(), name: `Imported ${i + 1}`, text: line.trim() }));
          }
          if (imported.length) { savePromptsToStorage([...imported, ...savedPrompts]); showToast(`Imported ${imported.length} prompts`, "ok"); }
        } catch { showToast("Parse error", "err"); }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [savedPrompts, savePromptsToStorage, showToast]);

  const saveCurrentPrompt = useCallback(() => {
    if (!promptLibName.trim() || !prompt.trim()) { showToast("Enter both a name and a prompt"); return; }
    savePromptsToStorage([{ id: uid(), name: promptLibName.trim(), text: prompt.trim() }, ...savedPrompts]);
    setPromptLibName(""); showToast("Prompt saved", "ok");
  }, [promptLibName, prompt, savedPrompts, savePromptsToStorage, showToast]);
  const deletePrompt = useCallback((id: string) => { savePromptsToStorage(savedPrompts.filter((p) => p.id !== id)); }, [savedPrompts, savePromptsToStorage]);

  // ── Prompt textarea key handler (arrow history)
  const handlePromptKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isGenerating) { e.preventDefault(); handleSend(); return; }
    if (e.key === "ArrowUp" && !prompt.trim() && promptHistory.length > 0) {
      e.preventDefault();
      const idx = Math.min(promptHistoryIdx + 1, promptHistory.length - 1);
      setPromptHistoryIdx(idx); setPrompt(promptHistory[idx]);
    }
    if (e.key === "ArrowDown" && promptHistoryIdx >= 0) {
      e.preventDefault();
      const idx = promptHistoryIdx - 1;
      if (idx < 0) { setPromptHistoryIdx(-1); setPrompt(""); }
      else { setPromptHistoryIdx(idx); setPrompt(promptHistory[idx]); }
    }
  }, [isGenerating, handleSend, prompt, promptHistory, promptHistoryIdx]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const isDark = editorTheme === "dark";

  return (
    <ClickSpark enabled={effectsEnabled}>
      <div
        className="flex flex-col h-screen w-screen overflow-hidden select-none relative"
        data-editor-theme={editorTheme}
        style={{ background: "var(--ed-bg)" }}
      >
        {/* Ambient glow layer */}
        {effectsEnabled && (
          <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
            <GlowOrbs enabled />
          </div>
        )}

        {/* ── HEADER ────────────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-4 py-2 border-b shrink-0 relative z-[60]"
          style={{ background: "var(--ed-header-bg)", borderColor: "var(--ed-border)", backdropFilter: "blur(20px)" }}
          data-tauri-drag-region
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: "linear-gradient(135deg, #8b5cf6, #ec4899)" }} />
              <ShinyText
                enabled={effectsEnabled}
                className="text-[13px] font-semibold tracking-wide"
                style={{ color: "var(--ed-text-1)" }}
                speed={4}
                baseColor={isDark ? "rgba(255,255,255,0.9)" : "rgba(15,23,42,0.9)"}
                shineColor={isDark ? "rgba(192,132,252,0.95)" : "rgba(124,58,237,0.95)"}
              >
                Zenith Editor
              </ShinyText>
            </div>
            {activeThread && (
              <span className="text-[11px] truncate max-w-40" style={{ color: "var(--ed-text-4)" }}>{activeThread.title}</span>
            )}
            {settings !== null && (
              apiStatus.hasKey
                ? <span className="flex items-center gap-1 text-[10px] text-emerald-400/70"><i className="fa-solid fa-circle-check text-[8px]" />{apiStatus.provider === "google" ? "Google" : "OpenAI"}</span>
                : <button onClick={() => invoke("open_settings").catch(() => {})} className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 transition-colors"><i className="fa-solid fa-triangle-exclamation text-[9px]" />No API key</button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* New Canvas */}
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={handleNewCanvas}
              aria-label="New canvas"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all border"
              style={{ color: "var(--ed-text-3)", borderColor: "var(--ed-border)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--ed-emerald)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--ed-emerald-border)"; (e.currentTarget as HTMLElement).style.background = "var(--ed-emerald-bg)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--ed-text-3)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--ed-border)"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              <i className="fa-solid fa-plus text-[9px]" />New Canvas
            </motion.button>

            <div className="w-px h-5" style={{ background: "var(--ed-border)" }} />

            {/* Remove BG */}
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={handleRemoveBackground} disabled={!currentImageB64 || isRemovingBg}
              aria-label="Remove background"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-30 border"
              style={{ color: currentImageB64 ? "rgba(244,114,182,0.9)" : "var(--ed-text-5)", borderColor: "var(--ed-border)" }}>
              {isRemovingBg ? <><i className="fa-solid fa-spinner fa-spin text-[9px]" />Removing…</> : <><i className="fa-solid fa-eraser text-[9px]" />Remove BG</>}
            </motion.button>

            {/* Send to Stage */}
            {currentImageB64 && !isGenerating && (
              <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                onClick={() => handleSendToStage()}
                aria-label="Send to Stage"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all border"
                style={{ color: "var(--ed-emerald)", borderColor: "var(--ed-emerald-border)", background: "var(--ed-emerald-bg)" }}>
                <i className="fa-solid fa-arrow-up-from-bracket text-[10px]" />Stage
              </motion.button>
            )}

            {/* Copy */}
            {currentImageB64 && (
              <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                onClick={() => handleCopyImage()}
                aria-label="Copy image to clipboard"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all border"
                style={{ color: "var(--ed-text-3)", borderColor: "var(--ed-border)" }}>
                <i className="fa-regular fa-copy text-[10px]" />Copy
              </motion.button>
            )}

            {/* Save */}
            <div className="relative">
              <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                onClick={() => setShowSaveOptions(!showSaveOptions)} disabled={!currentImageB64}
                aria-label="Save image" aria-expanded={showSaveOptions}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-30 border"
                style={{ background: currentImageB64 ? "var(--ed-violet-bg)" : "transparent", color: currentImageB64 ? "var(--ed-violet)" : "var(--ed-text-5)", borderColor: currentImageB64 ? "var(--ed-violet-border)" : "var(--ed-border)" }}>
                <i className="fa-solid fa-floppy-disk text-[10px]" />Save<i className={`fa-solid fa-chevron-${showSaveOptions ? "up" : "down"} text-[7px] opacity-50`} />
              </motion.button>
              <AnimatePresence>
                {showSaveOptions && (
                  <motion.div initial={{ opacity: 0, y: -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }}
                    className="absolute right-0 top-full mt-1 z-[60] rounded-xl p-3 space-y-2.5 w-56"
                    style={{ background: "var(--ed-modal-bg)", border: `1px solid var(--ed-modal-border)`, boxShadow: "0 20px 50px rgba(0,0,0,0.5)" }}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] w-14" style={{ color: "var(--ed-text-3)" }}>Format:</span>
                      <div className="flex gap-1">{(["png", "jpg", "webp"] as SaveFormat[]).map((f) => (
                        <button key={f} onClick={() => setSaveFormat(f)} className="px-2 py-0.5 rounded text-[9px] font-medium transition-colors uppercase"
                          style={{ background: saveFormat === f ? "var(--ed-violet-bg)" : "transparent", color: saveFormat === f ? "var(--ed-violet)" : "var(--ed-text-3)" }}>
                          {f}
                        </button>
                      ))}</div>
                    </div>
                    {saveFormat !== "png" && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] w-14" style={{ color: "var(--ed-text-3)" }}>Quality:</span>
                        <input type="range" min={50} max={100} value={saveQuality} onChange={(e) => setSaveQuality(Number(e.target.value))} className="flex-1 h-1 appearance-none rounded-full cursor-pointer" style={{ background: `linear-gradient(to right, rgba(139,92,246,0.6) ${saveQuality}%, rgba(255,255,255,0.08) ${saveQuality}%)` }} />
                        <span className="text-[10px] font-mono w-7 text-right" style={{ color: "var(--ed-violet)" }}>{saveQuality}%</span>
                      </div>
                    )}
                    <button onClick={handleSaveImage} className="w-full py-1.5 rounded-lg text-[11px] font-medium transition-colors border"
                      style={{ color: "var(--ed-violet)", borderColor: "var(--ed-violet-border)" }}>
                      <i className="fa-solid fa-download mr-1.5 text-[9px]" />Save & Send to Stage
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="w-px h-5" style={{ background: "var(--ed-border)" }} />

            {/* Theme toggle */}
            <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.94 }}
              onClick={toggleTheme}
              aria-label={`Switch to ${isDark ? "light" : "dark"} theme`} aria-pressed={!isDark}
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-all border"
              style={{ color: "var(--ed-text-3)", borderColor: "var(--ed-border)" }}>
              <i className={`fa-solid ${isDark ? "fa-sun" : "fa-moon"} text-[11px]`} />
            </motion.button>

            {/* Effects toggle */}
            <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.94 }}
              onClick={toggleEffects}
              aria-label={effectsEnabled ? "Disable effects" : "Enable effects"} aria-pressed={effectsEnabled}
              title={effectsEnabled ? "Disable visual effects" : "Enable visual effects"}
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-all border"
              style={{ color: effectsEnabled ? "rgba(139,92,246,0.8)" : "var(--ed-text-4)", borderColor: effectsEnabled ? "var(--ed-violet-border)" : "var(--ed-border)", background: effectsEnabled ? "var(--ed-violet-bg)" : "transparent" }}>
              <i className="fa-solid fa-wand-sparkles text-[10px]" />
            </motion.button>

            <div className="w-px h-5" style={{ background: "var(--ed-border)" }} />

            {/* Reset */}
            <div className="relative">
              <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                onClick={() => setShowResetConfirm(true)}
                aria-label="Reset all threads"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all border"
                style={{ color: "var(--ed-text-3)", borderColor: "var(--ed-border)" }}>
                <i className="fa-solid fa-arrow-rotate-left text-[9px]" />Reset
              </motion.button>
              <AnimatePresence>
                {showResetConfirm && (
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                    className="absolute right-0 top-full mt-1 z-[60] rounded-xl p-3 w-56"
                    style={{ background: "var(--ed-modal-bg)", border: `1px solid var(--ed-red-border)`, boxShadow: "0 16px 40px rgba(0,0,0,0.5)" }}>
                    <p className="text-[11px] mb-2.5" style={{ color: "var(--ed-text-2)" }}>Delete ALL threads and clear everything?</p>
                    <div className="flex gap-1.5">
                      <button onClick={handleReset} className="flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-colors border"
                        style={{ color: "#f87171", background: "var(--ed-red-bg)", borderColor: "var(--ed-red-border)" }}>Reset All</button>
                      <button onClick={() => setShowResetConfirm(false)} className="flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-colors border"
                        style={{ color: "var(--ed-text-2)", borderColor: "var(--ed-border)" }}>Cancel</button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* ── MAIN BODY ─────────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden relative z-10">

          {/* ▌ LEFT PANEL ─────────────────────────────────────────────── */}
          <div className="w-56 shrink-0 flex flex-col border-r" style={{ background: "var(--ed-panel-bg)", borderColor: "var(--ed-border)" }}>
            {/* Tab bar */}
            <div className="flex border-b" style={{ borderColor: "var(--ed-border)" }}>
              {(["threads", "images"] as LeftTab[]).map((tab) => (
                <button key={tab} onClick={() => setLeftTab(tab)} role="tab" aria-selected={leftTab === tab}
                  className="flex-1 py-2 text-[11px] font-semibold uppercase tracking-wider transition-all"
                  style={{ color: leftTab === tab ? "var(--ed-violet)" : "var(--ed-text-4)", borderBottom: leftTab === tab ? "2px solid var(--ed-violet)" : "2px solid transparent" }}>
                  {tab === "threads" ? <><i className="fa-solid fa-layer-group text-[9px] mr-1.5" />Threads</> : <><i className="fa-solid fa-images text-[9px] mr-1.5" />Images</>}
                </button>
              ))}
            </div>

            {/* THREADS TAB */}
            {leftTab === "threads" && (
              <div className="flex-1 overflow-y-auto py-1 px-1.5 space-y-0.5 scrollbar-thin">
                {threads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2 px-3">
                    <i className="fa-regular fa-folder-open text-2xl" style={{ color: "var(--ed-text-5)" }} />
                    <p className="text-[10px] text-center" style={{ color: "var(--ed-text-4)" }}>No threads yet</p>
                  </div>
                ) : threads.map((t) => (
                  <div key={t.id} onClick={() => { if (renamingThreadId !== t.id) switchThread(t.id); }}>
                  <SpotlightCard enabled={effectsEnabled}
                    className="group flex items-start gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all border"
                    style={{ background: t.id === activeThreadId ? "var(--ed-violet-bg)" : "transparent", borderColor: t.id === activeThreadId ? "var(--ed-violet-border)" : "transparent" }}
                    spotColor="rgba(139,92,246,0.08)" spotRadius={200}>
                    <div className="flex-1 min-w-0">
                      {renamingThreadId === t.id ? (
                        <input ref={renameInputRef} value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={commitRename} onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingThreadId(null); }}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full text-[11px] font-medium outline-none rounded px-1"
                          style={{ background: "var(--ed-input-bg)", border: "1px solid var(--ed-violet-border)", color: "var(--ed-text-1)" }} />
                      ) : (
                        <p className="text-[11px] font-medium truncate" style={{ color: t.id === activeThreadId ? "var(--ed-violet)" : "var(--ed-text-2)" }}
                          onDoubleClick={(e) => { e.stopPropagation(); setRenamingThreadId(t.id); setRenameValue(t.title); }}
                          title="Double-click to rename">
                          {t.title}
                        </p>
                      )}
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9px]" style={{ color: "var(--ed-text-4)" }}>{fmtDate(t.updatedAt)} · {fmtTime(t.updatedAt)}</span>
                        {t.imageCount > 0 && <span className="text-[9px]" style={{ color: "var(--ed-text-5)" }}>{t.imageCount} img{t.imageCount !== 1 ? "s" : ""}</span>}
                        {t.totalCost > 0 && <span className="text-[9px] font-mono" style={{ color: "var(--ed-amber)" }}>{fmtCost(t.totalCost)}</span>}
                      </div>
                    </div>
                    {threads.length > 1 && (
                      <button onClick={(e) => { e.stopPropagation(); deleteThread(t.id); }}
                        aria-label="Delete thread"
                        className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-all p-0.5 rounded"
                        style={{ color: "var(--ed-text-4)" }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#f87171"}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--ed-text-4)"}>
                        <i className="fa-solid fa-trash text-[8px]" />
                      </button>
                    )}
                  </SpotlightCard>
                  </div>
                ))}
              </div>
            )}

            {/* IMAGES TAB */}
            {leftTab === "images" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto py-1.5 space-y-1 px-1.5 scrollbar-thin">
                  {history.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2 px-3">
                      <i className="fa-regular fa-image text-2xl" style={{ color: "var(--ed-text-5)" }} />
                      <p className="text-[10px] text-center leading-relaxed" style={{ color: "var(--ed-text-4)" }}>Generations will<br />appear here</p>
                    </div>
                  ) : history.map((item, idx) => (
                    <GlareHover key={item.id} enabled={effectsEnabled} className="relative group" glareOpacity={0.06}>
                      <motion.button onClick={() => loadHistoryItem(item)} whileHover={{ scale: 1.02 }}
                        className="w-full flex flex-col gap-1 p-1.5 rounded-lg transition-all text-left border"
                        style={{
                          background: historyIndex === idx ? "var(--ed-violet-bg)" : "transparent",
                          borderColor: historyIndex === idx ? "var(--ed-violet-border)" : "transparent",
                          boxShadow: historyIndex === idx ? "0 0 12px var(--ed-active-ring)" : "none",
                        }}>
                        <div className="w-full aspect-[4/3] rounded-md overflow-hidden" style={{ background: "var(--ed-input-bg)" }}>
                          <img src={`data:image/png;base64,${item.imageB64}`} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
                        </div>
                        <p className="text-[10px] font-medium truncate leading-tight" style={{ color: "var(--ed-text-2)" }}>{item.title}</p>
                        <div className="flex items-center justify-between">
                          <span className="text-[9px]" style={{ color: "var(--ed-text-4)" }}>{fmtTime(item.timestamp)}</span>
                          <span className="text-[9px] font-mono" style={{ color: "var(--ed-amber)" }}>{fmtCost(item.cost)}</span>
                        </div>
                      </motion.button>
                      {/* Delete item */}
                      <button onClick={(e) => { e.stopPropagation(); deleteHistoryItem(item.id); }}
                        aria-label="Delete this generation"
                        className="absolute top-2 right-2 w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: "var(--ed-red-bg)", color: "#f87171", border: "1px solid var(--ed-red-border)" }}>
                        <i className="fa-solid fa-trash text-[7px]" />
                      </button>
                    </GlareHover>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ▌ CENTER — Chat Timeline ──────────────────────────────────── */}
          <div className="flex-1 flex flex-col overflow-hidden relative">
            {/* Aurora background in center */}
            {effectsEnabled && (
              <div className="absolute inset-0 pointer-events-none z-0">
                <AuroraBg enabled />
              </div>
            )}

            {/* Compare original toggle */}
            {originalImageB64 && currentImageB64 && originalImageB64 !== currentImageB64 && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                className="absolute top-3 left-1/2 -translate-x-1/2 z-20">
                <button
                  onMouseDown={() => setShowOriginal(true)} onMouseUp={() => setShowOriginal(false)} onMouseLeave={() => setShowOriginal(false)}
                  aria-label="Hold to compare with original" aria-pressed={showOriginal}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all"
                  style={{ background: showOriginal ? "rgba(236,72,153,0.20)" : "var(--ed-violet-bg)", border: `1px solid ${showOriginal ? "rgba(236,72,153,0.35)" : "var(--ed-violet-border)"}`, color: showOriginal ? "#f9a8d4" : "var(--ed-violet)", backdropFilter: "blur(12px)" }}>
                  <i className={`fa-solid ${showOriginal ? "fa-eye" : "fa-wand-magic-sparkles"} text-[9px]`} />
                  {showOriginal ? "Viewing Original" : "Compare Original"}
                </button>
              </motion.div>
            )}

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 scrollbar-thin relative z-10">
              {/* Empty state */}
              {isBlankCanvas && !isGenerating && (
                <div className="flex flex-col items-center justify-center h-full gap-4 px-8 relative">
                  {effectsEnabled && <FloatingParticles enabled count={20} />}
                  <div className="w-20 h-20 rounded-2xl flex items-center justify-center z-10" style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.12), rgba(236,72,153,0.08))", border: "1px solid rgba(139,92,246,0.15)" }}>
                    <i className="fa-solid fa-wand-magic-sparkles text-3xl" style={{ color: "var(--ed-text-5)" }} />
                  </div>
                  <div className="text-center space-y-1.5 z-10">
                    <p className="text-[14px] font-medium" style={{ color: "var(--ed-text-3)" }}>Ready to Create</p>
                    <p className="text-[12px] leading-relaxed max-w-sm" style={{ color: "var(--ed-text-4)" }}>Describe an image below to generate it, or open an image from the Stage to start conversational editing.</p>
                  </div>
                  {!apiStatus.hasKey && settings !== null && (
                    <motion.button initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} z-10
                      onClick={() => invoke("open_settings").catch(() => {})}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-medium z-10"
                      style={{ background: "rgba(245,158,11,0.10)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.22)" }}>
                      <i className="fa-solid fa-key text-[11px]" />Add {apiStatus.provider === "google" ? "Google Gemini" : "OpenAI"} API key
                    </motion.button>
                  )}
                </div>
              )}

              {/* Original image from Stage */}
              {originalImageB64 && history.length === 0 && !isGenerating && (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-3">
                  <div className="rounded-xl overflow-hidden shadow-2xl max-w-lg border" style={{ borderColor: "var(--ed-border)", background: "var(--ed-checkered)", backgroundSize: "16px 16px" }}>
                    <img src={`data:image/png;base64,${originalImageB64}`} alt="Original" className="max-w-full max-h-[50vh] object-contain" draggable={false} />
                  </div>
                  <p className="text-[12px]" style={{ color: "var(--ed-text-3)" }}>Original image loaded — describe your edits below</p>
                </motion.div>
              )}

              {/* Chat messages */}
              {chatHistory.map((item) => (
                <motion.div key={item.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-2.5">
                  {/* User bubble */}
                  <div className="flex justify-end">
                    <div className="max-w-[70%] px-3.5 py-2 rounded-2xl rounded-br-sm" style={{ background: "var(--ed-bubble-user-bg)", border: "1px solid var(--ed-bubble-user-border)" }}>
                      <p className="text-[12px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--ed-text-1)" }}>{item.prompt}</p>
                    </div>
                  </div>
                  {/* AI response */}
                  <div className="flex justify-start">
                    <div
                      className={`max-w-[80%] rounded-2xl rounded-bl-sm p-2 transition-all`}
                      style={{ background: "var(--ed-bubble-ai-bg)", border: `1px solid ${historyIndex >= 0 && history[historyIndex]?.id === item.id ? "var(--ed-violet-border)" : "var(--ed-bubble-ai-border)"}`, boxShadow: historyIndex >= 0 && history[historyIndex]?.id === item.id ? "0 0 20px var(--ed-active-ring)" : "none" }}>
                      <GlareHover enabled={effectsEnabled} glareOpacity={0.07}>
                        <div className="rounded-xl overflow-hidden cursor-pointer group relative"
                          onClick={() => setExpandedImageId(expandedImageId === item.id ? null : item.id)}
                          style={{ background: "var(--ed-checkered)", backgroundSize: "16px 16px" }}>
                          <img src={`data:image/png;base64,${item.imageB64}`} alt={item.title}
                            className={`object-contain transition-all duration-300 ${expandedImageId === item.id ? "max-w-full max-h-[65vh]" : "max-w-md max-h-72"}`}
                            draggable={false} />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                            <i className={`fa-solid ${expandedImageId === item.id ? "fa-compress" : "fa-expand"} text-white/0 group-hover:text-white/50 transition-all text-sm`} />
                          </div>
                        </div>
                      </GlareHover>
                      <div className="flex items-center justify-between mt-1.5 px-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-medium" style={{ color: "var(--ed-text-2)" }}>{item.title}</span>
                          <span style={{ color: "var(--ed-text-4)" }}>·</span>
                          <span className="text-[10px]" style={{ color: "var(--ed-text-4)" }}>{MODELS.find((m) => m.id === item.model)?.label ?? item.model}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px]" style={{ color: "var(--ed-text-4)" }}>{fmtTime(item.timestamp)}</span>
                          <span className="text-[9px] font-mono" style={{ color: "var(--ed-amber)" }}>{fmtCost(item.cost)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 mt-1.5 px-1">
                        <button onClick={(e) => { e.stopPropagation(); loadHistoryItem(item); }}
                          aria-label="Edit from this image"
                          className="text-[10px] transition-colors px-1.5 py-0.5 rounded"
                          style={{ color: "var(--ed-text-3)" }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--ed-violet)"; (e.currentTarget as HTMLElement).style.background = "var(--ed-violet-bg)"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--ed-text-3)"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                          <i className="fa-solid fa-pen-to-square mr-1 text-[9px]" />Edit from here
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleCopyImage(item.imageB64); }}
                          aria-label="Copy this image"
                          className="text-[10px] transition-colors px-1.5 py-0.5 rounded"
                          style={{ color: "var(--ed-text-3)" }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--ed-violet)"; (e.currentTarget as HTMLElement).style.background = "var(--ed-violet-bg)"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--ed-text-3)"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                          <i className="fa-regular fa-copy mr-1 text-[9px]" />Copy
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleSendToStage(item.imageB64); }}
                          aria-label="Send to Stage"
                          className="text-[10px] transition-colors px-1.5 py-0.5 rounded"
                          style={{ color: "var(--ed-text-3)" }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--ed-emerald)"; (e.currentTarget as HTMLElement).style.background = "var(--ed-emerald-bg)"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--ed-text-3)"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                          <i className="fa-solid fa-arrow-up-from-bracket mr-1 text-[9px]" />Stage
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}

              {/* Generating indicator */}
              {isGenerating && (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-sm p-4" style={{ background: "var(--ed-bubble-ai-bg)", border: "1px solid var(--ed-bubble-ai-border)" }}>
                    <div className="flex items-center gap-3">
                      <div className="relative w-8 h-8">
                        <div className="absolute inset-0 rounded-full border-2 border-violet-500/30 animate-ping" />
                        <div className="absolute inset-1 rounded-full border-2 border-violet-400/50 animate-pulse" />
                        <i className="fa-solid fa-wand-magic-sparkles absolute inset-0 flex items-center justify-center text-violet-400 text-xs m-auto" style={{ display: "flex" }} />
                      </div>
                      <div>
                        <p className="text-[12px]" style={{ color: "var(--ed-text-2)" }}>Generating with {currentModel.label}</p>
                        <p className="text-[10px] mt-0.5" style={{ color: "var(--ed-text-4)" }}>This may take a moment…</p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
              <div ref={chatEndRef} />
            </div>
          </div>

          {/* ▌ RIGHT PANEL — Parameters ───────────────────────────────── */}
          <div className="w-52 shrink-0 flex flex-col border-l overflow-hidden" style={{ background: "var(--ed-panel-bg)", borderColor: "var(--ed-border)" }}>
            <div className="px-3 py-2 border-b" style={{ borderColor: "var(--ed-border)" }}>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded flex items-center justify-center" style={{ background: "var(--ed-violet-bg)" }}>
                  <i className="fa-solid fa-sliders text-[7px] text-violet-400" />
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--ed-text-3)" }}>Parameters</span>
              </div>
            </div>
            <div className="flex-1 px-3 py-2.5 space-y-3.5 overflow-y-auto scrollbar-thin">
              {/* Aspect Ratio */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium" style={{ color: "var(--ed-text-3)" }}>Aspect Ratio</span>
                <div className="flex flex-wrap gap-1">
                  {(isGoogleModel ? GEMINI_ASPECT_OPTIONS : OPENAI_ASPECT_OPTIONS).map((ar) => (
                    <button key={ar.value} onClick={() => setAspectRatio(ar.value)}
                      className="px-2 py-1 rounded-md text-[10px] font-medium transition-all border"
                      style={{ background: aspectRatio === ar.value ? "var(--ed-violet-bg)" : "transparent", color: aspectRatio === ar.value ? "var(--ed-violet)" : "var(--ed-text-3)", borderColor: aspectRatio === ar.value ? "var(--ed-violet-border)" : "transparent" }}>
                      {ar.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Gemini: Image Size */}
              {isGoogleModel && (
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium" style={{ color: "var(--ed-text-3)" }}>Image Size</span>
                  <div className="flex gap-1">
                    {IMAGE_SIZE_OPTIONS.map((sz) => (
                      <button key={sz.value} onClick={() => setImageSize(sz.value)} title={sz.desc}
                        className="flex-1 py-1 rounded-md text-[10px] font-medium transition-all border"
                        style={{ background: imageSize === sz.value ? "var(--ed-violet-bg)" : "transparent", color: imageSize === sz.value ? "var(--ed-violet)" : "var(--ed-text-3)", borderColor: imageSize === sz.value ? "var(--ed-violet-border)" : "transparent" }}>
                        {sz.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Style */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium" style={{ color: "var(--ed-text-3)" }}>Style</span>
                <div className="grid grid-cols-2 gap-0.5">
                  {STYLE_OPTIONS.map((s) => (
                    <button key={s.value} onClick={() => setImageStyle(s.value)}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] transition-all text-left"
                      style={{ background: imageStyle === s.value ? "var(--ed-violet-bg)" : "transparent", color: imageStyle === s.value ? "var(--ed-violet)" : "var(--ed-text-3)" }}>
                      <i className={`fa-solid ${s.icon} text-[8px]`} style={{ color: imageStyle === s.value ? "var(--ed-violet)" : "var(--ed-text-4)" }} />{s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Flash: Thinking — 4-option toggle */}
              {selectedModel === "gemini-3.1-flash-image-preview" && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium" style={{ color: "var(--ed-text-3)" }}>Thinking</span>
                    <span className="text-[10px] font-mono capitalize" style={{ color: "var(--ed-violet)" }}>{thinkingLevel}</span>
                  </div>
                  <div className="flex gap-0.5 rounded-lg overflow-hidden border" style={{ borderColor: "var(--ed-border)" }}>
                    {THINKING_OPTIONS.map((o) => (
                      <button key={o.value} onClick={() => setThinkingLevel(o.value)}
                        aria-pressed={thinkingLevel === o.value}
                        className="flex-1 py-1 text-[9px] font-medium transition-all"
                        style={{ background: thinkingLevel === o.value ? "var(--ed-violet-bg)" : "transparent", color: thinkingLevel === o.value ? "var(--ed-violet)" : "var(--ed-text-4)" }}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* OpenAI: Resolution */}
              {!isGoogleModel && (
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium" style={{ color: "var(--ed-text-3)" }}>Resolution</span>
                  <div className="flex gap-1">
                    {(["standard", "hd"] as const).map((r) => (
                      <button key={r} onClick={() => setResolution(r)} aria-pressed={resolution === r}
                        className="flex-1 py-1 rounded-md text-[10px] font-medium transition-all border"
                        style={{ background: resolution === r ? "var(--ed-violet-bg)" : "transparent", color: resolution === r ? "var(--ed-violet)" : "var(--ed-text-3)", borderColor: resolution === r ? "var(--ed-violet-border)" : "transparent" }}>
                        {r === "standard" ? "Standard" : "HD / 4K"}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* OpenAI: Adherence */}
              {!isGoogleModel && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium" style={{ color: "var(--ed-text-3)" }} title="How strictly the image follows your prompt (vs. creative freedom)">Adherence</span>
                    <span className="text-[10px] font-mono" style={{ color: "var(--ed-violet)" }}>{adherence}%</span>
                  </div>
                  <input type="range" min={0} max={100} value={adherence}
                    onChange={(e) => setAdherence(Number(e.target.value))}
                    aria-label={`Adherence ${adherence}%`}
                    className="w-full h-1 appearance-none rounded-full cursor-pointer"
                    style={{ background: `linear-gradient(to right, rgba(139,92,246,0.6) ${adherence}%, rgba(128,128,128,0.15) ${adherence}%)` }} />
                </div>
              )}

              {/* Session summary */}
              <div className="pt-3 border-t space-y-1.5" style={{ borderColor: "var(--ed-border-subtle)" }}>
                <div className="flex items-center gap-1.5">
                  <div className="w-3.5 h-3.5 rounded flex items-center justify-center" style={{ background: "rgba(245,158,11,0.12)" }}>
                    <i className="fa-solid fa-chart-simple text-[7px] text-amber-400" />
                  </div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--ed-text-3)" }}>Session</span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px]"><span style={{ color: "var(--ed-text-3)" }}>Generations:</span><span className="font-mono" style={{ color: "var(--ed-text-2)" }}>{history.length}</span></div>
                  <div className="flex justify-between text-[10px]"><span style={{ color: "var(--ed-text-3)" }}>Cost:</span><span className="font-mono" style={{ color: "var(--ed-amber)" }}>{fmtCost(sessionCost)}</span></div>
                  <div className="flex justify-between text-[10px]"><span style={{ color: "var(--ed-text-3)" }}>Threads:</span><span className="font-mono" style={{ color: "var(--ed-text-2)" }}>{threads.length}</span></div>
                </div>
              </div>

              {/* Model info */}
              <div className="pt-3 border-t space-y-1" style={{ borderColor: "var(--ed-border-subtle)" }}>
                <div className="flex items-center gap-1.5">
                  <div className="w-3.5 h-3.5 rounded flex items-center justify-center" style={{ background: "var(--ed-violet-bg)" }}>
                    <i className="fa-solid fa-microchip text-[7px] text-violet-400" />
                  </div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--ed-text-3)" }}>Model</span>
                </div>
                <p className="text-[11px] font-medium" style={{ color: "var(--ed-violet)" }}>{currentModel.label}</p>
                <p className="text-[10px]" style={{ color: "var(--ed-text-4)" }}>{currentModel.desc}</p>
                <p className="text-[10px] font-mono" style={{ color: "var(--ed-amber)" }}>~{fmtCost(currentModel.cost)} per image</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── COMMAND DECK ───────────────────────────────────────────────── */}
        <div className="border-t shrink-0 relative z-20" style={{ background: "var(--ed-cmd-bg)", borderColor: "var(--ed-border)", backdropFilter: "blur(24px)" }}>
          {/* Tier 1 */}
          <div className="flex items-center gap-2 px-4 py-1.5 border-b" style={{ borderColor: "var(--ed-border-subtle)" }}>
            {/* Prompt library toggle */}
            <div className="relative">
              <button ref={promptLibBtnRef} onClick={() => setShowPromptLib(!showPromptLib)}
                aria-label="Prompt library" aria-expanded={showPromptLib}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-all"
                style={{ background: showPromptLib ? "var(--ed-violet-bg)" : "transparent", color: showPromptLib ? "var(--ed-violet)" : "var(--ed-text-3)" }}>
                <i className="fa-solid fa-book-bookmark text-[9px]" />Prompts
              </button>
            </div>
            <div className="w-px h-4" style={{ background: "var(--ed-border)" }} />

            {/* Model selector */}
            <div className="flex-1 flex justify-center">
              <div className="relative">
                <select value={selectedModel} onChange={(e) => handleModelChange(e.target.value as ModelId)}
                  aria-label="Select model"
                  className="appearance-none px-3 pr-7 py-1 rounded-lg text-[11px] font-medium outline-none cursor-pointer transition-all hover:brightness-110"
                  style={{ background: "var(--ed-select-bg)", color: "var(--ed-violet)", border: "1px solid var(--ed-violet-border)" }}>
                  {MODELS.map((m) => <option key={m.id} value={m.id} style={{ background: isDark ? "#0f0f1a" : "#ffffff", color: isDark ? "#fff" : "#1a1a2e" }}>{m.label} — {m.desc}</option>)}
                </select>
                <i className="fa-solid fa-chevron-down absolute right-2.5 top-1/2 -translate-y-1/2 text-[8px] pointer-events-none" style={{ color: "var(--ed-violet)" }} />
              </div>
            </div>
            <div className="w-px h-4" style={{ background: "var(--ed-border)" }} />

            {/* Session cost */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border" style={{ background: "var(--ed-input-bg)", borderColor: "var(--ed-border-subtle)" }}>
              <i className="fa-solid fa-coins text-[9px] text-amber-400/70" />
              <span className="text-[11px] font-medium" style={{ color: "var(--ed-text-3)" }}>Session:</span>
              <span className="text-[11px] font-mono" style={{ color: "var(--ed-amber)" }}>{fmtCost(sessionCost)}</span>
            </div>

            {/* Undo/Redo in tier 1 */}
            <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--ed-border)" }}>
              <button onClick={handleUndo} disabled={!canUndo}
                aria-label="Undo" title="Undo (Ctrl+Z)"
                className="flex items-center px-2.5 py-1 text-[10px] font-medium transition-all disabled:opacity-25 disabled:cursor-not-allowed"
                style={{ color: canUndo ? "var(--ed-text-2)" : "var(--ed-text-4)" }}>
                <i className="fa-solid fa-rotate-left text-[9px]" />
              </button>
              <div className="w-px" style={{ background: "var(--ed-border)" }} />
              <button onClick={handleRedo} disabled={!canRedo}
                aria-label="Redo" title="Redo (Ctrl+Shift+Z)"
                className="flex items-center px-2.5 py-1 text-[10px] font-medium transition-all disabled:opacity-25 disabled:cursor-not-allowed"
                style={{ color: canRedo ? "var(--ed-text-2)" : "var(--ed-text-4)" }}>
                <i className="fa-solid fa-rotate-right text-[9px]" />
              </button>
            </div>
          </div>

          {/* Tier 2 — Prompt input */}
          <div className="flex items-end gap-2 px-4 py-2.5">
            <div className="flex-1 flex flex-col gap-1.5">
              {/* Negative prompt (collapsible) */}
              <div className="flex items-center gap-1.5">
                <button onClick={() => setShowNegPrompt(!showNegPrompt)}
                  aria-expanded={showNegPrompt} aria-label="Toggle negative prompt"
                  className="text-[10px] transition-colors flex items-center gap-1"
                  style={{ color: showNegPrompt ? "var(--ed-violet)" : "var(--ed-text-4)" }}>
                  <i className={`fa-solid fa-chevron-${showNegPrompt ? "down" : "right"} text-[8px]`} />
                  Negative prompt
                  {negPrompt.trim() && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 ml-0.5" />}
                </button>
              </div>
              <AnimatePresence>
                {showNegPrompt && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <textarea value={negPrompt} onChange={(e) => setNegPrompt(e.target.value)}
                      placeholder="Describe what to exclude…"
                      rows={1}
                      className="w-full resize-none px-3 py-1.5 rounded-lg text-[11px] placeholder:text-opacity-30 outline-none transition-all"
                      style={{ background: "var(--ed-input-bg)", border: "1px solid var(--ed-input-border)", color: "var(--ed-text-1)", lineHeight: "1.4" }} />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Main prompt */}
              <div className="relative">
                <textarea ref={promptRef} value={prompt} onChange={(e) => { setPrompt(e.target.value); setPromptHistoryIdx(-1); setPreEnhancePrompt(null); }}
                  onKeyDown={handlePromptKeyDown}
                  placeholder={currentImageB64 ? "Describe changes to make… (Enter to send, ↑ for history)" : "Describe an image to generate… (Enter to send, ↑ for history)"}
                  rows={2}
                  className="w-full resize-none px-3.5 py-2.5 pr-10 rounded-xl text-[12px] placeholder:text-opacity-20 outline-none transition-all focus:ring-1 focus:ring-violet-500/30"
                  style={{ background: "var(--ed-input-bg)", border: "1px solid var(--ed-input-border)", color: "var(--ed-text-1)", lineHeight: "1.5" }} />
                {/* Enhance button */}
                <button onClick={handleEnhance} disabled={isEnhancing || isGenerating || !prompt.trim()}
                  aria-label="Enhance prompt with AI"
                  title="Rewrite as natural language description"
                  className="absolute right-2.5 bottom-2.5 w-6 h-6 rounded-md flex items-center justify-center transition-all disabled:opacity-20 hover:scale-110 active:scale-95"
                  style={{ color: "var(--ed-violet)" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--ed-violet-bg)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                  {isEnhancing ? <i className="fa-solid fa-spinner fa-spin text-[9px]" /> : <i className="fa-solid fa-wand-magic-sparkles text-[10px]" />}
                </button>
              </div>

              {/* Revert enhance */}
              <AnimatePresence>
                {preEnhancePrompt && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                    <button onClick={() => { setPrompt(preEnhancePrompt); setPreEnhancePrompt(null); }}
                      className="text-[10px] transition-colors flex items-center gap-1"
                      style={{ color: "var(--ed-text-3)" }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--ed-violet)"}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--ed-text-3)"}>
                      <i className="fa-solid fa-rotate-left text-[8px]" />Revert enhancement
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="flex gap-1 pb-0.5">
              {/* Send */}
              <StarBorder enabled={effectsEnabled && !isGenerating && !!prompt.trim()} color="#8b5cf6" speed="2.5s" radius={12}>
                <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                  onClick={() => handleSend()} disabled={isGenerating || !prompt.trim()}
                  aria-label="Generate image"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{
                    background: !isGenerating && prompt.trim() ? "linear-gradient(135deg, rgba(139,92,246,0.5), rgba(236,72,153,0.4))" : "var(--ed-violet-bg)",
                    color: !isGenerating && prompt.trim() ? "#f0abfc" : "var(--ed-text-3)",
                    border: `1px solid ${!isGenerating && prompt.trim() ? "rgba(168,85,247,0.5)" : "var(--ed-violet-border)"}`,
                    boxShadow: !isGenerating && prompt.trim() ? "0 4px 16px rgba(139,92,246,0.2)" : "none",
                  }}>
                  <i className="fa-solid fa-paper-plane text-[10px]" />Generate
                </motion.button>
              </StarBorder>

              {/* Retry / Cancel */}
              <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: "var(--ed-border)" }}>
                <button onClick={() => handleSend(lastPrompt)} disabled={isGenerating || !lastPrompt}
                  aria-label="Retry last prompt" title="Retry last prompt"
                  className="flex items-center px-2.5 py-2 text-[10px] font-medium transition-all disabled:opacity-25"
                  style={{ color: "var(--ed-text-2)" }}>
                  <i className="fa-solid fa-rotate text-[9px]" />
                </button>
                <div className="w-px" style={{ background: "var(--ed-border)" }} />
                <button
                  onClick={() => { abortRef.current = true; setIsGenerating(false); }}
                  disabled={!isGenerating}
                  aria-label="Cancel generation" title="Cancel (note: backend may still be running)"
                  className="flex items-center px-2.5 py-2 text-[10px] font-medium transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                  style={{ color: isGenerating ? "#f87171" : "var(--ed-text-4)" }}>
                  <i className="fa-solid fa-stop text-[9px]" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── PROMPT LIBRARY ─────────────────────────────────────────────── */}
        <AnimatePresence>
          {showPromptLib && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
              className="absolute bottom-[calc(100%-var(--deck-h,120px))] left-4 z-50 rounded-xl w-96 overflow-hidden"
              style={{ bottom: "160px", background: "var(--ed-modal-bg)", border: "1px solid var(--ed-modal-border)", boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}
              role="dialog" aria-label="Prompt library">
              <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--ed-border)" }}>
                <span className="text-[12px] font-semibold" style={{ color: "var(--ed-text-2)" }}>
                  <i className="fa-solid fa-book-bookmark text-[9px] mr-1.5 text-violet-400" />Prompt Library
                  {savedPrompts.length > 0 && <span className="text-[10px] ml-1.5" style={{ color: "var(--ed-text-4)" }}>({savedPrompts.length})</span>}
                </span>
                <div className="flex items-center gap-1">
                  {savedPrompts.length > 0 && (
                    <button onClick={() => { const blob = new Blob([JSON.stringify(savedPrompts, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "zenith_prompts.json"; a.click(); URL.revokeObjectURL(url); showToast("Exported!", "ok"); }}
                      aria-label="Export prompts"
                      className="transition-colors px-1.5 py-0.5 rounded text-[9px]" style={{ color: "var(--ed-text-3)" }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--ed-emerald)"}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--ed-text-3)"}>
                      <i className="fa-solid fa-file-export" />
                    </button>
                  )}
                  <button onClick={handleImportPrompts} aria-label="Import prompts"
                    className="transition-colors px-1.5 py-0.5 rounded text-[9px]" style={{ color: "var(--ed-text-3)" }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--ed-violet)"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--ed-text-3)"}>
                    <i className="fa-solid fa-file-import" />
                  </button>
                  {savedPrompts.length > 0 && (
                    <button onClick={() => { savePromptsToStorage([]); showToast("All prompts cleared"); }} aria-label="Clear all prompts"
                      className="transition-colors px-1.5 py-0.5 rounded text-[9px]" style={{ color: "var(--ed-text-3)" }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#f87171"}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--ed-text-3)"}>
                      <i className="fa-solid fa-trash-can" />
                    </button>
                  )}
                  <button onClick={() => setShowPromptLib(false)} aria-label="Close prompt library"
                    className="ml-1 transition-colors" style={{ color: "var(--ed-text-3)" }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--ed-text-1)"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--ed-text-3)"}>
                    <i className="fa-solid fa-xmark text-[11px]" />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-2 border-b" style={{ borderColor: "var(--ed-border)" }}>
                <input type="text" placeholder="Name this prompt…" value={promptLibName}
                  onChange={(e) => setPromptLibName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveCurrentPrompt()}
                  className="flex-1 px-2 py-1 rounded-md text-[11px] placeholder:text-opacity-30 outline-none"
                  style={{ background: "var(--ed-input-bg)", border: "1px solid var(--ed-input-border)", color: "var(--ed-text-1)" }} />
                <button onClick={saveCurrentPrompt} disabled={!promptLibName.trim() || !prompt.trim()}
                  className="px-2 py-1 rounded-md text-[11px] font-medium transition-colors disabled:opacity-25"
                  style={{ color: "var(--ed-violet)" }}>
                  <i className="fa-solid fa-plus text-[9px] mr-1" />Save
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {savedPrompts.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8 px-4">
                    <i className="fa-regular fa-folder-open text-xl" style={{ color: "var(--ed-text-5)" }} />
                    <p className="text-[11px] text-center" style={{ color: "var(--ed-text-4)" }}>No saved prompts yet</p>
                  </div>
                ) : savedPrompts.map((sp) => (
                  <div key={sp.id} className="flex items-start gap-2 px-3 py-2 transition-colors group border-b last:border-0"
                    style={{ borderColor: "var(--ed-border-subtle)" }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--ed-hover-bg)"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                    <button onClick={() => { setPrompt(sp.text); setShowPromptLib(false); }} className="flex-1 text-left min-w-0">
                      <p className="text-[11px] font-medium truncate" style={{ color: "var(--ed-text-2)" }}>{sp.name}</p>
                      <p className="text-[10px] line-clamp-2 mt-0.5 leading-relaxed" style={{ color: "var(--ed-text-4)" }}>{sp.text}</p>
                    </button>
                    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                      <button onClick={() => { navigator.clipboard.writeText(sp.text); showToast("Copied", "ok"); }} aria-label="Copy prompt"
                        className="p-0.5 rounded transition-colors" style={{ color: "var(--ed-text-3)" }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--ed-violet)"}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--ed-text-3)"}>
                        <i className="fa-regular fa-copy text-[8px]" />
                      </button>
                      <button onClick={() => deletePrompt(sp.id)} aria-label="Delete prompt"
                        className="p-0.5 rounded transition-colors" style={{ color: "var(--ed-text-3)" }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#f87171"}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--ed-text-3)"}>
                        <i className="fa-solid fa-trash text-[8px]" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── TOAST ──────────────────────────────────────────────────────── */}
        <AnimatePresence>
          {toast && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
              className="fixed bottom-24 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-[12px] font-medium pointer-events-none z-[70] flex items-center gap-2"
              style={{
                background: "var(--ed-modal-bg)", border: `1px solid ${toast.type === "err" ? "var(--ed-red-border)" : toast.type === "ok" ? "var(--ed-emerald-border)" : toast.type === "warn" ? "rgba(245,158,11,0.25)" : "var(--ed-modal-border)"}`,
                color: toast.type === "err" ? "#f87171" : toast.type === "ok" ? "var(--ed-emerald)" : toast.type === "warn" ? "#fbbf24" : "var(--ed-text-1)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
              }}>
              {toast.type === "err" && <i className="fa-solid fa-circle-exclamation text-[10px]" />}
              {toast.type === "ok" && <i className="fa-solid fa-circle-check text-[10px]" />}
              {toast.type === "warn" && <i className="fa-solid fa-triangle-exclamation text-[10px]" />}
              {toast.msg}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Click-outside dismiss */}
        {(showSaveOptions || showResetConfirm) && (
          <div className="fixed inset-0 z-[55]" onClick={() => { setShowSaveOptions(false); setShowResetConfirm(false); }} />
        )}
      </div>
    </ClickSpark>
  );
}
