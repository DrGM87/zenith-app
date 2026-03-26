import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  [key: string]: unknown; // allow extra fields from the full settings object
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

interface SavedPrompt {
  id: string;
  name: string;
  text: string;
}

type ModelId = "gemini-3.1-flash-image-preview" | "gemini-3-pro-image-preview" | "gpt-image-1.5";
type AspectRatio = "1:1" | "16:9" | "9:16";
type ImageStyle = "photorealistic" | "digital_art" | "vector";
type SaveFormat = "png" | "jpg" | "webp";

// ── Constants ─────────────────────────────────────────────────────────────────

const MODELS: { id: ModelId; label: string; desc: string; provider: "google" | "openai"; cost: number }[] = [
  { id: "gemini-3.1-flash-image-preview", label: "Nano Banana 2", desc: "Fast · High quality · Google", provider: "google", cost: 0.067 },
  { id: "gemini-3-pro-image-preview",     label: "Nano Banana Pro", desc: "Deep reasoning · Google",     provider: "google", cost: 0.134 },
  { id: "gpt-image-1.5",                  label: "GPT-Image 1.5",  desc: "Ultra-realistic · OpenAI",    provider: "openai", cost: 0.133 },
];

const ASPECT_OPTIONS: AspectRatio[] = ["1:1", "16:9", "9:16"];
const STYLE_OPTIONS: { value: ImageStyle; label: string }[] = [
  { value: "photorealistic", label: "Photorealistic" },
  { value: "digital_art",    label: "Digital Art" },
  { value: "vector",         label: "Vector" },
];

const PROMPTS_KEY = "zenith_editor_prompts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string { return Math.random().toString(36).slice(2, 10); }
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtCost(n: number): string { return `$${n.toFixed(3)}`; }

// ── Component ─────────────────────────────────────────────────────────────────

