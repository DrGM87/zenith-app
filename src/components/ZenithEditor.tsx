import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { motion, AnimatePresence } from "framer-motion";

// ── Types ────────────────────────────────────────────────────────────────────

interface ApiKeyEntry {
  provider: string;
  label: string;
  key: string;
  model: string;
  is_default: boolean;
}

interface ZenithSettings {
  api_keys: ApiKeyEntry[];
  vt_api_key: string;
  omdb_api_key: string;
  audiodb_api_key: string;
  imdb_api_key: string;
  token_usage?: TokenUsage;
  [key: string]: unknown;
}

interface TokenUsageEntry {
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

interface TokenUsage {
  entries: TokenUsageEntry[];
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
}

interface HistoryItem {
  id: string;
  imageB64: string;
  prompt: string;
  title: string;
  timestamp: number;
  cost: number;
  model: string;
}

interface HistoryMeta {
  id: string;
  prompt: string;
  title: string;
  timestamp: number;
  cost: number;
  model: string;
  filePath: string;
}

interface SavedPrompt {
  id: string;
  name: string;
  text: string;
}

type ModelId = "gemini-3.1-flash-image-preview" | "gemini-3-pro-image-preview" | "gpt-image-1.5";
type AspectRatio = "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9";
type ImageSize = "512" | "1K" | "2K" | "4K";
type ImageStyle = "photorealistic" | "digital_art" | "vector" | "anime" | "watercolor" | "oil_painting" | "3d_render" | "pixel_art" | "sketch" | "";
type SaveFormat = "png" | "jpg" | "webp";

// ── Constants ─────────────────────────────────────────────────────────────────

const MODELS: { id: ModelId; label: string; desc: string; provider: "google" | "openai"; cost: number }[] = [
  { id: "gemini-3.1-flash-image-preview", label: "Nano Banana 2", desc: "Fast · High quality · Google", provider: "google", cost: 0.067 },
  { id: "gemini-3-pro-image-preview",     label: "Nano Banana Pro", desc: "Deep reasoning · Google",     provider: "google", cost: 0.134 },
  { id: "gpt-image-1.5",                  label: "GPT-Image 1.5",  desc: "Ultra-realistic · OpenAI",    provider: "openai", cost: 0.133 },
];

const GEMINI_ASPECT_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: "1:1",  label: "1:1" },
  { value: "2:3",  label: "2:3" },
  { value: "3:2",  label: "3:2" },
  { value: "3:4",  label: "3:4" },
  { value: "4:3",  label: "4:3" },
  { value: "4:5",  label: "4:5" },
  { value: "5:4",  label: "5:4" },
  { value: "9:16", label: "9:16" },
  { value: "16:9", label: "16:9" },
  { value: "21:9", label: "21:9" },
];
const OPENAI_ASPECT_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: "1:1",  label: "1:1" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
];
const IMAGE_SIZE_OPTIONS: { value: ImageSize; label: string; desc: string }[] = [
  { value: "512", label: "512",  desc: "Fast preview" },
  { value: "1K",  label: "1K",   desc: "Standard" },
  { value: "2K",  label: "2K",   desc: "High detail" },
  { value: "4K",  label: "4K",   desc: "Maximum quality" },
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

const PROMPTS_KEY = "zenith_editor_prompts";
const HISTORY_KEY = "zenith_editor_history";

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtCost(n: number): string { return `$${n.toFixed(3)}`; }

const IMAGE_MODEL_IDS: Set<string> = new Set(MODELS.map((m) => m.id));

// ── Persistence Helpers ──────────────────────────────────────────────────────

async function saveHistoryItemToDisk(item: HistoryItem): Promise<string | null> {
  try {
    const argsJson = JSON.stringify({
      image_b64: item.imageB64, format: "png", quality: 100,
      filename: `history_${item.id}`,
    });
    const r = JSON.parse(await invoke<string>("process_file", { action: "save_editor_image", argsJson }));
    return r.ok ? r.path : null;
  } catch { return null; }
}

function saveHistoryMeta(meta: HistoryMeta[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(meta.slice(0, 30))); } catch { /* quota */ }
}

