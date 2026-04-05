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
  pmid?: string;
  mesh_terms?: string[];
  journal?: string;
  is_relevant?: boolean;
  relevance_score?: number;
  pdf_path?: string;
}

/* ── Pipeline Types (v5.6) ── */

export type PipelinePhase =
  | "idle"
  | "validating"
  | "generating_queries"
  | "harvesting"
  | "triaging"
  | "acquiring"
  | "extracting"
  | "ingesting"
  | "blueprinting"
  | "drafting"
  | "generating_figures"
  | "citation_verifying"
  | "guidelines_checking"
  | "smoothing"
  | "compiling"
  | "complete"
  | "error";

/* ── Per-step pipeline config (mirrors settings.rs PipelineStepConfig) ── */

export interface PipelineStepConfig {
  system_prompt: string;
  model_tier: "strong" | "fast";
  max_tokens: number;
  temperature: number;
  use_structured_output: boolean;
  use_thinking: boolean;
  thinking_budget: number;
  use_google_search: boolean;
  use_code_execution: boolean;
}

export interface PipelineConfig {
  gatekeeper: PipelineStepConfig;
  query_architect: PipelineStepConfig;
  triage_agent: PipelineStepConfig;
  blueprint_agent: PipelineStepConfig;
  lead_author: PipelineStepConfig;
  citation_verifier: PipelineStepConfig;
  guidelines_compliance: PipelineStepConfig;
  smoothing_pass: PipelineStepConfig;
}

export type StudyDesign = "systematic_review" | "meta_analysis" | "narrative_review" | "scoping_review" | "subject_review" | "educational" | "case_study" | "comparative" | "exploratory";

export interface PipelineLog {
  time: string;
  phase: string;
  message: string;
  level: "info" | "warn" | "error" | "success";
}

export interface PipelineState {
  active: boolean;
  phase: PipelinePhase;
  progress: number;          // 0-100
  statusMessage: string;
  query: string;
  studyDesign: StudyDesign;
  papers: PaperResult[];
  relevantPapers: PaperResult[];
  acquiredPdfs: { doi: string; path: string; title: string }[];
  extractedTexts: { path: string; text: string; pages: number }[];
  searchQueries: { db: string; query_string: string; description: string }[];
  blueprint: {
    sections: { id: string; title: string; description: string; requirements: string }[];
    figure_plan: string[];
    table_plan: string[];
    guidelines_map: Record<string, string>;
  } | null;
  draftSections: { type: string; text: string; figures?: string[]; tables?: string[] }[];
  generatedFigures: { description: string; caption: string; path: string; chart_type: string; size: number; index: number }[];
  generatedTables: { description: string; caption: string; markdown: string; path: string; size: number; index: number }[];
  citationIssues: { section: string; issue: string; severity: string }[];
  guidelinesIssues: { item: string; status: string; fix: string }[];
  manuscript: string;
  bibliography: string;
  error: string | null;
  logs: PipelineLog[];
  totalTokens: { input: number; output: number; cost: number };
}

/* ── Constants ── */

const MAX_THREADS = 50;
const MAX_MESSAGES_PER_THREAD = 200;

const LS_THREADS = "zenith_research_threads";
const LS_ACTIVE = "zenith_research_active_thread";
const LS_PARAMS = "zenith_research_params";

const DEFAULT_SYSTEM_PROMPT =
  "You are Zenith Research Assistant — a PhD-level autonomous research agent. " +
  "You orchestrate multi-phase research pipelines: validate queries, generate MeSH/Boolean search strings, " +
  "harvest papers from PubMed/Semantic Scholar/OpenAlex/arXiv, triage for relevance, acquire full-text via " +
  "Sci-Hub/Unpaywall, extract PDF content, draft sections with proper citations, verify citation integrity, " +
  "and compile publication-ready manuscripts. Be thorough, cite every claim, and provide structured outputs.";

const DEFAULT_PARAMS: ResearchParams = {
  provider: "",
  model: "",
  api_key: "",
  temperature: 0.7,
  max_tokens: 16384,
  enabled_tools: [
    "pubmed", "literature", "web_search", "scihub",
    "validate_query", "mesh_queries", "triage", "draft_section",
    "pdf_extract", "novelty", "citation_verify", "experiment",
  ],
  export_format: "markdown",
  system_prompt: DEFAULT_SYSTEM_PROMPT,
};

