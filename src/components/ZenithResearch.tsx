import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { motion, AnimatePresence } from "framer-motion";
import {
  useResearchStore,
  type ResearchMessage,
  type PaperResult,
  type PipelinePhase,
  type PipelineState,
  type StudyDesign,
  type PipelineStepConfig,
  type PipelineConfig,
} from "../stores/useResearchStore";

// ── Types ────────────────────────────────────────────────────────────────────

interface ApiKeyEntry { provider: string; label: string; key: string; model: string; is_default: boolean; }
interface TokenUsageEntry { provider: string; input_tokens: number; output_tokens: number; cost_usd: number; }
interface TokenUsage { entries: TokenUsageEntry[]; total_input_tokens: number; total_output_tokens: number; total_cost_usd: number; }
interface ZenithSettings {
  api_keys: ApiKeyEntry[];
  token_usage?: TokenUsage;
  ai_prompts?: { research?: string; research_pipeline?: string; [key: string]: unknown };
  tavily_api_key?: string;
  brave_api_key?: string;
  firecrawl_api_key?: string;
  pipeline_config?: PipelineConfig;
  [key: string]: unknown;
}

// ── Constants ────────────────────────────────────────────────────────────────

const PROVIDER_MODELS: Record<string, { id: string; label: string }[]> = {
  openai: [
    { id: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { id: "gpt-5.4-nano", label: "GPT-5.4 Nano" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    { id: "o3-mini", label: "o3 Mini" },
    { id: "o4-mini", label: "o4 Mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-5.4", label: "GPT-5.4" },
  ],
  anthropic: [
    { id: "claude-haiku-4-5-20250514", label: "Claude Haiku 4.5" },
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { id: "claude-sonnet-4-5-20260115", label: "Claude Sonnet 4.5" },
    { id: "claude-opus-4-20250918", label: "Claude Opus 4" },
    { id: "claude-opus-4-6-20260310", label: "Claude Opus 4.6" },
  ],
  google: [
    { id: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash" },
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  ],
  deepseek: [
    { id: "deepseek-chat", label: "DeepSeek V3 (Chat)" },
    { id: "deepseek-reasoner", label: "DeepSeek R1 (Reasoner)" },
  ],
  groq: [
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
    { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B" },
    { id: "gemma2-9b-it", label: "Gemma 2 9B" },
  ],
};

const RESEARCH_TOOLS = [
  // Primary v5.6 pipeline tools
  { id: "pubmed", label: "PubMed Search", icon: "fa-hospital", desc: "MEDLINE / PubMed E-utilities", group: "primary" },
  { id: "literature", label: "Literature Search", icon: "fa-book", desc: "arXiv, Semantic Scholar, OpenAlex", group: "primary" },
  { id: "web_search", label: "Web Search", icon: "fa-globe", desc: "Brave / Tavily / Firecrawl / DDG", group: "primary" },
  { id: "scihub", label: "Sci-Hub / OA", icon: "fa-unlock-keyhole", desc: "Download papers via Sci-Hub + Unpaywall", group: "primary" },
  { id: "validate_query", label: "Gatekeeper", icon: "fa-shield-halved", desc: "Validate research question", group: "primary" },
  { id: "mesh_queries", label: "Query Architect", icon: "fa-diagram-project", desc: "Generate MeSH/Boolean queries", group: "primary" },
  { id: "triage", label: "Triage Agent", icon: "fa-filter", desc: "Screen papers for relevance", group: "primary" },
  { id: "draft_section", label: "Lead Author", icon: "fa-pen-nib", desc: "Draft sections with citations", group: "primary" },
  // Auxiliary tools
  { id: "pdf_extract", label: "PDF Extract", icon: "fa-file-pdf", desc: "Extract text from PDFs", group: "auxiliary" },
  { id: "novelty", label: "Novelty Check", icon: "fa-lightbulb", desc: "Score idea novelty", group: "auxiliary" },
  { id: "citation_verify", label: "Citation Verify", icon: "fa-check-double", desc: "3-layer verification", group: "auxiliary" },
  { id: "experiment", label: "Experiment", icon: "fa-flask", desc: "Run sandboxed code", group: "auxiliary" },
  { id: "generate_chart", label: "Chart Gen", icon: "fa-chart-bar", desc: "Generate charts (bar, line, pie)", group: "auxiliary" },
  { id: "generate_table", label: "Table Gen", icon: "fa-table", desc: "Generate formatted tables", group: "auxiliary" },
];

const EXPORT_FORMATS = [
  { id: "markdown", label: "Markdown", icon: "fa-file-lines", ext: ".md" },
  { id: "pdf", label: "PDF", icon: "fa-file-pdf", ext: ".pdf" },
  { id: "latex", label: "LaTeX", icon: "fa-file-code", ext: ".tex" },
  { id: "bibtex", label: "BibTeX", icon: "fa-quote-right", ext: ".bib" },
  { id: "json", label: "JSON", icon: "fa-file-code", ext: ".json" },
];

const PRICING: Record<string, Record<string, { input: number; output: number }>> = {
  openai: {
    "gpt-4.1-mini": { input: 0.15, output: 0.60 },
    "gpt-4.1": { input: 2.50, output: 10.00 },
    "gpt-5.4-nano": { input: 5.00, output: 15.00 },
  },
  anthropic: {
    "claude-haiku-4-5-20250514": { input: 0.25, output: 1.25 },
    "claude-sonnet-4-5-20260115": { input: 3.00, output: 15.00 },
    "claude-opus-4-6-20260310": { input: 5.00, output: 25.00 },
  },
  google: {
    "gemini-3.1-flash-lite-preview": { input: 0.075, output: 0.30 }, "gemini-3.0-flash": { input: 0.15, output: 0.60 },
    "gemini-3.1-pro-preview": { input: 1.25, output: 5.00 }, "gemini-3.0-pro": { input: 1.25, output: 5.00 },
  },
  deepseek: { "deepseek-chat": { input: 0.27, output: 1.10 }, "deepseek-reasoner": { input: 0.55, output: 2.19 } },
  groq: { "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 }, "llama-3.1-8b-instant": { input: 0.05, output: 0.08 }, "gemma2-9b-it": { input: 0.20, output: 0.20 } },
};

const PIPELINE_PHASES: { id: PipelinePhase; label: string; icon: string; desc: string }[] = [
  { id: "validating", label: "Gatekeeper", icon: "fa-shield-halved", desc: "Validate research question" },
  { id: "generating_queries", label: "Query Architect", icon: "fa-diagram-project", desc: "Generate MeSH queries" },
  { id: "harvesting", label: "Harvester", icon: "fa-seedling", desc: "Search PubMed, S2, OpenAlex" },
  { id: "triaging", label: "Triage Agent", icon: "fa-filter", desc: "Screen for relevance" },
  { id: "acquiring", label: "Acquisition", icon: "fa-download", desc: "Download via Sci-Hub/OA" },
  { id: "extracting", label: "PDF Parser", icon: "fa-file-pdf", desc: "Extract text from PDFs" },
  { id: "ingesting", label: "Vector DB", icon: "fa-database", desc: "Build semantic search index" },
  { id: "blueprinting", label: "Blueprint Agent", icon: "fa-sitemap", desc: "Plan paper structure" },
  { id: "drafting", label: "Lead Author", icon: "fa-pen-nib", desc: "Draft sections with figures/tables" },
  { id: "generating_figures", label: "Data Analyst", icon: "fa-chart-bar", desc: "Generate charts & tables" },
  { id: "citation_verifying", label: "Citation Verifier", icon: "fa-check-double", desc: "Verify citation integrity" },
  { id: "guidelines_checking", label: "Guidelines Check", icon: "fa-clipboard-check", desc: "Check reporting compliance" },
  { id: "smoothing", label: "Smoothing Pass", icon: "fa-wand-magic-sparkles", desc: "Polish manuscript" },
  { id: "compiling", label: "Compiler", icon: "fa-file-export", desc: "Compile references" },
];

const STUDY_DESIGNS: { id: StudyDesign; label: string }[] = [
  { id: "systematic_review", label: "Systematic Review" },
  { id: "meta_analysis", label: "Meta-Analysis" },
  { id: "narrative_review", label: "Narrative Review" },
  { id: "scoping_review", label: "Scoping Review" },
  { id: "subject_review", label: "Subject Review" },
  { id: "educational", label: "Educational" },
  { id: "case_study", label: "Case Study" },
  { id: "comparative", label: "Comparative Analysis" },
  { id: "exploratory", label: "Exploratory Research" },
];

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
function fmtCost(n: number): string { return `$${n.toFixed(4)}`; }

function estimateCost(provider: string, mdl: string, inputTokens: number, outputTokens: number): number {
  const rates = PRICING[provider]?.[mdl] || { input: 1.0, output: 2.0 };
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

async function trackTokenUsage(provider: string, _model: string, inputTokens: number, outputTokens: number, cost: number) {
  try {
    const s = await invoke<ZenithSettings>("get_settings");
    const tu = s.token_usage ?? { entries: [], total_input_tokens: 0, total_output_tokens: 0, total_cost_usd: 0 };
    const entries = [...tu.entries];
    const idx = entries.findIndex((e) => e.provider === provider);
    if (idx >= 0) {
      entries[idx] = { ...entries[idx], input_tokens: entries[idx].input_tokens + inputTokens, output_tokens: entries[idx].output_tokens + outputTokens, cost_usd: entries[idx].cost_usd + cost };
    } else {
      entries.push({ provider, input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: cost });
    }
    await invoke("save_settings", { newSettings: { ...s, token_usage: { entries, total_input_tokens: tu.total_input_tokens + inputTokens, total_output_tokens: tu.total_output_tokens + outputTokens, total_cost_usd: tu.total_cost_usd + cost } } });
  } catch (e) { console.error("trackTokenUsage:", e); }
}

// ══════════════════════════════════════════════════════════════════════════════
// ██  COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

export function ZenithResearch() {
  // ── Settings
  const [settings, setSettings] = useState<ZenithSettings | null>(null);

  // ── Store
  const {
    threads, activeThreadId, params, isGenerating, pipeline, viewMode,
    createThread, deleteThread, switchThread, renameThread,
    addMessage, removeMessagesFrom, setParams, setGenerating,
    setPipeline, resetPipeline, setViewMode,
    loadThreads, activeThread, totalCost,
    addPipelineLog, addPipelineTokens,
  } = useResearchStore();

  // ── Local UI state
  const [threadSearch, setThreadSearch] = useState("");
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [editTitleVal, setEditTitleVal] = useState("");
  const [inputText, setInputText] = useState("");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; path: string }[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [pipelineQuery, setPipelineQuery] = useState("");
  const [pipelineDesign, setPipelineDesign] = useState<StudyDesign>("systematic_review");
  const [showLogs, setShowLogs] = useState(false);
  const [captchaDialog, setCaptchaDialog] = useState<{
    show: boolean; imgB64: string; doi: string; mirror: string;
    formAction: string; cookies: Record<string, string>;
    resolve: ((solution: string) => void) | null;
  }>({ show: false, imgB64: "", doi: "", mirror: "", formAction: "", cookies: {}, resolve: null });
  const [captchaSolution, setCaptchaSolution] = useState("");
  const [expandedPipelineStep, setExpandedPipelineStep] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pipelineAbortRef = useRef(false);

  // ── Init: load settings + threads
  useEffect(() => {
    loadThreads();
    invoke<ZenithSettings>("get_settings").then((s) => {
      setSettings(s);
      const keys = s.api_keys ?? [];
      const def = keys.find((k) => k.is_default) || keys[0];
      if (def && !params.provider) {
        setParams({ provider: def.provider, model: def.model, api_key: def.key });
      }
      if (s.ai_prompts?.research) {
        setParams({ system_prompt: s.ai_prompts.research });
      }
    }).catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-create first thread if none exist
  useEffect(() => {
    if (threads.length === 0) createThread();
  }, [threads.length, createThread]);

  // ── Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeThreadId, threads]);

  const currentThread = activeThread();
  const messages = currentThread?.messages ?? [];

  // ── Filtered threads
  const filteredThreads = useMemo(() => {
    if (!threadSearch.trim()) return threads;
    const q = threadSearch.toLowerCase();
    return threads.filter((t) => t.title.toLowerCase().includes(q));
  }, [threads, threadSearch]);

  // ── Group threads by date
  const groupedThreads = useMemo(() => {
    const groups: { label: string; threads: typeof threads }[] = [];
    const today: typeof threads = [];
    const yesterday: typeof threads = [];
    const older: typeof threads = [];
    const now = new Date();
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    for (const t of filteredThreads) {
      const d = new Date(t.updated_at);
      if (d.toDateString() === now.toDateString()) today.push(t);
      else if (d.toDateString() === yest.toDateString()) yesterday.push(t);
      else older.push(t);
    }
    if (today.length) groups.push({ label: "Today", threads: today });
    if (yesterday.length) groups.push({ label: "Yesterday", threads: yesterday });
    if (older.length) groups.push({ label: "Older", threads: older });
    return groups;
  }, [filteredThreads]);

  // ── Available providers from settings
  const availableProviders = useMemo(() => {
    if (!settings) return [];
    const providers = new Set<string>();
    for (const k of settings.api_keys) providers.add(k.provider);
    return Array.from(providers);
  }, [settings]);

  const modelsForProvider = useMemo(() => {
    return PROVIDER_MODELS[params.provider] ?? [];
  }, [params.provider]);

  // ── Show toast
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Send message (Chat Mode)
  const handleSend = useCallback(async () => {
    if (!inputText.trim() || isGenerating || !currentThread) return;
    const userMsg: ResearchMessage = {
      id: uid(), role: "user", content: inputText.trim(),
      type: "text", timestamp: Date.now(),
    };
    addMessage(currentThread.id, userMsg);
    setInputText("");
    setGenerating(true);

    const isFirst = messages.length === 0;

    try {
      const chatMessages = [...messages, userMsg].map((m) => ({
        role: m.role, content: m.content,
      }));

      const argsJson = JSON.stringify({
        messages: chatMessages,
        api_key: params.api_key,
        provider: params.provider,
        model: params.model,
        temperature: params.temperature,
        max_tokens: params.max_tokens,
        system_prompt: params.system_prompt,
        enabled_tools: params.enabled_tools,
        tavily_api_key: settings?.tavily_api_key ?? "",
        brave_api_key: (settings?.brave_api_key as string) ?? "",
        firecrawl_api_key: (settings?.firecrawl_api_key as string) ?? "",
      });

      const resultStr = await invoke<string>("process_file", { action: "research_chat", argsJson });
      const result = JSON.parse(resultStr);

      if (result.error) {
        addMessage(currentThread.id, {
          id: uid(), role: "assistant", content: result.error,
          type: "error", timestamp: Date.now(),
        });
      } else {
        const cost = result.tokens
          ? estimateCost(params.provider, params.model, result.tokens.input || 0, result.tokens.output || 0)
          : 0;

        if (result.tokens) {
          await trackTokenUsage(params.provider, params.model, result.tokens.input || 0, result.tokens.output || 0, cost);
        }

        // Tool results FIRST
        if (result.tool_results && Array.isArray(result.tool_results)) {
          for (const tr of result.tool_results) {
            addMessage(currentThread.id, {
              id: uid(), role: "tool", content: tr.summary || "",
              type: tr.type || "text", data: tr.data,
              timestamp: Date.now(), tool_used: tr.tool_name,
            });
          }
        }

        // Then assistant synthesis
        addMessage(currentThread.id, {
          id: uid(), role: "assistant", content: result.reply || result.content || "",
          type: result.type || "text", data: result.data, timestamp: Date.now(),
          tokens: result.tokens ? { input: result.tokens.input || 0, output: result.tokens.output || 0, cost } : undefined,
          tool_used: result.tool_used,
        });
      }

      if (isFirst && inputText.trim().length > 0) {
        // Use LLM to generate a smart title
        try {
          const renameResult = JSON.parse(await invoke<string>("process_file", {
            action: "run_pipeline_phase",
            argsJson: JSON.stringify({ phase: "auto_rename", content: inputText.trim(), api_key: params.api_key, provider: params.provider, model: params.model }),
          }));
          if (renameResult?.ok && renameResult.title) {
            renameThread(currentThread.id, renameResult.title);
          } else {
            renameThread(currentThread.id, inputText.trim().length > 50 ? inputText.trim().slice(0, 47) + "..." : inputText.trim());
          }
        } catch {
          renameThread(currentThread.id, inputText.trim().length > 50 ? inputText.trim().slice(0, 47) + "..." : inputText.trim());
        }
      }
    } catch (e) {
      addMessage(currentThread.id, {
        id: uid(), role: "assistant", content: `Error: ${String(e)}`,
        type: "error", timestamp: Date.now(),
      });
    } finally {
      setGenerating(false);
    }
  }, [inputText, isGenerating, currentThread, messages, params, settings, addMessage, setGenerating, renameThread]);

  // ── Run Pipeline (Pipeline Mode)
  const handleRunPipeline = useCallback(async () => {
    if (!pipelineQuery.trim() || !params.api_key) {
      showToast(!params.api_key ? "Set an API key in the right panel first" : "Enter a research question");
      return;
    }

    pipelineAbortRef.current = false;
    setPipeline({ active: true, phase: "validating", progress: 0, query: pipelineQuery, studyDesign: pipelineDesign, error: null, papers: [], relevantPapers: [], acquiredPdfs: [], extractedTexts: [], searchQueries: [], blueprint: null, draftSections: [], citationIssues: [], guidelinesIssues: [], manuscript: "", bibliography: "", logs: [], totalTokens: { input: 0, output: 0, cost: 0 } });
    const log = (phase: string, message: string, level: "info" | "warn" | "error" | "success" = "info") => addPipelineLog(phase, message, level);
    const trackPipelineTokens = (result: Record<string, unknown>) => {
      const tokens = result?.tokens as { input_tokens?: number; output_tokens?: number } | undefined;
      if (tokens) {
        const inp = tokens.input_tokens || 0;
        const out = tokens.output_tokens || 0;
        const cost = estimateCost(params.provider, params.model, inp, out);
        addPipelineTokens(inp, out, cost);
        trackTokenUsage(params.provider, params.model, inp, out, cost);
      }
    };

    // Select the contextual prompt based on the chosen study design
    const designPromptMap: Record<string, string> = {
      systematic_review: "research_pipeline", meta_analysis: "research_pipeline",
      narrative_review: "research_pipeline", scoping_review: "research_pipeline",
      subject_review: "subject_review", educational: "educational",
      case_study: "case_study", comparative: "comparative", exploratory: "exploratory",
    };
    const promptKey = designPromptMap[pipelineDesign] || "research_pipeline";
    const prompts = settings?.ai_prompts as Record<string, string> | undefined;
    const pipelinePrompt = prompts?.[promptKey] ?? prompts?.research_pipeline ?? "";
    const pc = settings?.pipeline_config;
    const stepConfig = (key: keyof PipelineConfig): PipelineStepConfig | undefined => pc?.[key];
    const baseArgs = {
      api_key: params.api_key, provider: params.provider, model: params.model,
      system_prompt: pipelinePrompt,
      study_design: pipelineDesign,
      tavily_api_key: settings?.tavily_api_key ?? "",
      brave_api_key: (settings?.brave_api_key as string) ?? "",
      firecrawl_api_key: (settings?.firecrawl_api_key as string) ?? "",
    };

    try {
      // Phase 1.1 — Gatekeeper
      log("validate", "Validating research question...");
      setPipeline({ phase: "validating", progress: 5, statusMessage: "Validating research question..." });
      const validateResult = JSON.parse(await invoke<string>("process_file", {
        action: "run_pipeline_phase",
        argsJson: JSON.stringify({ phase: "validate", query: pipelineQuery, step_config: stepConfig("gatekeeper"), ...baseArgs }),
      }));
      trackPipelineTokens(validateResult);
      if (pipelineAbortRef.current) return;
      if (!validateResult.ok || validateResult.is_valid === false) {
        log("validate", `Query INVALID: ${validateResult.reason || validateResult.error || "Unknown"}`, "error");
        setPipeline({ phase: "error", error: `Query invalid: ${validateResult.reason || validateResult.error || "Unknown"}`, active: false });
        return;
      }
      log("validate", `Query VALID. Domain: ${validateResult.domain || "general"}. Keywords: ${(validateResult.keywords || []).join(", ")}`, "success");
      setPipeline({ progress: 10, statusMessage: `Valid query. Domain: ${validateResult.domain || "general"}` });

      // Phase 1.2 — Query Architect
      log("queries", "Generating optimized MeSH/Boolean search queries...");
      setPipeline({ phase: "generating_queries", progress: 15, statusMessage: "Generating optimized search queries..." });
      const queriesResult = JSON.parse(await invoke<string>("process_file", {
        action: "run_pipeline_phase",
        argsJson: JSON.stringify({ phase: "generate_queries", query: pipelineQuery, domain: validateResult.domain, step_config: stepConfig("query_architect"), ...baseArgs }),
      }));
      trackPipelineTokens(queriesResult);
      if (pipelineAbortRef.current) return;
      const searchQueries = Array.isArray(queriesResult?.queries) ? queriesResult.queries : [{ db: "pubmed", query_string: pipelineQuery, description: "Direct search" }];
      for (const sq of searchQueries) { log("queries", `[${sq.db}] ${sq.query_string?.slice(0, 80)}`); }
      log("queries", `Generated ${searchQueries.length} search queries`, "success");
      setPipeline({ searchQueries, progress: 20, statusMessage: `Generated ${searchQueries.length} search queries` });

      // Phase 1.3 — Harvester
      log("harvest", "Searching PubMed, Semantic Scholar, OpenAlex, arXiv...");
      setPipeline({ phase: "harvesting", progress: 25, statusMessage: "Searching PubMed, Semantic Scholar, OpenAlex, arXiv..." });
      const harvestResult = JSON.parse(await invoke<string>("process_file", {
        action: "run_pipeline_phase",
        argsJson: JSON.stringify({ phase: "harvest", query: pipelineQuery, search_queries: searchQueries, ...baseArgs }),
      }));
      if (pipelineAbortRef.current) return;
      const allPapers: PaperResult[] = Array.isArray(harvestResult?.papers) ? harvestResult.papers : [];
      const sources = (harvestResult?.sources || []).join(", ");
      log("harvest", `Found ${allPapers.length} unique papers from: ${sources}`, allPapers.length > 0 ? "success" : "warn");
      setPipeline({ papers: allPapers, progress: 40, statusMessage: `Found ${allPapers.length} papers from ${sources}` });

      if (allPapers.length === 0) {
        log("harvest", "No papers found. Pipeline halted.", "error");
        setPipeline({ phase: "error", error: "No papers found. Try broadening your query.", active: false });
        return;
      }

      // Phase 1.4 — Triage
      log("triage", `Screening ${allPapers.length} papers for relevance...`);
      setPipeline({ phase: "triaging", progress: 45, statusMessage: `Screening ${allPapers.length} papers for relevance...` });
      const triageResult = JSON.parse(await invoke<string>("process_file", {
        action: "run_pipeline_phase",
        argsJson: JSON.stringify({ phase: "triage", papers: allPapers.slice(0, 40), query: pipelineQuery, step_config: stepConfig("triage_agent"), ...baseArgs }),
      }));
      trackPipelineTokens(triageResult);
      if (pipelineAbortRef.current) return;
      const relevant = triageResult.ok
        ? allPapers.filter((_: PaperResult, i: number) => triageResult.results?.[i]?.is_relevant !== false)
        : allPapers;
      log("triage", `${relevant.length}/${allPapers.length} papers deemed relevant`, "success");
      setPipeline({ relevantPapers: relevant, progress: 55, statusMessage: `${relevant.length}/${allPapers.length} papers relevant` });

      // Phase 1.5 — Acquisition
      const papersWithDoi = relevant.filter((p: PaperResult) => p.doi).slice(0, 15);
      let acquired: { doi: string; path: string; title: string }[] = [];
      if (papersWithDoi.length > 0) {
        log("acquire", `Acquiring ${papersWithDoi.length} papers with DOIs (Unpaywall → Sci-Hub)...`);
        setPipeline({ phase: "acquiring", progress: 58, statusMessage: `Acquiring ${papersWithDoi.length} papers via Unpaywall/Sci-Hub...` });
        const acquireResult = JSON.parse(await invoke<string>("process_file", {
          action: "run_pipeline_phase",
          argsJson: JSON.stringify({ phase: "acquire", papers: papersWithDoi, skip_unpaywall: false, ...baseArgs }),
        }));
        if (pipelineAbortRef.current) return;
        acquired = Array.isArray(acquireResult?.acquired) ? acquireResult.acquired : [];

        // Handle CAPTCHAs interactively
        const captchaPapers: { doi: string; title: string; captcha_img_b64: string; mirror: string; form_action: string; cookies: Record<string, string> }[] = acquireResult?.captcha_needed ?? [];
        for (const cp of captchaPapers) {
          if (pipelineAbortRef.current) return;
          if (!cp.captcha_img_b64) continue;

          setPipeline({ statusMessage: `CAPTCHA required for "${cp.title.slice(0, 40)}..." — please solve it` });

          // Show CAPTCHA dialog and wait for user input
          const solution = await new Promise<string>((resolve) => {
            setCaptchaSolution("");
            setCaptchaDialog({ show: true, imgB64: cp.captcha_img_b64, doi: cp.doi, mirror: cp.mirror, formAction: cp.form_action, cookies: cp.cookies, resolve });
          });
          setCaptchaDialog((d) => ({ ...d, show: false, resolve: null }));

          if (!solution || pipelineAbortRef.current) continue;

          // Submit CAPTCHA solution
          try {
            const solveResult = JSON.parse(await invoke<string>("process_file", {
              action: "solve_scihub_captcha",
              argsJson: JSON.stringify({ solution, mirror: cp.mirror, doi: cp.doi, form_action: cp.form_action, cookies: cp.cookies }),
            }));
            if (solveResult?.ok && solveResult.path) {
              acquired.push({ doi: cp.doi, path: solveResult.path, title: cp.title });
            }
          } catch { /* CAPTCHA solve failed, skip this paper */ }
        }

        // Log acquisition failures
        const failedPapers = acquireResult?.failed ?? [];
        for (const fp of failedPapers) {
          log("acquire", `FAILED: "${(fp.title || fp.doi || "unknown").slice(0, 50)}" — ${fp.error || "unknown error"}`, "warn");
        }
        log("acquire", `Acquired ${acquired.length}/${papersWithDoi.length} full-text PDFs (${failedPapers.length} failed)`, acquired.length > 0 ? "success" : "warn");
        setPipeline({ acquiredPdfs: acquired, progress: 65, statusMessage: `Acquired ${acquired.length}/${papersWithDoi.length} full-text PDFs` });

        // Phase 2.1 — Extract text
        if (acquired.length > 0) {
          log("extract", `Extracting text from ${acquired.length} PDFs...`);
          setPipeline({ phase: "extracting", progress: 68, statusMessage: "Extracting text from PDFs..." });
          const paths = acquired.map((a) => a.path);
          const extractResult = JSON.parse(await invoke<string>("process_file", {
            action: "run_pipeline_phase",
            argsJson: JSON.stringify({ phase: "extract", paths, ...baseArgs }),
          }));
          if (pipelineAbortRef.current) return;
          const extracted = Array.isArray(extractResult?.results) ? extractResult.results.filter((r: { ok: boolean }) => r.ok) : [];
          const extractFailed = Array.isArray(extractResult?.results) ? extractResult.results.filter((r: { ok: boolean }) => !r.ok) : [];
          for (const ef of extractFailed) { log("extract", `PDF extract failed: ${ef.path} — ${ef.error || "unknown"}`, "warn"); }
          log("extract", `Extracted text from ${extracted.length}/${acquired.length} PDFs`, "success");
          setPipeline({ extractedTexts: extracted, progress: 72, statusMessage: `Extracted text from ${extracted.length} PDFs` });
        }
      } else {
        setPipeline({ progress: 72, statusMessage: "No DOIs available for full-text acquisition — using abstracts" });
      }

      // Phase 2.2 — Vector DB Ingestion (GraphRAG)
      if (pipelineAbortRef.current) return;
      const currentExtracted = useResearchStore.getState().pipeline.extractedTexts;
      const projectId = currentThread?.id || "default";
      if (currentExtracted.length > 0) {
        log("vectordb", "Ingesting texts into vector database for semantic retrieval...");
        setPipeline({ progress: 73, statusMessage: "Building vector database..." });
        const vdbPapers = currentExtracted.map((e, i) => ({
          title: acquired[i]?.title || `Paper ${i + 1}`,
          doi: acquired[i]?.doi || "",
          text: e.text || "",
        }));
        const vdbResult = JSON.parse(await invoke<string>("process_file", {
          action: "run_pipeline_phase",
          argsJson: JSON.stringify({ phase: "ingest_vectordb", project_id: projectId, papers: vdbPapers, query: pipelineQuery }),
        }));
        if (vdbResult.warning) {
          log("vectordb", vdbResult.warning, "warn");
        } else {
          log("vectordb", `Stored ${vdbResult.chunks_stored} chunks in vector DB (${vdbResult.collection_size} total)`, "success");
        }
      }

      // Phase 3.1 — Blueprint Agent
      if (pipelineAbortRef.current) return;
      log("blueprint", "Generating paper blueprint (structure, figures, tables)...");
      setPipeline({ phase: "blueprinting", progress: 74, statusMessage: "Generating paper blueprint..." });

      const papersContext = relevant.slice(0, 20).map((p: PaperResult, i: number) =>
        `[${i + 1}] "${p.title}" (${p.authors?.slice(0, 3).join(", ") || "Unknown"}, ${p.year || "n.d."}). ${p.abstract?.slice(0, 300) || ""}`
      ).join("\n");

      // Include extracted full-text for richer context
      const extractedContext = useResearchStore.getState().pipeline.extractedTexts
        .slice(0, 10).map((e) => e.text?.slice(0, 2000) || "").filter(Boolean).join("\n---\n");

      const blueprintResult = JSON.parse(await invoke<string>("process_file", {
        action: "run_pipeline_phase",
        argsJson: JSON.stringify({
          phase: "blueprint", query: pipelineQuery,
          papers_context: papersContext, extracted_texts: extractedContext,
          step_config: stepConfig("blueprint_agent"), ...baseArgs,
        }),
      }));
      trackPipelineTokens(blueprintResult);
      if (pipelineAbortRef.current) return;

      let blueprint: PipelineState["blueprint"] = null;
      if (blueprintResult.ok) {
        blueprint = {
          sections: blueprintResult.sections || [],
          figure_plan: blueprintResult.figure_plan || [],
          table_plan: blueprintResult.table_plan || [],
          guidelines_map: blueprintResult.guidelines_map || {},
        };
        setPipeline({ blueprint, progress: 78 });
        log("blueprint", `Blueprint: ${blueprint.sections.length} sections, ${blueprint.figure_plan.length} figures, ${blueprint.table_plan.length} tables`, "success");
      } else {
        log("blueprint", `Blueprint generation failed: ${blueprintResult.error || "unknown"} — using default structure`, "warn");
      }

      // Phase 3.2 — Lead Author: draft each section
      const sectionTypes = blueprint?.sections?.length
        ? blueprint.sections.map((s) => s.id || s.title.toLowerCase().replace(/\s+/g, "_"))
        : ["introduction", "methodology", "results", "discussion"];
      const sectionTitles = blueprint?.sections?.length
        ? blueprint.sections.map((s) => s.title)
        : ["Introduction", "Methodology", "Results", "Discussion"];
      const draftSections: { type: string; text: string; figures?: string[]; tables?: string[] }[] = [];

      for (let si = 0; si < sectionTypes.length; si++) {
        if (pipelineAbortRef.current) return;
        const sType = sectionTypes[si];
        const sTitle = sectionTitles[si];
        const pct = 78 + (si / sectionTypes.length) * 10;
        log("draft", `Drafting "${sTitle}" (${si + 1}/${sectionTypes.length})...`);
        setPipeline({ phase: "drafting", progress: Math.round(pct), statusMessage: `Drafting ${sTitle}...` });

        const blueprintReqs = blueprint?.sections?.[si]
          ? `Section: ${blueprint.sections[si].title}\nDescription: ${blueprint.sections[si].description}\nRequirements: ${blueprint.sections[si].requirements}`
          : "";

        const draftResult = JSON.parse(await invoke<string>("process_file", {
          action: "run_pipeline_phase",
          argsJson: JSON.stringify({
            phase: "draft", section_type: sType, query: pipelineQuery,
            papers_context: papersContext, extracted_texts: extractedContext,
            blueprint_requirements: blueprintReqs, project_id: projectId,
            step_config: stepConfig("lead_author"), ...baseArgs,
          }),
        }));
        trackPipelineTokens(draftResult);
        if (draftResult.ok) {
          draftSections.push({
            type: sType, text: draftResult.text,
            figures: draftResult.figures || [],
            tables: draftResult.tables || [],
          });
          log("draft", `${sTitle}: ${draftResult.text.length} chars, ${draftResult.citations_used || 0} citations`, "success");
        } else {
          log("draft", `${sTitle}: FAILED — ${draftResult.error || "unknown error"}`, "error");
        }
      }
      setPipeline({ draftSections, progress: 85, statusMessage: `Drafted ${draftSections.length} sections` });

      // Phase 3.2b — Data Analyst: Generate figures & tables from blueprint plan
      let genFigures: { description: string; caption: string; path: string; chart_type: string; size: number; index: number }[] = [];
      let genTables: { description: string; caption: string; markdown: string; path: string; size: number; index: number }[] = [];
      const figurePlan = blueprint?.figure_plan || [];
      const tablePlan = blueprint?.table_plan || [];
      if (figurePlan.length > 0 || tablePlan.length > 0 || draftSections.some(s => (s.figures?.length ?? 0) > 0)) {
        if (pipelineAbortRef.current) return;
        log("figures", `Generating ${figurePlan.length} figures + ${tablePlan.length} tables...`);
        setPipeline({ phase: "generating_figures", progress: 86, statusMessage: "Generating charts & tables..." });
        try {
          const figResult = JSON.parse(await invoke<string>("process_file", {
            action: "run_pipeline_phase",
            argsJson: JSON.stringify({
              phase: "generate_figures",
              figure_plan: figurePlan,
              table_plan: tablePlan,
              draft_sections: draftSections,
              papers_context: papersContext,
              query: pipelineQuery,
              ...baseArgs,
            }),
          }));
          trackPipelineTokens(figResult);
          if (figResult.ok) {
            genFigures = figResult.figures || [];
            genTables = figResult.tables || [];
            setPipeline({ generatedFigures: genFigures, generatedTables: genTables });
            const errCount = (figResult.errors || []).length;
            log("figures", `Generated ${genFigures.length} figures, ${genTables.length} tables${errCount > 0 ? ` (${errCount} errors)` : ""}`, genFigures.length > 0 || genTables.length > 0 ? "success" : "warn");
            if (errCount > 0) {
              for (const err of (figResult.errors || []).slice(0, 5)) {
                log("figures", err, "warn");
              }
            }
          } else {
            log("figures", `Figure generation failed: ${figResult.error || "unknown"}`, "error");
          }
        } catch (e) {
          log("figures", `Figure generation error: ${String(e)}`, "error");
        }
      }
      setPipeline({ progress: 87 });

      // Phase 3.2c — Scientific Illustrator Agent: generate illustrations via Nano Banana Pro
      if (pipelineAbortRef.current) return;
      {
        log("illustrator", "Scientific Illustrator: generating illustrations via Nano Banana Pro...");
        setPipeline({ phase: "generating_figures", progress: 87, statusMessage: "Generating scientific illustrations..." });
        try {
          const illResult = JSON.parse(await invoke<string>("process_file", {
            action: "run_pipeline_phase",
            argsJson: JSON.stringify({
              phase: "illustrate",
              draft_sections: draftSections,
              figure_plan: figurePlan,
              generated_figures: genFigures,
              query: pipelineQuery,
              ...baseArgs,
            }),
          }));
          trackPipelineTokens(illResult);
          if (illResult.ok) {
            const newIllustrations = illResult.illustrations || [];
            if (newIllustrations.length > 0) {
              genFigures = [...genFigures, ...newIllustrations];
              setPipeline({ generatedFigures: genFigures });
              log("illustrator", `Generated ${newIllustrations.length} scientific illustration(s)`, "success");
            } else {
              log("illustrator", "No additional illustrations needed", "info");
            }
            const illErrors = illResult.errors || [];
            for (const err of illErrors.slice(0, 5)) {
              log("illustrator", err, "warn");
            }
          } else {
            log("illustrator", `Illustrator failed: ${illResult.error || "unknown"}`, "error");
          }
        } catch (e) {
          log("illustrator", `Illustrator error: ${String(e)}`, "error");
        }
      }
      setPipeline({ progress: 88 });

      // Phase 3.3 — Quality Swarm (Citation Verify + Guidelines Check) with retry loop
      const MAX_SWARM_RETRIES = 2;
      if (draftSections.length > 0) {
        for (let swarmRound = 0; swarmRound <= MAX_SWARM_RETRIES; swarmRound++) {
          if (pipelineAbortRef.current) return;
          const isRetry = swarmRound > 0;
          if (isRetry) log("quality_swarm", `Quality swarm retry ${swarmRound}/${MAX_SWARM_RETRIES}...`, "warn");

          // 3.3a — Citation Verifier
          log("citation_verify", `${isRetry ? "Re-v" : "V"}erifying citation integrity...`);
          setPipeline({ phase: "citation_verifying", progress: 89, statusMessage: `${isRetry ? "Re-v" : "V"}erifying citations...` });
          const cvResult = JSON.parse(await invoke<string>("process_file", {
            action: "run_pipeline_phase",
            argsJson: JSON.stringify({
              phase: "citation_verify_swarm", sections: draftSections,
              papers: relevant.slice(0, 30), query: pipelineQuery,
              step_config: stepConfig("citation_verifier"), ...baseArgs,
            }),
          }));
          trackPipelineTokens(cvResult);
          const citIssues = cvResult.ok ? (cvResult.issues || []) : [];
          setPipeline({ citationIssues: citIssues });
          const criticalCitations = citIssues.filter((i: { severity: string }) => i.severity === "critical");
          log("citation_verify", `Citation check: ${citIssues.length} issue(s), ${criticalCitations.length} critical`, criticalCitations.length > 0 ? "warn" : "success");

          // 3.3b — Guidelines Compliance
          if (pipelineAbortRef.current) return;
          log("guidelines", `${isRetry ? "Re-c" : "C"}hecking reporting guidelines compliance...`);
          setPipeline({ phase: "guidelines_checking", progress: 91, statusMessage: "Checking guidelines compliance..." });
          const gcResult = JSON.parse(await invoke<string>("process_file", {
            action: "run_pipeline_phase",
            argsJson: JSON.stringify({
              phase: "guidelines_check", sections: draftSections,
              query: pipelineQuery,
              guidelines_map: blueprint?.guidelines_map || {},
              step_config: stepConfig("guidelines_compliance"), ...baseArgs,
            }),
          }));
          trackPipelineTokens(gcResult);
          const glItems = gcResult.ok ? (gcResult.checklist || []) : [];
          const glIssues = glItems.filter((it: { status: string }) => it.status !== "met");
          setPipeline({ guidelinesIssues: glIssues });
          const met = glItems.length - glIssues.length;
          log("guidelines", `Guidelines: ${met}/${glItems.length} items met`, glIssues.length === 0 ? "success" : "warn");

          // If no critical issues, break the retry loop
          if (criticalCitations.length === 0 && glIssues.length <= 2) {
            log("quality_swarm", "Quality swarm passed — proceeding to smoothing", "success");
            break;
          }

          // If at max retries, mark sections with [MANUAL REVIEW REQUIRED]
          if (swarmRound === MAX_SWARM_RETRIES) {
            log("quality_swarm", `Max retries reached — inserting [MANUAL REVIEW REQUIRED] tags`, "warn");
            for (const ds of draftSections) {
              if (!ds.text.includes("[MANUAL REVIEW REQUIRED]")) {
                ds.text += "\n\n> [MANUAL REVIEW REQUIRED] — Quality swarm flagged issues that could not be auto-resolved.\n";
              }
            }
            setPipeline({ draftSections: [...draftSections] });
            break;
          }

          // Redraft sections with critical issues (route back to Lead Author)
          log("quality_swarm", `Redrafting sections to fix ${criticalCitations.length} citation + ${glIssues.length} guideline issues...`, "warn");
          setPipeline({ phase: "drafting", progress: 87, statusMessage: "Redrafting to fix quality issues..." });
          for (let si = 0; si < draftSections.length; si++) {
            if (pipelineAbortRef.current) return;
            const sType = draftSections[si].type;
            const fixInstructions = [
              ...criticalCitations.filter((c: { section: string }) => c.section.toLowerCase().includes(sType)).map((c: { issue: string }) => `Fix citation: ${c.issue}`),
              ...glIssues.slice(0, 3).map((g: { item: string; fix: string }) => `Fix guideline: ${g.item} — ${g.fix}`),
            ];
            if (fixInstructions.length === 0) continue;

            const redraftResult = JSON.parse(await invoke<string>("process_file", {
              action: "run_pipeline_phase",
              argsJson: JSON.stringify({
                phase: "draft", section_type: sType, query: pipelineQuery,
                papers_context: papersContext, extracted_texts: extractedContext,
                guidelines: pipelineDesign === "meta_analysis" ? "PRISMA-MA" : "PRISMA",
                blueprint_requirements: `REVISION — fix these issues:\n${fixInstructions.join("\n")}\n\nOriginal draft:\n${draftSections[si].text.slice(0, 4000)}`,
                project_id: projectId, step_config: stepConfig("lead_author"), ...baseArgs,
              }),
            }));
            trackPipelineTokens(redraftResult);
            if (redraftResult.ok) {
              draftSections[si] = { ...draftSections[si], text: redraftResult.text };
              log("quality_swarm", `Redrafted ${sType}`, "info");
            }
          }
          setPipeline({ draftSections: [...draftSections] });
        }
      }

      // Phase 4.1 — Smoothing
      if (draftSections.length > 0) {
        log("smooth", "Polishing manuscript — preserving all citations, tables, figures...");
        setPipeline({ phase: "smoothing", progress: 93, statusMessage: "Polishing manuscript..." });
        const smoothResult = JSON.parse(await invoke<string>("process_file", {
          action: "run_pipeline_phase",
          argsJson: JSON.stringify({
            phase: "smooth", sections: draftSections, query: pipelineQuery,
            papers: relevant.slice(0, 30), project_id: projectId,
            generated_figures: genFigures,
            generated_tables: genTables,
            citation_issues: useResearchStore.getState().pipeline.citationIssues,
            guidelines_issues: useResearchStore.getState().pipeline.guidelinesIssues,
            step_config: stepConfig("smoothing_pass"), ...baseArgs,
          }),
        }));
        trackPipelineTokens(smoothResult);
        if (pipelineAbortRef.current) return;
        if (smoothResult.ok) {
          log("smooth", `Manuscript polished: ${smoothResult.manuscript.length} chars`, "success");
          setPipeline({ manuscript: smoothResult.manuscript, progress: 97 });
        } else {
          log("smooth", `Smoothing failed: ${smoothResult.error || "unknown"}`, "error");
        }
      }

      // Phase 4.2 — Compile references
      log("compile", "Compiling bibliography...");
      setPipeline({ phase: "compiling", progress: 98, statusMessage: "Compiling bibliography..." });
      const refsResult = JSON.parse(await invoke<string>("process_file", {
        action: "run_pipeline_phase",
        argsJson: JSON.stringify({ phase: "compile_refs", papers: relevant.slice(0, 30), ...baseArgs }),
      }));
      if (refsResult?.ok && refsResult.bibtex) {
        log("compile", `Bibliography compiled: ${refsResult.count || 0} references`, "success");
        setPipeline({ bibliography: refsResult.bibtex });
      }

      // Auto-rename thread
      try {
        const renameResult = JSON.parse(await invoke<string>("process_file", {
          action: "run_pipeline_phase",
          argsJson: JSON.stringify({ phase: "auto_rename", content: pipelineQuery, api_key: params.api_key, provider: params.provider, model: params.model }),
        }));
        if (renameResult?.ok && renameResult.title && currentThread) {
          renameThread(currentThread.id, renameResult.title);
        }
      } catch { /* rename failed, keep default */ }

      // Store pipeline results as messages in the chat thread for post-pipeline chatting
      if (currentThread) {
        addMessage(currentThread.id, {
          id: uid(), role: "system", content: `Research pipeline completed for: "${pipelineQuery}"`,
          type: "text", timestamp: Date.now(),
        });
        if (relevant.length > 0) {
          addMessage(currentThread.id, {
            id: uid(), role: "tool", content: `Found ${allPapers.length} papers, ${relevant.length} relevant, ${acquired.length} acquired`,
            type: "papers", data: relevant.slice(0, 15), timestamp: Date.now(), tool_used: "Pipeline",
          });
        }
      }

      log("complete", `Pipeline complete! ${allPapers.length} papers → ${relevant.length} relevant → ${acquired.length} acquired. Manuscript: ${useResearchStore.getState().pipeline.manuscript.length} chars`, "success");
      setPipeline({ phase: "complete", progress: 100, active: false, statusMessage: "Research pipeline complete!" });
      showToast("Pipeline complete! Switch to Chat mode to discuss results, or export.");

    } catch (e) {
      setPipeline({ phase: "error", error: String(e), active: false });
      showToast(`Pipeline error: ${String(e)}`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineQuery, pipelineDesign, params, settings, setPipeline, showToast, addPipelineLog, addPipelineTokens, addMessage, renameThread, currentThread]);

  // ── Cancel pipeline
  const handleCancelPipeline = useCallback(() => {
    pipelineAbortRef.current = true;
    setPipeline({ active: false, phase: "idle", statusMessage: "Cancelled by user" });
  }, [setPipeline]);

  // ── Export chat or pipeline
  const handleExport = useCallback(async (format: string) => {
    if (!currentThread) { showToast("No active thread"); return; }
    setShowExportMenu(false);

    const hasPipelineData = pipeline.manuscript || (pipeline.papers?.length ?? 0) > 0;
    const hasMessages = messages.length > 0;

    if (!hasPipelineData && !hasMessages) { showToast("Nothing to export"); return; }

    try {
      // If we have pipeline data, use the snapshot export for comprehensive output
      if (hasPipelineData) {
        const argsJson = JSON.stringify({
          manuscript: pipeline.manuscript,
          papers: pipeline.relevantPapers || pipeline.papers || [],
          bibliography: pipeline.bibliography,
          query: pipeline.query,
          study_design: pipeline.studyDesign,
          logs: pipeline.logs,
          thread_title: currentThread.title,
          draft_sections: pipeline.draftSections,
          generated_figures: pipeline.generatedFigures || [],
          generated_tables: pipeline.generatedTables || [],
          acquired_pdfs: pipeline.acquiredPdfs || [],
          messages: messages.map((m) => ({ role: m.role, content: m.content, type: m.type, tool_used: m.tool_used })),
          format,
        });
        const resultStr = await invoke<string>("process_file", { action: "export_research_snapshot", argsJson });
        const result = JSON.parse(resultStr);
        if (result.ok && result.folder) {
          try { await invoke("reveal_in_folder", { path: result.folder }); } catch { /* */ }
          addMessage(currentThread.id, {
            id: uid(), role: "assistant", content: `Research exported: ${result.file_count} files`,
            type: "export", data: { path: result.folder, format: "folder", size: 0, files: result.files }, timestamp: Date.now(),
          });
          showToast(`Exported ${result.file_count} files → ${result.folder.split(/[/\\]/).pop()}`);
          return;
        } else {
          showToast(result.error || "Export failed");
          return;
        }
      }

      // Regular chat export
      const argsJson = JSON.stringify({
        messages: messages.map((m) => ({ role: m.role, content: m.content, type: m.type, data: m.data })),
        format, thread_title: currentThread.title,
      });
      const resultStr = await invoke<string>("process_file", { action: "export_chat", argsJson });
      const result = JSON.parse(resultStr);
      if (result.ok && result.path) {
        try { await invoke("stage_file", { path: result.path }); await emit("items-changed"); } catch { /* main window may be closed */ }
        addMessage(currentThread.id, {
          id: uid(), role: "assistant", content: `Exported as ${format.toUpperCase()}`,
          type: "export", data: { path: result.path, format, size: result.size }, timestamp: Date.now(),
        });
        try { await invoke("open_file", { path: result.path }); } catch { /* silent */ }
        showToast(`Exported → ${result.path.split(/[/\\]/).pop()}`);
      } else {
        showToast(result.error || "Export failed");
      }
    } catch (e) {
      showToast(`Export error: ${String(e)}`);
    }
  }, [currentThread, messages, pipeline, showToast, addMessage]);

  // ── Retry
  const handleRetry = useCallback(() => {
    if (!currentThread || isGenerating) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const idx = messages.indexOf(lastUser);
    const toRemove = messages.slice(idx + 1);
    for (const m of toRemove.reverse()) {
      removeMessagesFrom(currentThread.id, m.id);
    }
    setInputText(lastUser.content);
    setTimeout(() => handleSend(), 50);
  }, [currentThread, isGenerating, messages, removeMessagesFrom, handleSend]);

  // ── Edit & Retry
  const handleEditRetry = useCallback((msgId: string) => {
    if (!currentThread || isGenerating) return;
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return;
    setInputText(msg.content);
    removeMessagesFrom(currentThread.id, msgId);
    inputRef.current?.focus();
  }, [currentThread, isGenerating, messages, removeMessagesFrom]);

  // ── Copy
  const handleCopyMessage = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
    showToast("Copied to clipboard");
  }, [showToast]);

  // ── Key handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  // ── Change provider
  const handleProviderChange = useCallback((provider: string) => {
    const keys = settings?.api_keys ?? [];
    const key = keys.find((k) => k.provider === provider);
    const models = PROVIDER_MODELS[provider] ?? [];
    setParams({ provider, api_key: key?.key ?? "", model: key?.model || models[0]?.id || "" });
  }, [settings, setParams]);

  // ══════════════════════════════════════════════════════════════════════════════
  // ██  RENDER
  // ══════════════════════════════════════════════════════════════════════════════

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden"
      style={{ background: "linear-gradient(145deg, #0a0a0f 0%, #0d1117 40%, #0a0f1a 100%)", color: "#e2e8f0", fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif" }}>

      {/* ── HEADER BAR ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.06] select-none"
        style={{ background: "rgba(15,15,25,0.85)", backdropFilter: "blur(20px)" }}>
        {/* Left toggle */}
        <button onClick={() => setLeftCollapsed(!leftCollapsed)}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors cursor-pointer"
          title={leftCollapsed ? "Show threads" : "Hide threads"}>
          <i className={`fa-solid ${leftCollapsed ? "fa-bars" : "fa-chevron-left"} text-[11px]`} />
        </button>

        {/* Mode toggle */}
        <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
          <button onClick={() => setViewMode("chat")}
            className={`px-3 py-1 text-[11px] font-medium transition-all cursor-pointer ${viewMode === "chat" ? "text-cyan-300" : "text-white/35 hover:text-white/60"}`}
            style={{ background: viewMode === "chat" ? "rgba(34,211,238,0.12)" : "transparent" }}>
            <i className="fa-solid fa-comments text-[9px] mr-1.5" />Chat
          </button>
          <div className="w-px bg-white/[0.08]" />
          <button onClick={() => setViewMode("pipeline")}
            className={`px-3 py-1 text-[11px] font-medium transition-all cursor-pointer ${viewMode === "pipeline" ? "text-emerald-300" : "text-white/35 hover:text-white/60"}`}
            style={{ background: viewMode === "pipeline" ? "rgba(16,185,129,0.12)" : "transparent" }}>
            <i className="fa-solid fa-rocket text-[9px] mr-1.5" />Pipeline
          </button>
        </div>

        {/* Thread title */}
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <i className="fa-solid fa-microscope text-cyan-400/70 text-sm" />
          {editingTitle === currentThread?.id ? (
            <input value={editTitleVal}
              onChange={(e) => setEditTitleVal(e.target.value)}
              onBlur={() => { if (editTitleVal.trim() && currentThread) renameThread(currentThread.id, editTitleVal.trim()); setEditingTitle(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") { if (editTitleVal.trim() && currentThread) renameThread(currentThread.id, editTitleVal.trim()); setEditingTitle(null); } if (e.key === "Escape") setEditingTitle(null); }}
              className="bg-white/5 border border-cyan-500/30 rounded px-2 py-0.5 text-sm text-white/90 outline-none flex-1" autoFocus />
          ) : (
            <span className="text-sm font-medium text-white/80 truncate cursor-pointer hover:text-white/95"
              onDoubleClick={() => { if (currentThread) { setEditingTitle(currentThread.id); setEditTitleVal(currentThread.title); } }}>
              {currentThread?.title || "New Research"}
            </span>
          )}
        </div>

        {/* Header actions */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-mono"
            style={{ background: "rgba(34,211,238,0.08)", color: "#67e8f9", border: "1px solid rgba(34,211,238,0.15)" }}>
            <i className="fa-solid fa-coins text-[9px]" />
            {fmtCost(currentThread?.total_cost ?? 0)}
          </div>

          <div className="w-px h-5 bg-white/[0.06]" />

          {/* Export dropdown */}
          <div className="relative">
            <button onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors cursor-pointer"
              title="Export conversation">
              <i className="fa-solid fa-download text-[10px]" /> Export
            </button>
            <AnimatePresence>
              {showExportMenu && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  className="absolute right-0 top-full mt-1 z-50 rounded-xl overflow-hidden shadow-2xl"
                  style={{ background: "rgba(20,20,35,0.95)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(20px)", minWidth: 160 }}>
                  {EXPORT_FORMATS.map((f) => (
                    <button key={f.id} onClick={() => handleExport(f.id)}
                      className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-white/70 hover:text-white hover:bg-white/5 transition-colors cursor-pointer">
                      <i className={`fa-solid ${f.icon} text-[10px] w-4 text-center`} />
                      {f.label} <span className="text-white/30 ml-auto">{f.ext}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button onClick={() => createThread()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer"
            style={{ background: "rgba(34,211,238,0.12)", color: "#67e8f9", border: "1px solid rgba(34,211,238,0.25)" }}
            title="New research thread">
            <i className="fa-solid fa-plus text-[10px]" /> New
          </button>

          <div className="w-px h-5 bg-white/[0.06]" />

          <button onClick={() => setRightCollapsed(!rightCollapsed)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors cursor-pointer"
            title={rightCollapsed ? "Show parameters" : "Hide parameters"}>
            <i className={`fa-solid ${rightCollapsed ? "fa-sliders" : "fa-chevron-right"} text-[11px]`} />
          </button>
        </div>
      </div>

      {/* ── MAIN 3-COLUMN LAYOUT ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ══ LEFT PANEL — THREADS ══ */}
        <AnimatePresence initial={false}>
          {!leftCollapsed && (
            <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 240, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col border-r border-white/[0.06] overflow-hidden select-none"
              style={{ background: "rgba(10,10,18,0.6)", minWidth: 0 }}>

              <div className="p-2.5">
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <i className="fa-solid fa-magnifying-glass text-[10px] text-white/30" />
                  <input value={threadSearch} onChange={(e) => setThreadSearch(e.target.value)}
                    placeholder="Search threads..."
                    className="bg-transparent text-[12px] text-white/80 placeholder:text-white/25 outline-none flex-1" />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-3" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}>
                {groupedThreads.map((group) => (
                  <div key={group.label}>
                    <div className="text-[10px] font-semibold text-white/25 uppercase tracking-wider px-2 mb-1">{group.label}</div>
                    {group.threads.map((t) => (
                      <button key={t.id}
                        onClick={() => switchThread(t.id)}
                        className={`w-full text-left px-2.5 py-2 rounded-lg mb-0.5 transition-all group cursor-pointer ${
                          t.id === activeThreadId
                            ? "bg-cyan-500/10 border border-cyan-500/20"
                            : "hover:bg-white/[0.03] border border-transparent"
                        }`}>
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.id === activeThreadId ? "bg-cyan-400" : "bg-white/15"}`} />
                          <span className="text-[12px] text-white/75 truncate flex-1">{t.title}</span>
                          <button onClick={(e) => { e.stopPropagation(); deleteThread(t.id); }}
                            className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded flex items-center justify-center text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                            title="Delete thread">
                            <i className="fa-solid fa-xmark text-[9px]" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 pl-3.5">
                          <span className="text-[10px] text-white/25">{fmtDate(t.updated_at)}</span>
                          {t.total_cost > 0 && (
                            <span className="text-[10px] text-cyan-400/40">{fmtCost(t.total_cost)}</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                ))}
                {filteredThreads.length === 0 && (
                  <div className="text-center text-[11px] text-white/20 py-8">No threads found</div>
                )}
              </div>

              <div className="px-3 py-2 border-t border-white/[0.04]">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-white/25">Total spent</span>
                  <span className="text-cyan-400/60 font-mono">{fmtCost(totalCost())}</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ══ CENTER — CHAT / PIPELINE AREA ══ */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden" style={{ background: "rgba(8,8,16,0.95)" }}>

          {/* ═══ PIPELINE MODE ═══ */}
          <div className={`flex-1 overflow-y-auto px-6 py-4 ${viewMode !== "pipeline" ? "hidden" : ""}`} style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>

              {/* Pipeline input */}
              {!pipeline.active && pipeline.phase !== "complete" && (
                <div className="max-w-2xl mx-auto mb-6">
                  <div className="rounded-2xl p-6" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(10px)" }}>
                    <div className="flex items-center gap-2 mb-4">
                      <i className="fa-solid fa-rocket text-emerald-400/70 text-lg" />
                      <h2 className="text-[15px] font-semibold text-white/80">Autonomous Research Pipeline</h2>
                    </div>
                    <p className="text-[12px] text-white/35 mb-4 leading-relaxed">
                      Enter your research question and select a study design. The pipeline will autonomously search databases,
                      screen papers, acquire full-text PDFs, draft sections, and compile a manuscript.
                    </p>
                    <textarea value={pipelineQuery} onChange={(e) => setPipelineQuery(e.target.value)}
                      placeholder="Enter your research question... (e.g., 'What is the efficacy of SSRI vs SNRI for treatment-resistant depression?')"
                      className="w-full rounded-xl px-4 py-3 text-[13px] text-white/90 placeholder:text-white/25 outline-none resize-none mb-3"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", minHeight: 80 }}
                      rows={3} />
                    <div className="flex items-center gap-3 mb-4">
                      <label className="text-[11px] text-white/40">Study Design:</label>
                      <select value={pipelineDesign} onChange={(e) => setPipelineDesign(e.target.value as StudyDesign)}
                        className="px-3 py-1.5 rounded-lg text-[12px] text-white/80 outline-none appearance-none cursor-pointer"
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                        {STUDY_DESIGNS.map((d) => (
                          <option key={d.id} value={d.id} style={{ background: "#151520" }}>{d.label}</option>
                        ))}
                      </select>
                    </div>
                    <button onClick={handleRunPipeline}
                      disabled={!pipelineQuery.trim() || !params.api_key}
                      className="w-full py-2.5 rounded-xl text-[13px] font-semibold transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.25), rgba(34,211,238,0.25))", border: "1px solid rgba(16,185,129,0.3)", color: "#6ee7b7" }}>
                      <i className="fa-solid fa-play text-[10px] mr-2" />
                      Launch Research Pipeline
                    </button>
                  </div>
                </div>
              )}

              {/* Pipeline progress */}
              {(pipeline.active || pipeline.phase === "complete" || pipeline.phase === "error") && (
                <div className="max-w-2xl mx-auto">
                  {/* Query display */}
                  <div className="rounded-xl px-4 py-3 mb-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Research Query</div>
                    <div className="text-[13px] text-white/80">{pipeline.query}</div>
                    <div className="text-[10px] text-emerald-400/50 mt-1">
                      {STUDY_DESIGNS.find((d) => d.id === pipeline.studyDesign)?.label}
                    </div>
                  </div>

                  {/* Phase progress cards */}
                  <div className="space-y-1.5 mb-4">
                    {PIPELINE_PHASES.map((phase) => {
                      const phaseIdx = PIPELINE_PHASES.findIndex((p) => p.id === phase.id);
                      const currentIdx = PIPELINE_PHASES.findIndex((p) => p.id === pipeline.phase);
                      const isActive = phase.id === pipeline.phase;
                      const isDone = phaseIdx < currentIdx || pipeline.phase === "complete";
                      const isPending = phaseIdx > currentIdx && pipeline.phase !== "complete";

                      return (
                        <div key={phase.id}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
                            isActive ? "border" : "border border-transparent"
                          }`}
                          style={{
                            background: isActive ? "rgba(16,185,129,0.06)" : isDone ? "rgba(255,255,255,0.015)" : "transparent",
                            borderColor: isActive ? "rgba(16,185,129,0.2)" : "transparent",
                            opacity: isPending ? 0.35 : 1,
                          }}>
                          <div className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] flex-shrink-0 ${
                            isDone ? "bg-emerald-500/15 text-emerald-400" : isActive ? "bg-emerald-500/15 text-emerald-400 animate-pulse" : "bg-white/5 text-white/20"
                          }`}>
                            <i className={`fa-solid ${isDone ? "fa-check" : phase.icon}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-[11px] font-medium ${isDone ? "text-emerald-400/70" : isActive ? "text-white/80" : "text-white/30"}`}>
                              {phase.label}
                            </div>
                            <div className="text-[9px] text-white/20">{phase.desc}</div>
                          </div>
                          {isDone && <i className="fa-solid fa-circle-check text-emerald-400/50 text-[10px]" />}
                          {isActive && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />}
                        </div>
                      );
                    })}
                  </div>

                  {/* Status bar */}
                  <div className="rounded-xl px-4 py-3 mb-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] text-white/50">{pipeline.statusMessage || "Preparing..."}</span>
                      <span className="text-[11px] text-emerald-400/60 font-mono">{pipeline.progress}%</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                      <motion.div
                        className={`h-full rounded-full ${pipeline.phase === "error" ? "bg-red-500/60" : "bg-emerald-500/50"}`}
                        animate={{ width: `${pipeline.progress}%` }}
                        transition={{ duration: 0.5 }} />
                    </div>
                    {/* Token cost + log toggle */}
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-3 text-[10px]">
                        <span className="text-white/30">
                          <i className="fa-solid fa-coins text-[8px] mr-1 text-amber-400/40" />
                          {fmtCost(pipeline.totalTokens.cost)}
                        </span>
                        <span className="text-white/20">
                          <i className="fa-solid fa-arrow-down text-[7px] mr-0.5 text-cyan-400/30" />
                          {pipeline.totalTokens.input.toLocaleString()} in
                        </span>
                        <span className="text-white/20">
                          <i className="fa-solid fa-arrow-up text-[7px] mr-0.5 text-emerald-400/30" />
                          {pipeline.totalTokens.output.toLocaleString()} out
                        </span>
                      </div>
                      <button onClick={() => setShowLogs(!showLogs)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] text-white/35 hover:text-white/70 hover:bg-white/5 transition-colors cursor-pointer"
                        title="Toggle pipeline logs">
                        <i className={`fa-solid ${showLogs ? "fa-chevron-up" : "fa-terminal"} text-[8px]`} />
                        Logs{pipeline.logs.length > 0 && <span className="text-white/20 font-mono">({pipeline.logs.length})</span>}
                      </button>
                    </div>
                  </div>

                  {/* Pipeline Log Panel */}
                  <AnimatePresence>
                    {showLogs && pipeline.logs.length > 0 && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="rounded-xl mb-4 overflow-hidden"
                        style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.05)" }}>
                        <div className="flex items-center justify-between px-3 py-2 border-b border-white/4">
                          <div className="flex items-center gap-1.5">
                            <i className="fa-solid fa-terminal text-[9px] text-emerald-400/50" />
                            <span className="text-[10px] font-medium text-white/40">Pipeline Log</span>
                          </div>
                          <button onClick={() => {
                            const logText = pipeline.logs.map(l => `[${l.time}] [${l.phase}] [${l.level.toUpperCase()}] ${l.message}`).join("\n");
                            navigator.clipboard.writeText(logText);
                            showToast("Logs copied to clipboard");
                          }}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] text-white/25 hover:text-white/60 hover:bg-white/5 transition-colors cursor-pointer">
                            <i className="fa-solid fa-copy text-[7px]" /> Copy All
                          </button>
                        </div>
                        <div className="max-h-48 overflow-y-auto px-3 py-2 space-y-0.5 font-mono" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
                          {pipeline.logs.map((log, i) => (
                            <div key={i} className="flex items-start gap-2 text-[10px] leading-relaxed">
                              <span className="text-white/15 shrink-0 w-[52px]">{log.time}</span>
                              <span className={`shrink-0 w-[60px] truncate ${
                                log.level === "success" ? "text-emerald-400/60" :
                                log.level === "error" ? "text-red-400/70" :
                                log.level === "warn" ? "text-amber-400/60" :
                                "text-cyan-400/40"
                              }`}>{log.phase}</span>
                              <span className={`shrink-0 w-3 text-center ${
                                log.level === "success" ? "text-emerald-400/50" :
                                log.level === "error" ? "text-red-400/60" :
                                log.level === "warn" ? "text-amber-400/50" :
                                "text-white/15"
                              }`}>
                                <i className={`fa-solid ${
                                  log.level === "success" ? "fa-check" :
                                  log.level === "error" ? "fa-xmark" :
                                  log.level === "warn" ? "fa-exclamation" :
                                  "fa-circle"
                                } text-[7px]`} />
                              </span>
                              <span className={`flex-1 wrap-break-word ${
                                log.level === "success" ? "text-emerald-300/50" :
                                log.level === "error" ? "text-red-300/60" :
                                log.level === "warn" ? "text-amber-300/50" :
                                "text-white/40"
                              }`}>{log.message}</span>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Error display */}
                  {pipeline.phase === "error" && pipeline.error && (
                    <div className="rounded-xl px-4 py-3 mb-4" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
                      <div className="flex items-center gap-2 mb-1">
                        <i className="fa-solid fa-exclamation-triangle text-red-400/70 text-[11px]" />
                        <span className="text-[11px] font-medium text-red-400/80">Pipeline Error</span>
                      </div>
                      <p className="text-[12px] text-red-300/60">{pipeline.error}</p>
                    </div>
                  )}

                  {/* Results summary */}
                  {((pipeline.papers?.length ?? 0) > 0 || pipeline.manuscript) && (
                    <div className="space-y-3">
                      {/* Papers found */}
                      {(pipeline.papers?.length ?? 0) > 0 && (
                        <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                          <div className="flex items-center gap-2 mb-2">
                            <i className="fa-solid fa-book text-cyan-400/60 text-[11px]" />
                            <span className="text-[11px] font-medium text-white/60">
                              Papers: {pipeline.papers?.length ?? 0} found → {pipeline.relevantPapers?.length ?? 0} relevant → {pipeline.acquiredPdfs?.length ?? 0} acquired
                            </span>
                          </div>
                          <div className="space-y-1 max-h-52 overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
                            {(pipeline.relevantPapers ?? []).slice(0, 20).map((p, i) => {
                              const isAcquired = (pipeline.acquiredPdfs ?? []).some(a => a.doi === p.doi);
                              return (
                                <div key={i} className="flex items-start gap-1.5 text-[11px] text-white/50 pl-2 border-l-2 transition-colors"
                                  style={{ borderColor: isAcquired ? "rgba(16,185,129,0.3)" : p.doi ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.04)" }}>
                                  <i className={`fa-solid ${isAcquired ? "fa-file-pdf text-emerald-400/50" : p.doi ? "fa-circle-xmark text-red-400/30" : "fa-minus text-white/15"} text-[8px] mt-[3px] flex-shrink-0`} />
                                  <span className="truncate flex-1">{p.title}</span>
                                  <span className="text-white/20 flex-shrink-0">({p.year})</span>
                                </div>
                              );
                            })}
                          </div>
                          {(pipeline.relevantPapers?.length ?? 0) > 20 && (
                            <div className="text-[9px] text-white/20 mt-1 pl-2">+{(pipeline.relevantPapers?.length ?? 0) - 20} more papers</div>
                          )}
                        </div>
                      )}

                      {/* Generated Figures & Tables */}
                      {((pipeline.generatedFigures?.length ?? 0) > 0 || (pipeline.generatedTables?.length ?? 0) > 0) && (
                        <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                          <div className="flex items-center gap-2 mb-3">
                            <i className="fa-solid fa-chart-bar text-amber-400/60 text-[11px]" />
                            <span className="text-[11px] font-medium text-white/60">
                              Generated Assets: {pipeline.generatedFigures?.length ?? 0} figures, {pipeline.generatedTables?.length ?? 0} tables
                            </span>
                          </div>
                          {/* Figures grid */}
                          {(pipeline.generatedFigures?.length ?? 0) > 0 && (
                            <div className="grid grid-cols-2 gap-2 mb-2">
                              {(pipeline.generatedFigures ?? []).map((fig, i) => (
                                <div key={i} className="rounded-lg overflow-hidden" style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.04)" }}>
                                  <div className="px-2 py-1.5" style={{ background: "rgba(255,255,255,0.03)" }}>
                                    <div className="text-[10px] text-amber-400/60 font-medium">Figure {fig.index || i + 1}</div>
                                    <div className="text-[9px] text-white/40 truncate">{fig.caption || fig.description}</div>
                                  </div>
                                  <div className="px-2 py-1 flex items-center gap-2">
                                    <i className={`fa-solid ${fig.chart_type === "pie" ? "fa-chart-pie" : fig.chart_type === "line" ? "fa-chart-line" : fig.chart_type === "scatter" ? "fa-braille" : "fa-chart-bar"} text-[14px] text-cyan-400/40`} />
                                    <div className="flex-1">
                                      <div className="text-[9px] text-white/30">{fig.chart_type} chart</div>
                                      <div className="text-[8px] text-white/15">{((fig.size || 0) / 1024).toFixed(0)} KB</div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Tables list */}
                          {(pipeline.generatedTables?.length ?? 0) > 0 && (
                            <div className="space-y-1">
                              {(pipeline.generatedTables ?? []).map((tbl, i) => (
                                <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.02)" }}>
                                  <i className="fa-solid fa-table text-[10px] text-emerald-400/40" />
                                  <span className="text-[10px] text-white/50 flex-1 truncate">Table {tbl.index || i + 1}: {tbl.caption || tbl.description}</span>
                                  <span className="text-[8px] text-white/20">{((tbl.size || 0) / 1024).toFixed(0)} KB</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Manuscript preview */}
                      {pipeline.manuscript && (
                        <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <i className="fa-solid fa-file-lines text-emerald-400/60 text-[11px]" />
                              <span className="text-[11px] font-medium text-white/60">Manuscript Draft</span>
                            </div>
                            <button onClick={() => { navigator.clipboard.writeText(pipeline.manuscript); showToast("Manuscript copied!"); }}
                              className="text-[10px] text-cyan-400/50 hover:text-cyan-400 transition-colors cursor-pointer">
                              <i className="fa-solid fa-copy mr-1" />Copy
                            </button>
                          </div>
                          <div className="select-text max-h-[500px] overflow-y-auto text-[12px] text-white/60 leading-relaxed whitespace-pre-wrap" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
                            {pipeline.manuscript}
                          </div>
                          <div className="text-[9px] text-white/20 mt-2 pt-2 border-t border-white/4">
                            {pipeline.manuscript.length.toLocaleString()} characters
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Controls */}
                  <div className="flex items-center gap-2 mt-4">
                    {pipeline.active ? (
                      <button onClick={handleCancelPipeline}
                        className="px-4 py-2 rounded-xl text-[12px] font-medium text-red-400/70 hover:text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-all cursor-pointer"
                        title="Stop Research">
                        <i className="fa-solid fa-stop text-[10px] mr-1.5" />Stop Research
                      </button>
                    ) : pipeline.phase === "error" || pipeline.phase === "complete" ? (
                      <button onClick={handleRunPipeline}
                        className="px-4 py-2 rounded-xl text-[12px] font-medium text-cyan-400 hover:text-cyan-300 hover:bg-cyan-400/10 border border-cyan-400/30 transition-all cursor-pointer"
                        title="Retry Research">
                        <i className="fa-solid fa-rotate-right text-[10px] mr-1.5" />Retry
                      </button>
                    ) : null}
                    {(pipeline.phase === "complete" || pipeline.phase === "error") && (
                      <>
                        <button onClick={() => { setViewMode("chat"); }}
                          className="px-4 py-2 rounded-xl text-[12px] font-medium transition-colors cursor-pointer"
                          style={{ background: "rgba(34,211,238,0.12)", border: "1px solid rgba(34,211,238,0.25)", color: "#67e8f9" }}>
                          <i className="fa-solid fa-comments text-[9px] mr-1.5" /> Chat About Results
                        </button>
                        <button onClick={() => setShowExportMenu(true)}
                          className="px-4 py-2 rounded-xl text-[12px] font-medium text-emerald-400/70 hover:text-emerald-400 transition-colors cursor-pointer"
                          style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.15)" }}>
                          <i className="fa-solid fa-download text-[9px] mr-1.5" /> Export
                        </button>
                        <button onClick={() => resetPipeline()}
                          className="px-4 py-2 rounded-xl text-[12px] font-medium text-white/50 hover:text-white/80 transition-colors cursor-pointer"
                          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                          <i className="fa-solid fa-rotate-right text-[9px] mr-1.5" /> New Pipeline
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ═══ CHAT MODE ═══ */}
            <div className={`flex-1 flex flex-col min-h-0 ${viewMode !== "chat" ? "hidden" : ""}`}>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4"
                style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>

                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center gap-4 opacity-40">
                    <i className="fa-solid fa-microscope text-5xl text-cyan-400/30" />
                    <div>
                      <div className="text-lg font-medium text-white/50 mb-1">Zenith Research v5.6</div>
                      <div className="text-[13px] text-white/30 max-w-md">
                        Ask questions, search PubMed, download papers via Sci-Hub, verify citations,
                        or switch to Pipeline mode for autonomous systematic reviews.
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center max-w-lg mt-2">
                      {["Search PubMed for recent CRISPR therapy trials",
                        "Download and analyze DOI 10.1038/s41586-024-07386-0",
                        "Check the novelty of my idea about mRNA delivery",
                        "Generate a related work section on transformer architectures",
                      ].map((q) => (
                        <button key={q} onClick={() => { setInputText(q); inputRef.current?.focus(); }}
                          className="px-3 py-1.5 rounded-lg text-[11px] text-white/40 hover:text-white/70 transition-colors cursor-pointer"
                          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg) => (
                  <MessageBubble key={msg.id} msg={msg}
                    onCopy={() => handleCopyMessage(msg.content)}
                    onRetry={msg.role === "assistant" || msg.role === "tool" ? handleRetry : undefined}
                    onEditRetry={msg.role === "user" ? () => handleEditRetry(msg.id) : undefined}
                    isGenerating={isGenerating}
                  />
                ))}

                {isGenerating && (
                  <div className="flex items-start gap-3 max-w-3xl">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: "rgba(34,211,238,0.12)" }}>
                      <i className="fa-solid fa-microscope text-[11px] text-cyan-400 animate-pulse" />
                    </div>
                    <div className="px-4 py-3 rounded-xl"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="flex gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                        <span className="text-[12px] text-white/40">Researching...</span>
                      </div>
                      <div className="text-[10px] text-white/20 leading-relaxed">
                        Analyzing query → dispatching {params.enabled_tools.length} tools ({params.enabled_tools.map(t =>
                          RESEARCH_TOOLS.find(rt => rt.id === t)?.label || t
                        ).join(", ")}) → synthesizing
                      </div>
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>

              {/* ── INPUT BAR ── */}
              <div className="px-4 py-3 border-t border-white/6 select-none"
                style={{ background: "rgba(12,12,22,0.8)" }}>
                {attachedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2 max-w-4xl mx-auto">
                    {attachedFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px]"
                        style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.15)" }}>
                        <i className="fa-solid fa-paperclip text-[9px] text-cyan-400/60" />
                        <span className="text-white/60 max-w-[120px] truncate">{f.name}</span>
                        <button onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                          className="w-4 h-4 rounded flex items-center justify-center text-white/30 hover:text-red-400 transition-colors cursor-pointer">
                          <i className="fa-solid fa-xmark text-[8px]" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2 max-w-4xl mx-auto">
                  <input ref={fileInputRef} type="file" multiple className="hidden"
                    onChange={(e) => {
                      const files = e.target.files;
                      if (files) {
                        const newFiles = Array.from(files).map((f) => ({ name: f.name, path: (f as unknown as { path?: string }).path || f.name }));
                        setAttachedFiles((prev) => [...prev, ...newFiles].slice(0, 10));
                      }
                      e.target.value = "";
                    }} />
                  <div className="flex rounded-xl overflow-hidden flex-shrink-0"
                    style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                    <button onClick={() => fileInputRef.current?.click()}
                      className="w-10 h-10 flex items-center justify-center transition-all hover:bg-white/[0.06] cursor-pointer"
                      style={{ background: "rgba(255,255,255,0.03)" }}
                      title="Attach files">
                      <i className="fa-solid fa-paperclip text-[12px] text-white/30 hover:text-white/60" />
                    </button>
                    <div className="w-px bg-white/[0.06]" />
                    <div className="relative">
                      <button onClick={() => setShowToolsMenu(!showToolsMenu)}
                        className="w-10 h-10 flex items-center justify-center transition-all hover:bg-white/[0.06] cursor-pointer"
                        style={{ background: "rgba(255,255,255,0.03)" }}
                        title="Quick commands">
                        <i className="fa-solid fa-wrench text-[12px] text-white/30 hover:text-white/60" />
                      </button>
                      <AnimatePresence>
                        {showToolsMenu && (
                          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                            className="absolute bottom-full mb-1 left-0 z-50 rounded-xl overflow-hidden shadow-2xl"
                            style={{ background: "rgba(20,20,35,0.95)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(20px)", minWidth: 220 }}>
                            {[
                              { label: "PubMed Search", icon: "fa-hospital", cmd: "Search PubMed for: " },
                              { label: "Search Papers", icon: "fa-book", cmd: "Search for papers on: " },
                              { label: "Download Paper", icon: "fa-unlock-keyhole", cmd: "Download paper with DOI: " },
                              { label: "Check Novelty", icon: "fa-lightbulb", cmd: "Check the novelty of this idea: " },
                              { label: "Verify Citations", icon: "fa-check-double", cmd: "Verify these citations: " },
                              { label: "Generate Section", icon: "fa-pen-nib", cmd: "Generate a related work section about: " },
                              { label: "Web Search", icon: "fa-globe", cmd: "Search the web for: " },
                              { label: "Run Experiment", icon: "fa-flask", cmd: "Run this Python experiment:\n```python\n\n```" },
                            ].map((t) => (
                              <button key={t.label} onClick={() => { setInputText(t.cmd); setShowToolsMenu(false); inputRef.current?.focus(); }}
                                className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-white/70 hover:text-white hover:bg-white/5 transition-colors cursor-pointer">
                                <i className={`fa-solid ${t.icon} text-[10px] w-4 text-center text-cyan-400/50`} />
                                {t.label}
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                  <div className="flex-1 rounded-xl overflow-hidden"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <textarea ref={inputRef} value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Ask a research question..."
                      rows={1}
                      className="w-full bg-transparent text-[13px] text-white/90 placeholder:text-white/25 outline-none resize-none px-4 py-3"
                      style={{ minHeight: 44, maxHeight: 160 }}
                      onInput={(e) => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 160) + "px"; }}
                    />
                  </div>
                  <button onClick={handleSend}
                    disabled={!inputText.trim() || isGenerating}
                    className="w-10 h-10 rounded-xl flex items-center justify-center transition-all flex-shrink-0 disabled:opacity-30 cursor-pointer"
                    style={{ background: inputText.trim() && !isGenerating ? "rgba(34,211,238,0.2)" : "rgba(255,255,255,0.03)", border: `1px solid ${inputText.trim() && !isGenerating ? "rgba(34,211,238,0.4)" : "rgba(255,255,255,0.06)"}` }}>
                    <i className={`fa-solid fa-paper-plane text-[12px] ${inputText.trim() && !isGenerating ? "text-cyan-400" : "text-white/20"}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-1.5 max-w-4xl mx-auto px-1">
                  <div className="flex items-center gap-1.5 text-[9px]">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.03] text-white/25 border border-white/[0.04]">
                      <i className="fa-solid fa-microchip text-[7px] text-cyan-400/40" />{params.model || "no model"}
                    </span>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.03] text-white/25 border border-white/[0.04]">
                      T={params.temperature}
                    </span>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.03] text-white/25 border border-white/[0.04]">
                      <i className="fa-solid fa-wrench text-[7px] text-violet-400/40" />{params.enabled_tools.length} tools
                    </span>
                  </div>
                  <span className="text-[9px] text-white/15">Shift+Enter for new line</span>
                </div>
              </div>
            </div>
        </div>

        {/* ══ RIGHT PANEL — PARAMETERS ══ */}
        <AnimatePresence initial={false}>
          {!rightCollapsed && (
            <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 270, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col border-l border-white/[0.06] overflow-y-auto select-none"
              style={{ background: "rgba(10,10,18,0.6)", minWidth: 0, scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>

              {/* Model Config */}
              <div className="p-3 border-b border-white/[0.04]">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <div className="w-4 h-4 rounded flex items-center justify-center" style={{ background: "rgba(34,211,238,0.12)" }}>
                    <i className="fa-solid fa-microchip text-[7px] text-cyan-400" />
                  </div>
                  <span className="text-[10px] font-semibold text-white/35 uppercase tracking-wider">Model</span>
                </div>

                <label className="text-[11px] text-white/40 mb-1 block">Provider</label>
                <select value={params.provider} onChange={(e) => handleProviderChange(e.target.value)}
                  className="w-full mb-2.5 px-2.5 py-1.5 rounded-lg text-[12px] text-white/80 outline-none appearance-none cursor-pointer"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <option value="">Select provider</option>
                  {availableProviders.map((p) => (
                    <option key={p} value={p} style={{ background: "#151520" }}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>

                <label className="text-[11px] text-white/40 mb-1 block">Model</label>
                <select value={params.model} onChange={(e) => setParams({ model: e.target.value })}
                  className="w-full mb-2.5 px-2.5 py-1.5 rounded-lg text-[12px] text-white/80 outline-none appearance-none cursor-pointer"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  {modelsForProvider.map((m) => (
                    <option key={m.id} value={m.id} style={{ background: "#151520" }}>{m.label}</option>
                  ))}
                </select>

                <label className="text-[11px] text-white/40 mb-1 flex justify-between">
                  <span>Temperature</span>
                  <span className="text-white/60 font-mono">{params.temperature.toFixed(1)}</span>
                </label>
                <input type="range" min={0} max={2} step={0.1} value={params.temperature}
                  onChange={(e) => setParams({ temperature: parseFloat(e.target.value) })}
                  className="w-full mb-2.5 accent-cyan-400 h-1" />

                <label className="text-[11px] text-white/40 mb-1 flex justify-between">
                  <span>Max Tokens</span>
                  <span className="text-white/60 font-mono">{params.max_tokens >= 1000 ? `${(params.max_tokens / 1000).toFixed(params.max_tokens % 1000 === 0 ? 0 : 1)}k` : params.max_tokens}</span>
                </label>
                <input type="range" min={1024} max={128000} step={1024} value={params.max_tokens}
                  onChange={(e) => setParams({ max_tokens: parseInt(e.target.value) })}
                  className="w-full mb-1 accent-cyan-400 h-1" />
              </div>

              {/* Research Tools */}
              <div className="p-3 border-b border-white/[0.04]">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <div className="w-4 h-4 rounded flex items-center justify-center" style={{ background: "rgba(167,139,250,0.12)" }}>
                    <i className="fa-solid fa-toolbox text-[7px] text-violet-400" />
                  </div>
                  <span className="text-[10px] font-semibold text-white/35 uppercase tracking-wider">Tools</span>
                  <span className="text-[8px] text-cyan-400/40 font-mono ml-auto">{params.enabled_tools.length}/{RESEARCH_TOOLS.length}</span>
                </div>

                {/* Primary tools */}
                <div className="text-[9px] text-emerald-400/40 uppercase tracking-wider mb-1.5 px-1">Primary (v5.6)</div>
                <div className="space-y-1 mb-2.5">
                  {RESEARCH_TOOLS.filter(t => t.group === "primary").map((tool) => {
                    const enabled = params.enabled_tools.includes(tool.id);
                    return (
                      <button key={tool.id}
                        onClick={() => {
                          const tools = enabled
                            ? params.enabled_tools.filter((t) => t !== tool.id)
                            : [...params.enabled_tools, tool.id];
                          setParams({ enabled_tools: tools });
                        }}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-all cursor-pointer ${
                          enabled ? "bg-emerald-500/8 border border-emerald-500/15" : "hover:bg-white/[0.02] border border-transparent"
                        }`}>
                        <div className={`w-5 h-5 rounded flex items-center justify-center text-[9px] ${
                          enabled ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-white/25"
                        }`}>
                          <i className={`fa-solid ${tool.icon}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={`text-[10px] font-medium ${enabled ? "text-white/80" : "text-white/40"}`}>{tool.label}</div>
                          <div className="text-[8px] text-white/20 truncate">{tool.desc}</div>
                        </div>
                        <div className={`w-3 h-3 rounded border flex items-center justify-center ${
                          enabled ? "bg-emerald-500/20 border-emerald-500/40" : "border-white/15"
                        }`}>
                          {enabled && <i className="fa-solid fa-check text-[6px] text-emerald-400" />}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Auxiliary tools */}
                <div className="text-[9px] text-violet-400/40 uppercase tracking-wider mb-1.5 px-1">Auxiliary</div>
                <div className="space-y-1">
                  {RESEARCH_TOOLS.filter(t => t.group === "auxiliary").map((tool) => {
                    const enabled = params.enabled_tools.includes(tool.id);
                    return (
                      <button key={tool.id}
                        onClick={() => {
                          const tools = enabled
                            ? params.enabled_tools.filter((t) => t !== tool.id)
                            : [...params.enabled_tools, tool.id];
                          setParams({ enabled_tools: tools });
                        }}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-all cursor-pointer ${
                          enabled ? "bg-cyan-500/8 border border-cyan-500/15" : "hover:bg-white/[0.02] border border-transparent"
                        }`}>
                        <div className={`w-5 h-5 rounded flex items-center justify-center text-[9px] ${
                          enabled ? "bg-cyan-500/15 text-cyan-400" : "bg-white/5 text-white/25"
                        }`}>
                          <i className={`fa-solid ${tool.icon}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={`text-[10px] font-medium ${enabled ? "text-white/80" : "text-white/40"}`}>{tool.label}</div>
                          <div className="text-[8px] text-white/20 truncate">{tool.desc}</div>
                        </div>
                        <div className={`w-3 h-3 rounded border flex items-center justify-center ${
                          enabled ? "bg-cyan-500/20 border-cyan-500/40" : "border-white/15"
                        }`}>
                          {enabled && <i className="fa-solid fa-check text-[6px] text-cyan-400" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Export Format */}
              <div className="p-3 border-b border-white/[0.04]">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <div className="w-4 h-4 rounded flex items-center justify-center" style={{ background: "rgba(16,185,129,0.12)" }}>
                    <i className="fa-solid fa-file-export text-[7px] text-emerald-400" />
                  </div>
                  <span className="text-[10px] font-semibold text-white/35 uppercase tracking-wider">Export</span>
                </div>
                <div className="space-y-1">
                  {EXPORT_FORMATS.map((f) => (
                    <button key={f.id}
                      onClick={() => setParams({ export_format: f.id as typeof params.export_format })}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] transition-all cursor-pointer ${
                        params.export_format === f.id
                          ? "bg-cyan-500/10 text-white/80 border border-cyan-500/20"
                          : "text-white/40 hover:text-white/60 hover:bg-white/[0.02] border border-transparent"
                      }`}>
                      <i className={`fa-solid ${f.icon} text-[10px] w-4 text-center`} />
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* System Prompt */}
              <div className="p-3 border-b border-white/[0.04]">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="w-4 h-4 rounded flex items-center justify-center" style={{ background: "rgba(245,158,11,0.12)" }}>
                    <i className="fa-solid fa-terminal text-[7px] text-amber-400" />
                  </div>
                  <span className="text-[10px] font-semibold text-white/35 uppercase tracking-wider">System Prompt</span>
                </div>
                <p className="text-[10px] text-white/25 leading-relaxed">
                  <i className="fa-solid fa-gear text-[8px] mr-1 text-white/15" />
                  Managed in <span className="text-cyan-400/50">Settings &rarr; AI Prompts &rarr; Research</span>
                </p>
              </div>

              {/* Pipeline Step Config */}
              <div className="p-3">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <div className="w-4 h-4 rounded flex items-center justify-center" style={{ background: "rgba(251,113,133,0.12)" }}>
                    <i className="fa-solid fa-sliders text-[7px] text-rose-400" />
                  </div>
                  <span className="text-[10px] font-semibold text-white/35 uppercase tracking-wider">Pipeline Agents</span>
                </div>
                <div className="space-y-1">
                  {([
                    { key: "gatekeeper", label: "Gatekeeper", icon: "fa-shield-halved", color: "cyan" },
                    { key: "query_architect", label: "Query Architect", icon: "fa-diagram-project", color: "cyan" },
                    { key: "triage_agent", label: "Triage Agent", icon: "fa-filter", color: "amber" },
                    { key: "blueprint_agent", label: "Blueprint Agent", icon: "fa-sitemap", color: "violet" },
                    { key: "lead_author", label: "Lead Author", icon: "fa-pen-nib", color: "emerald" },
                    { key: "citation_verifier", label: "Citation Verifier", icon: "fa-check-double", color: "rose" },
                    { key: "guidelines_compliance", label: "Guidelines Check", icon: "fa-clipboard-check", color: "amber" },
                    { key: "smoothing_pass", label: "Smoothing Pass", icon: "fa-wand-magic-sparkles", color: "violet" },
                  ] as { key: keyof PipelineConfig; label: string; icon: string; color: string }[]).map((step) => {
                    const isExpanded = expandedPipelineStep === step.key;
                    const cfg = settings?.pipeline_config?.[step.key];
                    return (
                      <div key={step.key}>
                        <button
                          onClick={() => setExpandedPipelineStep(isExpanded ? null : step.key)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-all cursor-pointer hover:bg-white/[0.02]"
                        >
                          <i className={`fa-solid ${step.icon} text-[8px] text-${step.color}-400/60 w-3 text-center`} />
                          <span className="text-[10px] text-white/50 flex-1">{step.label}</span>
                          <span className="text-[8px] text-white/20 font-mono">{cfg?.model_tier === "fast" ? "⚡" : "🧠"}</span>
                          <i className={`fa-solid fa-chevron-${isExpanded ? "up" : "down"} text-[7px] text-white/20`} />
                        </button>
                        {isExpanded && cfg && (
                          <div className="ml-5 mt-1 mb-2 space-y-2 p-2 rounded-lg" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                            <div className="flex items-center gap-2">
                              <label className="text-[9px] text-white/30 w-12">Tier</label>
                              <select
                                value={cfg.model_tier}
                                onChange={async (e) => {
                                  const newCfg = { ...cfg, model_tier: e.target.value as "strong" | "fast" };
                                  const newPc = { ...settings?.pipeline_config, [step.key]: newCfg };
                                  const newSettings = { ...settings, pipeline_config: newPc };
                                  await invoke("save_settings", { newSettings });
                                  setSettings(newSettings as ZenithSettings);
                                }}
                                className="flex-1 px-2 py-1 rounded text-[10px] text-white/70 outline-none appearance-none cursor-pointer"
                                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
                              >
                                <option value="strong" style={{ background: "#151520" }}>🧠 Strong (Pro)</option>
                                <option value="fast" style={{ background: "#151520" }}>⚡ Fast (Flash)</option>
                              </select>
                            </div>
                            <div className="flex items-center gap-2">
                              <label className="text-[9px] text-white/30 w-12">Tokens</label>
                              <input
                                type="number"
                                value={cfg.max_tokens}
                                onChange={async (e) => {
                                  const newCfg = { ...cfg, max_tokens: parseInt(e.target.value) || 8192 };
                                  const newPc = { ...settings?.pipeline_config, [step.key]: newCfg };
                                  const newSettings = { ...settings, pipeline_config: newPc };
                                  await invoke("save_settings", { newSettings });
                                  setSettings(newSettings as ZenithSettings);
                                }}
                                className="flex-1 px-2 py-1 rounded text-[10px] text-white/70 outline-none font-mono"
                                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <label className="text-[9px] text-white/30 w-12">Temp</label>
                              <input
                                type="range" min={0} max={2} step={0.1}
                                value={cfg.temperature}
                                onChange={async (e) => {
                                  const newCfg = { ...cfg, temperature: parseFloat(e.target.value) };
                                  const newPc = { ...settings?.pipeline_config, [step.key]: newCfg };
                                  const newSettings = { ...settings, pipeline_config: newPc };
                                  await invoke("save_settings", { newSettings });
                                  setSettings(newSettings as ZenithSettings);
                                }}
                                className="flex-1 accent-cyan-400 h-1"
                              />
                              <span className="text-[9px] text-white/40 font-mono w-6 text-right">{cfg.temperature.toFixed(1)}</span>
                            </div>
                            <div className="mt-3 pt-3 border-t border-white/10 flex gap-4">
                              <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
                                <input
                                  type="checkbox" checked={cfg.use_thinking}
                                  onChange={async (e) => {
                                    const newCfg = { ...cfg, use_thinking: e.target.checked };
                                    const newPc = { ...settings?.pipeline_config, [step.key]: newCfg };
                                    const newSettings = { ...settings, pipeline_config: newPc };
                                    await invoke("save_settings", { newSettings });
                                    setSettings(newSettings as ZenithSettings);
                                  }}
                                  className="rounded border-white/20 bg-white/5"
                                />
                                Use Thinking
                              </label>
                              {cfg.use_thinking && (
                                <label className="flex items-center gap-2 text-xs text-white/70">
                                  Budget:
                                  <input
                                    type="number"
                                    className="w-16 bg-white/5 border border-white/10 rounded px-1 py-0.5 text-white/90 text-xs"
                                    value={cfg.thinking_budget}
                                    onChange={async (e) => {
                                      const newCfg = { ...cfg, thinking_budget: parseInt(e.target.value) || 8192 };
                                      const newPc = { ...settings?.pipeline_config, [step.key]: newCfg };
                                      const newSettings = { ...settings, pipeline_config: newPc };
                                      await invoke("save_settings", { newSettings });
                                      setSettings(newSettings as ZenithSettings);
                                    }}
                                  />
                                </label>
                              )}
                              <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
                                <input
                                  type="checkbox" checked={cfg.use_structured_output}
                                  onChange={async (e) => {
                                    const newCfg = { ...cfg, use_structured_output: e.target.checked };
                                    const newPc = { ...settings?.pipeline_config, [step.key]: newCfg };
                                    const newSettings = { ...settings, pipeline_config: newPc };
                                    await invoke("save_settings", { newSettings });
                                    setSettings(newSettings as ZenithSettings);
                                  }}
                                  className="accent-cyan-400 w-3 h-3"
                                />
                                <span className="text-[9px] text-white/40">Structured</span>
                              </label>
                              <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
                                <input
                                  type="checkbox" checked={cfg.use_google_search}
                                  onChange={async (e) => {
                                    const newCfg = { ...cfg, use_google_search: e.target.checked };
                                    const newPc = { ...settings?.pipeline_config, [step.key]: newCfg };
                                    const newSettings = { ...settings, pipeline_config: newPc };
                                    await invoke("save_settings", { newSettings });
                                    setSettings(newSettings as ZenithSettings);
                                  }}
                                  className="accent-emerald-400 w-3 h-3"
                                />
                                <span className="text-[9px] text-white/40">Google Search Grounding</span>
                              </label>
                              <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
                                <input
                                  type="checkbox" checked={cfg.use_code_execution}
                                  onChange={async (e) => {
                                    const newCfg = { ...cfg, use_code_execution: e.target.checked };
                                    const newPc = { ...settings?.pipeline_config, [step.key]: newCfg };
                                    const newSettings = { ...settings, pipeline_config: newPc };
                                    await invoke("save_settings", { newSettings });
                                    setSettings(newSettings as ZenithSettings);
                                  }}
                                  className="accent-violet-400 w-3 h-3"
                                />
                                <span className="text-[9px] text-white/40">Code Exec</span>
                              </label>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-[9px] text-white/15 mt-2 px-1">
                  <i className="fa-solid fa-info-circle text-[7px] mr-1" />
                  Per-step prompts editable in Settings → Pipeline
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── CAPTCHA DIALOG ── */}
      <AnimatePresence>
        {captchaDialog.show && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="rounded-2xl p-6 max-w-sm w-full mx-4 space-y-4"
              style={{ background: "rgba(20,20,35,0.97)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-shield-halved text-amber-400 text-sm" />
                <span className="text-[13px] font-medium text-white/80">Sci-Hub CAPTCHA Required</span>
              </div>
              <p className="text-[11px] text-white/50">
                Sci-Hub requires a CAPTCHA to download &quot;{captchaDialog.doi.slice(0, 30)}&quot;. Please solve it below.
              </p>
              {captchaDialog.imgB64 && (
                <div className="flex justify-center rounded-lg p-2" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <img src={`data:image/png;base64,${captchaDialog.imgB64}`} alt="CAPTCHA" className="max-w-full h-auto rounded" />
                </div>
              )}
              <input type="text" value={captchaSolution} onChange={(e) => setCaptchaSolution(e.target.value)}
                placeholder="Enter CAPTCHA text..."
                onKeyDown={(e) => { if (e.key === "Enter" && captchaSolution.trim() && captchaDialog.resolve) { captchaDialog.resolve(captchaSolution.trim()); } }}
                className="w-full px-3 py-2 rounded-xl text-[13px] text-white/90 placeholder-white/30 outline-none"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                autoFocus />
              <div className="flex gap-2">
                <button onClick={() => { if (captchaDialog.resolve) captchaDialog.resolve(""); }}
                  className="flex-1 px-3 py-2 rounded-xl text-[12px] text-white/50 hover:text-white/70 transition-colors cursor-pointer"
                  style={{ background: "rgba(255,255,255,0.04)" }}>
                  Skip
                </button>
                <button onClick={() => { if (captchaSolution.trim() && captchaDialog.resolve) captchaDialog.resolve(captchaSolution.trim()); }}
                  className="flex-1 px-3 py-2 rounded-xl text-[12px] text-white font-medium transition-colors cursor-pointer"
                  style={{ background: "rgba(34,211,238,0.15)", border: "1px solid rgba(34,211,238,0.3)" }}>
                  Submit
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── TOAST ── */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-[12px] text-white/80 shadow-2xl z-50"
            style={{ background: "rgba(20,20,35,0.95)", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(20px)" }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ██  LIGHTWEIGHT MARKDOWN RENDERER
// ══════════════════════════════════════════════════════════════════════════════

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Headers
    const headerMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const sizes = ["text-[16px]", "text-[15px]", "text-[14px]", "text-[13px]"];
      elements.push(
        <div key={i} className={`${sizes[level - 1]} font-semibold text-white/90 mt-2 mb-1`}>
          {renderInline(headerMatch[2])}
        </div>
      );
      i++;
      continue;
    }

    // Code blocks
    if (line.trimStart().startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      elements.push(
        <pre key={`code-${i}`} className="rounded-lg px-3 py-2 my-1.5 text-[11px] font-mono text-green-300/80 overflow-x-auto"
          style={{ background: "rgba(0,0,0,0.3)" }}>
          {codeLines.join("\n")}
        </pre>
      );
      continue;
    }

    // Unordered list items
    const ulMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (ulMatch) {
      const indent = Math.floor(ulMatch[1].length / 2);
      elements.push(
        <div key={i} className="flex items-start gap-1.5" style={{ paddingLeft: `${indent * 12}px` }}>
          <span className="text-cyan-400/50 mt-[3px] text-[8px]">●</span>
          <span>{renderInline(ulMatch[2])}</span>
        </div>
      );
      i++;
      continue;
    }

    // Ordered list items
    const olMatch = line.match(/^(\s*)\d+[.)]\s+(.+)$/);
    if (olMatch) {
      const indent = Math.floor(olMatch[1].length / 2);
      const num = line.match(/^(\s*)(\d+)/)?.[2] || "1";
      elements.push(
        <div key={i} className="flex items-start gap-1.5" style={{ paddingLeft: `${indent * 12}px` }}>
          <span className="text-cyan-400/50 text-[11px] font-mono min-w-[16px]">{num}.</span>
          <span>{renderInline(olMatch[2])}</span>
        </div>
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      elements.push(<hr key={i} className="border-white/[0.06] my-2" />);
      i++;
      continue;
    }

    // Blockquote
    const bqMatch = line.match(/^>\s?(.*)$/);
    if (bqMatch) {
      elements.push(
        <div key={i} className="border-l-2 border-cyan-400/30 pl-3 text-white/60 italic my-1">
          {renderInline(bqMatch[1])}
        </div>
      );
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(<div key={i}>{renderInline(line)}</div>);
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(\[(.+?)\]\((.+?)\))|(https?:\/\/[^\s\])<>]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      parts.push(<strong key={match.index} className="font-semibold text-white/95">{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={match.index} className="italic text-white/70">{match[4]}</em>);
    } else if (match[5]) {
      parts.push(
        <code key={match.index} className="px-1 py-0.5 rounded bg-white/[0.06] text-cyan-300/80 text-[11px] font-mono">
          {match[6]}
        </code>
      );
    } else if (match[7]) {
      parts.push(
        <a key={match.index} href={match[9]} target="_blank" rel="noopener noreferrer"
          className="text-cyan-400/80 underline underline-offset-2 hover:text-cyan-300 transition-colors">
          {match[8]}
        </a>
      );
    } else if (match[10]) {
      let url = match[10].replace(/[.,;:!?)]+$/, "");
      const consumed = url.length;
      parts.push(
        <a key={match.index} href={url} target="_blank" rel="noopener noreferrer"
          className="text-cyan-400/80 underline underline-offset-2 hover:text-cyan-300 transition-colors break-all">
          {url.length > 60 ? url.slice(0, 55) + "..." : url}
        </a>
      );
      lastIndex = match.index + consumed;
      continue;
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : <>{parts}</>;
}

// ══════════════════════════════════════════════════════════════════════════════
// ██  MESSAGE BUBBLE COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

function MessageBubble({ msg, onCopy, onRetry, onEditRetry, isGenerating }: {
  msg: ResearchMessage;
  onCopy: () => void;
  onRetry?: () => void;
  onEditRetry?: () => void;
  isGenerating: boolean;
}) {
  const isUser = msg.role === "user";
  const isError = msg.type === "error";
  const isTool = msg.role === "tool";

  return (
    <div className={`group flex items-start gap-3 ${isUser ? "flex-row-reverse max-w-3xl ml-auto" : "max-w-3xl"}`}>
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
        isUser ? "bg-violet-500/15" : isTool ? "bg-amber-500/12" : isError ? "bg-red-500/12" : "bg-cyan-500/12"
      }`}>
        <i className={`fa-solid ${
          isUser ? "fa-user" : isTool ? "fa-wrench" : isError ? "fa-exclamation-triangle" : "fa-microscope"
        } text-[11px] ${
          isUser ? "text-violet-400" : isTool ? "text-amber-400" : isError ? "text-red-400" : "text-cyan-400"
        }`} />
      </div>

      <div className={`flex-1 min-w-0 ${isUser ? "text-right" : ""}`}>
        <div className="flex items-center gap-2 mb-1 select-none">
          <span className={`text-[10px] font-medium ${
            isUser ? "text-violet-400/60 ml-auto" : isTool ? "text-amber-400/60" : isError ? "text-red-400/60" : "text-cyan-400/60"
          }`}>
            {isUser ? "You" : isTool ? `Tool: ${msg.tool_used || "unknown"}` : isError ? "Error" : "Assistant"}
          </span>
          <span className="text-[9px] text-white/15">{fmtTime(msg.timestamp)}</span>
          {msg.tokens && (
            <span className="text-[9px] text-white/15 font-mono">
              {msg.tokens.input + msg.tokens.output} tok · {fmtCost(msg.tokens.cost)}
            </span>
          )}
        </div>

        <div className={`rounded-xl px-4 py-3 text-[13px] leading-relaxed select-text ${
          isUser
            ? "bg-violet-500/8 border border-violet-500/15 text-white/85 inline-block text-left"
            : isError
              ? "bg-red-500/8 border border-red-500/15 text-red-300/90"
              : isTool
                ? "bg-amber-500/5 border border-amber-500/10 text-white/75"
                : "bg-white/[0.025] border border-white/[0.05] text-white/80"
        }`}>
          {msg.type === "papers" && msg.data && Array.isArray(msg.data) ? (
            <div>
              {msg.content && <p className="mb-3 text-white/70">{msg.content}</p>}
              <div className="grid grid-cols-1 gap-2">
                {(msg.data as PaperResult[]).slice(0, 10).map((paper, i) => (
                  <PaperCard key={i} paper={paper} />
                ))}
              </div>
            </div>
          ) : msg.type === "code" ? (
            <div>
              {msg.content && <p className="mb-2 text-white/70">{msg.content}</p>}
              {msg.data != null && (
                <pre className="rounded-lg px-3 py-2 text-[11px] font-mono text-green-300/80 overflow-x-auto"
                  style={{ background: "rgba(0,0,0,0.3)" }}>
                  {String(typeof msg.data === "string" ? msg.data : JSON.stringify(msg.data, null, 2))}
                </pre>
              )}
            </div>
          ) : msg.type === "export" ? (
            <ExportBadge content={msg.content} data={msg.data} />
          ) : (
            <div>{renderMarkdown(msg.content)}</div>
          )}
        </div>

        <div className={`flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity select-none ${isUser ? "justify-end" : ""}`}>
          <button onClick={onCopy}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-white/25 hover:text-white/60 hover:bg-white/5 transition-colors cursor-pointer"
            title="Copy message">
            <i className="fa-solid fa-copy text-[8px]" /> Copy
          </button>
          {onEditRetry && !isGenerating && (
            <button onClick={onEditRetry}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-white/25 hover:text-violet-400/80 hover:bg-violet-500/10 transition-colors cursor-pointer"
              title="Edit and retry">
              <i className="fa-solid fa-pen text-[8px]" /> Edit & Retry
            </button>
          )}
          {onRetry && !isGenerating && (
            <button onClick={onRetry}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-white/25 hover:text-cyan-400/80 hover:bg-cyan-500/10 transition-colors cursor-pointer"
              title="Retry">
              <i className="fa-solid fa-rotate-right text-[8px]" /> Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ██  PAPER CARD COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

function PaperCard({ paper }: { paper: PaperResult }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg px-3 py-2.5 transition-all cursor-pointer hover:bg-white/[0.02]"
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
      onClick={() => setExpanded(!expanded)}>
      <div className="flex items-start gap-2">
        <i className="fa-solid fa-file-lines text-[10px] text-cyan-400/50 mt-1 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-white/80 leading-snug">{paper.title}</div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[10px] text-white/35">{paper.authors?.slice(0, 3).join(", ")}{paper.authors?.length > 3 ? " et al." : ""}</span>
            {paper.year && <span className="text-[10px] text-cyan-400/40">{paper.year}</span>}
            {paper.citations > 0 && (
              <span className="text-[10px] text-amber-400/40">
                <i className="fa-solid fa-quote-right text-[8px] mr-0.5" />{paper.citations}
              </span>
            )}
            {paper.source && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-white/25">{paper.source}</span>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            {paper.abstract && (
              <p className="mt-2 text-[11px] text-white/45 leading-relaxed pl-5">{paper.abstract}</p>
            )}
            <div className="flex items-center gap-2 mt-2 pl-5">
              {paper.doi && (
                <span className="text-[10px] text-cyan-400/40 font-mono">DOI: {paper.doi}</span>
              )}
              {paper.url && (
                <a href={paper.url} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] text-cyan-400/60 hover:text-cyan-400 transition-colors"
                  onClick={(e) => e.stopPropagation()}>
                  <i className="fa-solid fa-external-link text-[8px] mr-0.5" /> Open
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ██  EXPORT BADGE COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

function ExportBadge({ content, data }: { content: string; data?: unknown }) {
  const info = useMemo(() => {
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      return { path: String(d.path || ""), format: String(d.format || "file"), size: Number(d.size || 0) };
    }
    return { path: "", format: "file", size: 0 };
  }, [data]);

  const fileName = info.path ? info.path.split(/[/\\]/).pop() : "";

  const handleOpen = async () => {
    if (info.path) {
      try { await invoke("open_file", { path: info.path }); } catch (e) { console.error("open_file:", e); }
    }
  };
  const handleReveal = async () => {
    if (info.path) {
      try { await invoke("reveal_in_folder", { path: info.path }); } catch (e) { console.error("reveal:", e); }
    }
  };

  return (
    <div className="flex items-center gap-3">
      <i className="fa-solid fa-file-arrow-down text-green-400/70 text-lg" />
      <div className="flex-1 min-w-0">
        {content && <p className="text-white/70 mb-1">{content}</p>}
        {fileName && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-cyan-400/70 font-mono truncate max-w-[300px]" title={info.path}>{fileName}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400/60 border border-green-500/15">
              {info.format.toUpperCase()}
            </span>
            {info.size > 0 && (
              <span className="text-[9px] text-white/25">{(info.size / 1024).toFixed(1)} KB</span>
            )}
          </div>
        )}
        {info.path && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <button onClick={handleOpen}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-cyan-400/70 hover:text-cyan-300 transition-colors cursor-pointer"
              style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.15)" }}>
              <i className="fa-solid fa-arrow-up-right-from-square text-[8px]" /> Open File
            </button>
            <button onClick={handleReveal}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-white/40 hover:text-white/70 transition-colors cursor-pointer"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <i className="fa-solid fa-folder-open text-[8px]" /> Show in Explorer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
