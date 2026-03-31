import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
// ReactBits effects are configured here but rendered in Bubble.tsx

interface GeneralSettings {
  launch_on_startup: boolean;
  show_tray_icon: boolean;
  check_for_updates: boolean;
  plugins_directory: string;
}

interface AppearanceSettings {
  theme: string;
  opacity: number;
  blur_strength: number;
  corner_radius: number;
  accent_color: string;
  font_size: number;
  animation_speed: number;
  border_glow: boolean;
  border_glow_speed: number;
  aurora_bg: boolean;
  aurora_speed: number;
  spotlight_cards: boolean;
}

interface BehaviorSettings {
  collapse_delay_ms: number;
  expand_on_hover: boolean;
  expand_on_drag: boolean;
  auto_collapse_on_blur: boolean;
  confirm_clear_all: boolean;
  max_staged_items: number;
  duplicate_detection: boolean;
  position: string;
}

interface ShortcutSettings {
  stage_clipboard: string;
  toggle_window: string;
  clear_all: string;
}

interface ScriptEntry {
  id: string;
  name: string;
  description: string;
  path: string;
  enabled: boolean;
}

interface ApiKeyEntry {
  provider: string;
  label: string;
  key: string;
  model: string;
  is_default: boolean;
}

interface ProcessingDefaults {
  image_quality: number;
  webp_quality: number;
  pdf_compression_level: string;
  default_resize_percentage: number;
  split_chunk_size_mb: number;
}

interface AiPrompts {
  smart_rename: string;
  smart_sort: string;
  ocr: string;
  auto_organize: string;
  translate: string;
  ask_data: string;
  summarize: string;
  super_summary: string;
  dashboard: string;
  research: string;
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

interface ZenithSettings {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  behavior: BehaviorSettings;
  shortcuts: ShortcutSettings;
  scripts: ScriptEntry[];
  api_keys: ApiKeyEntry[];
  processing: ProcessingDefaults;
  ai_prompts: AiPrompts;
  token_usage: TokenUsage;
  vt_api_key: string;
  omdb_api_key: string;
  audiodb_api_key: string;
  imdb_api_key: string;
  tavily_api_key: string;
  shazam_auto_recognize: boolean;
}

interface PluginInfo {
  name: string;
  path: string;
  loaded: boolean;
}

type TabId = "general" | "appearance" | "behavior" | "shortcuts" | "processing" | "api_keys" | "ai_tools" | "token_usage" | "scripts";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "general", label: "General", icon: "fa-solid fa-sliders" },
  { id: "appearance", label: "Appearance", icon: "fa-solid fa-palette" },
  { id: "behavior", label: "Behavior", icon: "fa-solid fa-brain" },
  { id: "processing", label: "Processing", icon: "fa-solid fa-compress" },
  { id: "api_keys", label: "API Keys", icon: "fa-solid fa-key" },
  { id: "ai_tools", label: "AI Prompts", icon: "fa-solid fa-wand-magic-sparkles" },
  { id: "token_usage", label: "Token Usage", icon: "fa-solid fa-chart-line" },
  { id: "shortcuts", label: "Shortcuts", icon: "fa-solid fa-keyboard" },
  { id: "scripts", label: "Scripts", icon: "fa-solid fa-puzzle-piece" },
];

const LLM_PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google Gemini" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "groq", label: "Groq" },
];

// Note: image generation models use a flat per-image cost stored in `input`.
// `output` is 0 for image gen models.  The UI shows "per image" for these.
const IMAGE_GEN_MODEL_IDS = new Set([
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
  "gpt-image-1.5",
]);

const PROVIDER_MODELS: Record<string, { id: string; label: string; input: number; output: number }[]> = {
  openai: [
    { id: "gpt-4.1-nano", label: "GPT-4.1 Nano", input: 0.10, output: 0.40 },
    { id: "gpt-4o-mini", label: "GPT-4o Mini", input: 0.15, output: 0.60 },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", input: 0.40, output: 1.60 },
    { id: "o3-mini", label: "o3 Mini", input: 1.10, output: 4.40 },
    { id: "o4-mini", label: "o4 Mini", input: 1.10, output: 4.40 },
    { id: "gpt-4.1", label: "GPT-4.1", input: 2.00, output: 8.00 },
    { id: "gpt-4o", label: "GPT-4o", input: 2.50, output: 10.00 },
    // ── Image Generation ──────────────────────────────────────────────────
    { id: "gpt-image-1.5", label: "GPT-Image 1.5 ✦ (Image Gen)", input: 0.133, output: 0 },
  ],
  anthropic: [
    { id: "claude-haiku-4-5-20250514", label: "Claude Haiku 4.5", input: 1.00, output: 5.00 },
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", input: 3.00, output: 15.00 },
    { id: "claude-opus-4-20250918", label: "Claude Opus 4", input: 5.00, output: 25.00 },
  ],
  google: [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", input: 0.15, output: 0.60 },
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", input: 0.50, output: 3.00 },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", input: 1.25, output: 10.00 },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", input: 2.00, output: 12.00 },
    // ── Image Generation ──────────────────────────────────────────────────
    { id: "gemini-3.1-flash-image-preview", label: "Nano Banana 2 ✦ (Image Gen)", input: 0.067, output: 0 },
    { id: "gemini-3-pro-image-preview", label: "Nano Banana Pro ✦ (Image Gen)", input: 0.134, output: 0 },
  ],
  deepseek: [
    { id: "deepseek-chat", label: "DeepSeek V3 (Chat)", input: 0.27, output: 1.10 },
    { id: "deepseek-reasoner", label: "DeepSeek R1 (Reasoner)", input: 0.55, output: 2.19 },
  ],
  groq: [
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", input: 0.59, output: 0.79 },
    { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B", input: 0.05, output: 0.08 },
    { id: "gemma2-9b-it", label: "Gemma 2 9B", input: 0.20, output: 0.20 },
  ],
};

function getModelPricing(provider: string, modelId: string): { input: number; output: number } | null {
  const models = PROVIDER_MODELS[provider] || [];
  return models.find((m) => m.id === modelId) || null;
}

const ACCENT_PRESETS = [
  "#22d3ee", "#8b5cf6", "#f43f5e", "#10b981",
  "#f59e0b", "#3b82f6", "#ec4899", "#14b8a6",
];

