import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface StagedItem {
  id: string;
  path: string;
  name: string;
  size: number;
  extension: string;
  is_directory: boolean;
  thumbnail: string | null;
  mime_type: string;
  self_destruct_at: number | null;
}

export interface AppearanceSettings {
  theme: string;
  opacity: number;
  blur_strength: number;
  corner_radius: number;
  accent_color: string;
  font_size: number;
  animation_speed: number;
  border_glow?: boolean;
  border_glow_speed?: number;
  aurora_bg?: boolean;
  aurora_speed?: number;
  spotlight_cards?: boolean;
}

export interface BehaviorSettings {
  collapse_delay_ms: number;
  expand_on_hover: boolean;
  expand_on_drag: boolean;
  auto_collapse_on_blur: boolean;
  confirm_clear_all: boolean;
  max_staged_items: number;
  duplicate_detection: boolean;
  position: string;
}

export interface ApiKeyEntry {
  provider: string;
  label: string;
  key: string;
  model: string;
  is_default: boolean;
}

export interface ProcessingDefaults {
  image_quality: number;
  webp_quality: number;
  pdf_compression_level: string;
  default_resize_percentage: number;
  split_chunk_size_mb: number;
}

export interface AiPrompts {
  smart_rename: string;
  smart_sort: string;
  ocr: string;
  auto_organize: string;
  translate: string;
  ask_data: string;
  summarize: string;
  super_summary: string;
  dashboard: string;
}

export interface TokenUsageEntry {
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface TokenUsage {
  entries: TokenUsageEntry[];
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
}

export interface RenameSuggestion {
  stem: string;
  full_name: string;
  new_path: string;
}

export interface RenameState {
  itemId: string;
  path: string;
  originalName: string;
  originalStem: string;
  extension: string;
  suggestions: RenameSuggestion[];
  activeIndex: number;
  loading: boolean;
  error?: string;
}

export interface PreviewPane {
  id: string;
  item: StagedItem;
  content?: string;
  loading: boolean;
  error?: string;
}

/* ── Audio recognition types ── */
export interface AudioRecognitionResult {
  itemId: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  year: string;
  genre: string;
  track_number: string;
  cover_url: string;
  shazam_url: string;
  mood?: string;
  style?: string;
  description?: string;
  saved?: boolean;       // true after metadata+rename applied
  new_path?: string;     // path after rename
  new_name?: string;
  error?: string;
}

export interface AudioUndoEntry {
  itemId: string;
  old_path: string;
  new_path: string;
  old_name: string;
  new_name: string;
}

/* ── Auto-Studio types ── */
export interface StudioPlanItem {
  id: string;
  old_path: string;
  old_name: string;
  new_name: string;
  new_path: string;
  folder: string;
  type: "music" | "video" | "image" | "document" | "other";
  enabled: boolean;
  metadata?: Record<string, unknown>;
  poster_url?: string;
  poster_local?: string;
}

export interface StudioFolder {
  name: string;
  icon: string;
  items: StudioPlanItem[];
  color: string;
}

export interface StudioPlan {
  folders: StudioFolder[];
  base_dir: string;
  total_items: number;
}

export interface StudioProgress {
  status: string;
  current: number;
  total: number;
  message: string;
}

export interface ZenithSettings {
  general: { launch_on_startup: boolean; show_tray_icon: boolean; check_for_updates: boolean; plugins_directory: string };
  appearance: AppearanceSettings;
  behavior: BehaviorSettings;
  shortcuts: { stage_clipboard: string; toggle_window: string; clear_all: string };
  scripts: { id: string; name: string; description: string; path: string; enabled: boolean }[];
  api_keys: ApiKeyEntry[];
  processing: ProcessingDefaults;
  ai_prompts: AiPrompts;
  token_usage: TokenUsage;
  vt_api_key: string;
  omdb_api_key: string;
  audiodb_api_key: string;
  imdb_api_key: string;
  shazam_auto_recognize: boolean;
}

interface ZenithState {
  items: StagedItem[];
  isExpanded: boolean;
  isDragOver: boolean;
  settings: ZenithSettings | null;
  clipboardStack: string[];
  isStackMode: boolean;
  selectedIds: Set<string>;
  previewPanes: PreviewPane[];
  renameStates: Record<string, RenameState>;
  batchRenameMode: boolean;
  renameUndoCount: number;
  renameRedoCount: number;

