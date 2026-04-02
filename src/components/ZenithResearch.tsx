import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { motion, AnimatePresence } from "framer-motion";
import {
  useResearchStore,
  type ResearchMessage,
  type PaperResult,
  type PipelinePhase,
  type StudyDesign,
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
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
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
    "gpt-4.1-nano": { input: 0.10, output: 0.40 }, "gpt-4o-mini": { input: 0.15, output: 0.60 },
    "gpt-4.1-mini": { input: 0.40, output: 1.60 }, "o3-mini": { input: 1.10, output: 4.40 },
    "o4-mini": { input: 1.10, output: 4.40 }, "gpt-4.1": { input: 2.00, output: 8.00 },
    "gpt-4o": { input: 2.50, output: 10.00 },
    "gpt-5.4-nano": { input: 0.20, output: 1.25 }, "gpt-5.4-mini": { input: 0.40, output: 2.50 },
    "gpt-5.4": { input: 3.00, output: 12.00 },
  },
  anthropic: {
    "claude-haiku-4-5-20250514": { input: 1.00, output: 5.00 }, "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
    "claude-sonnet-4-5-20260115": { input: 3.00, output: 15.00 }, "claude-opus-4-20250918": { input: 5.00, output: 25.00 },
    "claude-opus-4-6-20260310": { input: 5.00, output: 25.00 },
  },
  google: {
    "gemini-2.5-flash": { input: 0.15, output: 0.60 }, "gemini-3-flash-preview": { input: 0.50, output: 3.00 },
    "gemini-2.5-pro": { input: 1.25, output: 10.00 }, "gemini-3.1-pro-preview": { input: 2.00, output: 12.00 },
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
  { id: "drafting", label: "Lead Author", icon: "fa-pen-nib", desc: "Draft sections" },
  { id: "verifying", label: "Quality Swarm", icon: "fa-check-double", desc: "Verify citations" },
  { id: "smoothing", label: "Smoothing Pass", icon: "fa-wand-magic-sparkles", desc: "Polish manuscript" },
  { id: "compiling", label: "Compiler", icon: "fa-file-export", desc: "Compile references" },
];