const POSITIONS = [
  { value: "bottom-right", label: "Bottom Right" },
  { value: "bottom-left", label: "Bottom Left" },
  { value: "top-right", label: "Top Right" },
  { value: "top-left", label: "Top Left" },
];

export function Settings() {
  const [activeTab, setActiveTab] = useState<TabId>("general");
  const [settings, setSettings] = useState<ZenithSettings | null>(null);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [saved, setSaved] = useState(false);
  const [pluginOutput, setPluginOutput] = useState<string | null>(null);
  const [runningScripts, setRunningScripts] = useState<Record<string, boolean>>({});

  useEffect(() => {
    invoke<ZenithSettings>("get_settings").then((s) => {
      setSettings(s);
      // Check which scripts are currently running
      (s.scripts || []).forEach((script) => {
        invoke<boolean>("is_script_running", { scriptId: script.id })
          .then((running) => setRunningScripts((prev) => ({ ...prev, [script.id]: running })))
          .catch(() => {});
      });
    }).catch(console.error);
    invoke<PluginInfo[]>("list_plugins").then(setPlugins).catch(console.error);
  }, []);

  // Poll script running status
  useEffect(() => {
    if (!settings) return;
    const interval = setInterval(() => {
      (settings.scripts || []).forEach((script) => {
        invoke<boolean>("is_script_running", { scriptId: script.id })
          .then((running) => setRunningScripts((prev) => ({ ...prev, [script.id]: running })))
          .catch(() => {});
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [settings]);

  const save = useCallback(async (updated: ZenithSettings) => {
    setSettings(updated);
    try {
      await invoke("save_settings", { newSettings: updated });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  }, []);

  const updateGeneral = (key: keyof GeneralSettings, value: unknown) => {
    if (!settings) return;
    const updated = { ...settings, general: { ...settings.general, [key]: value } };
    save(updated);
  };

  const updateAppearance = (key: keyof AppearanceSettings, value: unknown) => {
    if (!settings) return;
    const updated = { ...settings, appearance: { ...settings.appearance, [key]: value } };
    save(updated);
  };

  const updateBehavior = (key: keyof BehaviorSettings, value: unknown) => {
    if (!settings) return;
    const updated = { ...settings, behavior: { ...settings.behavior, [key]: value } };
    save(updated);
  };

  const updateShortcut = (key: keyof ShortcutSettings, value: string) => {
    if (!settings) return;
    const updated = { ...settings, shortcuts: { ...settings.shortcuts, [key]: value } };
    save(updated);
  };

  const updateProcessing = (key: keyof ProcessingDefaults, value: unknown) => {
    if (!settings) return;
    const updated = { ...settings, processing: { ...settings.processing, [key]: value } };
    save(updated);
  };

  const updateAiPrompt = (key: keyof AiPrompts, value: string) => {
    if (!settings) return;
    const updated = { ...settings, ai_prompts: { ...settings.ai_prompts, [key]: value } };
    save(updated);
  };

  const addApiKey = () => {
    if (!settings) return;
    const entry: ApiKeyEntry = { provider: "openai", label: "", key: "", model: "", is_default: settings.api_keys.length === 0 };
    save({ ...settings, api_keys: [...settings.api_keys, entry] });
  };

  const updateApiKey = (idx: number, patch: Partial<ApiKeyEntry>) => {
    if (!settings) return;
    const keys = settings.api_keys.map((k, i) => i === idx ? { ...k, ...patch } : k);
    save({ ...settings, api_keys: keys });
  };

  const removeApiKey = (idx: number) => {
    if (!settings) return;
    const keys = settings.api_keys.filter((_, i) => i !== idx);
    save({ ...settings, api_keys: keys });
  };

  const setDefaultApiKey = (idx: number) => {
    if (!settings) return;
    const keys = settings.api_keys.map((k, i) => ({ ...k, is_default: i === idx }));
    save({ ...settings, api_keys: keys });
  };

  const runPlugin = async (path: string) => {
    try {
      const result = await invoke<string>("run_plugin", { pluginPath: path });
      setPluginOutput(result);
    } catch (e) {
      setPluginOutput(`Error: ${e}`);
    }
  };

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#121218]">
        <div className="text-white/40 text-sm">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#121218] text-white select-none">
      {/* Sidebar */}
      <div
        className="w-[200px] flex flex-col border-r"
        style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.3)" }}
      >
        <div className="px-5 pt-6 pb-4 border-b border-white/[0.04] mb-2">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(34,211,238,0.12)" }}>
              <i className="fa-solid fa-gear text-[11px] text-cyan-400" />
            </div>
            <div>
              <h1 className="text-[15px] font-bold tracking-wide text-white/90">Settings</h1>
              <p className="text-[10px] text-white/30">Zenith v0.1.0</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-2 space-y-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-white/10 text-white border-l-2 border-cyan-400"
                  : "text-white/40 hover:text-white/70 hover:bg-white/[0.04] border-l-2 border-transparent"
              }`}
            >
              <i className={`${tab.icon} text-sm w-4 text-center`} />
              {tab.label}
            </button>
          ))}
        </nav>

        {saved && (
          <div className="mx-3 mb-4 px-3 py-2 rounded-lg bg-emerald-500/15 text-emerald-300 text-[11px] font-medium text-center">
            Settings saved
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">
        {activeTab === "general" && (
          <TabPanel title="General" description="Configure core application behavior">
            <SettingGroup title="Startup">
              <Toggle
                label="Launch on system startup"
                description="Automatically start Zenith when Windows boots"
                checked={settings.general.launch_on_startup}
                onChange={(v) => updateGeneral("launch_on_startup", v)}
              />
              <Toggle
                label="Show tray icon"
                description="Display Zenith in the system notification area"
                checked={settings.general.show_tray_icon}
                onChange={(v) => updateGeneral("show_tray_icon", v)}
              />
            </SettingGroup>
            <SettingGroup title="Updates">
              <Toggle
                label="Check for updates automatically"
                description="Periodically check for new versions of Zenith"
                checked={settings.general.check_for_updates}
                onChange={(v) => updateGeneral("check_for_updates", v)}
              />
            </SettingGroup>
            <SettingGroup title="Storage">
              <TextInput
                label="Plugins directory"
                description="Where WASM extension files are stored"
                value={settings.general.plugins_directory}
                onChange={(v) => updateGeneral("plugins_directory", v)}
              />
            </SettingGroup>
          </TabPanel>
        )}

        {activeTab === "appearance" && (
          <TabPanel title="Appearance" description="Customize the look and feel of Zenith">
            <SettingGroup title="Theme">
              <Select
                label="Color scheme"
                description="Choose between dark and light themes"
                value={settings.appearance.theme}
                options={[
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                  { value: "system", label: "Follow System" },
                ]}
                onChange={(v) => updateAppearance("theme", v)}
              />
              <div className="mt-4">
                <label className="text-[13px] font-medium text-white/80">Accent color</label>
                <p className="text-[11px] text-white/30 mb-2">Primary color for highlights and indicators</p>
                <div className="flex gap-2 flex-wrap">
                  {ACCENT_PRESETS.map((color) => (
                    <button
                      key={color}
                      onClick={() => updateAppearance("accent_color", color)}
                      className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
                      style={{
                        background: color,
                        borderColor: settings.appearance.accent_color === color ? "white" : "transparent",
                      }}
                    />
                  ))}
                </div>
              </div>
            </SettingGroup>
            <SettingGroup title="Window">
              <Slider
                label="Corner radius"
                description="Roundness of the panel corners"
                value={settings.appearance.corner_radius}
                min={0}
                max={40}
                step={1}
                displayValue={`${settings.appearance.corner_radius}px`}
                onChange={(v) => updateAppearance("corner_radius", v)}
              />
            </SettingGroup>
            <SettingGroup title="Effects">
              <Toggle
                label="Border glow"
                description="Animated gradient glow around the panel and pill"
                checked={settings.appearance.border_glow !== false}
                onChange={(v) => updateAppearance("border_glow", v)}
              />
              {settings.appearance.border_glow !== false && (
                <Slider
                  label="Glow rotation speed"
                  description="How fast the border glow rotates"
                  value={settings.appearance.border_glow_speed ?? 4}
                  min={1}
                  max={12}
                  step={0.5}
                  displayValue={`${(settings.appearance.border_glow_speed ?? 4).toFixed(1)}s`}
                  onChange={(v) => updateAppearance("border_glow_speed", v)}
                />
              )}
              <Toggle
                label="Aurora background"
                description="Soft animated gradient aurora behind panel content"
                checked={settings.appearance.aurora_bg !== false}
                onChange={(v) => updateAppearance("aurora_bg", v)}
              />
              {settings.appearance.aurora_bg !== false && (
                <Slider
                  label="Aurora animation speed"
                  description="Duration of one aurora cycle"
                  value={settings.appearance.aurora_speed ?? 8}
                  min={3}
                  max={20}
                  step={1}
                  displayValue={`${settings.appearance.aurora_speed ?? 8}s`}
                  onChange={(v) => updateAppearance("aurora_speed", v)}
                />
              )}
              <Toggle
                label="Spotlight cards"
                description="Mouse-tracking highlight effect on file cards"
                checked={settings.appearance.spotlight_cards !== false}
                onChange={(v) => updateAppearance("spotlight_cards", v)}
              />
            </SettingGroup>
            <SettingGroup title="Typography">
              <Slider
                label="Font size"
                description="Base text size across the UI"
                value={settings.appearance.font_size}
                min={10}
                max={18}
                step={0.5}
                displayValue={`${settings.appearance.font_size}px`}
                onChange={(v) => updateAppearance("font_size", v)}
              />
              <Slider
                label="Animation speed"
                description="Controls how fast UI animations play (1x = normal)"
                value={settings.appearance.animation_speed}
                min={0.2}
                max={3}
                step={0.1}
                displayValue={`${settings.appearance.animation_speed.toFixed(1)}x`}
                onChange={(v) => updateAppearance("animation_speed", v)}
              />
            </SettingGroup>
          </TabPanel>
        )}

        {activeTab === "behavior" && (
          <TabPanel title="Behavior" description="Control how Zenith responds to interactions">
            <SettingGroup title="Expand / Collapse">
              <Toggle
                label="Expand on hover"
                description="Open the panel when hovering over the collapsed pill"
                checked={settings.behavior.expand_on_hover}
                onChange={(v) => updateBehavior("expand_on_hover", v)}
              />
              <Toggle
                label="Expand on file drag"
                description="Open the panel when dragging files near the Zenith zone"
                checked={settings.behavior.expand_on_drag}
                onChange={(v) => updateBehavior("expand_on_drag", v)}
              />
              <Toggle
                label="Auto-collapse on blur"
                description="Collapse when you click away from Zenith"
                checked={settings.behavior.auto_collapse_on_blur}
                onChange={(v) => updateBehavior("auto_collapse_on_blur", v)}
              />
              <Slider
                label="Collapse delay"
                description="Time before the panel auto-collapses"
                value={settings.behavior.collapse_delay_ms}
                min={300}
                max={5000}
                step={100}
                displayValue={`${(settings.behavior.collapse_delay_ms / 1000).toFixed(1)}s`}
                onChange={(v) => updateBehavior("collapse_delay_ms", v)}
              />
            </SettingGroup>
            <SettingGroup title="Items">
              <Toggle
                label="Confirm clear all"
                description="Ask before removing all staged items"
                checked={settings.behavior.confirm_clear_all}
                onChange={(v) => updateBehavior("confirm_clear_all", v)}
              />
              <Toggle
                label="Duplicate detection"
                description="Prevent staging the same file twice"
                checked={settings.behavior.duplicate_detection}
                onChange={(v) => updateBehavior("duplicate_detection", v)}
              />
              <Slider
                label="Max staged items"
                description="Maximum number of items in the staging area"
                value={settings.behavior.max_staged_items}
                min={5}
                max={200}
                step={5}
                displayValue={`${settings.behavior.max_staged_items}`}
                onChange={(v) => updateBehavior("max_staged_items", Math.round(v))}
              />
            </SettingGroup>
            <SettingGroup title="Position">
              <Select
                label="Window position"
                description="Where Zenith appears on screen"
                value={settings.behavior.position}
                options={POSITIONS}
                onChange={(v) => updateBehavior("position", v)}
              />
            </SettingGroup>
          </TabPanel>
        )}

        {activeTab === "shortcuts" && (
          <TabPanel title="Shortcuts" description="Configure global keyboard shortcuts">
            <SettingGroup title="Global Shortcuts">
              <TextInput
                label="Stage clipboard"
                description="Shortcut to stage clipboard contents into Zenith"
                value={settings.shortcuts.stage_clipboard}
                onChange={(v) => updateShortcut("stage_clipboard", v)}
                placeholder="e.g. CmdOrCtrl+Shift+V"
              />
              <TextInput
                label="Toggle window"
                description="Shortcut to show/hide the Zenith panel"
                value={settings.shortcuts.toggle_window}
                onChange={(v) => updateShortcut("toggle_window", v)}
                placeholder="e.g. CmdOrCtrl+Shift+Z"
              />
              <TextInput
                label="Clear all items"
                description="Shortcut to clear all staged items"
                value={settings.shortcuts.clear_all}
                onChange={(v) => updateShortcut("clear_all", v)}
                placeholder="Leave empty to disable"
              />
            </SettingGroup>
            <div className="mt-4 p-4 rounded-xl bg-white/3 border border-white/6">
              <p className="text-[11px] text-white/30 leading-relaxed">
                Use Electron-style shortcut format: <code className="text-white/50">CmdOrCtrl</code>, <code className="text-white/50">Shift</code>, <code className="text-white/50">Alt</code> combined with key names separated by <code className="text-white/50">+</code>.
                <br />
                Examples: <code className="text-white/50">CmdOrCtrl+Shift+V</code>, <code className="text-white/50">Alt+Z</code>
              </p>
            </div>
          </TabPanel>
        )}

        {activeTab === "processing" && (
          <TabPanel title="Processing Defaults" description="Default parameters for file processing actions">
            <SettingGroup title="Image Compression">
              <Slider
                label="Default quality"
                description="Quality level for image compression (lower = smaller file)"
                value={settings.processing?.image_quality ?? 80}
                min={10} max={100} step={5}
                displayValue={`${settings.processing?.image_quality ?? 80}%`}
                onChange={(v) => updateProcessing("image_quality", Math.round(v))}
              />
              <Slider
                label="WebP quality"
                description="Quality for WebP conversion"
                value={settings.processing?.webp_quality ?? 85}
                min={10} max={100} step={5}
                displayValue={`${settings.processing?.webp_quality ?? 85}%`}
                onChange={(v) => updateProcessing("webp_quality", Math.round(v))}
              />
              <Slider
                label="Default resize percentage"
                description="Default scale when resizing images"
                value={settings.processing?.default_resize_percentage ?? 50}
                min={10} max={100} step={5}
                displayValue={`${settings.processing?.default_resize_percentage ?? 50}%`}
                onChange={(v) => updateProcessing("default_resize_percentage", Math.round(v))}
              />
            </SettingGroup>
            <SettingGroup title="PDF">
              <Select
                label="Compression level"
                description="How aggressively to compress PDFs"
                value={settings.processing?.pdf_compression_level ?? "medium"}
                options={[
                  { value: "low", label: "Low (faster, larger)" },
                  { value: "medium", label: "Medium (balanced)" },
                  { value: "high", label: "High (slower, smaller)" },
                ]}
                onChange={(v) => updateProcessing("pdf_compression_level", v)}
              />
            </SettingGroup>
            <SettingGroup title="File Splitting">
              <Slider
                label="Default chunk size"
                description="Size of each chunk when splitting large files"
                value={settings.processing?.split_chunk_size_mb ?? 25}
                min={1} max={100} step={1}
                displayValue={`${settings.processing?.split_chunk_size_mb ?? 25} MB`}
                onChange={(v) => updateProcessing("split_chunk_size_mb", Math.round(v))}
              />
            </SettingGroup>
          </TabPanel>
        )}

        {activeTab === "api_keys" && (
          <TabPanel title="API Keys" description="Configure LLM providers, models, and API keys">
            <SettingGroup title="LLM Providers">
              {(settings.api_keys ?? []).length === 0 ? (
                <div className="py-8 text-center">
                  <i className="fa-solid fa-key text-2xl text-white/10 mb-2 block" />
                  <p className="text-[13px] text-white/30">No API keys configured</p>
                  <p className="text-[11px] text-white/20 mt-1">Add a key to enable AI features</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {(settings.api_keys ?? []).map((entry, idx) => {
                    const models = PROVIDER_MODELS[entry.provider] || [];
                    const pricing = getModelPricing(entry.provider, entry.model);
                    return (
                    <div key={idx} className="p-4 rounded-xl bg-white/3 border border-white/6 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
                            <i className="fa-solid fa-key text-amber-400 text-sm" />
                          </div>
                          <div className="flex-1">
                            <input
                              type="text" placeholder="Label (e.g. My OpenAI Key)"
                              value={entry.label}
                              onChange={(e) => updateApiKey(idx, { label: e.target.value })}
                              className="w-full text-[13px] font-medium text-white/85 bg-transparent outline-none placeholder:text-white/20"
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setDefaultApiKey(idx)}
                            className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${
                              entry.is_default ? "text-amber-300 bg-amber-500/15" : "text-white/25 hover:text-white/50"
                            }`}
                          >
                            {entry.is_default ? "Default" : "Set default"}
                          </button>
                          <button onClick={() => removeApiKey(idx)} className="text-white/20 hover:text-red-400 transition-colors">
                            <i className="fa-solid fa-trash text-[10px]" />
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={entry.provider}
                          onChange={(e) => {
                            const prov = e.target.value;
                            const firstModel = (PROVIDER_MODELS[prov] || [])[0]?.id || "";
                            updateApiKey(idx, { provider: prov, model: firstModel });
                          }}
                          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[13px] text-white/80 outline-none appearance-none cursor-pointer"
                        >
                          {LLM_PROVIDERS.map((p) => (
                            <option key={p.value} value={p.value} className="bg-[#1a1a24] text-white">{p.label}</option>
                          ))}
                        </select>
                        <select
                          value={entry.model}
                          onChange={(e) => updateApiKey(idx, { model: e.target.value })}
                          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[13px] text-white/80 outline-none appearance-none cursor-pointer"
                        >
                          {models.length === 0 && <option value="" className="bg-[#1a1a24] text-white">Custom model</option>}
                          {models.map((m) => (
                            <option key={m.id} value={m.id} className="bg-[#1a1a24] text-white">
                              {IMAGE_GEN_MODEL_IDS.has(m.id)
                                ? `${m.label} — $${m.input.toFixed(3)}/image`
                                : `${m.label} — $${m.input}/$${m.output} per 1M`}
                            </option>
                          ))}
                        </select>
                      </div>
                      <input
                        type="password" placeholder="API Key (sk-... or similar)"
                        value={entry.key}
                        onChange={(e) => updateApiKey(idx, { key: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[13px] text-white/80 placeholder:text-white/20 outline-none focus:border-amber-400/40 transition-colors font-mono"
                      />
                      {pricing && (
                        IMAGE_GEN_MODEL_IDS.has(entry.model) ? (
                          <div className="flex items-center gap-2 text-[10px] text-white/30">
                            <i className="fa-solid fa-image text-[8px] text-violet-400/60" />
                            <span>Image generation: <span className="text-white/50 font-mono">${pricing.input.toFixed(3)}</span> per image</span>
                            <span className="text-violet-400/50 ml-1">· Used by Zenith Editor</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 text-[10px] text-white/30">
                            <span><i className="fa-solid fa-arrow-down text-[8px] text-cyan-400/60 mr-1" />Input: <span className="text-white/50 font-mono">${pricing.input.toFixed(2)}</span>/1M</span>
                            <span><i className="fa-solid fa-arrow-up text-[8px] text-pink-400/60 mr-1" />Output: <span className="text-white/50 font-mono">${pricing.output.toFixed(2)}</span>/1M</span>
                          </div>
                        )
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
              <button
                onClick={addApiKey}
                className="mt-3 w-full py-2 rounded-xl border border-dashed border-white/10 hover:border-white/20 text-[12px] text-white/30 hover:text-white/60 font-medium transition-colors"
              >
                <i className="fa-solid fa-plus text-[10px] mr-1.5" />
                Add API Key
              </button>
            </SettingGroup>
            <SettingGroup title="VirusTotal">
              <p className="text-[11px] text-white/30 mb-2">Scan files and URLs for malware using the VirusTotal API.</p>
              <input
                type="password" placeholder="VirusTotal API Key"
                value={settings.vt_api_key ?? ""}
                onChange={(e) => save({ ...settings, vt_api_key: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[13px] text-white/80 placeholder:text-white/20 outline-none focus:border-amber-400/40 transition-colors font-mono"
              />
              <p className="text-[10px] text-white/20 mt-1">Get a free key at <code className="text-white/40">virustotal.com/gui/my-apikey</code></p>
            </SettingGroup>
            <SettingGroup title="Tavily (Research Web Search)">
              <p className="text-[11px] text-white/30 mb-2">AI-powered web search used by the Research Window. Falls back to DuckDuckGo if no key is set.</p>
              <input
                type="password" placeholder="Tavily API Key (optional)"
                value={settings.tavily_api_key ?? ""}
                onChange={(e) => save({ ...settings, tavily_api_key: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[13px] text-white/80 placeholder:text-white/20 outline-none focus:border-cyan-400/40 transition-colors font-mono"
              />
              <p className="text-[10px] text-white/20 mt-1">Get a key at <code className="text-white/40">tavily.com</code> — free tier available. Powers Research Window web search.</p>
            </SettingGroup>
            <SettingGroup title="IMDb API (Movies & Series) — Primary">
              <p className="text-[11px] text-white/30 mb-2">Primary API for movie/series identification. Free tier available, premium key optional.</p>
              <input
                type="password" placeholder="imdbapi.dev API Key (optional — free tier works without key)"
                value={settings.imdb_api_key ?? ""}
                onChange={(e) => save({ ...settings, imdb_api_key: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[13px] text-white/80 placeholder:text-white/20 outline-none focus:border-amber-400/40 transition-colors font-mono"
              />
              <p className="text-[10px] text-white/20 mt-1">API: <code className="text-white/40">imdbapi.dev</code> — works without a key for basic searches</p>
            </SettingGroup>
            <SettingGroup title="OMDB (Movies & Series) — Fallback">
              <p className="text-[11px] text-white/30 mb-2">Fallback API if imdbapi.dev fails. Used for detailed metadata (ratings, plot, director).</p>
              <input
                type="password" placeholder="OMDB API Key"
                value={settings.omdb_api_key ?? ""}
                onChange={(e) => save({ ...settings, omdb_api_key: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[13px] text-white/80 placeholder:text-white/20 outline-none focus:border-amber-400/40 transition-colors font-mono"
              />
              <p className="text-[10px] text-white/20 mt-1">Get a free key at <code className="text-white/40">omdbapi.com/apikey.aspx</code> (1,000 requests/day)</p>
            </SettingGroup>
            <SettingGroup title="Shazam Music Recognition">
              <p className="text-[11px] text-white/30 mb-2">Audio fingerprinting powered by SongRec. Identifies songs from audio files using Shazam's recognition API. Used as a fallback in Smart Organize when filename-based lookup fails.</p>
              <div className="flex items-center gap-3 mt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.shazam_auto_recognize !== false}
                    onChange={(e) => save({ ...settings, shazam_auto_recognize: e.target.checked })}
                    className="accent-amber-400"
                  />
                  <span className="text-[11px] text-white/60">Auto-recognize in Smart Organize</span>
                </label>
              </div>
              <p className="text-[10px] text-white/20 mt-1">When enabled, unidentified audio files are fingerprinted and matched via Shazam during Smart Organize. No API key needed.</p>
            </SettingGroup>
            <SettingGroup title="TheAudioDB (Music)">
              <p className="text-[11px] text-white/30 mb-2">Music metadata: album, artist, year, cover art. Free tier uses key <code className="text-white/40">523532</code>. Enter a premium key for higher rate limits.</p>
              <input
                type="password" placeholder="Premium API Key (leave empty for free tier)"
                value={settings.audiodb_api_key ?? ""}
                onChange={(e) => save({ ...settings, audiodb_api_key: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[13px] text-white/80 placeholder:text-white/20 outline-none focus:border-amber-400/40 transition-colors font-mono"
              />
              <p className="text-[10px] text-white/20 mt-1">API: <code className="text-white/40">theaudiodb.com/free_music_api</code> — free key <code className="text-white/40">523532</code> used by default</p>
            </SettingGroup>
            <div className="mt-4 p-4 rounded-xl bg-white/3 border border-white/6">
              <p className="text-[11px] text-white/30 leading-relaxed">
                <i className="fa-solid fa-shield-halved text-white/20 mr-1" />
                Keys are stored locally in <code className="text-white/50">%APPDATA%/Zenith/settings.json</code>. They are never sent anywhere except directly to the provider APIs.
                <br />
                <span className="text-white/20">Pricing as of March 2026. All prices USD per 1M tokens (input/output).</span>
              </p>
            </div>
          </TabPanel>
        )}

        {activeTab === "ai_tools" && (
          <TabPanel title="AI Prompts" description="Configure system prompts for each AI-powered feature. These instruct the LLM how to behave.">
            <SettingGroup title="File Management">
              <div className="space-y-5">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <i className="fa-solid fa-wand-magic-sparkles text-[10px] text-purple-400" />
                    <span className="text-[12px] font-medium text-white/70">Smart Rename</span>
                  </div>
                  <p className="text-[10px] text-white/25 mb-1.5">Suggests descriptive filenames. Filename & content preview appended automatically.</p>
                  <TextArea label="" description="" value={settings.ai_prompts?.smart_rename ?? ""} onChange={(v) => updateAiPrompt("smart_rename", v)} rows={2} />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <i className="fa-solid fa-folder-tree text-[10px] text-purple-400" />
                    <span className="text-[12px] font-medium text-white/70">Auto-Organize</span>
                  </div>
                  <p className="text-[10px] text-white/25 mb-1.5">Categorizes and renames staged files into folders. File list appended automatically.</p>
                  <TextArea label="" description="" value={settings.ai_prompts?.auto_organize ?? ""} onChange={(v) => updateAiPrompt("auto_organize", v)} rows={3} />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <i className="fa-solid fa-layer-group text-[10px] text-purple-400" />
                    <span className="text-[12px] font-medium text-white/70">Smart Sort</span>
                  </div>
                  <p className="text-[10px] text-white/25 mb-1.5">Groups files by category. File list appended automatically.</p>
                  <TextArea label="" description="" value={settings.ai_prompts?.smart_sort ?? ""} onChange={(v) => updateAiPrompt("smart_sort", v)} rows={2} />
                </div>
              </div>
            </SettingGroup>

            <SettingGroup title="Document Intelligence">
              <div className="space-y-5">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <i className="fa-solid fa-comments text-[10px] text-cyan-400" />
                    <span className="text-[12px] font-medium text-white/70">Ask Data (Q&A)</span>
                  </div>
                  <p className="text-[10px] text-white/25 mb-1.5">Answers questions using document chunks. Relevant chunks appended automatically.</p>
                  <TextArea label="" description="" value={settings.ai_prompts?.ask_data ?? ""} onChange={(v) => updateAiPrompt("ask_data", v)} rows={2} />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <i className="fa-solid fa-book-open text-[10px] text-violet-400" />
                    <span className="text-[12px] font-medium text-white/70">Summarize</span>
                  </div>
                  <p className="text-[10px] text-white/25 mb-1.5">Creates TL;DR + detailed summary. Document text appended automatically.</p>
                  <TextArea label="" description="" value={settings.ai_prompts?.summarize ?? ""} onChange={(v) => updateAiPrompt("summarize", v)} rows={2} />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <i className="fa-solid fa-books text-[10px] text-violet-400" />
                    <span className="text-[12px] font-medium text-white/70">Super Summary (Multi-Doc)</span>
                  </div>
                  <p className="text-[10px] text-white/25 mb-1.5">Executive summary across multiple docs with citations. Summaries appended automatically.</p>
                  <TextArea label="" description="" value={settings.ai_prompts?.super_summary ?? ""} onChange={(v) => updateAiPrompt("super_summary", v)} rows={2} />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <i className="fa-solid fa-language text-[10px] text-emerald-400" />
                    <span className="text-[12px] font-medium text-white/70">Translate</span>
                  </div>
                  <p className="text-[10px] text-white/25 mb-1.5">Translates documents. Target language and text appended automatically.</p>
                  <TextArea label="" description="" value={settings.ai_prompts?.translate ?? ""} onChange={(v) => updateAiPrompt("translate", v)} rows={2} />
                </div>
              </div>
            </SettingGroup>

            <SettingGroup title="Vision & Data">
              <div className="space-y-5">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <i className="fa-solid fa-font text-[10px] text-teal-400" />
                    <span className="text-[12px] font-medium text-white/70">OCR (Text Extraction)</span>
                  </div>
                  <p className="text-[10px] text-white/25 mb-1.5">Extracts text from images via LLM vision. Falls back to Tesseract if available.</p>
                  <TextArea label="" description="" value={settings.ai_prompts?.ocr ?? ""} onChange={(v) => updateAiPrompt("ocr", v)} rows={2} />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <i className="fa-solid fa-chart-column text-[10px] text-amber-400" />
                    <span className="text-[12px] font-medium text-white/70">Generate Dashboard</span>
                  </div>
                  <p className="text-[10px] text-white/25 mb-1.5">Creates interactive HTML dashboard from CSV. Column info appended automatically.</p>
                  <TextArea label="" description="" value={settings.ai_prompts?.dashboard ?? ""} onChange={(v) => updateAiPrompt("dashboard", v)} rows={2} />
                </div>
              </div>
            </SettingGroup>

            <SettingGroup title="Research Window">
              <div className="space-y-5">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <i className="fa-solid fa-microscope text-[10px] text-cyan-400" />
                    <span className="text-[12px] font-medium text-white/70">Research Assistant</span>
                  </div>
                  <p className="text-[10px] text-white/25 mb-1.5">System prompt for the Zenith Research Window. Controls how the AI researcher behaves, including tool usage and citation style.</p>
                  <TextArea label="" description="" value={settings.ai_prompts?.research ?? ""} onChange={(v) => updateAiPrompt("research", v)} rows={4} />
                </div>
              </div>
            </SettingGroup>

            {(!settings.api_keys || settings.api_keys.length === 0) && (
              <div className="mt-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <p className="text-[12px] text-amber-300 font-medium">
                  <i className="fa-solid fa-triangle-exclamation text-[10px] mr-1.5" />
                  No API keys configured. AI tools require at least one API key.
                </p>
                <button
                  onClick={() => setActiveTab("api_keys")}
                  className="mt-2 text-[11px] text-amber-200 hover:text-amber-100 underline transition-colors"
                >
                  Go to API Keys
                </button>
              </div>
            )}
          </TabPanel>
        )}

        {activeTab === "token_usage" && (
          <TabPanel title="Token Usage" description="Track LLM token consumption and estimated costs across all AI actions">
            <SettingGroup title="Usage Summary">
              {(() => {
                const tu = settings.token_usage ?? { entries: [], total_input_tokens: 0, total_output_tokens: 0, total_cost_usd: 0 };
                const totalIn = tu.total_input_tokens;
                const totalOut = tu.total_output_tokens;
                const totalCost = tu.total_cost_usd;
                return (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="p-4 rounded-xl bg-cyan-500/8 border border-cyan-500/15 text-center">
                        <p className="text-[10px] text-cyan-300/60 uppercase tracking-wider mb-1">Input Tokens</p>
                        <p className="text-[18px] font-bold text-cyan-300 font-mono">{totalIn.toLocaleString()}</p>
                      </div>
                      <div className="p-4 rounded-xl bg-pink-500/8 border border-pink-500/15 text-center">
                        <p className="text-[10px] text-pink-300/60 uppercase tracking-wider mb-1">Output Tokens</p>
                        <p className="text-[18px] font-bold text-pink-300 font-mono">{totalOut.toLocaleString()}</p>
                      </div>
                      <div className="p-4 rounded-xl bg-emerald-500/8 border border-emerald-500/15 text-center">
                        <p className="text-[10px] text-emerald-300/60 uppercase tracking-wider mb-1">Est. Cost</p>
                        <p className="text-[18px] font-bold text-emerald-300 font-mono">${totalCost.toFixed(4)}</p>
                      </div>
                    </div>
                    <p className="text-[10px] text-white/20">Total tokens: <span className="text-white/40 font-mono">{(totalIn + totalOut).toLocaleString()}</span></p>
                  </div>
                );
              })()}
            </SettingGroup>

            <SettingGroup title="Per-Provider Breakdown">
              {(() => {
                const tu = settings.token_usage ?? { entries: [], total_input_tokens: 0, total_output_tokens: 0, total_cost_usd: 0 };
                if (tu.entries.length === 0) {
                  return (
                    <div className="py-6 text-center">
                      <i className="fa-solid fa-chart-line text-xl text-white/10 mb-2 block" />
                      <p className="text-[13px] text-white/30">No usage recorded yet</p>
                      <p className="text-[11px] text-white/20 mt-1">Token usage will appear here after using any AI feature</p>
                    </div>
                  );
                }
                const providerColors: Record<string, string> = {
                  openai: "text-green-400 bg-green-500/10 border-green-500/20",
                  anthropic: "text-orange-400 bg-orange-500/10 border-orange-500/20",
                  google: "text-blue-400 bg-blue-500/10 border-blue-500/20",
                  deepseek: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
                  groq: "text-purple-400 bg-purple-500/10 border-purple-500/20",
                };
                return (
                  <div className="space-y-2">
                    {tu.entries.map((e, i) => {
                      const colors = providerColors[e.provider] || "text-white/60 bg-white/5 border-white/10";
                      const provLabel = LLM_PROVIDERS.find((p) => p.value === e.provider)?.label || e.provider;
                      return (
                        <div key={i} className={`p-3 rounded-xl border ${colors.split(" ").slice(1).join(" ")}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-[12px] font-semibold ${colors.split(" ")[0]}`}>{provLabel}</span>
                            <span className="text-[11px] text-white/40 font-mono">${e.cost_usd.toFixed(4)}</span>
                          </div>
                          <div className="flex gap-4 text-[10px] text-white/30">
                            <span>In: <span className="text-white/50 font-mono">{e.input_tokens.toLocaleString()}</span></span>
                            <span>Out: <span className="text-white/50 font-mono">{e.output_tokens.toLocaleString()}</span></span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </SettingGroup>

            <SettingGroup title="Actions">
              <button
                onClick={() => {
                  if (!settings) return;
                  const updated = {
                    ...settings,
                    token_usage: { entries: [], total_input_tokens: 0, total_output_tokens: 0, total_cost_usd: 0 },
                  };
                  save(updated);
                }}
                className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[12px] font-medium text-red-300 hover:bg-red-500/20 transition-colors"
              >
                <i className="fa-solid fa-trash text-[10px] mr-1.5" />
                Reset All Usage Data
              </button>
            </SettingGroup>

            <div className="mt-4 p-4 rounded-xl bg-white/3 border border-white/6">
              <p className="text-[11px] text-white/30 leading-relaxed">
                <i className="fa-solid fa-info-circle text-white/20 mr-1" />
                Costs are estimated based on official API pricing as of March 2026.
                Actual billing may vary due to caching, batch discounts, or rate changes.
              </p>
            </div>
          </TabPanel>
        )}

        {activeTab === "scripts" && (
          <TabPanel title="Scripts & Extensions" description="Manage scripts and WASM plugins">
            <SettingGroup title="Built-in Scripts">
              {(settings.scripts || []).length === 0 ? (
                <div className="py-8 text-center">
                  <i className="fa-solid fa-scroll text-2xl text-white/10 mb-2 block" />
                  <p className="text-[13px] text-white/30">No scripts available</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {(settings.scripts || []).map((script) => {
                    const isRunning = runningScripts[script.id] || false;
                    const iconMap: Record<string, string> = {
                      ai_summarizer: "fa-solid fa-robot",
                      duplicate_finder: "fa-solid fa-clone",
                    };
                    const colorMap: Record<string, string> = {
                      ai_summarizer: "bg-violet-500/15 text-violet-400",
                      duplicate_finder: "bg-amber-500/15 text-amber-400",
                    };
                    return (
                      <div
                        key={script.id}
                        className="p-4 rounded-xl bg-white/3 border border-white/6 space-y-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm ${colorMap[script.id] || "bg-cyan-500/15 text-cyan-400"}`}>
                              <i className={iconMap[script.id] || "fa-solid fa-code"} />
                            </div>
                            <div>
                              <p className="text-[13px] font-medium text-white/85">{script.name}</p>
                              <p className="text-[11px] text-white/35">{script.description}</p>
                            </div>
                          </div>
                          <Toggle
                            label=""
                            description=""
                            checked={script.enabled}
                            onChange={(enabled) => {
                              if (!settings) return;
                              const updated = {
                                ...settings,
                                scripts: settings.scripts.map((s) =>
                                  s.id === script.id ? { ...s, enabled } : s
                                ),
                              };
                              save(updated);
                              if (!enabled && isRunning) {
                                invoke("stop_script", { scriptId: script.id })
                                  .then(() => setRunningScripts((prev) => ({ ...prev, [script.id]: false })))
                                  .catch(console.error);
                              }
                            }}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          {script.enabled && !isRunning && (
                            <button
                              onClick={() => {
                                invoke("launch_script", { scriptId: script.id, scriptPath: script.path })
                                  .then(() => setRunningScripts((prev) => ({ ...prev, [script.id]: true })))
                                  .catch(console.error);
                              }}
                              className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-[11px] font-semibold text-cyan-300 transition-colors"
                            >
                              <i className="fa-solid fa-play text-[9px] mr-1.5" />
                              Launch
                            </button>
                          )}
                          {isRunning && (
                            <>
                              <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                Running
                              </span>
                              <button
                                onClick={() => {
                                  invoke("stop_script", { scriptId: script.id })
                                    .then(() => setRunningScripts((prev) => ({ ...prev, [script.id]: false })))
                                    .catch(console.error);
                                }}
                                className="px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-[11px] font-semibold text-red-300 transition-colors"
                              >
                                <i className="fa-solid fa-stop text-[9px] mr-1.5" />
                                Stop
                              </button>
                            </>
                          )}
                          {!script.enabled && (
                            <span className="text-[11px] text-white/25">Enable to use this script</span>
                          )}
                        </div>
                        <p className="text-[10px] text-white/20 font-mono truncate">{script.path}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </SettingGroup>

            <SettingGroup title="WASM Plugins">
              {plugins.length === 0 ? (
                <div className="py-6 text-center">
                  <i className="fa-solid fa-puzzle-piece text-xl text-white/10 mb-2 block" />
                  <p className="text-[13px] text-white/30">No plugins installed</p>
                  <p className="text-[11px] text-white/20 mt-1">
                    Place <code className="text-white/40">.wasm</code> files in the plugins directory
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {plugins.map((plugin) => (
                    <div
                      key={plugin.path}
                      className="flex items-center justify-between p-3 rounded-xl bg-white/3 border border-white/6"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center">
                          <i className="fa-solid fa-puzzle-piece text-purple-400 text-sm" />
                        </div>
                        <div>
                          <p className="text-[13px] font-medium text-white/80">{plugin.name}</p>
                          <p className="text-[10px] text-white/25 truncate max-w-[300px]">{plugin.path}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => runPlugin(plugin.path)}
                        className="px-3 py-1.5 rounded-lg bg-white/6 hover:bg-white/10 text-[11px] font-medium text-white/60 hover:text-white/90 transition-colors"
                      >
                        Run
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </SettingGroup>

            {pluginOutput !== null && (
              <SettingGroup title="Output">
                <pre className="p-3 rounded-xl bg-black/40 text-[12px] text-emerald-300/80 font-mono whitespace-pre-wrap overflow-x-auto max-h-[200px]">
                  {pluginOutput || "(no output)"}
                </pre>
                <button
                  onClick={() => setPluginOutput(null)}
                  className="mt-2 text-[11px] text-white/30 hover:text-white/60 transition-colors"
                >
                  Dismiss
                </button>
              </SettingGroup>
            )}

            <SettingGroup title="Plugin Directory">
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[12px] text-white/40 bg-white/3 px-3 py-2 rounded-lg border border-white/6 truncate">
                  {settings.general.plugins_directory}
                </code>
                <button
                  onClick={() => {
                    invoke("open_settings").catch(console.error);
                  }}
                  className="px-3 py-2 rounded-lg bg-white/6 hover:bg-white/10 text-[11px] font-medium text-white/60 hover:text-white/90 transition-colors whitespace-nowrap"
                >
                  Open Folder
                </button>
              </div>
            </SettingGroup>
          </TabPanel>
        )}
      </div>
    </div>
  );
}

/* ─── Reusable sub-components ─── */

function TabPanel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-[18px] font-bold text-white/90">{title}</h2>
      <p className="text-[12px] text-white/30 mt-0.5 mb-6">{description}</p>
      <div className="space-y-6">{children}</div>
    </div>
  );
}

function SettingGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-3">{title}</h3>
      <div className="space-y-4 pl-1">{children}</div>
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-[13px] font-medium text-white/80">{label}</p>
        <p className="text-[11px] text-white/30">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className="relative w-10 h-[22px] rounded-full transition-colors shrink-0"
        style={{
          background: checked ? "rgba(34, 211, 238, 0.6)" : "rgba(255, 255, 255, 0.1)",
        }}
      >
        <div
          className="absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-transform"
          style={{ left: checked ? "21px" : "3px" }}
        />
      </button>
    </div>
  );
}

function Slider({
  label,
  description,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div>
          <p className="text-[13px] font-medium text-white/80">{label}</p>
          <p className="text-[11px] text-white/30">{description}</p>
        </div>
        <span className="text-[12px] font-mono text-white/50 tabular-nums">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer mt-1"
        style={{
          background: `linear-gradient(to right, rgba(34, 211, 238, 0.5) ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.08) ${((value - min) / (max - min)) * 100}%)`,
        }}
      />
    </div>
  );
}

function TextInput({
  label,
  description,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <p className="text-[13px] font-medium text-white/80">{label}</p>
      <p className="text-[11px] text-white/30 mb-1.5">{description}</p>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[13px] text-white/80 placeholder:text-white/20 outline-none focus:border-cyan-400/40 transition-colors"
      />
    </div>
  );
}

function Select({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <p className="text-[13px] font-medium text-white/80">{label}</p>
      <p className="text-[11px] text-white/30 mb-1.5">{description}</p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[13px] text-white/80 outline-none focus:border-cyan-400/40 transition-colors appearance-none cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-[#1a1a24] text-white">
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextArea({
  label,
  description,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div>
      <p className="text-[13px] font-medium text-white/80">{label}</p>
      <p className="text-[11px] text-white/30 mb-1.5">{description}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[13px] text-white/80 placeholder:text-white/20 outline-none focus:border-cyan-400/40 transition-colors resize-y font-mono leading-relaxed"
      />
    </div>
  );
}