  isStudioOpen: boolean;
  studioPlan: StudioPlan | null;
  studioProgress: StudioProgress | null;
  studioExecuting: boolean;
  studioGroupImages: "date" | "vision";
  studioGroupDocs: "category" | "type" | "date";
  studioVideoHint: "auto" | "movie" | "personal";
  studioAudioHint: "auto" | "music" | "personal";

  // Audio recognition batch state
  audioResults: Record<string, AudioRecognitionResult>;
  audioUndoStack: AudioUndoEntry[][];
  audioRedoStack: AudioUndoEntry[][];
  setAudioResult: (itemId: string, result: AudioRecognitionResult | null) => void;
  clearAudioResults: () => void;
  pushAudioUndo: (entries: AudioUndoEntry[]) => void;
  popAudioUndo: () => AudioUndoEntry[] | null;
  popAudioRedo: () => AudioUndoEntry[] | null;

  setExpanded: (expanded: boolean) => void;
  setDragOver: (over: boolean) => void;
  setStackMode: (on: boolean) => void;
  pushToStack: (text: string) => void;
  clearStack: () => void;
  copyStack: () => Promise<void>;

  toggleSelect: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  selectByPath: (path: string) => void;

  stageFile: (path: string) => Promise<void>;
  stageText: (text: string) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  loadItems: () => Promise<void>;
  loadSettings: () => Promise<void>;
  startDragOut: (path: string) => Promise<void>;
  trackTokenUsage: (provider: string, model: string, inputTokens: number, outputTokens: number) => Promise<void>;

  setRenameState: (itemId: string, state: RenameState | null) => void;
  cycleRenameSuggestion: (itemId: string) => void;
  setBatchRenameMode: (on: boolean) => void;
  setRenameUndoCounts: (undo: number, redo: number) => void;
  refreshRenameCounts: () => Promise<void>;

  openPreview: (item: StagedItem) => void;
  closePreview: (id: string) => void;
  closeAllPreviews: () => void;
  updatePreviewContent: (id: string, content: string) => void;
  updatePreviewError: (id: string, error: string) => void;
  setPreviewLoading: (id: string, loading: boolean) => void;