const DEFAULT_PIPELINE: PipelineState = {
  active: false,
  phase: "idle",
  progress: 0,
  statusMessage: "",
  query: "",
  studyDesign: "systematic_review",
  papers: [],
  relevantPapers: [],
  acquiredPdfs: [],
  extractedTexts: [],
  searchQueries: [],
  blueprint: null,
  draftSections: [],
  generatedFigures: [],
  generatedTables: [],
  citationIssues: [],
  guidelinesIssues: [],
  manuscript: "",
  bibliography: "",
  error: null,
  logs: [],
  totalTokens: { input: 0, output: 0, cost: 0 },
};

const LS_PIPELINE = "zenith_research_pipeline";

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
  pipeline: PipelineState;
  viewMode: "chat" | "pipeline";

  // Thread CRUD
  createThread: () => string;
  deleteThread: (id: string) => void;
  switchThread: (id: string) => void;
  renameThread: (id: string, title: string) => void;

  // Messages
  addMessage: (threadId: string, msg: ResearchMessage) => void;
  updateMessage: (threadId: string, msgId: string, partial: Partial<ResearchMessage>) => void;
  clearMessages: (threadId: string) => void;
  removeMessagesFrom: (threadId: string, msgId: string) => void;

  // Params
  setParams: (partial: Partial<ResearchParams>) => void;

  // Generation state
  setGenerating: (v: boolean) => void;
  setAbortController: (c: AbortController | null) => void;

  // Pipeline
  setPipeline: (partial: Partial<PipelineState>) => void;
  resetPipeline: () => void;
  setViewMode: (mode: "chat" | "pipeline") => void;
  addPipelineLog: (phase: string, message: string, level?: "info" | "warn" | "error" | "success") => void;
  addPipelineTokens: (input: number, output: number, cost: number) => void;

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
  pipeline: DEFAULT_PIPELINE,
  viewMode: "chat" as const,

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

  removeMessagesFrom: (threadId, msgId) => {
    set((s) => {
      const threads = s.threads.map((t) => {
        if (t.id !== threadId) return t;
        const idx = t.messages.findIndex((m) => m.id === msgId);
        if (idx < 0) return t;
        const removed = t.messages.slice(idx);
        const costDelta = removed.reduce((sum, m) => sum + (m.tokens?.cost ?? 0), 0);
        return { ...t, messages: t.messages.slice(0, idx), total_cost: Math.max(0, t.total_cost - costDelta), updated_at: Date.now() };
      });
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

  /* ── Pipeline ── */

  setPipeline: (partial) => {
    set((s) => {
      const pipeline = { ...s.pipeline, ...partial };
      saveToLS(LS_PIPELINE, pipeline);
      return { pipeline };
    });
  },

  resetPipeline: () => {
    set({ pipeline: { ...DEFAULT_PIPELINE } });
    saveToLS(LS_PIPELINE, DEFAULT_PIPELINE);
  },

  setViewMode: (mode) => set({ viewMode: mode }),

  addPipelineLog: (phase, message, level = "info") => {
    set((s) => {
      const log: PipelineLog = { time: new Date().toLocaleTimeString(), phase, message, level };
      const pipeline = { ...s.pipeline, logs: [...s.pipeline.logs, log] };
      return { pipeline };
    });
  },

  addPipelineTokens: (input, output, cost) => {
    set((s) => {
      const t = s.pipeline.totalTokens;
      const pipeline = { ...s.pipeline, totalTokens: { input: t.input + input, output: t.output + output, cost: t.cost + cost } };
      return { pipeline };
    });
  },

  /* ── Persistence ── */

  loadThreads: () => {
    const threads = loadFromLS<ResearchThread[]>(LS_THREADS, []);
    const activeThreadId = loadFromLS<string | null>(LS_ACTIVE, threads[0]?.id ?? null);
    const savedParams = loadFromLS<Partial<ResearchParams>>(LS_PARAMS, {});
    const params = { ...DEFAULT_PARAMS, ...savedParams };
    const savedPipeline = loadFromLS<Partial<PipelineState>>(LS_PIPELINE, {});
    const pipeline = { ...DEFAULT_PIPELINE, ...savedPipeline };
    set({ threads, activeThreadId, params, pipeline });
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
