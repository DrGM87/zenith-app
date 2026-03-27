import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { motion, AnimatePresence } from "framer-motion";

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

/** Lightweight on-disk metadata for one image (no b64) */
interface ItemMeta {
  id: string; prompt: string; title: string; timestamp: number;
  cost: number; model: string; filePath: string;
}

/** A thread (session) groups multiple generations together */
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

// ── Constants ─────────────────────────────────────────────────────────────────

const MODELS: { id: ModelId; label: string; desc: string; provider: "google" | "openai"; cost: number }[] = [
  { id: "gemini-3.1-flash-image-preview", label: "Nano Banana 2", desc: "Fast · High quality · Google", provider: "google", cost: 0.067 },
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
const IMAGE_SIZE_OPTIONS: { value: ImageSize; label: string; desc: string }[] = [
  { value: "512", label: "512", desc: "Fast preview" }, { value: "1K", label: "1K", desc: "Standard" },
  { value: "2K", label: "2K", desc: "High detail" }, { value: "4K", label: "4K", desc: "Maximum quality" },
];
const STYLE_OPTIONS: { value: ImageStyle; label: string; icon: string }[] = [
  { value: "",               label: "None (default)", icon: "fa-ban" },
  { value: "photorealistic", label: "Photo",          icon: "fa-camera" },
  { value: "digital_art",   label: "Digital Art",     icon: "fa-palette" },
  { value: "vector",        label: "Vector",          icon: "fa-bezier-curve" },
  { value: "anime",         label: "Anime",           icon: "fa-star" },
  { value: "watercolor",    label: "Watercolor",      icon: "fa-droplet" },
  { value: "oil_painting",  label: "Oil Paint",       icon: "fa-brush" },
  { value: "3d_render",     label: "3D Render",       icon: "fa-cube" },
  { value: "pixel_art",     label: "Pixel Art",       icon: "fa-chess-board" },
  { value: "sketch",        label: "Sketch",          icon: "fa-pencil" },
];

const PROMPTS_KEY  = "zenith_editor_prompts";
const THREADS_KEY  = "zenith_editor_threads";
const ACTIVE_KEY   = "zenith_editor_active_thread";
const itemsKey     = (tid: string) => `zenith_editor_items_${tid}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function fmtTime(ts: number): string { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
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
  try { localStorage.setItem(itemsKey(threadId), JSON.stringify(metas.slice(0, 50))); } catch { /* quota */ }
}
function deleteThreadStorage(threadId: string) {
  try { localStorage.removeItem(itemsKey(threadId)); } catch { /* ok */ }
}

/** Save a generated image to disk, return the file path */
async function saveItemToDisk(item: HistoryItem): Promise<string | null> {
  try {
    const r = JSON.parse(await invoke<string>("process_file", {
      action: "save_editor_image",
      argsJson: JSON.stringify({ image_b64: item.imageB64, format: "png", quality: 100, filename: `hist_${item.id}` }),
    }));
    return r.ok ? r.path : null;
  } catch { return null; }
}

/** Load images for a thread from disk */
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
    const PRICING: Record<string, Record<string, { input: number; output: number }>> = {
      openai: { "gpt-4.1-nano": { input: 0.10, output: 0.40 }, "gpt-4o-mini": { input: 0.15, output: 0.60 }, "gpt-4.1-mini": { input: 0.40, output: 1.60 }, "gpt-4.1": { input: 2.00, output: 8.00 }, "gpt-4o": { input: 2.50, output: 10.00 } },
      google: { "gemini-2.5-flash": { input: 0.15, output: 0.60 }, "gemini-3-flash-preview": { input: 0.50, output: 3.00 }, "gemini-2.5-pro": { input: 1.25, output: 10.00 } },
      anthropic: { "claude-haiku-4-5-20250514": { input: 1.00, output: 5.00 }, "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 } },
      deepseek: { "deepseek-chat": { input: 0.27, output: 1.10 } },
    };
    const rates = PRICING[provider]?.[model] || { input: 1.00, output: 2.00 };
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

  // ── Image state
  const [currentImageB64, setCurrentImageB64] = useState<string | null>(null);
  const [originalImageB64, setOriginalImageB64] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [isBlankCanvas, setIsBlankCanvas] = useState(true);

  // ── Threads & History
  const [threads, setThreads] = useState<EditorThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);      // items of the ACTIVE thread
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [leftTab, setLeftTab] = useState<LeftTab>("threads");
  const [threadSwitching, setThreadSwitching] = useState(false);

  // ── Model + params
  const [selectedModel, setSelectedModel] = useState<ModelId>("gemini-3.1-flash-image-preview");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [imageSize, setImageSize] = useState<ImageSize>("1K");
  const [imageStyle, setImageStyle] = useState<ImageStyle>("");
  const [thinkingLevel, setThinkingLevel] = useState(50);
  const [resolution, setResolution] = useState<"standard" | "hd">("standard");
  const [adherence, setAdherence] = useState(70);

  // ── Session cost
  const [sessionCost, setSessionCost] = useState(0);

  // ── Prompt & generation
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastPrompt, setLastPrompt] = useState("");
  const abortRef = useRef(false);

  // ── Prompt library
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [showPromptLib, setShowPromptLib] = useState(false);
  const [promptLibName, setPromptLibName] = useState("");

  // ── Save options
  const [showSaveOptions, setShowSaveOptions] = useState(false);
  const [saveFormat, setSaveFormat] = useState<SaveFormat>("png");
  const [saveQuality, setSaveQuality] = useState(92);

  // ── UI
  const [toast, setToast] = useState<string | null>(null);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [expandedImageId, setExpandedImageId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const showToast = useCallback((msg: string, ms = 3000) => {
    setToast(msg); setTimeout(() => setToast(null), ms);
  }, []);

  // ── Active thread helper ──────────────────────────────────────────────────
  const activeThread = useMemo(() => threads.find((t) => t.id === activeThreadId) ?? null, [threads, activeThreadId]);

  /** Persist current thread metadata after history changes */
  const syncActiveThread = useCallback((hist: HistoryItem[], cost: number) => {
    if (!activeThreadId) return;
    setThreads((prev) => {
      const updated = prev.map((t) =>
        t.id === activeThreadId
          ? { ...t, updatedAt: Date.now(), totalCost: cost, imageCount: hist.length, title: t.title === "Untitled" && hist.length > 0 ? (hist[0].title !== "Generating title\u2026" ? hist[0].title : t.title) : t.title }
          : t,
      );
      persistThreads(updated);
      return updated;
    });
  }, [activeThreadId]);

  // ── Load settings ─────────────────────────────────────────────────────────
  const loadSettings = useCallback(() => { invoke<ZenithSettings>("get_settings").then(setSettings).catch(() => {}); }, []);
  useEffect(() => {
    loadSettings();
    const onFocus = () => loadSettings();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadSettings]);

  // ── Load prompts ──────────────────────────────────────────────────────────
  useEffect(() => { try { const r = localStorage.getItem(PROMPTS_KEY); if (r) setSavedPrompts(JSON.parse(r)); } catch {} }, []);
  const savePromptsToStorage = useCallback((p: SavedPrompt[]) => { localStorage.setItem(PROMPTS_KEY, JSON.stringify(p)); setSavedPrompts(p); }, []);

  // ── Initialize threads on mount ───────────────────────────────────────────
  useEffect(() => {
    let saved = loadThreads();
    const lastActive = localStorage.getItem(ACTIVE_KEY);
    if (saved.length === 0) {
      const first = createThread();
      saved = [first];
      persistThreads(saved);
    }
    setThreads(saved);
    const startId = (lastActive && saved.some((t) => t.id === lastActive)) ? lastActive : saved[0].id;
    setActiveThreadId(startId);
    localStorage.setItem(ACTIVE_KEY, startId);
    // Load images for the starting thread
    loadThreadImages(startId).then((items) => {
      if (items.length > 0) {
        setHistory(items);
        setHistoryIndex(0);
        setCurrentImageB64(items[0].imageB64);
        setIsBlankCanvas(false);
        setSessionCost(items.reduce((s, i) => s + i.cost, 0));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load initial image via Rust state (opened from Stage) ─────────────────
  useEffect(() => {
    invoke<string>("take_pending_editor_image")
      .then(async (path) => {
        if (path) {
          setIsBlankCanvas(false);
          try {
            const b64 = await invoke<string>("read_file_base64", { path });
            setCurrentImageB64(b64);
            setOriginalImageB64(b64);
          } catch (e) { showToast(`Failed to load image: ${String(e)}`); }
        }
      }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Listen for editor-load-image (reused window case) ─────────────────────
  useEffect(() => {
    const unlisten = listen<string>("editor-load-image", async (ev) => {
      const path = ev.payload;
      if (!path) { setIsBlankCanvas(true); setCurrentImageB64(null); setOriginalImageB64(null); return; }
      setIsBlankCanvas(false);
      try {
        const b64 = await invoke<string>("read_file_base64", { path });
        setCurrentImageB64(b64); setOriginalImageB64(b64);
      } catch (e) { showToast(`Failed to load image: ${String(e)}`); }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [showToast]);

  // ── Auto-scroll chat ─────────────────────────────────────────────────────
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history.length, isGenerating]);

  // ── API key helpers ───────────────────────────────────────────────────────
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

  // ── Undo / Redo ───────────────────────────────────────────────────────────
  const canUndo = history.length > 0 && historyIndex < history.length - 1;
  const canRedo = historyIndex > 0;
  const handleUndo = useCallback(() => {
    if (!canUndo) return;
    const ni = historyIndex + 1; setHistoryIndex(ni); setCurrentImageB64(history[ni].imageB64);
  }, [canUndo, historyIndex, history]);
  const handleRedo = useCallback(() => {
    if (!canRedo) return;
    const ni = historyIndex - 1; setHistoryIndex(ni); setCurrentImageB64(history[ni].imageB64);
  }, [canRedo, historyIndex, history]);

  // ── Thread Operations ─────────────────────────────────────────────────────

  const handleNewCanvas = useCallback(() => {
    // Persist current thread
    syncActiveThread(history, sessionCost);
    // Create new thread
    const t = createThread();
    setThreads((prev) => { const up = [t, ...prev]; persistThreads(up); return up; });
    setActiveThreadId(t.id);
    localStorage.setItem(ACTIVE_KEY, t.id);
    // Clear state for new thread
    setHistory([]);
    setHistoryIndex(-1);
    setCurrentImageB64(null);
    setOriginalImageB64(null);
    setIsBlankCanvas(true);
    setSessionCost(0);
    setLastPrompt("");
    setPrompt("");
    setLeftTab("images");
    showToast("New canvas created");
    promptRef.current?.focus();
  }, [history, sessionCost, syncActiveThread, showToast]);

  const switchThread = useCallback(async (threadId: string) => {
    if (threadId === activeThreadId || threadSwitching) return;
    setThreadSwitching(true);
    // Save current thread
    syncActiveThread(history, sessionCost);
    // Load target thread
    const items = await loadThreadImages(threadId);
    setActiveThreadId(threadId);
    localStorage.setItem(ACTIVE_KEY, threadId);
    setHistory(items);
    if (items.length > 0) {
      setHistoryIndex(0);
      setCurrentImageB64(items[0].imageB64);
      setIsBlankCanvas(false);
    } else {
      setHistoryIndex(-1);
      setCurrentImageB64(null);
      setIsBlankCanvas(true);
    }
    setOriginalImageB64(null);
    setSessionCost(items.reduce((s, i) => s + i.cost, 0));
    setLastPrompt("");
    setPrompt("");
    setLeftTab("images");
    setThreadSwitching(false);
  }, [activeThreadId, threadSwitching, history, sessionCost, syncActiveThread]);

  const deleteThread = useCallback((threadId: string) => {
    deleteThreadStorage(threadId);
    setThreads((prev) => {
      const filtered = prev.filter((t) => t.id !== threadId);
      // If we deleted the active thread, switch to another or create new
      if (threadId === activeThreadId) {
        if (filtered.length > 0) {
          const next = filtered[0];
          setActiveThreadId(next.id);
          localStorage.setItem(ACTIVE_KEY, next.id);
          loadThreadImages(next.id).then((items) => {
            setHistory(items);
            setHistoryIndex(items.length > 0 ? 0 : -1);
            setCurrentImageB64(items.length > 0 ? items[0].imageB64 : null);
            setIsBlankCanvas(items.length === 0);
            setSessionCost(items.reduce((s, i) => s + i.cost, 0));
          });
        } else {
          const fresh = createThread();
          filtered.push(fresh);
          setActiveThreadId(fresh.id);
          localStorage.setItem(ACTIVE_KEY, fresh.id);
          setHistory([]); setHistoryIndex(-1); setCurrentImageB64(null);
          setIsBlankCanvas(true); setSessionCost(0);
        }
      }
      persistThreads(filtered);
      return filtered;
    });
    showToast("Thread deleted");
  }, [activeThreadId, showToast]);

  const handleReset = useCallback(async () => {
    setShowResetConfirm(false);
    // Delete all thread storage
    for (const t of threads) deleteThreadStorage(t.id);
    // Create a fresh thread
    const fresh = createThread();
    setThreads([fresh]);
    persistThreads([fresh]);
    setActiveThreadId(fresh.id);
    localStorage.setItem(ACTIVE_KEY, fresh.id);
    setHistory([]); setHistoryIndex(-1);
    setCurrentImageB64(null); setOriginalImageB64(null);
    setIsBlankCanvas(true); setSessionCost(0);
    setLastPrompt(""); setPrompt("");
    setLeftTab("threads");
    try { await invoke<string>("process_file", { action: "reset_editor", argsJson: "{}" }); } catch {}
    showToast("All threads cleared");
  }, [threads, showToast]);

  // ── Generate image ────────────────────────────────────────────────────────

  const handleSend = useCallback(async (retryPrompt?: string) => {
    const p = retryPrompt ?? prompt.trim();
    if (!p) { showToast("Enter a prompt first"); return; }
    const { api_key, provider } = getApiCreds();
    if (!api_key) { showToast(`No ${provider} API key found. Add one in Settings > API Keys.`); return; }

    setIsGenerating(true);
    abortRef.current = false;
    setLastPrompt(p);

    try {
      const args: Record<string, unknown> = {
        model: selectedModel, prompt: p, api_key, provider,
        aspect_ratio: aspectRatio, style: imageStyle || undefined,
      };
      if (provider === "google") {
        args.image_size = imageSize;
        if (selectedModel === "gemini-3-pro-image-preview") args.thinking_level = thinkingLevel <= 50 ? "minimal" : "High";
      }
      if (provider === "openai") {
        args.quality = resolution;
        if (adherence !== 70) args.adherence = adherence;
      }
      if (currentImageB64) args.image_b64 = currentImageB64;

      const resultStr = await invoke<string>("process_file", { action: "generate_image", argsJson: JSON.stringify(args) });
      if (abortRef.current) return;
      const result = JSON.parse(resultStr);
      if (!result.ok || !result.image_b64) { showToast(result.error || "Generation failed"); return; }

      const newB64: string = result.image_b64;
      const cost: number = result.cost ?? MODELS.find((m) => m.id === selectedModel)?.cost ?? 0;

      setCurrentImageB64(newB64);
      const newSessionCost = sessionCost + cost;
      setSessionCost(newSessionCost);
      trackImageCost(provider, cost);

      const histItem: HistoryItem = { id: uid(), imageB64: newB64, prompt: p, title: "Generating title\u2026", timestamp: Date.now(), cost, model: selectedModel };
      const newHist = [histItem, ...history];
      setHistory(newHist);
      setHistoryIndex(0);
      setLeftTab("images");

      // Save image to disk and persist meta
      saveItemToDisk(histItem).then((filePath) => {
        if (filePath && activeThreadId) {
          const existing = loadItemMetas(activeThreadId);
          const meta: ItemMeta = { id: histItem.id, prompt: p, title: histItem.title, timestamp: histItem.timestamp, cost, model: selectedModel, filePath };
          persistItemMetas(activeThreadId, [meta, ...existing]);
        }
      });

      // Auto-title
      const titleArgs = { prompt: p, ...getTextLlmCreds() };
      invoke<string>("process_file", { action: "auto_title_prompt", argsJson: JSON.stringify(titleArgs) })
        .then((r) => {
          try {
            const tr = JSON.parse(r);
            if (tr.ok && tr.title) {
              const title = tr.title;
              setHistory((h) => { const up = h.map((x) => x.id === histItem.id ? { ...x, title } : x); return up; });
              // Update persisted meta
              if (activeThreadId) {
                const metas = loadItemMetas(activeThreadId);
                persistItemMetas(activeThreadId, metas.map((m) => m.id === histItem.id ? { ...m, title } : m));
              }
              // Update thread title if it's the first generation
              setThreads((prev) => {
                const up = prev.map((t) => t.id === activeThreadId && t.title === "Untitled" ? { ...t, title } : t);
                persistThreads(up);
                return up;
              });
            }
            trackTextTokenUsage(tr);
          } catch {}
        }).catch(() => {});

      // Sync thread metadata
      syncActiveThread(newHist, newSessionCost);
      if (!retryPrompt) setPrompt("");
    } catch (e) {
      if (!abortRef.current) showToast(`Error: ${String(e)}`);
    } finally { setIsGenerating(false); }
  }, [prompt, getApiCreds, getTextLlmCreds, selectedModel, aspectRatio, imageSize, resolution, imageStyle, thinkingLevel, adherence, currentImageB64, showToast, history, sessionCost, activeThreadId, syncActiveThread]);

  // ── Enhance prompt ────────────────────────────────────────────────────────
  const handleEnhance = useCallback(async () => {
    if (!prompt.trim()) { showToast("Enter a rough prompt first"); return; }
    const { api_key, provider, model } = getTextLlmCreds();
    if (!api_key) { showToast("No API key found for text LLM. Add one in Settings."); return; }
    setIsEnhancing(true);
    try {
      const r = JSON.parse(await invoke<string>("process_file", { action: "enhance_prompt", argsJson: JSON.stringify({ prompt: prompt.trim(), api_key, provider, model }) }));
      if (r.ok && r.enhanced_prompt) { setPrompt(r.enhanced_prompt); showToast("Prompt enhanced!"); }
      else showToast(r.error || "Enhancement failed");
      trackTextTokenUsage(r);
    } catch (e) { showToast(String(e)); }
    finally { setIsEnhancing(false); }
  }, [prompt, getTextLlmCreds, showToast]);

  // ── Save / Stage ──────────────────────────────────────────────────────────
  const handleSaveImage = useCallback(async () => {
    if (!currentImageB64) { showToast("Nothing to save"); return; }
    setShowSaveOptions(false);
    try {
      const r = JSON.parse(await invoke<string>("process_file", { action: "save_editor_image", argsJson: JSON.stringify({ image_b64: currentImageB64, format: saveFormat, quality: saveQuality, filename: `zenith_${Date.now()}` }) }));
      if (r.ok && r.path) { await invoke("stage_file", { path: r.path }); await emit("items-changed"); showToast(`Saved as ${saveFormat.toUpperCase()} — sent to Stage!`); }
      else showToast(r.error || "Save failed");
    } catch (e) { showToast(String(e)); }
  }, [currentImageB64, saveFormat, saveQuality, showToast]);

  const handleSendToStage = useCallback(async (overrideB64?: string) => {
    const b64 = overrideB64 ?? currentImageB64;
    if (!b64) { showToast("Nothing to send"); return; }
    try {
      const r = JSON.parse(await invoke<string>("process_file", { action: "save_editor_image", argsJson: JSON.stringify({ image_b64: b64, format: "png", quality: 95, filename: `zenith_generated_${Date.now()}` }) }));
      if (r.ok && r.path) { await invoke("stage_file", { path: r.path }); await emit("items-changed"); showToast("Sent to Stage!"); }
      else showToast(r.error || "Failed");
    } catch (e) { showToast(String(e)); }
  }, [currentImageB64, showToast]);

  // ── History navigation ────────────────────────────────────────────────────
  const loadHistoryItem = useCallback((item: HistoryItem) => {
    const idx = history.findIndex((h) => h.id === item.id);
    if (idx >= 0) { setHistoryIndex(idx); setCurrentImageB64(item.imageB64); }
  }, [history]);

  // ── Prompt library ────────────────────────────────────────────────────────
  const saveCurrentPrompt = useCallback(() => {
    if (!promptLibName.trim() || !prompt.trim()) { showToast("Enter both a name and a prompt"); return; }
    savePromptsToStorage([{ id: uid(), name: promptLibName.trim(), text: prompt.trim() }, ...savedPrompts]);
    setPromptLibName(""); showToast(`Prompt saved`);
  }, [promptLibName, prompt, savedPrompts, savePromptsToStorage, showToast]);
  const deletePrompt = useCallback((id: string) => { savePromptsToStorage(savedPrompts.filter((p) => p.id !== id)); }, [savedPrompts, savePromptsToStorage]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const currentModel = MODELS.find((m) => m.id === selectedModel)!;
  const isGoogleModel = currentModel.provider === "google";
  const chatHistory = useMemo(() => [...history].reverse(), [history]);

  // ══════════════════════════════════════════════════════════════════════════
  // ██  RENDER
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden select-none"
      style={{ background: "linear-gradient(135deg, #0a0a12 0%, #0f0f1a 50%, #0a0a12 100%)" }}>

      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06] shrink-0"
        style={{ background: "rgba(255,255,255,0.02)", backdropFilter: "blur(20px)" }}
        data-tauri-drag-region>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: "linear-gradient(135deg, #8b5cf6, #ec4899)" }} />
            <span className="text-[13px] font-semibold text-white/90 tracking-wide">Zenith Editor</span>
          </div>
          {activeThread && (
            <span className="text-[11px] text-white/25 truncate max-w-40">{activeThread.title}</span>
          )}
          {settings !== null && (
            apiStatus.hasKey
              ? <span className="flex items-center gap-1 text-[10px] text-emerald-400/70"><i className="fa-solid fa-circle-check text-[8px]" />{apiStatus.provider === "google" ? "Google" : "OpenAI"} key</span>
              : <button onClick={() => invoke("open_settings").catch(() => {})} className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 transition-colors"><i className="fa-solid fa-triangle-exclamation text-[9px]" />No API key</button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* New Canvas */}
          <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
            onClick={handleNewCanvas}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/45 hover:text-emerald-300 hover:bg-emerald-500/10 transition-all border border-white/[0.06] hover:border-emerald-500/30">
            <i className="fa-solid fa-plus text-[9px]" />New Canvas
          </motion.button>
          {/* Save */}
          <div className="relative">
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={() => setShowSaveOptions(!showSaveOptions)} disabled={!currentImageB64}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-25 border"
              style={{ background: currentImageB64 ? "rgba(139,92,246,0.15)" : "transparent", color: currentImageB64 ? "#c084fc" : "rgba(255,255,255,0.3)", borderColor: currentImageB64 ? "rgba(139,92,246,0.25)" : "rgba(255,255,255,0.06)" }}>
              <i className="fa-solid fa-floppy-disk text-[10px]" />Save<i className={`fa-solid fa-chevron-${showSaveOptions ? "up" : "down"} text-[7px] opacity-50`} />
            </motion.button>
            <AnimatePresence>
              {showSaveOptions && (
                <motion.div initial={{ opacity: 0, y: -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  className="absolute right-0 top-full mt-1 z-[60] rounded-xl p-3 space-y-2.5 w-56"
                  style={{ background: "rgba(10,10,18,0.97)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 20px 50px rgba(0,0,0,0.7)" }}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-white/40 w-14">Format:</span>
                    <div className="flex gap-1">{(["png", "jpg", "webp"] as SaveFormat[]).map((f) => (
                      <button key={f} onClick={() => setSaveFormat(f)} className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors uppercase ${saveFormat === f ? "bg-violet-500/30 text-violet-300" : "text-white/40 hover:text-white/70 hover:bg-white/5"}`}>{f}</button>
                    ))}</div>
                  </div>
                  {saveFormat !== "png" && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-white/40 w-14">Quality:</span>
                      <input type="range" min={50} max={100} value={saveQuality} onChange={(e) => setSaveQuality(Number(e.target.value))} className="flex-1 h-1 appearance-none rounded-full cursor-pointer" style={{ background: `linear-gradient(to right, rgba(139,92,246,0.6) ${saveQuality}%, rgba(255,255,255,0.08) ${saveQuality}%)` }} />
                      <span className="text-[10px] text-violet-300 font-mono w-7 text-right">{saveQuality}%</span>
                    </div>
                  )}
                  <button onClick={handleSaveImage} className="w-full py-1.5 rounded-lg text-[11px] font-medium text-violet-300 hover:bg-violet-500/20 transition-colors border border-violet-500/20">
                    <i className="fa-solid fa-download mr-1.5 text-[9px]" />Save & Send to Stage
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {/* Reset */}
          <div className="relative">
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={() => setShowResetConfirm(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-all border border-white/[0.06] hover:border-red-500/25">
              <i className="fa-solid fa-arrow-rotate-left text-[9px]" />Reset
            </motion.button>
            <AnimatePresence>
              {showResetConfirm && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                  className="absolute right-0 top-full mt-1 z-[60] rounded-xl p-3 w-56"
                  style={{ background: "rgba(10,10,18,0.97)", border: "1px solid rgba(239,68,68,0.2)", boxShadow: "0 16px 40px rgba(0,0,0,0.6)" }}>
                  <p className="text-[11px] text-white/60 mb-2.5">Delete ALL threads and clear everything?</p>
                  <div className="flex gap-1.5">
                    <button onClick={handleReset} className="flex-1 py-1.5 rounded-lg text-[10px] font-medium text-red-300 bg-red-500/15 hover:bg-red-500/25 transition-colors border border-red-500/20">Reset All</button>
                    <button onClick={() => setShowResetConfirm(false)} className="flex-1 py-1.5 rounded-lg text-[10px] font-medium text-white/50 hover:text-white/70 hover:bg-white/5 transition-colors border border-white/[0.06]">Cancel</button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ── MAIN BODY ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ▌ LEFT PANEL — Threads / Images ─────────────────────────────── */}
        <div className="w-56 shrink-0 flex flex-col border-r border-white/[0.06]"
          style={{ background: "rgba(255,255,255,0.012)" }}>
          {/* Tab bar */}
          <div className="flex border-b border-white/[0.06]">
            {(["threads", "images"] as LeftTab[]).map((tab) => (
              <button key={tab} onClick={() => setLeftTab(tab)}
                className={`flex-1 py-2 text-[10px] font-semibold uppercase tracking-wider transition-all ${leftTab === tab ? "text-violet-300 border-b-2 border-violet-500" : "text-white/25 hover:text-white/50"}`}>
                {tab === "threads" ? (
                  <><i className="fa-solid fa-layer-group text-[8px] mr-1.5" />Threads</>
                ) : (
                  <><i className="fa-solid fa-images text-[8px] mr-1.5" />Images</>
                )}
              </button>
            ))}
          </div>

          {/* TAB: THREADS */}
          {leftTab === "threads" && (
            <div className="flex-1 overflow-y-auto py-1 px-1.5 space-y-0.5 scrollbar-thin">
              {threads.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 px-3">
                  <i className="fa-regular fa-folder-open text-white/[0.08] text-2xl" />
                  <p className="text-[10px] text-white/20 text-center">No threads yet</p>
                </div>
              ) : (
                threads.map((t) => (
                  <div key={t.id}
                    onClick={() => switchThread(t.id)}
                    className={`group flex items-start gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all ${
                      t.id === activeThreadId
                        ? "bg-violet-500/15 border border-violet-500/25"
                        : "hover:bg-white/[0.04] border border-transparent"
                    }`}>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[10px] font-medium truncate ${t.id === activeThreadId ? "text-violet-300" : "text-white/60"}`}>
                        {t.title}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[8px] text-white/25">{fmtDate(t.updatedAt)} · {fmtTime(t.updatedAt)}</span>
                        {t.imageCount > 0 && (
                          <span className="text-[8px] text-white/20">{t.imageCount} img{t.imageCount !== 1 ? "s" : ""}</span>
                        )}
                        {t.totalCost > 0 && (
                          <span className="text-[8px] text-amber-400/40 font-mono">{fmtCost(t.totalCost)}</span>
                        )}
                      </div>
                    </div>
                    {/* Delete (only show on hover, never for last thread) */}
                    {threads.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteThread(t.id); }}
                        className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 text-white/20 hover:text-red-400 transition-all p-0.5 rounded"
                        title="Delete thread">
                        <i className="fa-solid fa-trash text-[8px]" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB: IMAGES (current thread) */}
          {leftTab === "images" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Undo/Redo */}
              <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/[0.04] shrink-0">
                <button onClick={handleUndo} disabled={!canUndo}
                  className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[9px] font-medium transition-all ${canUndo ? "text-white/50 hover:text-white/80 hover:bg-white/[0.06]" : "text-white/15 cursor-not-allowed"}`}>
                  <i className="fa-solid fa-rotate-left text-[8px]" />Undo
                </button>
                <div className="w-px h-3 bg-white/[0.06]" />
                <button onClick={handleRedo} disabled={!canRedo}
                  className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[9px] font-medium transition-all ${canRedo ? "text-white/50 hover:text-white/80 hover:bg-white/[0.06]" : "text-white/15 cursor-not-allowed"}`}>
                  Redo<i className="fa-solid fa-rotate-right text-[8px]" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto py-1.5 space-y-1 px-1.5 scrollbar-thin">
                {history.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2 px-3">
                    <i className="fa-regular fa-image text-white/[0.08] text-2xl" />
                    <p className="text-[10px] text-white/20 text-center leading-relaxed">Generations will<br/>appear here</p>
                  </div>
                ) : (
                  history.map((item, idx) => (
                    <motion.button key={item.id} onClick={() => loadHistoryItem(item)} whileHover={{ scale: 1.02 }}
                      className={`w-full flex flex-col gap-1 p-1.5 rounded-lg transition-all text-left ${
                        historyIndex === idx
                          ? "bg-violet-500/20 border border-violet-500/30 shadow-[0_0_12px_rgba(139,92,246,0.15)]"
                          : "hover:bg-white/[0.04] border border-transparent"
                      }`}>
                      <div className="w-full aspect-[4/3] rounded-md overflow-hidden bg-white/[0.04]">
                        <img src={`data:image/png;base64,${item.imageB64}`} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
                      </div>
                      <p className="text-[9px] font-medium text-white/70 truncate leading-tight">{item.title}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-[8px] text-white/25">{fmtTime(item.timestamp)}</span>
                        <span className="text-[8px] text-amber-400/50 font-mono">{fmtCost(item.cost)}</span>
                      </div>
                    </motion.button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* ▌ CENTER — Chat Timeline ────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Original / AI Edit toggle */}
          {originalImageB64 && currentImageB64 && originalImageB64 !== currentImageB64 && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
              className="absolute top-3 left-1/2 -translate-x-1/2 z-20">
              <button onMouseDown={() => setShowOriginal(true)} onMouseUp={() => setShowOriginal(false)} onMouseLeave={() => setShowOriginal(false)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all"
                style={{ background: showOriginal ? "rgba(236,72,153,0.25)" : "rgba(139,92,246,0.2)", border: `1px solid ${showOriginal ? "rgba(236,72,153,0.4)" : "rgba(139,92,246,0.35)"}`, color: showOriginal ? "#f9a8d4" : "#c084fc", backdropFilter: "blur(12px)" }}
                title="Hold to compare with original">
                <i className={`fa-solid ${showOriginal ? "fa-eye" : "fa-wand-magic-sparkles"} text-[9px]`} />
                {showOriginal ? "Viewing Original" : "AI Edit"}
              </button>
            </motion.div>
          )}

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 scrollbar-thin">
            {/* Empty states */}
            {!originalImageB64 && isBlankCanvas && history.length === 0 && !isGenerating && (
              <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
                <div className="w-20 h-20 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.12), rgba(236,72,153,0.08))", border: "1px solid rgba(139,92,246,0.15)" }}>
                  <i className="fa-solid fa-wand-magic-sparkles text-3xl text-white/15" />
                </div>
                <div className="text-center space-y-1.5">
                  <p className="text-[13px] text-white/35 font-medium">Ready to Create</p>
                  <p className="text-[11px] text-white/20 leading-relaxed max-w-sm">Describe an image below to generate it, or open an<br/>image from the Stage to start conversational editing.</p>
                </div>
                {!apiStatus.hasKey && settings !== null && (
                  <motion.button initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                    onClick={() => invoke("open_settings").catch(() => {})}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-medium mt-1"
                    style={{ background: "rgba(245,158,11,0.12)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.25)" }}>
                    <i className="fa-solid fa-key text-[11px]" />Add {apiStatus.provider === "google" ? "Google Gemini" : "OpenAI"} API key
                  </motion.button>
                )}
              </div>
            )}

            {/* Original image loaded from Stage */}
            {originalImageB64 && !isBlankCanvas && history.length === 0 && !isGenerating && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-3">
                <div className="rounded-xl overflow-hidden shadow-2xl max-w-lg border border-white/[0.06]" style={{ boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>
                  <img src={`data:image/png;base64,${originalImageB64}`} alt="Original" className="max-w-full max-h-[50vh] object-contain" draggable={false} />
                </div>
                <p className="text-[11px] text-white/30">Original image loaded — describe your edits below</p>
              </motion.div>
            )}

            {/* Chat messages */}
            {chatHistory.map((item) => (
              <motion.div key={item.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="space-y-2.5">
                {/* User bubble */}
                <div className="flex justify-end">
                  <div className="max-w-[70%] px-3.5 py-2 rounded-2xl rounded-br-sm" style={{ background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.2)" }}>
                    <p className="text-[12px] text-white/80 leading-relaxed whitespace-pre-wrap">{item.prompt}</p>
                  </div>
                </div>
                {/* AI response */}
                <div className="flex justify-start">
                  <div className={`max-w-[80%] rounded-2xl rounded-bl-sm p-2 transition-all ${historyIndex >= 0 && history[historyIndex]?.id === item.id ? "ring-2 ring-violet-500/40 shadow-[0_0_20px_rgba(139,92,246,0.15)]" : ""}`}
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="rounded-xl overflow-hidden cursor-pointer group relative"
                      onClick={() => setExpandedImageId(expandedImageId === item.id ? null : item.id)}>
                      <img src={`data:image/png;base64,${item.imageB64}`} alt={item.title}
                        className={`object-contain transition-all duration-300 ${expandedImageId === item.id ? "max-w-full max-h-[65vh]" : "max-w-md max-h-72"}`} draggable={false} />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                        <i className={`fa-solid ${expandedImageId === item.id ? "fa-compress" : "fa-expand"} text-white/0 group-hover:text-white/50 transition-all text-sm`} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-1.5 px-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-medium text-white/50">{item.title}</span>
                        <span className="text-[9px] text-white/20">·</span>
                        <span className="text-[9px] text-white/25">{MODELS.find((m) => m.id === item.model)?.label ?? item.model}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[8px] text-white/20">{fmtTime(item.timestamp)}</span>
                        <span className="text-[8px] text-amber-400/40 font-mono">{fmtCost(item.cost)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 mt-1.5 px-1">
                      <button onClick={(e) => { e.stopPropagation(); loadHistoryItem(item); }}
                        className="text-[9px] text-white/30 hover:text-violet-300 transition-colors px-1.5 py-0.5 rounded hover:bg-violet-500/10">
                        <i className="fa-solid fa-pen-to-square mr-1 text-[8px]" />Edit from here
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleSendToStage(item.imageB64); }}
                        className="text-[9px] text-white/30 hover:text-emerald-300 transition-colors px-1.5 py-0.5 rounded hover:bg-emerald-500/10">
                        <i className="fa-solid fa-arrow-up-from-bracket mr-1 text-[8px]" />Stage
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}

            {/* Generating */}
            {isGenerating && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="flex items-center gap-3">
                    <div className="relative w-8 h-8">
                      <div className="absolute inset-0 rounded-full border-2 border-violet-500/30 animate-ping" />
                      <div className="absolute inset-1 rounded-full border-2 border-violet-400/50 animate-pulse" />
                      <i className="fa-solid fa-wand-magic-sparkles absolute inset-0 flex items-center justify-center text-violet-400 text-xs m-auto" style={{ display: "flex" }} />
                    </div>
                    <div>
                      <p className="text-[11px] text-white/50">Generating with {currentModel.label}</p>
                      <p className="text-[9px] text-white/25 mt-0.5">This may take a moment…</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Floating Send to Stage */}
          {currentImageB64 && !isGenerating && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="absolute bottom-3 right-3 z-10">
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={() => handleSendToStage()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium shadow-lg"
                style={{ background: "rgba(16,185,129,0.2)", color: "#6ee7b7", border: "1px solid rgba(16,185,129,0.3)", backdropFilter: "blur(12px)" }}>
                <i className="fa-solid fa-arrow-up-from-bracket text-[10px]" />Send to Stage
              </motion.button>
            </motion.div>
          )}
        </div>

        {/* ▌ RIGHT PANEL — Parameters ──────────────────────────────────── */}
        <div className="w-52 shrink-0 flex flex-col border-l border-white/[0.06] overflow-hidden"
          style={{ background: "rgba(255,255,255,0.012)" }}>
          <div className="px-3 py-2 border-b border-white/[0.06]">
            <span className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">Parameters</span>
          </div>
          <div className="flex-1 px-3 py-2.5 space-y-3.5 overflow-y-auto scrollbar-thin">
            {/* Aspect Ratio */}
            <div className="space-y-1.5">
              <span className="text-[10px] text-white/40 font-medium">Aspect Ratio</span>
              <div className="flex flex-wrap gap-1">
                {(isGoogleModel ? GEMINI_ASPECT_OPTIONS : OPENAI_ASPECT_OPTIONS).map((ar) => (
                  <button key={ar.value} onClick={() => setAspectRatio(ar.value)}
                    className={`px-2 py-1 rounded-md text-[9px] font-medium transition-all ${aspectRatio === ar.value ? "bg-violet-500/25 text-violet-300 border border-violet-500/35" : "text-white/35 hover:text-white/60 hover:bg-white/[0.04] border border-transparent"}`}>
                    {ar.label}
                  </button>
                ))}
              </div>
            </div>
            {/* Gemini: Image Size */}
            {isGoogleModel && (
              <div className="space-y-1.5">
                <span className="text-[10px] text-white/40 font-medium">Image Size</span>
                <div className="flex gap-1">
                  {IMAGE_SIZE_OPTIONS.map((sz) => (
                    <button key={sz.value} onClick={() => setImageSize(sz.value)} title={sz.desc}
                      className={`flex-1 py-1 rounded-md text-[9px] font-medium transition-all ${imageSize === sz.value ? "bg-violet-500/25 text-violet-300 border border-violet-500/35" : "text-white/35 hover:text-white/60 hover:bg-white/[0.04] border border-transparent"}`}>
                      {sz.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Style */}
            <div className="space-y-1.5">
              <span className="text-[10px] text-white/40 font-medium">Style</span>
              <div className="grid grid-cols-2 gap-0.5">
                {STYLE_OPTIONS.map((s) => (
                  <button key={s.value} onClick={() => setImageStyle(s.value)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[9px] transition-all text-left ${imageStyle === s.value ? "bg-violet-500/20 text-violet-300" : "text-white/35 hover:text-white/60 hover:bg-white/[0.04]"}`}>
                    <i className={`fa-solid ${s.icon} text-[8px] ${imageStyle === s.value ? "text-violet-400" : "text-white/25"}`} />{s.label}
                  </button>
                ))}
              </div>
            </div>
            {/* Pro: Thinking */}
            {selectedModel === "gemini-3-pro-image-preview" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-white/40 font-medium">Thinking</span>
                  <span className="text-[9px] text-violet-300 font-mono">{thinkingLevel <= 50 ? "Minimal" : "High"}</span>
                </div>
                <input type="range" min={0} max={100} value={thinkingLevel} onChange={(e) => setThinkingLevel(Number(e.target.value))} className="w-full h-1 appearance-none rounded-full cursor-pointer" style={{ background: `linear-gradient(to right, rgba(139,92,246,0.6) ${thinkingLevel}%, rgba(255,255,255,0.08) ${thinkingLevel}%)` }} />
              </div>
            )}
            {/* OpenAI: Resolution */}
            {!isGoogleModel && (
              <div className="space-y-1.5">
                <span className="text-[10px] text-white/40 font-medium">Resolution</span>
                <div className="flex gap-1">
                  {(["standard", "hd"] as const).map((r) => (
                    <button key={r} onClick={() => setResolution(r)} className={`flex-1 py-1 rounded-md text-[9px] font-medium transition-all ${resolution === r ? "bg-violet-500/25 text-violet-300 border border-violet-500/35" : "text-white/35 hover:text-white/60 hover:bg-white/[0.04] border border-transparent"}`}>
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
                  <span className="text-[10px] text-white/40 font-medium">Adherence</span>
                  <span className="text-[9px] text-violet-300 font-mono">{adherence}%</span>
                </div>
                <input type="range" min={0} max={100} value={adherence} onChange={(e) => setAdherence(Number(e.target.value))} className="w-full h-1 appearance-none rounded-full cursor-pointer" style={{ background: `linear-gradient(to right, rgba(139,92,246,0.6) ${adherence}%, rgba(255,255,255,0.08) ${adherence}%)` }} />
              </div>
            )}
            {/* Session summary */}
            <div className="pt-3 border-t border-white/[0.06] space-y-1.5">
              <span className="text-[10px] text-white/35 font-semibold uppercase tracking-wider">Session</span>
              <div className="space-y-1">
                <div className="flex justify-between text-[9px]"><span className="text-white/30">Generations:</span><span className="text-white/50 font-mono">{history.length}</span></div>
                <div className="flex justify-between text-[9px]"><span className="text-white/30">Cost:</span><span className="text-amber-300/80 font-mono">{fmtCost(sessionCost)}</span></div>
                <div className="flex justify-between text-[9px]"><span className="text-white/30">Threads:</span><span className="text-white/50 font-mono">{threads.length}</span></div>
              </div>
            </div>
            <div className="pt-3 border-t border-white/[0.06] space-y-1">
              <span className="text-[10px] text-white/35 font-semibold uppercase tracking-wider">Model</span>
              <p className="text-[10px] text-violet-300/80 font-medium">{currentModel.label}</p>
              <p className="text-[9px] text-white/25">{currentModel.desc}</p>
              <p className="text-[9px] text-amber-400/50 font-mono">~{fmtCost(currentModel.cost)} per image</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── COMMAND DECK ─────────────────────────────────────────────────── */}
      <div className="border-t border-white/[0.06] shrink-0" style={{ background: "rgba(255,255,255,0.02)", backdropFilter: "blur(24px)" }}>
        {/* Tier 1 */}
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-white/[0.04]">
          <button onClick={() => setShowPromptLib(!showPromptLib)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium transition-all ${showPromptLib ? "bg-violet-500/15 text-violet-300" : "text-white/35 hover:text-white/60 hover:bg-white/[0.04]"}`}>
            <i className="fa-solid fa-book-bookmark text-[9px]" />Prompts
          </button>
          <div className="w-px h-4 bg-white/[0.06]" />
          <div className="flex-1 flex justify-center">
            <div className="relative">
              <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value as ModelId)}
                className="appearance-none px-3 pr-7 py-1 rounded-lg text-[11px] font-medium outline-none cursor-pointer transition-all hover:brightness-110"
                style={{ background: "rgba(139,92,246,0.12)", color: "#c084fc", border: "1px solid rgba(139,92,246,0.25)" }}>
                {MODELS.map((m) => <option key={m.id} value={m.id} className="bg-[#0f0f1a] text-white">{m.label} — {m.desc}</option>)}
              </select>
              <i className="fa-solid fa-chevron-down absolute right-2.5 top-1/2 -translate-y-1/2 text-[8px] text-violet-400/60 pointer-events-none" />
            </div>
          </div>
          <div className="w-px h-4 bg-white/[0.06]" />
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <i className="fa-solid fa-coins text-[9px] text-amber-400/70" />
            <span className="text-[10px] font-medium text-white/40">Session:</span>
            <span className="text-[10px] font-mono text-amber-300/80">{fmtCost(sessionCost)}</span>
          </div>
        </div>
        {/* Tier 2 */}
        <div className="flex items-end gap-2 px-4 py-2.5">
          <div className="flex-1 relative">
            <textarea ref={promptRef} value={prompt} onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !isGenerating) { e.preventDefault(); handleSend(); } }}
              placeholder={currentImageB64 ? "Describe changes to make… (Enter to send)" : "Describe an image to generate… (Enter to send)"}
              rows={2}
              className="w-full resize-none px-3.5 py-2.5 pr-10 rounded-xl text-[12px] text-white/80 placeholder:text-white/20 outline-none transition-all focus:ring-1 focus:ring-violet-500/30"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", lineHeight: "1.5" }} />
            <button onClick={handleEnhance} disabled={isEnhancing || isGenerating || !prompt.trim()}
              className="absolute right-2.5 bottom-2.5 w-6 h-6 rounded-md flex items-center justify-center transition-all disabled:opacity-20 hover:bg-violet-500/20 hover:scale-110 active:scale-95"
              style={{ color: "#c084fc" }} title="Enhance prompt with AI">
              {isEnhancing ? <i className="fa-solid fa-spinner fa-spin text-[9px]" /> : <i className="fa-solid fa-wand-magic-sparkles text-[10px]" />}
            </button>
          </div>
          <div className="flex gap-1.5 pb-0.5">
            <motion.button whileHover={canUndo ? { scale: 1.08 } : {}} whileTap={canUndo ? { scale: 0.92 } : {}}
              onClick={handleUndo} disabled={!canUndo}
              className={`flex items-center px-2 py-2 rounded-xl text-[10px] font-medium transition-all border ${canUndo ? "text-white/50 hover:text-white/80 hover:bg-white/[0.06] border-white/[0.06]" : "text-white/15 border-white/[0.03] cursor-not-allowed"}`}>
              <i className="fa-solid fa-rotate-left text-[9px]" />
            </motion.button>
            <motion.button whileHover={canRedo ? { scale: 1.08 } : {}} whileTap={canRedo ? { scale: 0.92 } : {}}
              onClick={handleRedo} disabled={!canRedo}
              className={`flex items-center px-2 py-2 rounded-xl text-[10px] font-medium transition-all border ${canRedo ? "text-white/50 hover:text-white/80 hover:bg-white/[0.06] border-white/[0.06]" : "text-white/15 border-white/[0.03] cursor-not-allowed"}`}>
              <i className="fa-solid fa-rotate-right text-[9px]" />
            </motion.button>
            <div className="w-px h-8 bg-white/[0.06] self-center" />
            <motion.button whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
              onClick={() => handleSend()} disabled={isGenerating || !prompt.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: !isGenerating && prompt.trim() ? "linear-gradient(135deg, rgba(139,92,246,0.5), rgba(236,72,153,0.4))" : "rgba(139,92,246,0.15)",
                color: !isGenerating && prompt.trim() ? "#f0abfc" : "rgba(255,255,255,0.3)",
                border: `1px solid ${!isGenerating && prompt.trim() ? "rgba(168,85,247,0.5)" : "rgba(139,92,246,0.15)"}`,
                boxShadow: !isGenerating && prompt.trim() ? "0 4px 16px rgba(139,92,246,0.2)" : "none",
              }}>
              <i className="fa-solid fa-paper-plane text-[10px]" />Send
            </motion.button>
            <motion.button whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
              onClick={() => handleSend(lastPrompt)} disabled={isGenerating || !lastPrompt}
              className="flex items-center px-2.5 py-2 rounded-xl text-[11px] font-medium transition-all disabled:opacity-25 text-white/45 hover:text-white/80 hover:bg-white/[0.06] border border-white/[0.06]"
              title="Retry last prompt">
              <i className="fa-solid fa-rotate text-[9px]" />
            </motion.button>
            <motion.button whileHover={isGenerating ? { scale: 1.06 } : {}} whileTap={isGenerating ? { scale: 0.94 } : {}}
              onClick={() => { abortRef.current = true; setIsGenerating(false); showToast("Cancelled"); }}
              disabled={!isGenerating}
              className={`flex items-center px-2.5 py-2 rounded-xl text-[11px] font-medium transition-all border ${isGenerating ? "text-red-400 hover:bg-red-500/15 border-red-500/25" : "text-white/15 border-white/[0.03] cursor-not-allowed"}`}>
              <i className="fa-solid fa-stop text-[9px]" />
            </motion.button>
          </div>
        </div>
      </div>

      {/* ── PROMPT LIBRARY ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {showPromptLib && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-[100px] left-4 z-50 rounded-xl w-96 overflow-hidden"
            style={{ background: "rgba(10,10,18,0.97)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 24px 60px rgba(0,0,0,0.7)" }}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
              <span className="text-[11px] font-semibold text-white/70"><i className="fa-solid fa-book-bookmark text-[9px] mr-1.5 text-violet-400" />Prompt Library{savedPrompts.length > 0 && <span className="text-[9px] text-white/25 ml-1.5">({savedPrompts.length})</span>}</span>
              <div className="flex items-center gap-1">
                {savedPrompts.length > 0 && (
                  <button onClick={() => { const blob = new Blob([JSON.stringify(savedPrompts, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "zenith_prompts.json"; a.click(); URL.revokeObjectURL(url); showToast("Exported!"); }}
                    className="text-white/25 hover:text-emerald-300 transition-colors px-1.5 py-0.5 rounded hover:bg-emerald-500/10" title="Export">
                    <i className="fa-solid fa-file-export text-[9px]" />
                  </button>
                )}
                <button onClick={() => { const input = document.createElement("input"); input.type = "file"; input.accept = ".json,.txt"; input.onchange = (e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const text = reader.result as string; let imported: SavedPrompt[]; if (file.name.endsWith(".json")) { const parsed = JSON.parse(text); if (!Array.isArray(parsed)) { showToast("Invalid format"); return; } imported = parsed.map((p: { name?: string; text?: string }, i: number) => ({ id: uid(), name: p.name || `Imported ${i+1}`, text: p.text || String(p) })); } else { imported = text.split("\n").filter((l: string) => l.trim()).map((line: string, i: number) => ({ id: uid(), name: `Imported ${i+1}`, text: line.trim() })); } if (imported.length) { savePromptsToStorage([...imported, ...savedPrompts]); showToast(`Imported ${imported.length} prompts`); } } catch { showToast("Parse error"); } }; reader.readAsText(file); }; input.click(); }}
                  className="text-white/25 hover:text-violet-300 transition-colors px-1.5 py-0.5 rounded hover:bg-violet-500/10" title="Import">
                  <i className="fa-solid fa-file-import text-[9px]" />
                </button>
                {savedPrompts.length > 0 && (
                  <button onClick={() => { savePromptsToStorage([]); showToast("All prompts cleared"); }}
                    className="text-white/25 hover:text-red-400 transition-colors px-1.5 py-0.5 rounded hover:bg-red-500/10" title="Clear all">
                    <i className="fa-solid fa-trash-can text-[9px]" />
                  </button>
                )}
                <button onClick={() => setShowPromptLib(false)} className="text-white/30 hover:text-white/70 transition-colors ml-1"><i className="fa-solid fa-xmark text-[11px]" /></button>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.06]">
              <input type="text" placeholder="Name this prompt…" value={promptLibName} onChange={(e) => setPromptLibName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveCurrentPrompt()}
                className="flex-1 px-2 py-1 rounded-md text-[10px] text-white/70 placeholder:text-white/20 outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }} />
              <button onClick={saveCurrentPrompt} disabled={!promptLibName.trim() || !prompt.trim()}
                className="px-2 py-1 rounded-md text-[10px] font-medium text-violet-300 hover:bg-violet-500/15 transition-colors disabled:opacity-25">
                <i className="fa-solid fa-plus text-[9px] mr-1" />Save
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {savedPrompts.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 px-4">
                  <i className="fa-regular fa-folder-open text-white/10 text-xl" />
                  <p className="text-[10px] text-white/25 text-center">No saved prompts yet</p>
                </div>
              ) : savedPrompts.map((sp) => (
                <div key={sp.id} className="flex items-start gap-2 px-3 py-2 hover:bg-white/[0.04] transition-colors group border-b border-white/[0.03] last:border-0">
                  <button onClick={() => { setPrompt(sp.text); setShowPromptLib(false); }} className="flex-1 text-left min-w-0">
                    <p className="text-[10px] font-medium text-white/65 group-hover:text-white/90 truncate">{sp.name}</p>
                    <p className="text-[9px] text-white/25 line-clamp-2 mt-0.5 leading-relaxed">{sp.text}</p>
                  </button>
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                    <button onClick={() => { navigator.clipboard.writeText(sp.text); showToast("Copied"); }} className="text-white/30 hover:text-violet-300 transition-colors p-0.5 rounded"><i className="fa-regular fa-copy text-[8px]" /></button>
                    <button onClick={() => deletePrompt(sp.id)} className="text-white/30 hover:text-red-400 transition-colors p-0.5 rounded"><i className="fa-solid fa-trash text-[8px]" /></button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── TOAST ────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-[11px] font-medium text-white/90 pointer-events-none z-[60]"
            style={{ background: "rgba(10,10,18,0.94)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Click-outside dismiss */}
      {(showSaveOptions || showResetConfirm) && (
        <div className="fixed inset-0 z-[55]" onClick={() => { setShowSaveOptions(false); setShowResetConfirm(false); }} />
      )}
    </div>
  );
}