function loadHistoryMeta(): HistoryMeta[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// ── Cost Tracking ────────────────────────────────────────────────────────────

async function trackImageCost(provider: string, _model: string, cost: number) {
  try {
    const s = await invoke<ZenithSettings>("get_settings");
    const tu = s.token_usage ?? { entries: [], total_input_tokens: 0, total_output_tokens: 0, total_cost_usd: 0 };
    const entries = [...tu.entries];
    const idx = entries.findIndex((e) => e.provider === provider);
    if (idx >= 0) {
      entries[idx] = { ...entries[idx], cost_usd: entries[idx].cost_usd + cost };
    } else {
      entries.push({ provider, input_tokens: 0, output_tokens: 0, cost_usd: cost });
    }
    const updated: ZenithSettings = {
      ...s,
      token_usage: {
        entries,
        total_input_tokens: tu.total_input_tokens,
        total_output_tokens: tu.total_output_tokens,
        total_cost_usd: tu.total_cost_usd + cost,
      },
    };
    await invoke("save_settings", { newSettings: updated });
  } catch (e) { console.error("Failed to track image cost:", e); }
}

async function trackTextTokenUsage(result: { token_usage?: { provider: string; model: string; input_tokens: number; output_tokens: number } }) {
  if (!result.token_usage) return;
  const { provider, model, input_tokens, output_tokens } = result.token_usage;
  if (input_tokens === 0 && output_tokens === 0) return;
  try {
    const s = await invoke<ZenithSettings>("get_settings");
    const PRICING: Record<string, Record<string, { input: number; output: number }>> = {
      openai: { "gpt-4.1-nano": { input: 0.10, output: 0.40 }, "gpt-4o-mini": { input: 0.15, output: 0.60 }, "gpt-4.1-mini": { input: 0.40, output: 1.60 }, "o3-mini": { input: 1.10, output: 4.40 }, "o4-mini": { input: 1.10, output: 4.40 }, "gpt-4.1": { input: 2.00, output: 8.00 }, "gpt-4o": { input: 2.50, output: 10.00 } },
      anthropic: { "claude-haiku-4-5-20250514": { input: 1.00, output: 5.00 }, "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 }, "claude-opus-4-20250918": { input: 5.00, output: 25.00 } },
      google: { "gemini-2.5-flash": { input: 0.15, output: 0.60 }, "gemini-3-flash-preview": { input: 0.50, output: 3.00 }, "gemini-2.5-pro": { input: 1.25, output: 10.00 }, "gemini-3.1-pro-preview": { input: 2.00, output: 12.00 } },
      deepseek: { "deepseek-chat": { input: 0.27, output: 1.10 }, "deepseek-reasoner": { input: 0.55, output: 2.19 } },
      groq: { "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 }, "llama-3.1-8b-instant": { input: 0.05, output: 0.08 }, "gemma2-9b-it": { input: 0.20, output: 0.20 } },
    };
    const rates = PRICING[provider]?.[model] || { input: 1.00, output: 2.00 };
    const cost = (input_tokens / 1_000_000) * rates.input + (output_tokens / 1_000_000) * rates.output;
    const tu = s.token_usage ?? { entries: [], total_input_tokens: 0, total_output_tokens: 0, total_cost_usd: 0 };
    const entries = [...tu.entries];
    const idx = entries.findIndex((e) => e.provider === provider);
    if (idx >= 0) {
      entries[idx] = { ...entries[idx], input_tokens: entries[idx].input_tokens + input_tokens, output_tokens: entries[idx].output_tokens + output_tokens, cost_usd: entries[idx].cost_usd + cost };
    } else {
      entries.push({ provider, input_tokens, output_tokens, cost_usd: cost });
    }
    const updated: ZenithSettings = {
      ...s,
      token_usage: {
        entries,
        total_input_tokens: tu.total_input_tokens + input_tokens,
        total_output_tokens: tu.total_output_tokens + output_tokens,
        total_cost_usd: tu.total_cost_usd + cost,
      },
    };
    await invoke("save_settings", { newSettings: updated });
  } catch (e) { console.error("Failed to track text token usage:", e); }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ZenithEditor() {
  // ── Settings & API keys
  const [settings, setSettings] = useState<ZenithSettings | null>(null);

  // ── Image state
  const [currentImageB64, setCurrentImageB64] = useState<string | null>(null);
  const [originalImageB64, setOriginalImageB64] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [isBlankCanvas, setIsBlankCanvas] = useState(true);

  // ── History & undo/redo
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1); // -1 = at latest / no history
  const [, setHistoryMetaCache] = useState<HistoryMeta[]>([]);
  const [, setHistoryRestored] = useState(false);

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
    setToast(msg);
    setTimeout(() => setToast(null), ms);
  }, []);

  // ── Load settings ──────────────────────────────────────────────────────────

  const loadSettings = useCallback(() => {
    invoke<ZenithSettings>("get_settings").then(setSettings).catch(() => {});
  }, []);

  useEffect(() => {
    loadSettings();
    const onFocus = () => loadSettings();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadSettings]);

  // ── Load saved prompts from localStorage ────────────────────────────────────

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROMPTS_KEY);
      if (raw) setSavedPrompts(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const savePromptsToStorage = useCallback((prompts: SavedPrompt[]) => {
    localStorage.setItem(PROMPTS_KEY, JSON.stringify(prompts));
    setSavedPrompts(prompts);
  }, []);

  // ── Restore history from disk on mount ──────────────────────────────────────

  useEffect(() => {
    (async () => {
      const meta = loadHistoryMeta();
      if (meta.length === 0) { setHistoryRestored(true); return; }
      const items: HistoryItem[] = [];
      for (const m of meta) {
        try {
          const b64 = await invoke<string>("read_file_base64", { path: m.filePath });
          items.push({ id: m.id, imageB64: b64, prompt: m.prompt, title: m.title, timestamp: m.timestamp, cost: m.cost, model: m.model });
        } catch { /* file gone, skip */ }
      }
      if (items.length > 0) {
        setHistory(items);
        setHistoryMetaCache(meta.filter((m) => items.some((i) => i.id === m.id)));
      }
      setHistoryRestored(true);
    })();
  }, []);

  // ── Load initial image via pending-path state ───────────────────────────────

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
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Listen for editor-load-image event ──────────────────────────────────────

  useEffect(() => {
    const unlisten = listen<string>("editor-load-image", async (event) => {
      const path = event.payload;
      if (!path) {
        setIsBlankCanvas(true);
        setCurrentImageB64(null);
        setOriginalImageB64(null);
        return;
      }
      setIsBlankCanvas(false);
      try {
        const b64 = await invoke<string>("read_file_base64", { path });
        setCurrentImageB64(b64);
        setOriginalImageB64(b64);
      } catch (e) { showToast(`Failed to load image: ${String(e)}`); }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [showToast]);

  // ── Auto-scroll chat to bottom ──────────────────────────────────────────────

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history.length, isGenerating]);

  // ── API key helpers ─────────────────────────────────────────────────────────

  const getApiCreds = useCallback(() => {
    const modelInfo = MODELS.find((m) => m.id === selectedModel);
    const provider = modelInfo?.provider ?? "google";
    const keys = settings?.api_keys ?? [];
    const entry = keys.find((k) => k.provider === provider && k.is_default) ?? keys.find((k) => k.provider === provider);
    return { api_key: entry?.key ?? "", provider, model: selectedModel, hasKey: !!entry?.key };
  }, [settings, selectedModel]);

  const getTextLlmCreds = useCallback(() => {
    const keys = settings?.api_keys ?? [];
    const def = keys.find((k) => k.is_default && !IMAGE_MODEL_IDS.has(k.model))
             ?? keys.find((k) => !IMAGE_MODEL_IDS.has(k.model))
             ?? keys.find((k) => k.is_default)
             ?? keys[0];
    return def
      ? { api_key: def.key, provider: def.provider, model: def.model }
      : { api_key: "", provider: "google", model: "" };
  }, [settings]);

  const apiStatus = getApiCreds();

  // ── Undo / Redo ────────────────────────────────────────────────────────────

  const canUndo = history.length > 0 && historyIndex < history.length - 1;
  const canRedo = historyIndex > 0;

  const handleUndo = useCallback(() => {
    if (!canUndo) return;
    const newIdx = historyIndex + 1;
    setHistoryIndex(newIdx);
    setCurrentImageB64(history[newIdx].imageB64);
    showToast(`Undo → ${history[newIdx].title}`);
  }, [canUndo, historyIndex, history, showToast]);

  const handleRedo = useCallback(() => {
    if (!canRedo) return;
    const newIdx = historyIndex - 1;
    setHistoryIndex(newIdx);
    setCurrentImageB64(history[newIdx].imageB64);
    showToast(`Redo → ${history[newIdx].title}`);
  }, [canRedo, historyIndex, history, showToast]);

  // ── Generate image ─────────────────────────────────────────────────────────

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
        model: selectedModel,
        prompt: p,
        api_key,
        provider,
        aspect_ratio: aspectRatio,
        style: imageStyle || undefined,
      };

      // Gemini-specific params
      if (provider === "google") {
        args.image_size = imageSize;
        if (selectedModel === "gemini-3-pro-image-preview") {
          // Map slider 0-100 to "minimal" or "High"
          args.thinking_level = thinkingLevel <= 50 ? "minimal" : "High";
        }
      }
      // OpenAI-specific params
      if (provider === "openai") {
        args.quality = resolution;
        if (adherence !== 70) args.adherence = adherence;
      }

      // Conversational: use current image as base for editing
      if (currentImageB64) args.image_b64 = currentImageB64;

      const resultStr = await invoke<string>("process_file", { action: "generate_image", argsJson: JSON.stringify(args) });
      if (abortRef.current) return;

      const result = JSON.parse(resultStr);
      if (!result.ok || !result.image_b64) {
        showToast(result.error || "Generation failed");
        return;
      }

      const newB64: string = result.image_b64;
      const cost: number = result.cost ?? MODELS.find((m) => m.id === selectedModel)?.cost ?? 0;

      setCurrentImageB64(newB64);
      setSessionCost((c) => c + cost);

      // Track cost in main settings
      trackImageCost(provider, selectedModel, cost);

      // Build history item
      const histItem: HistoryItem = { id: uid(), imageB64: newB64, prompt: p, title: "Generating title\u2026", timestamp: Date.now(), cost, model: selectedModel };
      setHistory((h) => [histItem, ...h]);
      setHistoryIndex(0);

      // Persist to disk
      const filePath = await saveHistoryItemToDisk(histItem);
      if (filePath) {
        const meta: HistoryMeta = { id: histItem.id, prompt: p, title: histItem.title, timestamp: histItem.timestamp, cost, model: selectedModel, filePath };
        setHistoryMetaCache((prev) => {
          const updated = [meta, ...prev].slice(0, 30);
          saveHistoryMeta(updated);
          return updated;
        });
      }

      // Auto-title in background
      const titleArgs = { prompt: p, ...getTextLlmCreds() };
      invoke<string>("process_file", { action: "auto_title_prompt", argsJson: JSON.stringify(titleArgs) })
        .then((r) => {
          try {
            const tr = JSON.parse(r);
            if (tr.ok && tr.title) {
              const title = tr.title;
              setHistory((h) => h.map((x) => x.id === histItem.id ? { ...x, title } : x));
              // Update persisted meta too
              setHistoryMetaCache((prev) => {
                const updated = prev.map((m) => m.id === histItem.id ? { ...m, title } : m);
                saveHistoryMeta(updated);
                return updated;
              });
            }
            // Track text LLM token usage
            trackTextTokenUsage(tr);
          } catch { /* ignore */ }
        }).catch(() => {});

      if (!retryPrompt) setPrompt("");
    } catch (e) {
      if (!abortRef.current) showToast(`Error: ${String(e)}`);
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, getApiCreds, getTextLlmCreds, selectedModel, aspectRatio, imageSize, resolution, imageStyle, thinkingLevel, adherence, currentImageB64, showToast]);

  // ── Enhance prompt ─────────────────────────────────────────────────────────

  const handleEnhance = useCallback(async () => {
    if (!prompt.trim()) { showToast("Enter a rough prompt first"); return; }
    const { api_key, provider, model } = getTextLlmCreds();
    if (!api_key) { showToast("No API key found for text LLM. Add one in Settings."); return; }
    setIsEnhancing(true);
    try {
      const argsJson = JSON.stringify({ prompt: prompt.trim(), api_key, provider, model });
      const r = JSON.parse(await invoke<string>("process_file", { action: "enhance_prompt", argsJson }));
      if (r.ok && r.enhanced_prompt) { setPrompt(r.enhanced_prompt); showToast("Prompt enhanced!"); }
      else showToast(r.error || "Enhancement failed");
      trackTextTokenUsage(r);
    } catch (e) { showToast(String(e)); }
    finally { setIsEnhancing(false); }
  }, [prompt, getTextLlmCreds, showToast]);

  // ── Save image ─────────────────────────────────────────────────────────────

  const handleSaveImage = useCallback(async () => {
    if (!currentImageB64) { showToast("Nothing to save"); return; }
    setShowSaveOptions(false);
    try {
      const argsJson = JSON.stringify({ image_b64: currentImageB64, format: saveFormat, quality: saveQuality, filename: `zenith_${Date.now()}` });
      const r = JSON.parse(await invoke<string>("process_file", { action: "save_editor_image", argsJson }));
      if (r.ok && r.path) {
        await invoke("stage_file", { path: r.path });
        await emit("items-changed");
        showToast(`Saved as ${saveFormat.toUpperCase()} — sent to Stage!`);
      } else showToast(r.error || "Save failed");
    } catch (e) { showToast(String(e)); }
  }, [currentImageB64, saveFormat, saveQuality, showToast]);

  // ── Send to Stage ──────────────────────────────────────────────────────────

  const handleSendToStage = useCallback(async (overrideB64?: string) => {
    const b64 = overrideB64 ?? currentImageB64;
    if (!b64) { showToast("Nothing to send"); return; }
    try {
      const argsJson = JSON.stringify({ image_b64: b64, format: "png", quality: 95, filename: `zenith_generated_${Date.now()}` });
      const r = JSON.parse(await invoke<string>("process_file", { action: "save_editor_image", argsJson }));
      if (r.ok && r.path) {
        await invoke("stage_file", { path: r.path });
        await emit("items-changed");
        showToast("Sent to Stage!");
      } else showToast(r.error || "Failed to save image");
    } catch (e) { showToast(String(e)); }
  }, [currentImageB64, showToast]);

  // ── New Canvas ─────────────────────────────────────────────────────────────

  const handleNewCanvas = useCallback(() => {
    setCurrentImageB64(null);
    setOriginalImageB64(null);
    setIsBlankCanvas(true);
    setHistoryIndex(-1);
    setPrompt("");
    showToast("New canvas ready");
    promptRef.current?.focus();
  }, [showToast]);

  // ── Reset editor ───────────────────────────────────────────────────────────

  const handleReset = useCallback(async () => {
    setShowResetConfirm(false);
    setCurrentImageB64(null);
    setOriginalImageB64(null);
    setHistory([]);
    setHistoryIndex(-1);
    setHistoryMetaCache([]);
    setSessionCost(0);
    setIsBlankCanvas(true);
    setLastPrompt("");
    setPrompt("");
    localStorage.removeItem(HISTORY_KEY);
    try { await invoke<string>("process_file", { action: "reset_editor", argsJson: "{}" }); } catch { /* ignore */ }
    showToast("Editor reset — history cleared");
  }, [showToast]);

  // ── History navigation ─────────────────────────────────────────────────────

  const loadHistoryItem = useCallback((item: HistoryItem) => {
    const idx = history.findIndex((h) => h.id === item.id);
    if (idx >= 0) {
      setHistoryIndex(idx);
      setCurrentImageB64(item.imageB64);
    }
  }, [history]);

  // ── Prompt library ─────────────────────────────────────────────────────────

  const saveCurrentPrompt = useCallback(() => {
    if (!promptLibName.trim() || !prompt.trim()) { showToast("Enter both a name and a prompt"); return; }
    const newPrompt: SavedPrompt = { id: uid(), name: promptLibName.trim(), text: prompt.trim() };
    savePromptsToStorage([newPrompt, ...savedPrompts]);
    setPromptLibName("");
    showToast(`Saved: "${newPrompt.name}"`);
  }, [promptLibName, prompt, savedPrompts, savePromptsToStorage, showToast]);

  const deletePrompt = useCallback((id: string) => {
    savePromptsToStorage(savedPrompts.filter((p) => p.id !== id));
  }, [savedPrompts, savePromptsToStorage]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const currentModel = MODELS.find((m) => m.id === selectedModel)!;
  const isGoogleModel = currentModel.provider === "google";
  const chatHistory = useMemo(() => [...history].reverse(), [history]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden select-none"
      style={{ background: "linear-gradient(135deg, #0a0a12 0%, #0f0f1a 50%, #0a0a12 100%)" }}>

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06] shrink-0"
        style={{ background: "rgba(255,255,255,0.02)", backdropFilter: "blur(20px)" }}
        data-tauri-drag-region>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: "linear-gradient(135deg, #8b5cf6, #ec4899)" }} />
            <span className="text-[13px] font-semibold text-white/90 tracking-wide">Zenith Editor</span>
          </div>
          <span className="text-[11px] text-white/25">
            {isBlankCanvas ? "New Canvas" : "Editing Image"}
          </span>
          {settings !== null && (
            apiStatus.hasKey ? (
              <span className="flex items-center gap-1 text-[10px] text-emerald-400/70">
                <i className="fa-solid fa-circle-check text-[8px]" />
                {apiStatus.provider === "google" ? "Google" : "OpenAI"} key active
              </span>
            ) : (
              <button onClick={() => invoke("open_settings").catch(() => {})}
                className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 transition-colors"
                title="Open Settings to add an API key">
                <i className="fa-solid fa-triangle-exclamation text-[9px]" />
                No {apiStatus.provider === "google" ? "Google" : "OpenAI"} key — click to add
              </button>
            )
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* New Canvas */}
          <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
            onClick={handleNewCanvas}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/45 hover:text-emerald-300 hover:bg-emerald-500/10 transition-all border border-white/[0.06] hover:border-emerald-500/30">
            <i className="fa-solid fa-plus text-[9px]" />New Canvas
          </motion.button>
          {/* Save options */}
          <div className="relative">
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={() => setShowSaveOptions(!showSaveOptions)}
              disabled={!currentImageB64}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-25 border"
              style={{ background: currentImageB64 ? "rgba(139,92,246,0.15)" : "transparent", color: currentImageB64 ? "#c084fc" : "rgba(255,255,255,0.3)", borderColor: currentImageB64 ? "rgba(139,92,246,0.25)" : "rgba(255,255,255,0.06)" }}>
              <i className="fa-solid fa-floppy-disk text-[10px]" />Save
              <i className={`fa-solid fa-chevron-${showSaveOptions ? "up" : "down"} text-[7px] opacity-50`} />
            </motion.button>
            <AnimatePresence>
              {showSaveOptions && (
                <motion.div initial={{ opacity: 0, y: -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  className="absolute right-0 top-full mt-1 z-50 rounded-xl p-3 space-y-2.5 w-56"
                  style={{ background: "rgba(10,10,18,0.97)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 20px 50px rgba(0,0,0,0.7)" }}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-white/40 w-14">Format:</span>
                    <div className="flex gap-1">
                      {(["png", "jpg", "webp"] as SaveFormat[]).map((f) => (
                        <button key={f} onClick={() => setSaveFormat(f)}
                          className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors uppercase ${saveFormat === f ? "bg-violet-500/30 text-violet-300" : "text-white/40 hover:text-white/70 hover:bg-white/5"}`}>
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>
                  {saveFormat !== "png" && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-white/40 w-14">Quality:</span>
                      <input type="range" min={50} max={100} step={1} value={saveQuality} onChange={(e) => setSaveQuality(Number(e.target.value))}
                        className="flex-1 h-1 appearance-none rounded-full cursor-pointer"
                        style={{ background: `linear-gradient(to right, rgba(139,92,246,0.6) ${saveQuality}%, rgba(255,255,255,0.08) ${saveQuality}%)` }} />
                      <span className="text-[10px] text-violet-300 font-mono w-7 text-right">{saveQuality}%</span>
                    </div>
                  )}
                  <button onClick={handleSaveImage}
                    className="w-full py-1.5 rounded-lg text-[11px] font-medium text-violet-300 hover:bg-violet-500/20 transition-colors border border-violet-500/20">
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
                  className="absolute right-0 top-full mt-1 z-50 rounded-xl p-3 w-56"
                  style={{ background: "rgba(10,10,18,0.97)", border: "1px solid rgba(239,68,68,0.2)", boxShadow: "0 16px 40px rgba(0,0,0,0.6)" }}>
                  <p className="text-[11px] text-white/60 mb-2.5">Clear all history and reset canvas?</p>
                  <div className="flex gap-1.5">
                    <button onClick={handleReset}
                      className="flex-1 py-1.5 rounded-lg text-[10px] font-medium text-red-300 bg-red-500/15 hover:bg-red-500/25 transition-colors border border-red-500/20">
                      Reset All
                    </button>
                    <button onClick={() => setShowResetConfirm(false)}
                      className="flex-1 py-1.5 rounded-lg text-[10px] font-medium text-white/50 hover:text-white/70 hover:bg-white/5 transition-colors border border-white/[0.06]">
                      Cancel
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ── MAIN BODY (3 columns) ──────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT PANEL — History Timeline */}
        <div className="w-52 shrink-0 flex flex-col border-r border-white/[0.06] overflow-hidden"
          style={{ background: "rgba(255,255,255,0.012)" }}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
            <span className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">History</span>
            {history.length > 0 && (
              <span className="text-[9px] text-white/20">{history.length} items</span>
            )}
          </div>
          {/* Undo/Redo bar */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/[0.04]">
            <button onClick={handleUndo} disabled={!canUndo}
              className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[9px] font-medium transition-all ${canUndo ? "text-white/50 hover:text-white/80 hover:bg-white/[0.06]" : "text-white/15 cursor-not-allowed"}`}
              title="Undo (go to older)">
              <i className="fa-solid fa-rotate-left text-[8px]" />Undo
            </button>
            <div className="w-px h-3 bg-white/[0.06]" />
            <button onClick={handleRedo} disabled={!canRedo}
              className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[9px] font-medium transition-all ${canRedo ? "text-white/50 hover:text-white/80 hover:bg-white/[0.06]" : "text-white/15 cursor-not-allowed"}`}
              title="Redo (go to newer)">
              Redo<i className="fa-solid fa-rotate-right text-[8px]" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto overflow-x-hidden py-1.5 space-y-1 px-1.5 scrollbar-thin">
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 px-3">
                <i className="fa-regular fa-clock-rotate-left text-white/[0.08] text-2xl" />
                <p className="text-[10px] text-white/20 text-center leading-relaxed">Generations will<br/>appear here</p>
              </div>
            ) : (
              history.map((item, idx) => (
                <motion.button key={item.id}
                  onClick={() => loadHistoryItem(item)}
                  whileHover={{ scale: 1.02 }}
                  className={`w-full flex flex-col gap-1 p-1.5 rounded-lg transition-all text-left ${
                    historyIndex === idx
                      ? "bg-violet-500/20 border border-violet-500/30 shadow-[0_0_12px_rgba(139,92,246,0.15)]"
                      : "hover:bg-white/[0.04] border border-transparent"
                  }`}>
                  <div className="w-full aspect-[4/3] rounded-md overflow-hidden bg-white/[0.04]">
                    <img src={`data:image/png;base64,${item.imageB64}`} alt={item.title}
                      className="w-full h-full object-cover" loading="lazy" />
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

        {/* CENTER — Chat Timeline */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Original / AI Edit toggle */}
          {originalImageB64 && currentImageB64 && originalImageB64 !== currentImageB64 && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
              className="absolute top-3 left-1/2 -translate-x-1/2 z-20">
              <button
                onMouseDown={() => setShowOriginal(true)}
                onMouseUp={() => setShowOriginal(false)}
                onMouseLeave={() => setShowOriginal(false)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all"
                style={{
                  background: showOriginal ? "rgba(236,72,153,0.25)" : "rgba(139,92,246,0.2)",
                  border: `1px solid ${showOriginal ? "rgba(236,72,153,0.4)" : "rgba(139,92,246,0.35)"}`,
                  color: showOriginal ? "#f9a8d4" : "#c084fc",
                  backdropFilter: "blur(12px)",
                }}
                title="Hold to compare with original">
                <i className={`fa-solid ${showOriginal ? "fa-eye" : "fa-wand-magic-sparkles"} text-[9px]`} />
                {showOriginal ? "Viewing Original" : "AI Edit"}
              </button>
            </motion.div>
          )}

          {/* Chat content */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 scrollbar-thin">
            {/* Original image entry (if loaded from Stage) */}
            {originalImageB64 && !isBlankCanvas && history.length === 0 && !isGenerating && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center gap-3">
                <div className="rounded-xl overflow-hidden shadow-2xl max-w-lg border border-white/[0.06]"
                  style={{ boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>
                  <img src={`data:image/png;base64,${originalImageB64}`} alt="Original"
                    className="max-w-full max-h-[50vh] object-contain" draggable={false} />
                </div>
                <p className="text-[11px] text-white/30">Original image loaded — describe your edits below</p>
              </motion.div>
            )}

            {/* Empty canvas state */}
            {!originalImageB64 && isBlankCanvas && history.length === 0 && !isGenerating && (
              <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
                <div className="w-20 h-20 rounded-2xl flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.12), rgba(236,72,153,0.08))", border: "1px solid rgba(139,92,246,0.15)" }}>
                  <i className="fa-solid fa-wand-magic-sparkles text-3xl text-white/15" />
                </div>
                <div className="text-center space-y-1.5">
                  <p className="text-[13px] text-white/35 font-medium">Welcome to the Generative Editor</p>
                  <p className="text-[11px] text-white/20 leading-relaxed max-w-sm">
                    Describe an image to generate it, or open an image<br/>from the Stage to start conversational editing.
                  </p>
                </div>
                {!apiStatus.hasKey && settings !== null && (
                  <motion.button initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                    onClick={() => invoke("open_settings").catch(() => {})}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-medium mt-1"
                    style={{ background: "rgba(245,158,11,0.12)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.25)" }}>
                    <i className="fa-solid fa-key text-[11px]" />
                    Add {apiStatus.provider === "google" ? "Google Gemini" : "OpenAI"} API key
                  </motion.button>
                )}
              </div>
            )}

            {/* Chat conversation */}
            {chatHistory.map((item) => (
              <motion.div key={item.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="space-y-2.5">
                {/* User prompt bubble */}
                <div className="flex justify-end">
                  <div className="max-w-[70%] px-3.5 py-2 rounded-2xl rounded-br-sm"
                    style={{ background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.2)" }}>
                    <p className="text-[12px] text-white/80 leading-relaxed whitespace-pre-wrap">{item.prompt}</p>
                  </div>
                </div>
                {/* AI response */}
                <div className="flex justify-start">
                  <div className={`max-w-[80%] rounded-2xl rounded-bl-sm p-2 transition-all ${
                    historyIndex >= 0 && history[historyIndex]?.id === item.id
                      ? "ring-2 ring-violet-500/40 shadow-[0_0_20px_rgba(139,92,246,0.15)]"
                      : ""
                  }`}
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="rounded-xl overflow-hidden cursor-pointer group relative"
                      onClick={() => setExpandedImageId(expandedImageId === item.id ? null : item.id)}>
                      <img src={`data:image/png;base64,${item.imageB64}`} alt={item.title}
                        className={`object-contain transition-all duration-300 ${
                          expandedImageId === item.id ? "max-w-full max-h-[65vh]" : "max-w-md max-h-72"
                        }`}
                        draggable={false} />
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
                    {/* Quick actions on this image */}
                    <div className="flex items-center gap-1 mt-1.5 px-1">
                      <button onClick={(e) => { e.stopPropagation(); loadHistoryItem(item); }}
                        className="text-[9px] text-white/30 hover:text-violet-300 transition-colors px-1.5 py-0.5 rounded hover:bg-violet-500/10"
                        title="Use as base for next edit">
                        <i className="fa-solid fa-pen-to-square mr-1 text-[8px]" />Edit from here
                      </button>
                      <button onClick={(e) => {
                          e.stopPropagation();
                          handleSendToStage(item.imageB64);
                        }}
                        className="text-[9px] text-white/30 hover:text-emerald-300 transition-colors px-1.5 py-0.5 rounded hover:bg-emerald-500/10"
                        title="Send this image to Stage">
                        <i className="fa-solid fa-arrow-up-from-bracket mr-1 text-[8px]" />Stage
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}

            {/* Generating indicator */}
            {isGenerating && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm p-4"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
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

          {/* Floating Send to Stage button */}
          {currentImageB64 && !isGenerating && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="absolute bottom-3 right-3 z-10">
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={() => handleSendToStage()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium shadow-lg"
                style={{ background: "rgba(16,185,129,0.2)", color: "#6ee7b7", border: "1px solid rgba(16,185,129,0.3)", backdropFilter: "blur(12px)" }}>
                <i className="fa-solid fa-arrow-up-from-bracket text-[10px]" />Send to Stage
              </motion.button>
            </motion.div>
          )}
        </div>

        {/* RIGHT PANEL — Model Parameters */}
        <div className="w-52 shrink-0 flex flex-col border-l border-white/[0.06] overflow-y-auto overflow-x-hidden"
          style={{ background: "rgba(255,255,255,0.012)" }}>
          <div className="px-3 py-2 border-b border-white/[0.06]">
            <span className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">Parameters</span>
          </div>
          <div className="flex-1 px-3 py-2.5 space-y-3.5 overflow-y-auto scrollbar-thin">
            {/* Aspect Ratio — provider-aware */}
            <div className="space-y-1.5">
              <span className="text-[10px] text-white/40 font-medium">Aspect Ratio</span>
              <div className="flex flex-wrap gap-1">
                {(isGoogleModel ? GEMINI_ASPECT_OPTIONS : OPENAI_ASPECT_OPTIONS).map((ar) => (
                  <button key={ar.value} onClick={() => setAspectRatio(ar.value)}
                    className={`px-2 py-1 rounded-md text-[9px] font-medium transition-all ${aspectRatio === ar.value ? "bg-violet-500/25 text-violet-300 border border-violet-500/35 shadow-[0_0_8px_rgba(139,92,246,0.1)]" : "text-white/35 hover:text-white/60 hover:bg-white/[0.04] border border-transparent"}`}>
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
                    <button key={sz.value} onClick={() => setImageSize(sz.value)}
                      className={`flex-1 py-1 rounded-md text-[9px] font-medium transition-all ${imageSize === sz.value ? "bg-violet-500/25 text-violet-300 border border-violet-500/35" : "text-white/35 hover:text-white/60 hover:bg-white/[0.04] border border-transparent"}`}
                      title={sz.desc}>
                      {sz.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Style (all models) */}
            <div className="space-y-1.5">
              <span className="text-[10px] text-white/40 font-medium">Style</span>
              <div className="grid grid-cols-2 gap-0.5">
                {STYLE_OPTIONS.map((s) => (
                  <button key={s.value} onClick={() => setImageStyle(s.value)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[9px] transition-all text-left ${imageStyle === s.value ? "bg-violet-500/20 text-violet-300" : "text-white/35 hover:text-white/60 hover:bg-white/[0.04]"}`}>
                    <i className={`fa-solid ${s.icon} text-[8px] ${imageStyle === s.value ? "text-violet-400" : "text-white/25"}`} />
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Nano Banana Pro: Thinking Level */}
            {selectedModel === "gemini-3-pro-image-preview" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-white/40 font-medium">Thinking</span>
                  <span className="text-[9px] text-violet-300 font-mono">{thinkingLevel <= 50 ? "Minimal" : "High"}</span>
                </div>
                <input type="range" min={0} max={100} value={thinkingLevel} onChange={(e) => setThinkingLevel(Number(e.target.value))}
                  className="w-full h-1 appearance-none rounded-full cursor-pointer"
                  style={{ background: `linear-gradient(to right, rgba(139,92,246,0.6) ${thinkingLevel}%, rgba(255,255,255,0.08) ${thinkingLevel}%)` }} />
                <p className="text-[9px] text-white/20">Minimal = fast, High = deeper reasoning for complex edits</p>
              </div>
            )}

            {/* GPT-Image: Resolution */}
            {!isGoogleModel && (
              <div className="space-y-1.5">
                <span className="text-[10px] text-white/40 font-medium">Resolution</span>
                <div className="flex gap-1">
                  {(["standard", "hd"] as const).map((r) => (
                    <button key={r} onClick={() => setResolution(r)}
                      className={`flex-1 py-1 rounded-md text-[9px] font-medium transition-all ${resolution === r ? "bg-violet-500/25 text-violet-300 border border-violet-500/35" : "text-white/35 hover:text-white/60 hover:bg-white/[0.04] border border-transparent"}`}>
                      {r === "standard" ? "Standard" : "HD / 4K"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* GPT-Image: Adherence */}
            {!isGoogleModel && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-white/40 font-medium">Adherence</span>
                  <span className="text-[9px] text-violet-300 font-mono">{adherence}%</span>
                </div>
                <input type="range" min={0} max={100} value={adherence} onChange={(e) => setAdherence(Number(e.target.value))}
                  className="w-full h-1 appearance-none rounded-full cursor-pointer"
                  style={{ background: `linear-gradient(to right, rgba(139,92,246,0.6) ${adherence}%, rgba(255,255,255,0.08) ${adherence}%)` }} />
                <p className="text-[9px] text-white/20 leading-relaxed">Prompt adherence vs. creative freedom</p>
              </div>
            )}

            {/* Session summary */}
            <div className="pt-3 border-t border-white/[0.06] space-y-1.5">
              <span className="text-[10px] text-white/35 font-semibold uppercase tracking-wider">Session</span>
              <div className="space-y-1">
                <div className="flex justify-between text-[9px]">
                  <span className="text-white/30">Generations:</span>
                  <span className="text-white/50 font-mono">{history.length}</span>
                </div>
                <div className="flex justify-between text-[9px]">
                  <span className="text-white/30">Session cost:</span>
                  <span className="text-amber-300/80 font-mono">{fmtCost(sessionCost)}</span>
                </div>
                {historyIndex >= 0 && historyIndex < history.length && (
                  <div className="flex justify-between text-[9px]">
                    <span className="text-white/30">Position:</span>
                    <span className="text-violet-300/70 font-mono">{history.length - historyIndex}/{history.length}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Current model info */}
            <div className="pt-3 border-t border-white/[0.06] space-y-1">
              <span className="text-[10px] text-white/35 font-semibold uppercase tracking-wider">Model</span>
              <p className="text-[10px] text-violet-300/80 font-medium">{currentModel.label}</p>
              <p className="text-[9px] text-white/25">{currentModel.desc}</p>
              <p className="text-[9px] text-amber-400/50 font-mono">~{fmtCost(currentModel.cost)} per image</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── COMMAND DECK ─────────────────────────────────────────────────────── */}
      <div className="border-t border-white/[0.06] shrink-0"
        style={{ background: "rgba(255,255,255,0.02)", backdropFilter: "blur(24px)" }}>

        {/* Tier 1 — Strategy row */}
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-white/[0.04]">
          {/* Prompt library */}
          <button onClick={() => setShowPromptLib(!showPromptLib)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium transition-all ${showPromptLib ? "bg-violet-500/15 text-violet-300" : "text-white/35 hover:text-white/60 hover:bg-white/[0.04]"}`}
            title="Prompt library">
            <i className="fa-solid fa-book-bookmark text-[9px]" />Prompts
          </button>

          <div className="w-px h-4 bg-white/[0.06]" />

          {/* Model selector */}
          <div className="flex-1 flex justify-center">
            <div className="relative">
              <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value as ModelId)}
                className="appearance-none px-3 pr-7 py-1 rounded-lg text-[11px] font-medium outline-none cursor-pointer transition-all hover:brightness-110"
                style={{ background: "rgba(139,92,246,0.12)", color: "#c084fc", border: "1px solid rgba(139,92,246,0.25)" }}>
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id} className="bg-[#0f0f1a] text-white">{m.label} — {m.desc}</option>
                ))}
              </select>
              <i className="fa-solid fa-chevron-down absolute right-2.5 top-1/2 -translate-y-1/2 text-[8px] text-violet-400/60 pointer-events-none" />
            </div>
          </div>

          <div className="w-px h-4 bg-white/[0.06]" />

          {/* Cost tracker */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <i className="fa-solid fa-coins text-[9px] text-amber-400/70" />
            <span className="text-[10px] font-medium text-white/40">Session:</span>
            <span className="text-[10px] font-mono text-amber-300/80">{fmtCost(sessionCost)}</span>
          </div>
        </div>

        {/* Tier 2 — Chat input row */}
        <div className="flex items-end gap-2 px-4 py-2.5">
          <div className="flex-1 relative">
            <textarea ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !isGenerating) { e.preventDefault(); handleSend(); } }}
              placeholder={currentImageB64 ? "Describe changes to make… (Enter to send)" : "Describe an image to generate… (Enter to send)"}
              rows={2}
              className="w-full resize-none px-3.5 py-2.5 pr-10 rounded-xl text-[12px] text-white/80 placeholder:text-white/20 outline-none transition-all focus:ring-1 focus:ring-violet-500/30"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", lineHeight: "1.5" }} />
            {/* Enhance wand */}
            <button onClick={handleEnhance}
              disabled={isEnhancing || isGenerating || !prompt.trim()}
              className="absolute right-2.5 bottom-2.5 w-6 h-6 rounded-md flex items-center justify-center transition-all disabled:opacity-20 hover:bg-violet-500/20 hover:scale-110 active:scale-95"
              style={{ color: "#c084fc" }}
              title="Enhance prompt with AI (rewrites into a detailed professional prompt)">
              {isEnhancing ? <i className="fa-solid fa-spinner fa-spin text-[9px]" /> : <i className="fa-solid fa-wand-magic-sparkles text-[10px]" />}
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex gap-1.5 pb-0.5">
            {/* Undo */}
            <motion.button whileHover={canUndo ? { scale: 1.08 } : {}} whileTap={canUndo ? { scale: 0.92 } : {}}
              onClick={handleUndo} disabled={!canUndo}
              className={`flex items-center gap-1 px-2 py-2 rounded-xl text-[10px] font-medium transition-all border ${canUndo ? "text-white/50 hover:text-white/80 hover:bg-white/[0.06] border-white/[0.06]" : "text-white/15 border-white/[0.03] cursor-not-allowed"}`}
              title="Undo">
              <i className="fa-solid fa-rotate-left text-[9px]" />
            </motion.button>
            {/* Redo */}
            <motion.button whileHover={canRedo ? { scale: 1.08 } : {}} whileTap={canRedo ? { scale: 0.92 } : {}}
              onClick={handleRedo} disabled={!canRedo}
              className={`flex items-center gap-1 px-2 py-2 rounded-xl text-[10px] font-medium transition-all border ${canRedo ? "text-white/50 hover:text-white/80 hover:bg-white/[0.06] border-white/[0.06]" : "text-white/15 border-white/[0.03] cursor-not-allowed"}`}
              title="Redo">
              <i className="fa-solid fa-rotate-right text-[9px]" />
            </motion.button>

            <div className="w-px h-8 bg-white/[0.06] self-center" />

            {/* Send */}
            <motion.button whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
              onClick={() => handleSend()}
              disabled={isGenerating || !prompt.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: !isGenerating && prompt.trim()
                  ? "linear-gradient(135deg, rgba(139,92,246,0.5), rgba(236,72,153,0.4))"
                  : "rgba(139,92,246,0.15)",
                color: !isGenerating && prompt.trim() ? "#f0abfc" : "rgba(255,255,255,0.3)",
                border: `1px solid ${!isGenerating && prompt.trim() ? "rgba(168,85,247,0.5)" : "rgba(139,92,246,0.15)"}`,
                boxShadow: !isGenerating && prompt.trim() ? "0 4px 16px rgba(139,92,246,0.2)" : "none",
              }}>
              <i className="fa-solid fa-paper-plane text-[10px]" />Send
            </motion.button>
            {/* Retry */}
            <motion.button whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
              onClick={() => handleSend(lastPrompt)}
              disabled={isGenerating || !lastPrompt}
              className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-[11px] font-medium transition-all disabled:opacity-25 disabled:cursor-not-allowed text-white/45 hover:text-white/80 hover:bg-white/[0.06] border border-white/[0.06]"
              title="Retry last prompt">
              <i className="fa-solid fa-rotate text-[9px]" />
            </motion.button>
            {/* Cancel */}
            <motion.button whileHover={isGenerating ? { scale: 1.06 } : {}} whileTap={isGenerating ? { scale: 0.94 } : {}}
              onClick={() => { abortRef.current = true; setIsGenerating(false); showToast("Generation cancelled"); }}
              disabled={!isGenerating}
              className={`flex items-center gap-1 px-2.5 py-2 rounded-xl text-[11px] font-medium transition-all border ${isGenerating ? "text-red-400 hover:bg-red-500/15 border-red-500/25" : "text-white/15 border-white/[0.03] cursor-not-allowed"}`}
              title="Cancel generation">
              <i className="fa-solid fa-stop text-[9px]" />
            </motion.button>
          </div>
        </div>
      </div>

      {/* ── PROMPT LIBRARY OVERLAY ───────────────────────────────────────────── */}
      <AnimatePresence>
        {showPromptLib && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-[100px] left-4 z-50 rounded-xl w-96 overflow-hidden"
            style={{ background: "rgba(10,10,18,0.97)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 24px 60px rgba(0,0,0,0.7)" }}>
            {/* Header with actions */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
              <span className="text-[11px] font-semibold text-white/70">
                <i className="fa-solid fa-book-bookmark text-[9px] mr-1.5 text-violet-400" />Prompt Library
                {savedPrompts.length > 0 && <span className="text-[9px] text-white/25 ml-1.5">({savedPrompts.length})</span>}
              </span>
              <div className="flex items-center gap-1">
                {/* Export */}
                {savedPrompts.length > 0 && (
                  <button onClick={() => {
                    const blob = new Blob([JSON.stringify(savedPrompts, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a"); a.href = url; a.download = "zenith_prompts.json"; a.click();
                    URL.revokeObjectURL(url);
                    showToast("Prompts exported!");
                  }}
                    className="text-white/25 hover:text-emerald-300 transition-colors px-1.5 py-0.5 rounded hover:bg-emerald-500/10"
                    title="Export prompts as JSON">
                    <i className="fa-solid fa-file-export text-[9px]" />
                  </button>
                )}
                {/* Import */}
                <button onClick={() => {
                  const input = document.createElement("input"); input.type = "file"; input.accept = ".json,.txt";
                  input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      try {
                        const text = reader.result as string;
                        // Support both JSON array and plain text (one prompt per line)
                        let imported: SavedPrompt[];
                        if (file.name.endsWith(".json")) {
                          const parsed = JSON.parse(text);
                          if (Array.isArray(parsed)) {
                            imported = parsed.map((p: { name?: string; text?: string; id?: string }, i: number) => ({
                              id: p.id || uid(), name: p.name || `Imported ${i + 1}`, text: p.text || String(p),
                            }));
                          } else {
                            showToast("Invalid JSON format"); return;
                          }
                        } else {
                          // Plain text: one prompt per line
                          imported = text.split("\n").filter((l: string) => l.trim()).map((line: string, i: number) => ({
                            id: uid(), name: `Imported ${i + 1}`, text: line.trim(),
                          }));
                        }
                        if (imported.length > 0) {
                          savePromptsToStorage([...imported, ...savedPrompts]);
                          showToast(`Imported ${imported.length} prompts!`);
                        }
                      } catch { showToast("Failed to parse file"); }
                    };
                    reader.readAsText(file);
                  };
                  input.click();
                }}
                  className="text-white/25 hover:text-violet-300 transition-colors px-1.5 py-0.5 rounded hover:bg-violet-500/10"
                  title="Import prompts from JSON or text file">
                  <i className="fa-solid fa-file-import text-[9px]" />
                </button>
                {/* Clear all */}
                {savedPrompts.length > 0 && (
                  <button onClick={() => {
                    savePromptsToStorage([]);
                    showToast("All prompts cleared");
                  }}
                    className="text-white/25 hover:text-red-400 transition-colors px-1.5 py-0.5 rounded hover:bg-red-500/10"
                    title="Clear all saved prompts">
                    <i className="fa-solid fa-trash-can text-[9px]" />
                  </button>
                )}
                <button onClick={() => setShowPromptLib(false)} className="text-white/30 hover:text-white/70 transition-colors ml-1">
                  <i className="fa-solid fa-xmark text-[11px]" />
                </button>
              </div>
            </div>
            {/* Save current prompt */}
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.06]">
              <input type="text" placeholder="Name this prompt…"
                value={promptLibName} onChange={(e) => setPromptLibName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveCurrentPrompt()}
                className="flex-1 px-2 py-1 rounded-md text-[10px] text-white/70 placeholder:text-white/20 outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }} />
              <button onClick={saveCurrentPrompt} disabled={!promptLibName.trim() || !prompt.trim()}
                className="px-2 py-1 rounded-md text-[10px] font-medium text-violet-300 hover:bg-violet-500/15 transition-colors disabled:opacity-25">
                <i className="fa-solid fa-plus text-[9px] mr-1" />Save
              </button>
            </div>
            {/* Prompt list */}
            <div className="max-h-72 overflow-y-auto">
              {savedPrompts.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 px-4">
                  <i className="fa-regular fa-folder-open text-white/10 text-xl" />
                  <p className="text-[10px] text-white/25 text-center">No saved prompts yet.<br/>Save your current prompt or import a file.</p>
                </div>
              ) : (
                savedPrompts.map((sp) => (
                  <div key={sp.id} className="flex items-start gap-2 px-3 py-2 hover:bg-white/[0.04] transition-colors group border-b border-white/[0.03] last:border-0">
                    <button onClick={() => { setPrompt(sp.text); setShowPromptLib(false); showToast(`Loaded: "${sp.name}"`); }} className="flex-1 text-left min-w-0">
                      <p className="text-[10px] font-medium text-white/65 group-hover:text-white/90 truncate">{sp.name}</p>
                      <p className="text-[9px] text-white/25 line-clamp-2 mt-0.5 leading-relaxed">{sp.text}</p>
                    </button>
                    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                      {/* Copy to clipboard */}
                      <button onClick={() => { navigator.clipboard.writeText(sp.text); showToast("Copied to clipboard"); }}
                        className="text-white/30 hover:text-violet-300 transition-colors p-0.5 rounded"
                        title="Copy prompt text">
                        <i className="fa-regular fa-copy text-[8px]" />
                      </button>
                      {/* Delete */}
                      <button onClick={() => deletePrompt(sp.id)}
                        className="text-white/30 hover:text-red-400 transition-colors p-0.5 rounded"
                        title="Delete prompt">
                        <i className="fa-solid fa-trash text-[8px]" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── TOAST ──────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-[11px] font-medium text-white/90 pointer-events-none z-[60]"
            style={{ background: "rgba(10,10,18,0.94)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── CLICK-OUTSIDE handler for dropdowns ───────────────────────────── */}
      {(showSaveOptions || showResetConfirm) && (
        <div className="fixed inset-0 z-40" onClick={() => { setShowSaveOptions(false); setShowResetConfirm(false); }} />
      )}
    </div>
  );
}