export function ZenithEditor() {
  // ── Settings & API keys
  const [settings, setSettings] = useState<ZenithSettings | null>(null);

  // ── Image state
  const [currentImageB64, setCurrentImageB64] = useState<string | null>(null);
  const [originalImageB64, setOriginalImageB64] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [isBlankCanvas, setIsBlankCanvas] = useState(true);

  // ── History
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);

  // ── Model + params
  const [selectedModel, setSelectedModel] = useState<ModelId>("gemini-3.1-flash-image-preview");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [imageStyle, setImageStyle] = useState<ImageStyle>("photorealistic");
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

  // ── UI feedback
  const [toast, setToast] = useState<string | null>(null);
  const [isEnhancing, setIsEnhancing] = useState(false);

  const showToast = useCallback((msg: string, ms = 3000) => {
    setToast(msg);
    setTimeout(() => setToast(null), ms);
  }, []);

  // ── Load settings (and refresh on window focus) ───────────────────────────

  const loadSettings = useCallback(() => {
    invoke<ZenithSettings>("get_settings").then((s) => {
      setSettings(s);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadSettings();
    // Re-fetch settings when user focuses this window (in case they just added a key)
    const onFocus = () => loadSettings();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadSettings]);

  // ── Load saved prompts from localStorage ───────────────────────────────────

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

  // ── Load initial image via pending-path state (on first mount) ─────────────

  useEffect(() => {
    invoke<string>("take_pending_editor_image")
      .then(async (path) => {
        if (path) {
          setIsBlankCanvas(false);
          try {
            const b64 = await invoke<string>("read_file_base64", { path });
            setCurrentImageB64(b64);
            setOriginalImageB64(b64);
            showToast("Image loaded");
          } catch (e) {
            showToast(`Failed to load image: ${String(e)}`);
          }
        }
        // If path is empty, stay in blank-canvas mode (already the default)
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // ── Listen for editor-load-image event (handles reused window case) ────────

  useEffect(() => {
    const unlisten = listen<string>("editor-load-image", async (event) => {
      const path = event.payload;
      if (!path) {
        setIsBlankCanvas(true);
        setCurrentImageB64(null);
        setOriginalImageB64(null);
        showToast("New blank canvas");
        return;
      }
      setIsBlankCanvas(false);
      try {
        const b64 = await invoke<string>("read_file_base64", { path });
        setCurrentImageB64(b64);
        setOriginalImageB64(b64);
        showToast("Image loaded");
      } catch (e) {
        showToast(`Failed to load image: ${String(e)}`);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [showToast]);

  // ── Get API key for the selected IMAGE model ────────────────────────────

  const getApiCreds = useCallback(() => {
    const modelInfo = MODELS.find((m) => m.id === selectedModel);
    const provider = modelInfo?.provider ?? "google";
    const keys = settings?.api_keys ?? [];
    const entry = keys.find((k) => k.provider === provider && k.is_default) ?? keys.find((k) => k.provider === provider);
    return { api_key: entry?.key ?? "", provider, model: selectedModel, hasKey: !!entry?.key };
  }, [settings, selectedModel]);

  // ── Get the user's default TEXT LLM key (for enhance_prompt, auto_title) ──

  const getTextLlmCreds = useCallback(() => {
    const keys = settings?.api_keys ?? [];
    // Prefer the user's default key; fall back to any key that is NOT an image-gen model
    const IMAGE_MODEL_IDS: Set<string> = new Set(MODELS.map((m) => m.id));
    const def = keys.find((k) => k.is_default && !IMAGE_MODEL_IDS.has(k.model))
             ?? keys.find((k) => !IMAGE_MODEL_IDS.has(k.model))
             ?? keys.find((k) => k.is_default)
             ?? keys[0];
    return def
      ? { api_key: def.key, provider: def.provider, model: def.model }
      : { api_key: "", provider: "google", model: "" };
  }, [settings]);

  // Derived: whether we have a valid key for the current image model
  const apiStatus = getApiCreds();

  // ── Generate image ─────────────────────────────────────────────────────────

  const handleSend = useCallback(async (retryPrompt?: string) => {
    const p = retryPrompt ?? prompt.trim();
    if (!p) { showToast("Enter a prompt first"); return; }
    const { api_key, provider } = getApiCreds();
    if (!api_key) { showToast(`No ${provider} API key found. Add it in Settings > API Keys.`); return; }

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
        quality: resolution,
        style: imageStyle,
      };
      // Conversational editing: include current image if one exists
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

      // Add to history
      const histItem: HistoryItem = { id: uid(), imageB64: newB64, prompt: p, title: "Generating…", timestamp: Date.now(), cost, model: selectedModel };
      setHistory((h) => [histItem, ...h]);
      setActiveHistoryId(histItem.id);

      // Auto-title in background (uses TEXT LLM, not the image model)
      const titleArgs = { prompt: p, ...getTextLlmCreds() };
      invoke<string>("process_file", { action: "auto_title_prompt", argsJson: JSON.stringify(titleArgs) })
        .then((r) => {
          try {
            const tr = JSON.parse(r);
            if (tr.ok && tr.title) {
              setHistory((h) => h.map((x) => x.id === histItem.id ? { ...x, title: tr.title } : x));
            }
          } catch { /* ignore */ }
        }).catch(() => {});

      if (!retryPrompt) setPrompt("");
    } catch (e) {
      if (!abortRef.current) showToast(`Error: ${String(e)}`);
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, getApiCreds, getTextLlmCreds, selectedModel, aspectRatio, resolution, imageStyle, currentImageB64, showToast]);

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
        // Stage the saved file back to main window
        await invoke("stage_file", { path: r.path });
        showToast(`Saved as ${saveFormat.toUpperCase()} — sent to Stage!`);
      } else showToast(r.error || "Save failed");
    } catch (e) { showToast(String(e)); }
  }, [currentImageB64, saveFormat, saveQuality, showToast]);

  // ── Send to Stage (current image as PNG) ──────────────────────────────────

  const handleSendToStage = useCallback(async () => {
    if (!currentImageB64) { showToast("Nothing to send"); return; }
    try {
      const argsJson = JSON.stringify({ image_b64: currentImageB64, format: "png", quality: 95, filename: `zenith_generated_${Date.now()}` });
      const r = JSON.parse(await invoke<string>("process_file", { action: "save_editor_image", argsJson }));
      if (r.ok && r.path) { await invoke("stage_file", { path: r.path }); showToast("Sent to Stage!"); }
      else showToast(r.error || "Failed");
    } catch (e) { showToast(String(e)); }
  }, [currentImageB64, showToast]);

  // ── Reset editor ──────────────────────────────────────────────────────────

  const handleReset = useCallback(async () => {
    if (!confirm("Reset editor? This will clear history and the canvas.")) return;
    setCurrentImageB64(null);
    setOriginalImageB64(null);
    setHistory([]);
    setActiveHistoryId(null);
    setSessionCost(0);
    setIsBlankCanvas(true);
    setLastPrompt("");
    setPrompt("");
    try {
      await invoke<string>("process_file", { action: "reset_editor", argsJson: "{}" });
    } catch { /* ignore */ }
    showToast("Editor reset");
  }, [showToast]);

  // ── History navigation ────────────────────────────────────────────────────

  const loadHistoryItem = useCallback((item: HistoryItem) => {
    setCurrentImageB64(item.imageB64);
    setActiveHistoryId(item.id);
    showToast(`Loaded: ${item.title}`);
  }, [showToast]);

  // ── Prompt library ────────────────────────────────────────────────────────

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

  // ── Derived ───────────────────────────────────────────────────────────────

  const displayedB64 = showOriginal ? originalImageB64 : currentImageB64;
  const currentModel = MODELS.find((m) => m.id === selectedModel)!;
  const isGoogleModel = currentModel.provider === "google";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden select-none"
      style={{ background: "linear-gradient(135deg, #0d0d14 0%, #11111c 50%, #0d0d14 100%)" }}>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5"
        style={{ background: "rgba(255,255,255,0.02)", backdropFilter: "blur(16px)" }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ background: "linear-gradient(135deg, #8b5cf6, #ec4899)" }} />
            <span className="text-[13px] font-semibold text-white/90 tracking-wide">Zenith Editor</span>
          </div>
          <span className="text-[11px] text-white/25">
            {isBlankCanvas ? "New Canvas" : "Editing Image"}
          </span>
          {/* API key status */}
          {settings !== null && (
            apiStatus.hasKey ? (
              <span className="flex items-center gap-1 text-[10px] text-emerald-400/70">
                <i className="fa-solid fa-circle-check text-[8px]" />
                {apiStatus.provider === "google" ? "Google" : "OpenAI"} key active
              </span>
            ) : (
              <button
                onClick={() => invoke("open_settings").catch(() => {})}
                className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 transition-colors"
                title="Open Settings to add an API key"
              >
                <i className="fa-solid fa-triangle-exclamation text-[9px]" />
                No {apiStatus.provider === "google" ? "Google" : "OpenAI"} key — click to add
              </button>
            )
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Save options */}
          <div className="relative">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setShowSaveOptions(!showSaveOptions)}
              disabled={!currentImageB64}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-30"
              style={{ background: "rgba(139,92,246,0.2)", color: "#c084fc", border: "1px solid rgba(139,92,246,0.3)" }}
            >
              <i className="fa-solid fa-floppy-disk text-[10px]" />
              Save Image
              <i className={`fa-solid fa-chevron-${showSaveOptions ? "up" : "down"} text-[8px] opacity-60`} />
            </motion.button>
            <AnimatePresence>
              {showSaveOptions && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  className="absolute right-0 top-full mt-1 z-50 rounded-xl p-3 space-y-2 w-52"
                  style={{ background: "rgba(13,13,20,0.95)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 16px 40px rgba(0,0,0,0.6)" }}
                >
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
                    <i className="fa-solid fa-download mr-1.5 text-[9px]" />Save & Stage
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {/* Reset */}
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-all border border-white/8"
          >
            <i className="fa-solid fa-arrow-rotate-left text-[10px]" />
            Reset
          </motion.button>
        </div>
      </div>

      {/* ── MAIN BODY (3 columns) ───────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT PANEL — History Timeline */}
        <div className="w-48 shrink-0 flex flex-col border-r border-white/5 overflow-hidden"
          style={{ background: "rgba(255,255,255,0.015)" }}>
          <div className="px-3 py-2 border-b border-white/5">
            <span className="text-[10px] font-medium text-white/30 uppercase tracking-wider">History</span>
          </div>
          <div className="flex-1 overflow-y-auto overflow-x-hidden py-1.5 space-y-1 px-1.5">
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 px-3">
                <i className="fa-regular fa-clock-rotate-left text-white/10 text-2xl" />
                <p className="text-[10px] text-white/20 text-center">Generations will appear here</p>
              </div>
            ) : (
              history.map((item) => (
                <motion.button
                  key={item.id}
                  onClick={() => loadHistoryItem(item)}
                  whileHover={{ scale: 1.02 }}
                  className={`w-full flex flex-col gap-1 p-1.5 rounded-lg transition-all text-left ${
                    activeHistoryId === item.id
                      ? "bg-violet-500/20 border border-violet-500/30"
                      : "hover:bg-white/5 border border-transparent"
                  }`}
                >
                  {/* Thumbnail */}
                  <div className="w-full aspect-square rounded-md overflow-hidden bg-white/5">
                    <img src={`data:image/png;base64,${item.imageB64}`} alt={item.title}
                      className="w-full h-full object-cover" />
                  </div>
                  <p className="text-[9px] font-medium text-white/70 truncate leading-tight">{item.title}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] text-white/30">{fmtTime(item.timestamp)}</span>
                    <span className="text-[8px] text-white/25">{fmtCost(item.cost)}</span>
                  </div>
                </motion.button>
              ))
            )}
          </div>
        </div>

        {/* CENTER — Canvas */}
        <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden">
          {/* Original / AI Edit toggle pill */}
          {originalImageB64 && currentImageB64 && originalImageB64 !== currentImageB64 && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute top-3 z-10"
            >
              <button
                onMouseDown={() => setShowOriginal(true)}
                onMouseUp={() => setShowOriginal(false)}
                onMouseLeave={() => setShowOriginal(false)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all"
                style={{
                  background: showOriginal ? "rgba(236,72,153,0.25)" : "rgba(139,92,246,0.25)",
                  border: `1px solid ${showOriginal ? "rgba(236,72,153,0.4)" : "rgba(139,92,246,0.4)"}`,
                  color: showOriginal ? "#f9a8d4" : "#c084fc",
                }}
                title="Hold to compare with original"
              >
                <i className={`fa-solid ${showOriginal ? "fa-eye" : "fa-wand-magic-sparkles"} text-[9px]`} />
                {showOriginal ? "Original" : "AI Edit"}
              </button>
            </motion.div>
          )}

          {/* Image display */}
          <div className="relative flex items-center justify-center w-full h-full p-6">
            <AnimatePresence mode="wait">
              {isGenerating ? (
                <motion.div key="generating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-4">
                  <div className="relative w-16 h-16">
                    <div className="absolute inset-0 rounded-full border-2 border-violet-500/20 animate-ping" />
                    <div className="absolute inset-2 rounded-full border-2 border-violet-400/40 animate-pulse" />
                    <i className="fa-solid fa-wand-magic-sparkles absolute inset-0 flex items-center justify-center text-violet-400 text-xl m-auto" style={{ display: "flex" }} />
                  </div>
                  <p className="text-[12px] text-white/40">Generating with {currentModel.label}…</p>
                </motion.div>
              ) : displayedB64 ? (
                <motion.img
                  key={displayedB64.slice(0, 16)}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.3 }}
                  src={`data:image/png;base64,${displayedB64}`}
                  alt="Generated image"
                  className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
                  style={{ boxShadow: "0 32px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04) inset" }}
                  draggable={false}
                />
              ) : (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="flex flex-col items-center gap-4 px-8 text-center">
                  <div className="w-20 h-20 rounded-2xl flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.15), rgba(236,72,153,0.10))", border: "1px solid rgba(139,92,246,0.2)" }}>
                    <i className="fa-solid fa-wand-magic-sparkles text-3xl text-white/20" />
                  </div>
                  <p className="text-[13px] text-white/30">
                    Describe an image below to generate it,<br/>or open an image from the Stage to edit it.
                  </p>
                  {!apiStatus.hasKey && settings !== null && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      onClick={() => invoke("open_settings").catch(() => {})}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-medium mt-2"
                      style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.3)" }}
                    >
                      <i className="fa-solid fa-key text-[11px]" />
                      Add {apiStatus.provider === "google" ? "Google Gemini" : "OpenAI"} API key in Settings
                    </motion.button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Send to Stage button */}
          {currentImageB64 && !isGenerating && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute bottom-4 right-4"
            >
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleSendToStage}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium"
                style={{ background: "rgba(16,185,129,0.2)", color: "#6ee7b7", border: "1px solid rgba(16,185,129,0.3)" }}
              >
                <i className="fa-solid fa-arrow-up-from-bracket text-[10px]" />
                Send to Stage
              </motion.button>
            </motion.div>
          )}
        </div>

        {/* RIGHT PANEL — Model Parameters */}
        <div className="w-52 shrink-0 flex flex-col border-l border-white/5 overflow-y-auto overflow-x-hidden"
          style={{ background: "rgba(255,255,255,0.015)" }}>
          <div className="px-3 py-2 border-b border-white/5">
            <span className="text-[10px] font-medium text-white/30 uppercase tracking-wider">Parameters</span>
          </div>
          <div className="flex-1 px-3 py-2.5 space-y-4">
            {/* Common: Aspect Ratio */}
            <div className="space-y-1.5">
              <span className="text-[10px] text-white/40 font-medium">Aspect Ratio</span>
              <div className="flex gap-1">
                {ASPECT_OPTIONS.map((ar) => (
                  <button key={ar} onClick={() => setAspectRatio(ar)}
                    className={`flex-1 py-1 rounded-md text-[9px] font-medium transition-colors ${aspectRatio === ar ? "bg-violet-500/30 text-violet-300 border border-violet-500/40" : "text-white/35 hover:text-white/60 hover:bg-white/5 border border-transparent"}`}>
                    {ar}
                  </button>
                ))}
              </div>
            </div>

            {/* Google models: Style */}
            {isGoogleModel && (
              <div className="space-y-1.5">
                <span className="text-[10px] text-white/40 font-medium">Style</span>
                <div className="space-y-1">
                  {STYLE_OPTIONS.map((s) => (
                    <button key={s.value} onClick={() => setImageStyle(s.value)}
                      className={`w-full text-left px-2 py-1 rounded-md text-[10px] transition-colors ${imageStyle === s.value ? "bg-violet-500/20 text-violet-300" : "text-white/40 hover:text-white/70 hover:bg-white/5"}`}>
                      {imageStyle === s.value && <i className="fa-solid fa-check text-[8px] mr-1.5" />}
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Nano Banana Pro: Thinking Level */}
            {selectedModel === "gemini-3-pro-image-preview" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-white/40 font-medium">Thinking</span>
                  <span className="text-[9px] text-violet-300 font-mono">{thinkingLevel <= 33 ? "Fast" : thinkingLevel <= 66 ? "Balanced" : "Deep"}</span>
                </div>
                <input type="range" min={0} max={100} value={thinkingLevel} onChange={(e) => setThinkingLevel(Number(e.target.value))}
                  className="w-full h-1 appearance-none rounded-full cursor-pointer"
                  style={{ background: `linear-gradient(to right, rgba(139,92,246,0.6) ${thinkingLevel}%, rgba(255,255,255,0.08) ${thinkingLevel}%)` }} />
              </div>
            )}

            {/* GPT-Image: Resolution */}
            {!isGoogleModel && (
              <div className="space-y-1.5">
                <span className="text-[10px] text-white/40 font-medium">Resolution</span>
                <div className="flex gap-1">
                  {(["standard", "hd"] as const).map((r) => (
                    <button key={r} onClick={() => setResolution(r)}
                      className={`flex-1 py-1 rounded-md text-[9px] font-medium transition-colors ${resolution === r ? "bg-violet-500/30 text-violet-300 border border-violet-500/40" : "text-white/35 hover:text-white/60 hover:bg-white/5 border border-transparent"}`}>
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
                <p className="text-[9px] text-white/20">How closely AI follows the prompt vs. creative freedom</p>
              </div>
            )}

            {/* Session summary */}
            {history.length > 0 && (
              <div className="pt-2 border-t border-white/5 space-y-1">
                <span className="text-[10px] text-white/30 font-medium">Session</span>
                <div className="space-y-0.5">
                  <div className="flex justify-between text-[9px]">
                    <span className="text-white/30">Generations:</span>
                    <span className="text-white/50">{history.length}</span>
                  </div>
                  <div className="flex justify-between text-[9px]">
                    <span className="text-white/30">Total cost:</span>
                    <span className="text-violet-300 font-mono">{fmtCost(sessionCost)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── COMMAND DECK ────────────────────────────────────────────────────── */}
      <div className="border-t border-white/5 shrink-0"
        style={{ background: "rgba(255,255,255,0.025)", backdropFilter: "blur(20px)" }}>

        {/* Tier 1 — Strategy row */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5">
          {/* Prompt library buttons */}
          <button onClick={() => setShowPromptLib(!showPromptLib)}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${showPromptLib ? "bg-white/10 text-white/80" : "text-white/35 hover:text-white/60 hover:bg-white/5"}`}
            title="Prompt library">
            <i className="fa-solid fa-book-bookmark text-[9px]" />
            Prompts
          </button>

          {/* Model selector */}
          <div className="flex-1 flex justify-center">
            <div className="relative">
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value as ModelId)}
                className="appearance-none px-3 pr-7 py-1.5 rounded-lg text-[11px] font-medium outline-none cursor-pointer"
                style={{ background: "rgba(139,92,246,0.15)", color: "#c084fc", border: "1px solid rgba(139,92,246,0.3)" }}
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id} className="bg-[#13131f] text-white">{m.label} — {m.desc}</option>
                ))}
              </select>
              <i className="fa-solid fa-chevron-down absolute right-2 top-1/2 -translate-y-1/2 text-[8px] text-violet-400 pointer-events-none" />
            </div>
          </div>

          {/* Cost tracker */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <i className="fa-solid fa-coin text-[9px] text-amber-400" />
            <span className="text-[10px] font-medium text-white/50">Session:</span>
            <span className="text-[10px] font-mono text-amber-300">{fmtCost(sessionCost)}</span>
          </div>
        </div>

        {/* Tier 2 — Chat row */}
        <div className="flex items-end gap-2 px-4 py-2.5">
          <div className="flex-1 relative">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !isGenerating) { e.preventDefault(); handleSend(); } }}
              placeholder={currentImageB64 ? "Describe changes to make… (Enter to send)" : "Describe an image to generate… (Enter to send)"}
              rows={2}
              className="w-full resize-none px-3 py-2 pr-10 rounded-xl text-[12px] text-white/80 placeholder:text-white/20 outline-none"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", lineHeight: "1.5" }}
            />
            {/* Enhance (Magic Wand) */}
            <button
              onClick={handleEnhance}
              disabled={isEnhancing || isGenerating || !prompt.trim()}
              className="absolute right-2 bottom-2 w-6 h-6 rounded-md flex items-center justify-center transition-colors disabled:opacity-30 hover:bg-violet-500/20"
              style={{ color: "#c084fc" }}
              title="Enhance prompt with AI"
            >
              {isEnhancing ? <i className="fa-solid fa-spinner fa-spin text-[9px]" /> : <i className="fa-solid fa-wand-magic-sparkles text-[10px]" />}
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex gap-1.5 pb-0.5">
            {/* Send */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleSend()}
              disabled={isGenerating || !prompt.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold transition-all disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.4), rgba(236,72,153,0.3))", color: "#e879f9", border: "1px solid rgba(139,92,246,0.4)" }}
            >
              <i className="fa-solid fa-rocket text-[10px]" />
              Send
            </motion.button>
            {/* Retry */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleSend(lastPrompt)}
              disabled={isGenerating || !lastPrompt}
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-[11px] font-medium transition-all disabled:opacity-40 text-white/50 hover:text-white/80 hover:bg-white/5"
              style={{ border: "1px solid rgba(255,255,255,0.08)" }}
              title="Retry last prompt"
            >
              <i className="fa-solid fa-rotate text-[10px]" />
              Retry
            </motion.button>
            {/* Cancel */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => { abortRef.current = true; setIsGenerating(false); showToast("Cancelled"); }}
              disabled={!isGenerating}
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-[11px] font-medium transition-all disabled:opacity-30 text-red-400 hover:bg-red-500/10"
              style={{ border: "1px solid rgba(239,68,68,0.2)" }}
              title="Cancel generation"
            >
              <i className="fa-solid fa-stop text-[10px]" />
            </motion.button>
          </div>
        </div>
      </div>

      {/* ── PROMPT LIBRARY OVERLAY ──────────────────────────────────────────── */}
      <AnimatePresence>
        {showPromptLib && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-[116px] left-4 z-50 rounded-xl w-80 overflow-hidden"
            style={{ background: "rgba(13,13,20,0.96)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 20px 60px rgba(0,0,0,0.7)" }}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
              <span className="text-[11px] font-semibold text-white/70">Prompt Library</span>
              <button onClick={() => setShowPromptLib(false)} className="text-white/30 hover:text-white/70">
                <i className="fa-solid fa-xmark text-[11px]" />
              </button>
            </div>
            {/* Save current prompt */}
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/5">
              <input
                type="text"
                placeholder="Name this prompt…"
                value={promptLibName}
                onChange={(e) => setPromptLibName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveCurrentPrompt()}
                className="flex-1 px-2 py-1 rounded-md text-[10px] text-white/70 placeholder:text-white/20 outline-none"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
              />
              <button onClick={saveCurrentPrompt} disabled={!promptLibName.trim() || !prompt.trim()}
                className="px-2 py-1 rounded-md text-[10px] font-medium text-violet-300 hover:bg-violet-500/15 transition-colors disabled:opacity-30">
                <i className="fa-solid fa-plus text-[9px] mr-1" />Save
              </button>
            </div>
            {/* Saved prompts list */}
            <div className="max-h-60 overflow-y-auto">
              {savedPrompts.length === 0 ? (
                <p className="text-[10px] text-white/25 text-center py-4">No saved prompts yet</p>
              ) : (
                savedPrompts.map((sp) => (
                  <div key={sp.id} className="flex items-start gap-2 px-3 py-1.5 hover:bg-white/5 transition-colors group">
                    <button onClick={() => { setPrompt(sp.text); setShowPromptLib(false); }} className="flex-1 text-left">
                      <p className="text-[10px] font-medium text-white/70 group-hover:text-white/90">{sp.name}</p>
                      <p className="text-[9px] text-white/30 truncate mt-0.5">{sp.text}</p>
                    </button>
                    <button onClick={() => deletePrompt(sp.id)} className="shrink-0 text-white/20 hover:text-red-400 transition-colors mt-0.5">
                      <i className="fa-solid fa-trash text-[8px]" />
                    </button>
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
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="absolute bottom-32 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-[11px] font-medium text-white/90 pointer-events-none z-50"
            style={{ background: "rgba(13,13,20,0.92)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
