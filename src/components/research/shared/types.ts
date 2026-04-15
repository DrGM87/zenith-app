export type {
  ResearchMessage,
  PaperResult,
  PipelinePhase,
  PipelineState,
  StudyDesign,
  PipelineStepConfig,
  PipelineConfig,
  PipelineLog,
  ResearchThread,
  ResearchParams,
} from "../../../stores/useResearchStore";

// ── Settings ─────────────────────────────────────────────────────────────────

export interface ApiKeyEntry { provider: string; label: string; key: string; model: string; is_default: boolean; }
export interface TokenUsageEntry { provider: string; input_tokens: number; output_tokens: number; cost_usd: number; }
export interface TokenUsage { entries: TokenUsageEntry[]; total_input_tokens: number; total_output_tokens: number; total_cost_usd: number; }

/** Mirrors Rust AiPrompts struct — every field the backend can provide */
export interface AiPrompts {
  smart_rename?: string;
  smart_sort?: string;
  ocr?: string;
  auto_organize?: string;
  translate?: string;
  ask_data?: string;
  summarize?: string;
  super_summary?: string;
  dashboard?: string;
  research?: string;
  research_pipeline?: string;
  subject_review?: string;
  educational?: string;
  case_study?: string;
  comparative?: string;
  exploratory?: string;
  [key: string]: string | undefined;
}

/** Mirrors Rust ZenithSettings struct (research-relevant fields) */
export interface ZenithSettings {
  api_keys: ApiKeyEntry[];
  token_usage?: TokenUsage;
  ai_prompts?: AiPrompts;
  pipeline_config?: import("../../../stores/useResearchStore").PipelineConfig;
  tavily_api_key?: string;
  brave_api_key?: string;
  firecrawl_api_key?: string;
  vt_api_key?: string;
  omdb_api_key?: string;
  embedding_model?: string;
  gemini_api_key?: string;
  [key: string]: unknown;
}

// ── Agent Activity Feed ──────────────────────────────────────────────────────

export type AgentEventType = "started" | "tool_called" | "checkpoint" | "completed" | "error" | "info";

export interface AgentEvent {
  id: string;
  timestamp: number;
  agent_name: string;
  event_type: AgentEventType;
  tool_name?: string;
  message: string;
  data?: unknown;
  phase_group?: string;
  requires_approval?: boolean;
}

// ── Extraction Table ─────────────────────────────────────────────────────────

export interface PICOExtraction {
  paper_idx: number;
  paper_title: string;
  population: string;
  intervention: string;
  comparator: string;
  outcome: string;
  sample_size: string;
  effect_size: string;
  ci: string;
  p_value: string;
}
