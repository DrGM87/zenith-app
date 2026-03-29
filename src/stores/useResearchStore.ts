import { create } from "zustand";

/* ── Types ── */

export interface ResearchMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  type: "text" | "papers" | "citation" | "code" | "experiment_progress" | "table" | "error" | "export";
  data?: unknown;
  timestamp: number;
  tokens?: { input: number; output: number; cost: number };
  tool_used?: string;
}

export interface ResearchThread {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  messages: ResearchMessage[];
  total_cost: number;
  model: string;
  provider: string;
}

export interface ResearchParams {
  provider: string;
  model: string;
  api_key: string;
  temperature: number;
  max_tokens: number;
  enabled_tools: string[];
  export_format: "markdown" | "pdf" | "latex" | "bibtex" | "json";
  system_prompt: string;
}

export interface PaperResult {
  title: string;
  authors: string[];
  year: number | string;
  abstract: string;
  doi: string;
  citations: number;
  url: string;
  source: string;
}

/* ── Constants ── */

const MAX_THREADS = 50;
const MAX_MESSAGES_PER_THREAD = 200;

const LS_THREADS = "zenith_research_threads";
const LS_ACTIVE = "zenith_research_active_thread";
const LS_PARAMS = "zenith_research_params";

const DEFAULT_SYSTEM_PROMPT =
  "You are Zenith Research Assistant — an expert AI researcher. " +
  "You help users discover papers, analyze literature, verify citations, assess novelty, " +
  "run experiments, and generate research sections. Be thorough, cite sources, and provide " +
  "structured outputs when appropriate. When you use a research tool, explain what you found clearly.";

const DEFAULT_PARAMS: ResearchParams = {
  provider: "",
  model: "",
  api_key: "",
  temperature: 0.7,
  max_tokens: 4096,
  enabled_tools: ["literature", "web_search", "pdf_extract", "novelty", "citation_verify", "experiment"],
  export_format: "markdown",
  system_prompt: DEFAULT_SYSTEM_PROMPT,
};

/* ── Helpers ── */

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadFromLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveToLS(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage full — silently fail
  }
}

/* ── Store ── */

interface ResearchState {
  threads: ResearchThread[];
  activeThreadId: string | null;
  params: ResearchParams;
  isGenerating: boolean;
  abortController: AbortController | null;

  // Thread CRUD
  createThread: () => string;
  deleteThread: (id: string) => void;
  switchThread: (id: string) => void;
  renameThread: (id: string, title: string) => void;

  // Messages
  addMessage: (threadId: string, msg: ResearchMessage) => void;
  updateMessage: (threadId: string, msgId: string, partial: Partial<ResearchMessage>) => void;
  clearMessages: (threadId: string) => void;

  // Params
  setParams: (partial: Partial<ResearchParams>) => void;

  // Generation state
  setGenerating: (v: boolean) => void;
  setAbortController: (c: AbortController | null) => void;

  // Persistence
  loadThreads: () => void;
  saveThreads: () => void;

  // Computed helpers
  activeThread: () => ResearchThread | null;
  threadCost: (threadId: string) => number;
  totalCost: () => number;
}

export const useResearchStore = create<ResearchState>((set, get) => ({
  threads: [],
  activeThreadId: null,
  params: DEFAULT_PARAMS,
  isGenerating: false,
  abortController: null,

  /* ── Thread CRUD ── */

  createThread: () => {
    const id = genId();
    const now = Date.now();
    const thread: ResearchThread = {
      id,
      title: "New Research",
      created_at: now,
      updated_at: now,
      messages: [],
      total_cost: 0,
      model: get().params.model,
      provider: get().params.provider,
    };
    set((s) => {
      const threads = [thread, ...s.threads].slice(0, MAX_THREADS);
      saveToLS(LS_THREADS, threads);
      saveToLS(LS_ACTIVE, id);
      return { threads, activeThreadId: id };
    });
    return id;
  },

  deleteThread: (id) => {
    set((s) => {
      const threads = s.threads.filter((t) => t.id !== id);
      const activeThreadId = s.activeThreadId === id ? (threads[0]?.id ?? null) : s.activeThreadId;
      saveToLS(LS_THREADS, threads);
      saveToLS(LS_ACTIVE, activeThreadId);
      return { threads, activeThreadId };
    });
  },

  switchThread: (id) => {
    set({ activeThreadId: id });
    saveToLS(LS_ACTIVE, id);
  },

  renameThread: (id, title) => {
    set((s) => {
      const threads = s.threads.map((t) => (t.id === id ? { ...t, title, updated_at: Date.now() } : t));
      saveToLS(LS_THREADS, threads);
      return { threads };
    });
  },

  /* ── Messages ── */

  addMessage: (threadId, msg) => {
    set((s) => {
      const threads = s.threads.map((t) => {
        if (t.id !== threadId) return t;
        const messages = [...t.messages, msg].slice(-MAX_MESSAGES_PER_THREAD);
        const costDelta = msg.tokens?.cost ?? 0;
        return { ...t, messages, updated_at: Date.now(), total_cost: t.total_cost + costDelta };
      });
      saveToLS(LS_THREADS, threads);
      return { threads };
    });
  },

  updateMessage: (threadId, msgId, partial) => {
    set((s) => {
      const threads = s.threads.map((t) => {
        if (t.id !== threadId) return t;
        const messages = t.messages.map((m) => (m.id === msgId ? { ...m, ...partial } : m));
        return { ...t, messages, updated_at: Date.now() };
      });
      saveToLS(LS_THREADS, threads);
      return { threads };
    });
  },

  clearMessages: (threadId) => {
    set((s) => {
      const threads = s.threads.map((t) => (t.id === threadId ? { ...t, messages: [], total_cost: 0, updated_at: Date.now() } : t));
      saveToLS(LS_THREADS, threads);
      return { threads };
    });
  },

  /* ── Params ── */

  setParams: (partial) => {
    set((s) => {
      const params = { ...s.params, ...partial };
      saveToLS(LS_PARAMS, params);
      return { params };
    });
  },

  /* ── Generation ── */

  setGenerating: (v) => set({ isGenerating: v }),
  setAbortController: (c) => set({ abortController: c }),

  /* ── Persistence ── */

  loadThreads: () => {
    const threads = loadFromLS<ResearchThread[]>(LS_THREADS, []);
    const activeThreadId = loadFromLS<string | null>(LS_ACTIVE, threads[0]?.id ?? null);
    const savedParams = loadFromLS<Partial<ResearchParams>>(LS_PARAMS, {});
    const params = { ...DEFAULT_PARAMS, ...savedParams };
    set({ threads, activeThreadId, params });
  },

  saveThreads: () => {
    const { threads, activeThreadId, params } = get();
    saveToLS(LS_THREADS, threads);
    saveToLS(LS_ACTIVE, activeThreadId);
    saveToLS(LS_PARAMS, params);
  },

  /* ── Computed ── */

  activeThread: () => {
    const { threads, activeThreadId } = get();
    return threads.find((t) => t.id === activeThreadId) ?? null;
  },

  threadCost: (threadId) => {
    const thread = get().threads.find((t) => t.id === threadId);
    return thread?.total_cost ?? 0;
  },

  totalCost: () => {
    return get().threads.reduce((sum, t) => sum + t.total_cost, 0);
  },
}));
