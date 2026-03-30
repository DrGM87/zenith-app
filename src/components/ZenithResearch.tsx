import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { motion, AnimatePresence } from "framer-motion";
import {
  useResearchStore,
  type ResearchMessage,
  type PaperResult,
} from "../stores/useResearchStore";

// ── Types ────────────────────────────────────────────────────────────────────

interface ApiKeyEntry { provider: string; label: string; key: string; model: string; is_default: boolean; }
interface TokenUsageEntry { provider: string; input_tokens: number; output_tokens: number; cost_usd: number; }
interface TokenUsage { entries: TokenUsageEntry[]; total_input_tokens: number; total_output_tokens: number; total_cost_usd: number; }
interface ZenithSettings {
  api_keys: ApiKeyEntry[];
  token_usage?: TokenUsage;
  ai_prompts?: { research?: string; [key: string]: unknown };
  tavily_api_key?: string;
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
  { id: "literature", label: "Literature Search", icon: "fa-book", desc: "arXiv, Semantic Scholar, OpenAlex" },
  { id: "web_search", label: "Web Search", icon: "fa-globe", desc: "Tavily / DuckDuckGo" },
  { id: "pdf_extract", label: "PDF Extract", icon: "fa-file-pdf", desc: "Extract text from PDFs" },
  { id: "novelty", label: "Novelty Check", icon: "fa-lightbulb", desc: "Score idea novelty" },
  { id: "citation_verify", label: "Citation Verify", icon: "fa-check-double", desc: "Verify references" },
  { id: "experiment", label: "Experiment", icon: "fa-flask", desc: "Run sandboxed code" },
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
    threads, activeThreadId, params, isGenerating,
    createThread, deleteThread, switchThread, renameThread,
    addMessage, setParams, setGenerating,
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

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Init: load settings + threads
  useEffect(() => {
    loadThreads();
    invoke<ZenithSettings>("get_settings").then((s) => {
      setSettings(s);
      // Auto-pick first API key if params are empty
      const keys = s.api_keys ?? [];
      const def = keys.find((k) => k.is_default) || keys[0];
      if (def && !params.provider) {
        setParams({ provider: def.provider, model: def.model, api_key: def.key });
      }
      // Wire system prompt from Settings → AI Prompts → Research
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

  // ── Send message
  const handleSend = useCallback(async () => {
    if (!inputText.trim() || isGenerating || !currentThread) return;
    const userMsg: ResearchMessage = {
      id: uid(), role: "user", content: inputText.trim(),
      type: "text", timestamp: Date.now(),
    };
    addMessage(currentThread.id, userMsg);
    setInputText("");
    setGenerating(true);

    // Auto-name thread on first message
    const isFirst = messages.length === 0;

    try {
      // Build conversation for the LLM
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
      });

      const resultStr = await invoke<string>("process_file", { action: "research_chat", argsJson });
      const result = JSON.parse(resultStr);

      if (result.error) {
        const errMsg: ResearchMessage = {
          id: uid(), role: "assistant", content: result.error,
          type: "error", timestamp: Date.now(),
        };
        addMessage(currentThread.id, errMsg);
      } else {
        const cost = result.tokens
          ? estimateCost(params.provider, params.model, result.tokens.input || 0, result.tokens.output || 0)
          : 0;

        // Track usage in settings
        if (result.tokens) {
          await trackTokenUsage(params.provider, params.model, result.tokens.input || 0, result.tokens.output || 0, cost);
        }

        const assistantMsg: ResearchMessage = {
          id: uid(), role: "assistant", content: result.reply || result.content || "",
          type: result.type || "text",
          data: result.data,
          timestamp: Date.now(),
          tokens: result.tokens ? { input: result.tokens.input || 0, output: result.tokens.output || 0, cost } : undefined,
          tool_used: result.tool_used,
        };
        addMessage(currentThread.id, assistantMsg);

        // Handle tool results embedded in response
        if (result.tool_results && Array.isArray(result.tool_results)) {
          for (const tr of result.tool_results) {
            const toolMsg: ResearchMessage = {
              id: uid(), role: "tool", content: tr.summary || "",
              type: tr.type || "text",
              data: tr.data,
              timestamp: Date.now(),
              tool_used: tr.tool_name,
            };
            addMessage(currentThread.id, toolMsg);
          }
        }
      }

      // Auto-name thread
      if (isFirst && inputText.trim().length > 0) {
        const title = inputText.trim().length > 50 ? inputText.trim().slice(0, 47) + "..." : inputText.trim();
        renameThread(currentThread.id, title);
      }

    } catch (e) {
      const errMsg: ResearchMessage = {
        id: uid(), role: "assistant", content: `Error: ${String(e)}`,
        type: "error", timestamp: Date.now(),
      };
      addMessage(currentThread.id, errMsg);
    } finally {
      setGenerating(false);
    }
  }, [inputText, isGenerating, currentThread, messages, params, addMessage, setGenerating, renameThread]);

  // ── Export chat
  const handleExport = useCallback(async (format: string) => {
    if (!currentThread || messages.length === 0) { showToast("Nothing to export"); return; }
    setShowExportMenu(false);
    try {
      const argsJson = JSON.stringify({
        messages: messages.map((m) => ({ role: m.role, content: m.content, type: m.type, data: m.data })),
        format,
        thread_title: currentThread.title,
      });
      const resultStr = await invoke<string>("process_file", { action: "export_chat", argsJson });
      const result = JSON.parse(resultStr);
      if (result.ok && result.path) {
        // Auto-stage the exported file in Bubble
        try { await invoke("stage_file", { path: result.path }); await emit("items-changed"); } catch { /* main window may be closed */ }
        // Add export message to thread
        addMessage(currentThread.id, {
          id: crypto.randomUUID(), role: "assistant", content: `Exported as ${format.toUpperCase()} → ${result.path.split(/[/\\]/).pop()}`,
          type: "export", data: { path: result.path, format, size: result.size }, timestamp: Date.now(),
        });
        showToast(`Exported → ${result.path.split(/[/\\]/).pop()}`);
      } else {
        showToast(result.error || "Export failed");
      }
    } catch (e) {
      showToast(`Export error: ${String(e)}`);
    }
  }, [currentThread, messages, showToast, addMessage]);

  // ── Key handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // ── Change provider
  const handleProviderChange = useCallback((provider: string) => {
    const keys = settings?.api_keys ?? [];
    const key = keys.find((k) => k.provider === provider);
    const models = PROVIDER_MODELS[provider] ?? [];
    setParams({
      provider,
      api_key: key?.key ?? "",
      model: key?.model || models[0]?.id || "",
    });
  }, [settings, setParams]);

  // ══════════════════════════════════════════════════════════════════════════════
  // ██  RENDER
  // ══════════════════════════════════════════════════════════════════════════════

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden select-none"
      style={{ background: "linear-gradient(145deg, #0a0a0f 0%, #0d1117 40%, #0a0f1a 100%)", color: "#e2e8f0", fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif" }}>

      {/* ── HEADER BAR ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.06]"
        style={{ background: "rgba(15,15,25,0.85)", backdropFilter: "blur(20px)" }}>
        {/* Left toggle */}
        <button onClick={() => setLeftCollapsed(!leftCollapsed)}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors"
          title={leftCollapsed ? "Show threads" : "Hide threads"}>
          <i className={`fa-solid ${leftCollapsed ? "fa-bars" : "fa-chevron-left"} text-[11px]`} />
        </button>

        {/* Thread title */}
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <i className="fa-solid fa-microscope text-cyan-400/70 text-sm" />
          {editingTitle === currentThread?.id ? (
            <input value={editTitleVal}
              onChange={(e) => setEditTitleVal(e.target.value)}
              onBlur={() => { if (editTitleVal.trim() && currentThread) renameThread(currentThread.id, editTitleVal.trim()); setEditingTitle(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") { if (editTitleVal.trim() && currentThread) renameThread(currentThread.id, editTitleVal.trim()); setEditingTitle(null); } if (e.key === "Escape") setEditingTitle(null); }}
              className="bg-white/5 border border-cyan-500/30 rounded px-2 py-0.5 text-sm text-white/90 outline-none flex-1"
              autoFocus />
          ) : (
            <span className="text-sm font-medium text-white/80 truncate cursor-pointer hover:text-white/95"
              onDoubleClick={() => { if (currentThread) { setEditingTitle(currentThread.id); setEditTitleVal(currentThread.title); } }}>
              {currentThread?.title || "New Research"}
            </span>
          )}
        </div>

        {/* Header actions */}
        <div className="flex items-center gap-1.5">
          {/* Cost badge */}
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-mono"
            style={{ background: "rgba(34,211,238,0.08)", color: "#67e8f9", border: "1px solid rgba(34,211,238,0.15)" }}>
            <i className="fa-solid fa-coins text-[9px]" />
            {fmtCost(currentThread?.total_cost ?? 0)}
          </div>

          {/* Export dropdown */}
          <div className="relative">
            <button onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors"
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
                      className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-white/70 hover:text-white hover:bg-white/5 transition-colors">
                      <i className={`fa-solid ${f.icon} text-[10px] w-4 text-center`} />
                      {f.label} <span className="text-white/30 ml-auto">{f.ext}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* New thread */}
          <button onClick={() => createThread()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors"
            style={{ background: "rgba(34,211,238,0.12)", color: "#67e8f9", border: "1px solid rgba(34,211,238,0.25)" }}
            title="New research thread">
            <i className="fa-solid fa-plus text-[10px]" /> New Thread
          </button>

          {/* Right panel toggle */}
          <button onClick={() => setRightCollapsed(!rightCollapsed)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors"
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
            <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 250, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col border-r border-white/[0.06] overflow-hidden"
              style={{ background: "rgba(10,10,18,0.6)", minWidth: 0 }}>

              {/* Search */}
              <div className="p-2.5">
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <i className="fa-solid fa-magnifying-glass text-[10px] text-white/30" />
                  <input value={threadSearch} onChange={(e) => setThreadSearch(e.target.value)}
                    placeholder="Search threads..."
                    className="bg-transparent text-[12px] text-white/80 placeholder:text-white/25 outline-none flex-1" />
                </div>
              </div>

              {/* Thread list */}
              <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-3" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}>
                {groupedThreads.map((group) => (
                  <div key={group.label}>
                    <div className="text-[10px] font-semibold text-white/25 uppercase tracking-wider px-2 mb-1">{group.label}</div>
                    {group.threads.map((t) => (
                      <button key={t.id}
                        onClick={() => switchThread(t.id)}
                        className={`w-full text-left px-2.5 py-2 rounded-lg mb-0.5 transition-all group ${
                          t.id === activeThreadId
                            ? "bg-cyan-500/10 border border-cyan-500/20"
                            : "hover:bg-white/[0.03] border border-transparent"
                        }`}>
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.id === activeThreadId ? "bg-cyan-400" : "bg-white/15"}`} />
                          <span className="text-[12px] text-white/75 truncate flex-1">{t.title}</span>
                          <button onClick={(e) => { e.stopPropagation(); deleteThread(t.id); }}
                            className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded flex items-center justify-center text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-all"
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

              {/* Total cost footer */}
              <div className="px-3 py-2 border-t border-white/[0.04]">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-white/25">Total spent</span>
                  <span className="text-cyan-400/60 font-mono">{fmtCost(totalCost())}</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ══ CENTER — CHAT AREA ══ */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4"
            style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>

            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-4 opacity-40">
                <i className="fa-solid fa-microscope text-5xl text-cyan-400/30" />
                <div>
                  <div className="text-lg font-medium text-white/50 mb-1">Zenith Research</div>
                  <div className="text-[13px] text-white/30 max-w-md">
                    Ask a research question, search for papers, verify citations, or run experiments.
                    Use the tools panel on the right to configure capabilities.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 justify-center max-w-lg mt-2">
                  {["Find recent papers on transformer architectures",
                    "Summarize the key findings in attention mechanisms",
                    "Check if my idea about sparse attention is novel",
                    "Generate a related work section"].map((q) => (
                    <button key={q} onClick={() => { setInputText(q); inputRef.current?.focus(); }}
                      className="px-3 py-1.5 rounded-lg text-[11px] text-white/40 hover:text-white/70 transition-colors"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}

            {isGenerating && (
              <div className="flex items-start gap-3 max-w-3xl">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(34,211,238,0.12)" }}>
                  <i className="fa-solid fa-microscope text-[11px] text-cyan-400" />
                </div>
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  <span className="text-[12px] text-white/30">Researching...</span>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* ── INPUT BAR ── */}
          <div className="px-4 py-3 border-t border-white/[0.06]"
            style={{ background: "rgba(12,12,22,0.8)" }}>
            {/* Attached file chips */}
            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2 max-w-4xl mx-auto">
                {attachedFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px]"
                    style={{ background: "rgba(34,211,238,0.08)", border: "1px solid rgba(34,211,238,0.15)" }}>
                    <i className="fa-solid fa-paperclip text-[9px] text-cyan-400/60" />
                    <span className="text-white/60 max-w-[120px] truncate">{f.name}</span>
                    <button onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="w-4 h-4 rounded flex items-center justify-center text-white/30 hover:text-red-400 transition-colors">
                      <i className="fa-solid fa-xmark text-[8px]" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 max-w-4xl mx-auto">
              {/* Attach button */}
              <input ref={fileInputRef} type="file" multiple className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (files) {
                    const newFiles = Array.from(files).map((f) => ({ name: f.name, path: (f as unknown as { path?: string }).path || f.name }));
                    setAttachedFiles((prev) => [...prev, ...newFiles].slice(0, 10));
                  }
                  e.target.value = "";
                }} />
              <button onClick={() => fileInputRef.current?.click()}
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all flex-shrink-0"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                title="Attach files (PDFs, documents)">
                <i className="fa-solid fa-paperclip text-[12px] text-white/30 hover:text-white/60" />
              </button>
              {/* Tools quick-insert dropdown */}
              <div className="relative">
                <button onClick={() => setShowToolsMenu(!showToolsMenu)}
                  className="w-10 h-10 rounded-xl flex items-center justify-center transition-all flex-shrink-0"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                  title="Quick tool commands">
                  <i className="fa-solid fa-wrench text-[12px] text-white/30 hover:text-white/60" />
                </button>
                <AnimatePresence>
                  {showToolsMenu && (
                    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                      className="absolute bottom-full mb-1 left-0 z-50 rounded-xl overflow-hidden shadow-2xl"
                      style={{ background: "rgba(20,20,35,0.95)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(20px)", minWidth: 200 }}>
                      {[
                        { label: "Search Papers", icon: "fa-book", cmd: "Search for papers on: " },
                        { label: "Check Novelty", icon: "fa-lightbulb", cmd: "Check the novelty of this idea: " },
                        { label: "Verify Citations", icon: "fa-check-double", cmd: "Verify these citations: " },
                        { label: "Generate Section", icon: "fa-file-lines", cmd: "Generate a related work section about: " },
                        { label: "Web Search", icon: "fa-globe", cmd: "Search the web for: " },
                        { label: "Run Experiment", icon: "fa-flask", cmd: "Run this Python experiment:\n```python\n\n```" },
                      ].map((t) => (
                        <button key={t.label} onClick={() => { setInputText(t.cmd); setShowToolsMenu(false); inputRef.current?.focus(); }}
                          className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-white/70 hover:text-white hover:bg-white/5 transition-colors">
                          <i className={`fa-solid ${t.icon} text-[10px] w-4 text-center text-cyan-400/50`} />
                          {t.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {/* Text input */}
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
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all flex-shrink-0 disabled:opacity-30"
                style={{ background: inputText.trim() && !isGenerating ? "rgba(34,211,238,0.2)" : "rgba(255,255,255,0.03)", border: `1px solid ${inputText.trim() && !isGenerating ? "rgba(34,211,238,0.4)" : "rgba(255,255,255,0.06)"}` }}>
                <i className={`fa-solid fa-paper-plane text-[12px] ${inputText.trim() && !isGenerating ? "text-cyan-400" : "text-white/20"}`} />
              </button>
            </div>
            <div className="flex items-center justify-between mt-1.5 max-w-4xl mx-auto px-1">
              <div className="flex items-center gap-3 text-[10px] text-white/20">
                <span>{params.provider}/{params.model || "no model"}</span>
                <span>T={params.temperature}</span>
                <span>{params.enabled_tools.length} tools active</span>
                {attachedFiles.length > 0 && <span className="text-cyan-400/40">{attachedFiles.length} file(s) attached</span>}
              </div>
              <span className="text-[10px] text-white/15">Shift+Enter for new line</span>
            </div>
          </div>
        </div>

        {/* ══ RIGHT PANEL — PARAMETERS ══ */}
        <AnimatePresence>
          {!rightCollapsed && (
            <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 280, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col border-l border-white/[0.06] overflow-y-auto"
              style={{ background: "rgba(10,10,18,0.6)", minWidth: 0, scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>

              {/* Model Config */}
              <div className="p-3 border-b border-white/[0.04]">
                <div className="text-[10px] font-semibold text-white/30 uppercase tracking-wider mb-2">Model Configuration</div>

                {/* Provider */}
                <label className="text-[11px] text-white/40 mb-1 block">Provider</label>
                <select value={params.provider} onChange={(e) => handleProviderChange(e.target.value)}
                  className="w-full mb-2.5 px-2.5 py-1.5 rounded-lg text-[12px] text-white/80 outline-none appearance-none cursor-pointer"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <option value="">Select provider</option>
                  {availableProviders.map((p) => (
                    <option key={p} value={p} style={{ background: "#151520" }}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>

                {/* Model */}
                <label className="text-[11px] text-white/40 mb-1 block">Model</label>
                <select value={params.model} onChange={(e) => setParams({ model: e.target.value })}
                  className="w-full mb-2.5 px-2.5 py-1.5 rounded-lg text-[12px] text-white/80 outline-none appearance-none cursor-pointer"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  {modelsForProvider.map((m) => (
                    <option key={m.id} value={m.id} style={{ background: "#151520" }}>{m.label}</option>
                  ))}
                </select>

                {/* Temperature */}
                <label className="text-[11px] text-white/40 mb-1 flex justify-between">
                  <span>Temperature</span>
                  <span className="text-white/60 font-mono">{params.temperature.toFixed(1)}</span>
                </label>
                <input type="range" min={0} max={2} step={0.1} value={params.temperature}
                  onChange={(e) => setParams({ temperature: parseFloat(e.target.value) })}
                  className="w-full mb-2.5 accent-cyan-400 h-1" />

                {/* Max Tokens */}
                <label className="text-[11px] text-white/40 mb-1 flex justify-between">
                  <span>Max Tokens</span>
                  <span className="text-white/60 font-mono">{params.max_tokens}</span>
                </label>
                <input type="range" min={256} max={16384} step={256} value={params.max_tokens}
                  onChange={(e) => setParams({ max_tokens: parseInt(e.target.value) })}
                  className="w-full mb-1 accent-cyan-400 h-1" />
              </div>

              {/* Research Tools */}
              <div className="p-3 border-b border-white/[0.04]">
                <div className="text-[10px] font-semibold text-white/30 uppercase tracking-wider mb-2">Research Tools</div>
                <div className="space-y-1.5">
                  {RESEARCH_TOOLS.map((tool) => {
                    const enabled = params.enabled_tools.includes(tool.id);
                    return (
                      <button key={tool.id}
                        onClick={() => {
                          const tools = enabled
                            ? params.enabled_tools.filter((t) => t !== tool.id)
                            : [...params.enabled_tools, tool.id];
                          setParams({ enabled_tools: tools });
                        }}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all ${
                          enabled ? "bg-cyan-500/8 border border-cyan-500/15" : "hover:bg-white/[0.02] border border-transparent"
                        }`}>
                        <div className={`w-6 h-6 rounded flex items-center justify-center text-[10px] ${
                          enabled ? "bg-cyan-500/15 text-cyan-400" : "bg-white/5 text-white/25"
                        }`}>
                          <i className={`fa-solid ${tool.icon}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={`text-[11px] font-medium ${enabled ? "text-white/80" : "text-white/40"}`}>{tool.label}</div>
                          <div className="text-[9px] text-white/20 truncate">{tool.desc}</div>
                        </div>
                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                          enabled ? "bg-cyan-500/20 border-cyan-500/40" : "border-white/15"
                        }`}>
                          {enabled && <i className="fa-solid fa-check text-[7px] text-cyan-400" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Export Format */}
              <div className="p-3 border-b border-white/[0.04]">
                <div className="text-[10px] font-semibold text-white/30 uppercase tracking-wider mb-2">Default Export Format</div>
                <div className="space-y-1">
                  {EXPORT_FORMATS.map((f) => (
                    <button key={f.id}
                      onClick={() => setParams({ export_format: f.id as typeof params.export_format })}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] transition-all ${
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

              {/* System Prompt — managed in Settings > AI Prompts */}
              <div className="p-3">
                <div className="text-[10px] font-semibold text-white/30 uppercase tracking-wider mb-1.5">System Prompt</div>
                <p className="text-[10px] text-white/25 leading-relaxed">
                  <i className="fa-solid fa-gear text-[8px] mr-1 text-white/15" />
                  Managed in <span className="text-cyan-400/50">Settings → AI Prompts → Research</span>
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
// ██  MESSAGE BUBBLE COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

function MessageBubble({ msg }: { msg: ResearchMessage }) {
  const isUser = msg.role === "user";
  const isError = msg.type === "error";
  const isTool = msg.role === "tool";

  return (
    <div className={`flex items-start gap-3 ${isUser ? "flex-row-reverse max-w-3xl ml-auto" : "max-w-3xl"}`}>
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
        isUser ? "bg-violet-500/15" : isTool ? "bg-amber-500/12" : isError ? "bg-red-500/12" : "bg-cyan-500/12"
      }`}>
        <i className={`fa-solid ${
          isUser ? "fa-user" : isTool ? "fa-wrench" : isError ? "fa-exclamation-triangle" : "fa-microscope"
        } text-[11px] ${
          isUser ? "text-violet-400" : isTool ? "text-amber-400" : isError ? "text-red-400" : "text-cyan-400"
        }`} />
      </div>

      {/* Content */}
      <div className={`flex-1 min-w-0 ${isUser ? "text-right" : ""}`}>
        {/* Role label */}
        <div className="flex items-center gap-2 mb-1">
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

        {/* Message body */}
        <div className={`rounded-xl px-4 py-3 text-[13px] leading-relaxed ${
          isUser
            ? "bg-violet-500/8 border border-violet-500/15 text-white/85 inline-block text-left"
            : isError
              ? "bg-red-500/8 border border-red-500/15 text-red-300/90"
              : isTool
                ? "bg-amber-500/5 border border-amber-500/10 text-white/75"
                : "bg-white/[0.025] border border-white/[0.05] text-white/80"
        }`}>
          {/* Render papers grid if data is papers */}
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
          ) : msg.type === "citation" ? (
            <CitationBlock content={msg.content} data={msg.data} />
          ) : msg.type === "experiment_progress" ? (
            <ExperimentProgress content={msg.content} data={msg.data} />
          ) : msg.type === "export" ? (
            <ExportBadge content={msg.content} data={msg.data} />
          ) : msg.type === "table" && msg.data != null ? (
            <div>
              {msg.content && <p className="mb-2 text-white/70">{msg.content}</p>}
              <div className="overflow-x-auto">
                <pre className="text-[11px] font-mono text-white/60">
                  {String(typeof msg.data === "string" ? msg.data : JSON.stringify(msg.data, null, 2))}
                </pre>
              </div>
            </div>
          ) : (
            <div className="whitespace-pre-wrap">{msg.content}</div>
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
// ██  CITATION BLOCK COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

function CitationBlock({ content, data }: { content: string; data?: unknown }) {
  const [copied, setCopied] = useState(false);

  const bibtex = useMemo(() => {
    if (typeof data === "string") return data;
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      const key = String(d.key || "ref");
      const title = String(d.title || "");
      const authors = String(d.authors || "");
      const year = String(d.year || "");
      const doi = String(d.doi || "");
      return `@article{${key},\n  title = {${title}},\n  author = {${authors}},\n  year = {${year}},${doi ? `\n  doi = {${doi}},` : ""}\n}`;
    }
    return content;
  }, [content, data]);

  const handleCopy = () => {
    navigator.clipboard.writeText(bibtex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      {content && content !== bibtex && <p className="mb-2 text-white/70">{content}</p>}
      <div className="relative rounded-lg overflow-hidden" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(99,102,241,0.15)" }}>
        <div className="flex items-center justify-between px-3 py-1.5" style={{ background: "rgba(99,102,241,0.06)" }}>
          <span className="text-[10px] font-medium text-indigo-400/60 uppercase tracking-wider">BibTeX</span>
          <button onClick={handleCopy}
            className="text-[10px] px-2 py-0.5 rounded text-indigo-400/60 hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors">
            <i className={`fa-solid ${copied ? "fa-check" : "fa-copy"} text-[9px] mr-1`} />
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre className="px-3 py-2 text-[11px] font-mono text-indigo-300/70 overflow-x-auto whitespace-pre-wrap">{bibtex}</pre>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ██  EXPERIMENT PROGRESS COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

function ExperimentProgress({ content, data }: { content: string; data?: unknown }) {
  const progress = useMemo(() => {
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      return {
        stage: String(d.stage || "Running"),
        current: Number(d.current || 0),
        total: Number(d.total || 0),
        status: String(d.status || "running"),
        stdout: String(d.stdout || ""),
        stderr: String(d.stderr || ""),
        exit_code: d.exit_code as number | undefined,
      };
    }
    return { stage: "Running", current: 0, total: 0, status: "running", stdout: "", stderr: "", exit_code: undefined };
  }, [data]);

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const isDone = progress.status === "done" || progress.status === "completed";
  const isFailed = progress.status === "failed" || progress.status === "error";

  return (
    <div>
      {content && <p className="mb-2 text-white/70">{content}</p>}
      <div className="rounded-lg p-3" style={{ background: "rgba(0,0,0,0.2)", border: `1px solid ${isFailed ? "rgba(239,68,68,0.15)" : isDone ? "rgba(34,197,94,0.15)" : "rgba(34,211,238,0.15)"}` }}>
        {/* Stage label */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <i className={`fa-solid ${isDone ? "fa-check-circle text-green-400/60" : isFailed ? "fa-times-circle text-red-400/60" : "fa-flask text-cyan-400/60 animate-pulse"} text-[11px]`} />
            <span className="text-[12px] font-medium text-white/60">{progress.stage}</span>
          </div>
          {progress.total > 0 && (
            <span className="text-[10px] text-white/30">{progress.current}/{progress.total} — {pct}%</span>
          )}
        </div>
        {/* Progress bar */}
        {progress.total > 0 && (
          <div className="w-full h-1.5 rounded-full overflow-hidden mb-2" style={{ background: "rgba(255,255,255,0.05)" }}>
            <div className={`h-full rounded-full transition-all duration-500 ${isFailed ? "bg-red-500/50" : isDone ? "bg-green-500/50" : "bg-cyan-500/50"}`}
              style={{ width: `${pct}%` }} />
          </div>
        )}
        {/* Output */}
        {progress.stdout && (
          <pre className="text-[10px] font-mono text-green-300/50 mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap">{progress.stdout.slice(-500)}</pre>
        )}
        {progress.stderr && (
          <pre className="text-[10px] font-mono text-red-300/50 mt-1 max-h-20 overflow-y-auto whitespace-pre-wrap">{progress.stderr.slice(-300)}</pre>
        )}
        {progress.exit_code !== undefined && (
          <div className="mt-1 text-[10px] text-white/25">Exit code: {progress.exit_code}</div>
        )}
      </div>
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

  return (
    <div className="flex items-center gap-3">
      <i className="fa-solid fa-file-arrow-down text-green-400/70" />
      <div>
        {content && <p className="text-white/70 mb-1">{content}</p>}
        {fileName && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-cyan-400/60 font-mono">{fileName}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400/60 border border-green-500/15">
              {info.format.toUpperCase()}
            </span>
            {info.size > 0 && (
              <span className="text-[9px] text-white/25">{(info.size / 1024).toFixed(1)} KB</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
