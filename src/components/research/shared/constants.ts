// ── Provider Models ──────────────────────────────────────────────────────────

export const PROVIDER_MODELS: Record<string, { id: string; label: string }[]> = {
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
    { id: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite" },
    { id: "gemini-3.1-flash-preview", label: "Gemini 3.1 Flash" },
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

// ── Pricing (per 1M tokens) ──────────────────────────────────────────────────

export const PRICING: Record<string, Record<string, { input: number; output: number }>> = {
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
    "gemini-3.1-flash-lite-preview": { input: 0.075, output: 0.30 }, "gemini-3.1-flash-preview": { input: 0.10, output: 0.40 },
    "gemini-3.1-pro-preview": { input: 1.25, output: 5.00 },
  },
  deepseek: { "deepseek-chat": { input: 0.27, output: 1.10 }, "deepseek-reasoner": { input: 0.55, output: 2.19 } },
  groq: { "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 }, "llama-3.1-8b-instant": { input: 0.05, output: 0.08 }, "gemma2-9b-it": { input: 0.20, output: 0.20 } },
};

// ── Research Tools ───────────────────────────────────────────────────────────

export const RESEARCH_TOOLS = [
  { id: "pubmed", label: "PubMed Search", icon: "fa-hospital", desc: "MEDLINE / PubMed E-utilities", group: "primary" },
  { id: "literature", label: "Literature Search", icon: "fa-book", desc: "arXiv, Semantic Scholar, OpenAlex", group: "primary" },
  { id: "web_search", label: "Web Search", icon: "fa-globe", desc: "Brave / Tavily / Firecrawl / DDG", group: "primary" },
  { id: "scihub", label: "Sci-Hub / OA", icon: "fa-unlock-keyhole", desc: "Download papers via Sci-Hub + Unpaywall", group: "primary" },
  { id: "validate_query", label: "Gatekeeper", icon: "fa-shield-halved", desc: "Validate research question", group: "primary" },
  { id: "mesh_queries", label: "Query Architect", icon: "fa-diagram-project", desc: "Generate MeSH/Boolean queries", group: "primary" },
  { id: "triage", label: "Triage Agent", icon: "fa-filter", desc: "Screen papers for relevance", group: "primary" },
  { id: "draft_section", label: "Lead Author", icon: "fa-pen-nib", desc: "Draft sections with citations", group: "primary" },
  { id: "pdf_extract", label: "PDF Extract", icon: "fa-file-pdf", desc: "Extract text from PDFs", group: "auxiliary" },
  { id: "novelty", label: "Novelty Check", icon: "fa-lightbulb", desc: "Score idea novelty", group: "auxiliary" },
  { id: "citation_verify", label: "Citation Verify", icon: "fa-check-double", desc: "3-layer verification", group: "auxiliary" },
  { id: "experiment", label: "Experiment", icon: "fa-flask", desc: "Run sandboxed code", group: "auxiliary" },
  { id: "generate_chart", label: "Chart Gen", icon: "fa-chart-bar", desc: "Generate charts (bar, line, pie)", group: "auxiliary" },
  { id: "generate_table", label: "Table Gen", icon: "fa-table", desc: "Generate formatted tables", group: "auxiliary" },
];

// ── Export Formats ───────────────────────────────────────────────────────────

export const EXPORT_FORMATS = [
  { id: "markdown", label: "Markdown", icon: "fa-file-lines", ext: ".md" },
  { id: "pdf", label: "PDF", icon: "fa-file-pdf", ext: ".pdf" },
  { id: "latex", label: "LaTeX", icon: "fa-file-code", ext: ".tex" },
  { id: "bibtex", label: "BibTeX", icon: "fa-quote-right", ext: ".bib" },
  { id: "json", label: "JSON", icon: "fa-file-code", ext: ".json" },
];

// ── Study Designs ────────────────────────────────────────────────────────────

export const STUDY_DESIGNS: { id: string; label: string }[] = [
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

// ── Theme Tokens ─────────────────────────────────────────────────────────────

// All color values reference CSS custom properties defined in index.css.
// Toggling [data-theme="light"|"dark"] on <html> switches themes automatically.
export const THEME = {
  bg: {
    void:     "var(--zen-bg-void)",
    base:     "var(--zen-bg-base)",
    surface:  "var(--zen-bg-surface)",
    elevated: "var(--zen-bg-elevated)",
    hover:    "var(--zen-bg-hover)",
  },
  accent: {
    cyan:           "var(--zen-accent-cyan)",
    cyanDim:        "var(--zen-accent-cyan-dim)",
    cyanBorder:     "var(--zen-accent-cyan-border)",
    emerald:        "var(--zen-accent-emerald)",
    emeraldDim:     "var(--zen-accent-emerald-dim)",
    emeraldBorder:  "var(--zen-accent-emerald-border)",
    amber:          "var(--zen-accent-amber)",
    amberDim:       "var(--zen-accent-amber-dim)",
    red:            "var(--zen-accent-red)",
    redDim:         "var(--zen-accent-red-dim)",
  },
  text: {
    primary:   "var(--zen-text-primary)",
    secondary: "var(--zen-text-secondary)",
    tertiary:  "var(--zen-text-tertiary)",
    muted:     "var(--zen-text-muted)",
    ghost:     "var(--zen-text-ghost)",
  },
  border: {
    subtle:  "var(--zen-border-subtle)",
    default: "var(--zen-border-default)",
    active:  "var(--zen-border-active)",
  },
  font: {
    sans: "'Geist Sans', 'Inter', system-ui, sans-serif",
    mono: "'Geist Mono', 'JetBrains Mono', monospace",
  },
};