const STUDY_DESIGNS: { id: StudyDesign; label: string }[] = [
  { id: "systematic_review", label: "Systematic Review" },
  { id: "meta_analysis", label: "Meta-Analysis" },
  { id: "narrative_review", label: "Narrative Review" },
  { id: "scoping_review", label: "Scoping Review" },
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
        const title = inputText.trim().length > 50 ? inputText.trim().slice(0, 47) + "..." : inputText.trim();
        renameThread(currentThread.id, title);
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
    setPipeline({ active: true, phase: "validating", progress: 0, query: pipelineQuery, studyDesign: pipelineDesign, error: null, papers: [], relevantPapers: [], acquiredPdfs: [], extractedTexts: [], searchQueries: [], draftSections: [], manuscript: "", bibliography: "" });

    const pipelinePrompt = settings?.ai_prompts?.research_pipeline ?? "";
    const baseArgs = {
      api_key: params.api_key, provider: params.provider, model: params.model,
      system_prompt: pipelinePrompt,
      tavily_api_key: settings?.tavily_api_key ?? "",
      brave_api_key: (settings?.brave_api_key as string) ?? "",
      firecrawl_api_key: (settings?.firecrawl_api_key as string) ?? "",
    };

    try {
      // Phase 1.1 — Gatekeeper
      setPipeline({ phase: "validating", progress: 5, statusMessage: "Validating research question..." });
      const validateResult = JSON.parse(await invoke<string>("process_file", {
        action: "run_pipeline_phase",
        argsJson: JSON.stringify({ phase: "validate", query: pipelineQuery, ...baseArgs }),
      }));
      if (pipelineAbortRef.current) return;
      if (!validateResult.ok || validateResult.is_valid === false) {
        setPipeline({ phase: "error", error: `Query invalid: ${validateResult.reason || validateResult.error || "Unknown"}`, active: false });
        return;
      }
      setPipeline({ progress: 10, statusMessage: `Valid query. Domain: ${validateResult.domain || "general"}` });

      // Phase 1.2 — Query Architect
      setPipeline({ phase: "generating_queries", progress: 15, statusMessage: "Generating optimized search queries..." });
      const queriesResult = JSON.parse(await invoke<string>("process_file", {
        action: "run_pipeline_phase",
        argsJson: JSON.stringify({ phase: "generate_queries", query: pipelineQuery, domain: validateResult.domain, ...baseArgs }),
      }));
      if (pipelineAbortRef.current) return;
      const searchQueries = queriesResult.ok ? queriesResult.queries : [{ db: "pubmed", query_string: pipelineQuery }];
      setPipeline({ searchQueries, progress: 20, statusMessage: `Generated ${searchQueries.length} search queries` });

      // Phase 1.3 — Harvester
      setPipeline({ phase: "harvesting", progress: 25, statusMessage: "Searching PubMed, Semantic Scholar, OpenAlex, arXiv..." });
      const harvestResult = JSON.parse(await invoke<string>("process_file", {
        action: "run_pipeline_phase",
        argsJson: JSON.stringify({ phase: "harvest", query: pipelineQuery, search_queries: searchQueries, ...baseArgs }),
      }));
      if (pipelineAbortRef.current) return;
      const allPapers = harvestResult.ok ? harvestResult.papers : [];
      setPipeline({ papers: allPapers, progress: 40, statusMessage: `Found ${allPapers.length} papers from ${(harvestResult.sources || []).join(", ")}` });

      if (allPapers.length === 0) {
        setPipeline({ phase: "error", error: "No papers found. Try broadening your query.", active: false });
        return;
      }

      // Phase 1.4 — Triage
      setPipeline({ phase: "triaging", progress: 45, statusMessage: `Screening ${allPapers.length} papers for relevance...` });
      const triageResult = JSON.parse(await invoke<string>("process_file", {
        action: "run_pipeline_phase",
        argsJson: JSON.stringify({ phase: "triage", papers: allPapers.slice(0, 40), query: pipelineQuery, ...baseArgs }),
      }));
      if (pipelineAbortRef.current) return;
      const relevant = triageResult.ok
        ? allPapers.filter((_: PaperResult, i: number) => triageResult.results?.[i]?.is_relevant !== false)
        : allPapers;
      setPipeline({ relevantPapers: relevant, progress: 55, statusMessage: `${relevant.length}/${allPapers.length} papers relevant` });

      // Phase 1.5 — Acquisition
      const papersWithDoi = relevant.filter((p: PaperResult) => p.doi).slice(0, 15);
      if (papersWithDoi.length > 0) {
        setPipeline({ phase: "acquiring", progress: 58, statusMessage: `Acquiring ${papersWithDoi.length} papers via Sci-Hub/Unpaywall...` });
        const acquireResult = JSON.parse(await invoke<string>("process_file", {
          action: "run_pipeline_phase",
          argsJson: JSON.stringify({ phase: "acquire", papers: papersWithDoi }),
        }));
        if (pipelineAbortRef.current) return;
        const acquired = acquireResult.ok ? acquireResult.acquired : [];
        setPipeline({ acquiredPdfs: acquired, progress: 65, statusMessage: `Acquired ${acquired.length}/${papersWithDoi.length} full-text PDFs` });

        // Phase 2.1 — Extract text
        if (acquired.length > 0) {
          setPipeline({ phase: "extracting", progress: 68, statusMessage: "Extracting text from PDFs..." });
          const paths = acquired.map((a: { path: string }) => a.path);
          const extractResult = JSON.parse(await invoke<string>("process_file", {
            action: "run_pipeline_phase",
            argsJson: JSON.stringify({ phase: "extract", paths }),
          }));
          if (pipelineAbortRef.current) return;
          const extracted = extractResult.ok ? extractResult.results.filter((r: { ok: boolean }) => r.ok) : [];
          setPipeline({ extractedTexts: extracted, progress: 72, statusMessage: `Extracted text from ${extracted.length} PDFs` });
        }
      } else {
        setPipeline({ progress: 72, statusMessage: "No DOIs available for full-text acquisition — using abstracts" });
      }

      // Phase 3 — Drafting
      const papersContext = relevant.slice(0, 20).map((p: PaperResult, i: number) =>
        `[${i + 1}] "${p.title}" (${p.authors?.slice(0, 3).join(", ") || "Unknown"}, ${p.year || "n.d."}). ${p.abstract?.slice(0, 300) || ""}`
      ).join("\n");

      const sectionTypes = ["introduction", "methodology", "results", "discussion"];
      const draftSections: { type: string; text: string }[] = [];

      for (let si = 0; si < sectionTypes.length; si++) {
        if (pipelineAbortRef.current) return;
        const sType = sectionTypes[si];
        const pct = 75 + (si / sectionTypes.length) * 15;
        setPipeline({ phase: "drafting", progress: Math.round(pct), statusMessage: `Drafting ${sType}...` });

        const draftResult = JSON.parse(await invoke<string>("process_file", {
          action: "run_pipeline_phase",
          argsJson: JSON.stringify({
            phase: "draft", section_type: sType, query: pipelineQuery,
            papers_context: papersContext, guidelines: pipelineDesign === "meta_analysis" ? "PRISMA-MA" : "PRISMA",
            ...baseArgs,
          }),
        }));
        if (draftResult.ok) {
          draftSections.push({ type: sType, text: draftResult.text });
        }
      }
      setPipeline({ draftSections, progress: 90, statusMessage: `Drafted ${draftSections.length} sections` });

      // Phase 3.3 — Verification (citation check)
      if (pipelineAbortRef.current) return;
      setPipeline({ phase: "verifying", progress: 92, statusMessage: "Verifying citations..." });

      // Phase 4.1 — Smoothing
      if (draftSections.length > 0) {
        setPipeline({ phase: "smoothing", progress: 94, statusMessage: "Polishing manuscript..." });
        const smoothResult = JSON.parse(await invoke<string>("process_file", {
          action: "run_pipeline_phase",
          argsJson: JSON.stringify({ phase: "smooth", sections: draftSections, query: pipelineQuery, ...baseArgs }),
        }));
        if (pipelineAbortRef.current) return;
        if (smoothResult.ok) {
          setPipeline({ manuscript: smoothResult.manuscript, progress: 97 });
        }
      }

      // Phase 4.2 — Compile references
      setPipeline({ phase: "compiling", progress: 98, statusMessage: "Compiling bibliography..." });
      const refsResult = JSON.parse(await invoke<string>("process_file", {
        action: "run_pipeline_phase",
        argsJson: JSON.stringify({ phase: "compile_refs", papers: relevant.slice(0, 30) }),
      }));
      if (refsResult.ok) {
        setPipeline({ bibliography: refsResult.bibtex });
      }

      setPipeline({ phase: "complete", progress: 100, active: false, statusMessage: "Research pipeline complete!" });
      showToast("Pipeline complete! Review your manuscript in the results panel.");

    } catch (e) {
      setPipeline({ phase: "error", error: String(e), active: false });
      showToast(`Pipeline error: ${String(e)}`);
    }
  }, [pipelineQuery, pipelineDesign, params, settings, setPipeline, showToast]);

  // ── Cancel pipeline
  const handleCancelPipeline = useCallback(() => {
    pipelineAbortRef.current = true;
    setPipeline({ active: false, phase: "idle", statusMessage: "Cancelled by user" });
  }, [setPipeline]);

  // ── Export chat
  const handleExport = useCallback(async (format: string) => {
    if (!currentThread || messages.length === 0) { showToast("Nothing to export"); return; }
    setShowExportMenu(false);
    try {
      const argsJson = JSON.stringify({
        messages: messages.map((m) => ({ role: m.role, content: m.content, type: m.type, data: m.data })),
        format, thread_title: currentThread.title,
      });
      const resultStr = await invoke<string>("process_file", { action: "export_chat", argsJson });
      const result = JSON.parse(resultStr);
      if (result.ok && result.path) {
        try { await invoke("stage_file", { path: result.path }); await emit("items-changed"); } catch { /* main window may be closed */ }
        addMessage(currentThread.id, {
          id: crypto.randomUUID(), role: "assistant", content: `Exported as ${format.toUpperCase()}`,
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
  }, [currentThread, messages, showToast, addMessage]);

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
        <AnimatePresence>
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
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.id === activeThreadId ? "bg-cyan-400" : "bg-white/15"}`} />
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
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {viewMode === "pipeline" ? (
            /* ═══ PIPELINE MODE ═══ */
            <div className="flex-1 overflow-y-auto px-6 py-4" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>

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
                  </div>

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
                  {(pipeline.papers.length > 0 || pipeline.manuscript) && (
                    <div className="space-y-3">
                      {/* Papers found */}
                      {pipeline.papers.length > 0 && (
                        <div className="rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                          <div className="flex items-center gap-2 mb-2">
                            <i className="fa-solid fa-book text-cyan-400/60 text-[11px]" />
                            <span className="text-[11px] font-medium text-white/60">
                              Papers: {pipeline.papers.length} found → {pipeline.relevantPapers.length} relevant → {pipeline.acquiredPdfs.length} acquired
                            </span>
                          </div>
                          <div className="space-y-1 max-h-40 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                            {pipeline.relevantPapers.slice(0, 10).map((p, i) => (
                              <div key={i} className="text-[11px] text-white/50 truncate pl-2 border-l border-white/[0.06]">
                                {p.title} <span className="text-white/25">({p.year})</span>
                              </div>
                            ))}
                          </div>
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
                          <div className="select-text max-h-64 overflow-y-auto text-[12px] text-white/60 leading-relaxed whitespace-pre-wrap" style={{ scrollbarWidth: "thin" }}>
                            {pipeline.manuscript.slice(0, 3000)}{pipeline.manuscript.length > 3000 ? "\n\n[...truncated — copy full text]" : ""}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Controls */}
                  <div className="flex items-center gap-2 mt-4">
                    {pipeline.active && (
                      <button onClick={handleCancelPipeline}
                        className="px-4 py-2 rounded-xl text-[12px] font-medium text-red-400/70 hover:text-red-400 transition-colors cursor-pointer"
                        style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)" }}>
                        <i className="fa-solid fa-stop text-[9px] mr-1.5" /> Cancel
                      </button>
                    )}
                    {(pipeline.phase === "complete" || pipeline.phase === "error") && (
                      <button onClick={() => resetPipeline()}
                        className="px-4 py-2 rounded-xl text-[12px] font-medium text-white/50 hover:text-white/80 transition-colors cursor-pointer"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <i className="fa-solid fa-rotate-right text-[9px] mr-1.5" /> New Pipeline
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ═══ CHAT MODE ═══ */
            <>
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
              <div className="px-4 py-3 border-t border-white/[0.06] select-none"
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
            </>
          )}
        </div>

        {/* ══ RIGHT PANEL — PARAMETERS ══ */}
        <AnimatePresence>
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
              <div className="p-3">
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>

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