  setStudioOpen: (open: boolean) => void;
  setStudioPlan: (plan: StudioPlan | null) => void;
  setStudioProgress: (progress: StudioProgress | null) => void;
  setStudioExecuting: (executing: boolean) => void;
  setStudioGroupImages: (g: "date" | "vision") => void;
  setStudioGroupDocs: (g: "category" | "type" | "date") => void;
  setStudioVideoHint: (h: "auto" | "movie" | "personal") => void;
  setStudioAudioHint: (h: "auto" | "music" | "personal") => void;
  toggleStudioItem: (itemId: string) => void;
  updateStudioItemName: (itemId: string, newName: string) => void;
}

export const useZenithStore = create<ZenithState>((set, get) => ({
  items: [],
  isExpanded: false,
  isDragOver: false,
  settings: null,
  clipboardStack: [],
  isStackMode: false,
  selectedIds: new Set<string>(),
  previewPanes: [],
  renameStates: {},
  batchRenameMode: false,
  renameUndoCount: 0,
  renameRedoCount: 0,

  isStudioOpen: false,
  studioPlan: null,
  studioProgress: null,
  studioExecuting: false,
  studioGroupImages: "date",
  studioGroupDocs: "category",
  studioVideoHint: "auto",
  studioAudioHint: "auto",

  audioResults: {},
  audioUndoStack: [],
  audioRedoStack: [],
  setAudioResult: (itemId, result) => set((s) => {
    const next = { ...s.audioResults };
    if (result) next[itemId] = result; else delete next[itemId];
    return { audioResults: next };
  }),
  clearAudioResults: () => set({ audioResults: {} }),
  pushAudioUndo: (entries) => set((s) => ({
    audioUndoStack: [...s.audioUndoStack, entries],
    audioRedoStack: [],
  })),
  popAudioUndo: () => {
    const s = get();
    if (s.audioUndoStack.length === 0) return null;
    const entries = s.audioUndoStack[s.audioUndoStack.length - 1];
    set({
      audioUndoStack: s.audioUndoStack.slice(0, -1),
      audioRedoStack: [...s.audioRedoStack, entries],
    });
    return entries;
  },
  popAudioRedo: () => {
    const s = get();
    if (s.audioRedoStack.length === 0) return null;
    const entries = s.audioRedoStack[s.audioRedoStack.length - 1];
    set({
      audioRedoStack: s.audioRedoStack.slice(0, -1),
      audioUndoStack: [...s.audioUndoStack, entries],
    });
    return entries;
  },

  setExpanded: (expanded) => set({ isExpanded: expanded }),
  setDragOver: (over) => set({ isDragOver: over }),
  setStackMode: (on) => set({ isStackMode: on, clipboardStack: on ? [] : get().clipboardStack }),
  pushToStack: (text) => set((s) => ({ clipboardStack: [...s.clipboardStack, text] })),
  clearStack: () => set({ clipboardStack: [] }),
  copyStack: async () => {
    const merged = get().clipboardStack.join("\n");
    await navigator.clipboard.writeText(merged);
  },

  toggleSelect: (id) => set((s) => {
    const next = new Set(s.selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { selectedIds: next };
  }),
  selectAll: () => set((s) => ({ selectedIds: new Set(s.items.map((i) => i.id)) })),
  clearSelection: () => set({ selectedIds: new Set<string>() }),
  selectByPath: (path) => set((s) => {
    const next = new Set(s.selectedIds);
    const match = s.items.find((i) => i.path === path);
    if (match) { if (next.has(match.id)) next.delete(match.id); else next.add(match.id); }
    return { selectedIds: next };
  }),

  stageFile: async (path: string) => {
    try {
      const item = await invoke<StagedItem>("stage_file", { path });
      set((state) => ({ items: [...state.items, item] }));
    } catch (e) {
      console.error("Failed to stage file:", e);
    }
  },

  stageText: async (text: string) => {
    try {
      const item = await invoke<StagedItem>("stage_text", { text });
      set((state) => ({ items: [...state.items, item] }));
    } catch (e) {
      console.error("Failed to stage text:", e);
    }
  },

  removeItem: async (id: string) => {
    try {
      await invoke("remove_staged_item", { id });
      set((state) => ({ items: state.items.filter((i) => i.id !== id) }));
    } catch (e) {
      console.error("Failed to remove item:", e);
    }
  },

  clearAll: async () => {
    try {
      await invoke("clear_all_items");
      set({ items: [] });
    } catch (e) {
      console.error("Failed to clear items:", e);
    }
  },

  loadItems: async () => {
    try {
      const items = await invoke<StagedItem[]>("get_staged_items");
      set({ items });
    } catch (e) {
      console.error("Failed to load items:", e);
    }
  },

  loadSettings: async () => {
    try {
      const settings = await invoke<ZenithSettings>("get_settings");
      set({ settings });
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  },

  startDragOut: async (path: string) => {
    try {
      await invoke("start_drag_out", { path });
    } catch (e) {
      console.error("Failed to start drag out:", e);
    }
  },

  setRenameState: (itemId: string, state: RenameState | null) => set((s) => {
    const next = { ...s.renameStates };
    if (state) next[itemId] = state; else delete next[itemId];
    return { renameStates: next };
  }),
  cycleRenameSuggestion: (itemId: string) => set((s) => {
    const rs = s.renameStates[itemId];
    if (!rs || rs.suggestions.length <= 1) return s;
    return { renameStates: { ...s.renameStates, [itemId]: { ...rs, activeIndex: (rs.activeIndex + 1) % rs.suggestions.length } } };
  }),
  setBatchRenameMode: (on: boolean) => set({ batchRenameMode: on }),
  setRenameUndoCounts: (undo: number, redo: number) => set({ renameUndoCount: undo, renameRedoCount: redo }),
  refreshRenameCounts: async () => {
    try {
      const r = JSON.parse(await invoke<string>("get_rename_history_counts"));
      set({ renameUndoCount: r.undo_count ?? 0, renameRedoCount: r.redo_count ?? 0 });
    } catch { /* ignore */ }
  },

  openPreview: (item: StagedItem) => set((s) => {
    if (s.previewPanes.find((p) => p.item.id === item.id)) return s;
    return { previewPanes: [...s.previewPanes, { id: item.id, item, loading: true }] };
  }),
  closePreview: (id: string) => set((s) => ({ previewPanes: s.previewPanes.filter((p) => p.id !== id) })),
  closeAllPreviews: () => set({ previewPanes: [] }),
  updatePreviewContent: (id: string, content: string) => set((s) => ({
    previewPanes: s.previewPanes.map((p) => p.id === id ? { ...p, content, loading: false } : p),
  })),
  updatePreviewError: (id: string, error: string) => set((s) => ({
    previewPanes: s.previewPanes.map((p) => p.id === id ? { ...p, error, loading: false } : p),
  })),
  setPreviewLoading: (id: string, loading: boolean) => set((s) => ({
    previewPanes: s.previewPanes.map((p) => p.id === id ? { ...p, loading } : p),
  })),

  setStudioOpen: (open) => set({ isStudioOpen: open }),
  setStudioPlan: (plan) => set({ studioPlan: plan }),
  setStudioProgress: (progress) => set({ studioProgress: progress }),
  setStudioExecuting: (executing) => set({ studioExecuting: executing }),
  setStudioGroupImages: (g) => set({ studioGroupImages: g }),
  setStudioGroupDocs: (g) => set({ studioGroupDocs: g }),
  setStudioVideoHint: (h) => set({ studioVideoHint: h }),
  setStudioAudioHint: (h) => set({ studioAudioHint: h }),
  toggleStudioItem: (itemId) => set((s) => {
    if (!s.studioPlan) return s;
    const folders = s.studioPlan.folders.map((f) => ({
      ...f,
      items: f.items.map((it) => it.id === itemId ? { ...it, enabled: !it.enabled } : it),
    }));
    return { studioPlan: { ...s.studioPlan, folders } };
  }),
  updateStudioItemName: (itemId, newName) => set((s) => {
    if (!s.studioPlan) return s;
    const ext = newName.includes(".") ? "" : "." + s.studioPlan.folders.flatMap((f) => f.items).find((it) => it.id === itemId)?.old_name.split(".").pop();
    const folders = s.studioPlan.folders.map((f) => ({
      ...f,
      items: f.items.map((it) => it.id === itemId ? { ...it, new_name: newName + ext } : it),
    }));
    return { studioPlan: { ...s.studioPlan, folders } };
  }),

  trackTokenUsage: async (provider: string, model: string, inputTokens: number, outputTokens: number) => {
    const s = get().settings;
    if (!s || (inputTokens === 0 && outputTokens === 0)) return;

    const PRICING: Record<string, Record<string, { input: number; output: number }>> = {
      openai: { "gpt-4.1-nano": { input: 0.10, output: 0.40 }, "gpt-4o-mini": { input: 0.15, output: 0.60 }, "gpt-4.1-mini": { input: 0.40, output: 1.60 }, "o3-mini": { input: 1.10, output: 4.40 }, "o4-mini": { input: 1.10, output: 4.40 }, "gpt-4.1": { input: 2.00, output: 8.00 }, "gpt-4o": { input: 2.50, output: 10.00 } },
      anthropic: { "claude-haiku-4-5-20250514": { input: 1.00, output: 5.00 }, "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 }, "claude-opus-4-20250918": { input: 5.00, output: 25.00 } },
      google: { "gemini-2.5-flash": { input: 0.15, output: 0.60 }, "gemini-3-flash-preview": { input: 0.50, output: 3.00 }, "gemini-2.5-pro": { input: 1.25, output: 10.00 }, "gemini-3.1-pro-preview": { input: 2.00, output: 12.00 } },
      deepseek: { "deepseek-chat": { input: 0.27, output: 1.10 }, "deepseek-reasoner": { input: 0.55, output: 2.19 } },
      groq: { "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 }, "llama-3.1-8b-instant": { input: 0.05, output: 0.08 }, "gemma2-9b-it": { input: 0.20, output: 0.20 } },
    };

    const rates = PRICING[provider]?.[model] || { input: 1.00, output: 2.00 };
    const cost = (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;

    const tu = s.token_usage ?? { entries: [], total_input_tokens: 0, total_output_tokens: 0, total_cost_usd: 0 };
    const entries = [...tu.entries];
    const existing = entries.findIndex((e) => e.provider === provider);
    if (existing >= 0) {
      entries[existing] = {
        ...entries[existing],
        input_tokens: entries[existing].input_tokens + inputTokens,
        output_tokens: entries[existing].output_tokens + outputTokens,
        cost_usd: entries[existing].cost_usd + cost,
      };
    } else {
      entries.push({ provider, input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: cost });
    }

    const updated: ZenithSettings = {
      ...s,
      token_usage: {
        entries,
        total_input_tokens: tu.total_input_tokens + inputTokens,
        total_output_tokens: tu.total_output_tokens + outputTokens,
        total_cost_usd: tu.total_cost_usd + cost,
      },
    };
    set({ settings: updated });
    try { await invoke("save_settings", { newSettings: updated }); } catch (e) { console.error("Failed to save token usage:", e); }
  },
}));
