import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useResearchStore } from "../../stores/useResearchStore";
import type { PipelineConfig, PipelineStepConfig } from "../../stores/useResearchStore";
import { THEME as t, PROVIDER_MODELS, RESEARCH_TOOLS } from "./shared/constants";
import type { ZenithSettings, AiPrompts } from "./shared/types";

interface SettingsPanelProps {
  settings: ZenithSettings | null;
  onSettingsChange: (s: ZenithSettings) => void;
}

type SettingsTab = "model" | "tools" | "prompts" | "agents";

// ── Pipeline step metadata ───────────────────────────────────────────────────

const PIPELINE_STEPS: { key: keyof PipelineConfig; label: string; icon: string; tier: string }[] = [
  { key: "gatekeeper",            label: "Gatekeeper",       icon: "fa-shield-halved",      tier: "strong" },
  { key: "query_architect",       label: "Query Architect",  icon: "fa-diagram-project",    tier: "strong" },
  { key: "triage_agent",          label: "Triage Agent",     icon: "fa-filter",             tier: "fast"   },
  { key: "blueprint_agent",       label: "Blueprint",        icon: "fa-sitemap",            tier: "strong" },
  { key: "lead_author",           label: "Lead Author",      icon: "fa-pen-nib",            tier: "strong" },
  { key: "citation_verifier",     label: "Citation Check",   icon: "fa-check-double",       tier: "fast"   },
  { key: "guidelines_compliance", label: "Guidelines",       icon: "fa-clipboard-check",    tier: "strong" },
  { key: "smoothing_pass",        label: "Prose Smoother",   icon: "fa-wand-magic-sparkles", tier: "strong" },
];

const PIPELINE_PROMPTS: { key: keyof AiPrompts; label: string }[] = [
  { key: "research_pipeline", label: "Systematic / Meta / Narrative / Scoping" },
  { key: "subject_review",    label: "Subject Review" },
  { key: "educational",       label: "Educational" },
  { key: "case_study",        label: "Case Study" },
  { key: "comparative",       label: "Comparative Analysis" },
  { key: "exploratory",       label: "Exploratory Research" },
];

// ── Component ────────────────────────────────────────────────────────────────

export function SettingsPanel({ settings, onSettingsChange }: SettingsPanelProps) {
  const { params, setParams } = useResearchStore();
  const [tab, setTab] = useState<SettingsTab>("model");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const providers = Object.keys(PROVIDER_MODELS);

  // ── Settings helpers ──────────────────────────────────────────────────────

  const patchSettings = (patch: Partial<ZenithSettings>) =>
    settings && onSettingsChange({ ...settings, ...patch });

  const patchPrompts = (key: keyof AiPrompts, value: string) =>
    patchSettings({ ai_prompts: { ...(settings?.ai_prompts ?? {}), [key]: value } });

  const patchPipelineStep = (stepKey: keyof PipelineConfig, field: keyof PipelineStepConfig, value: unknown) => {
    const pc = settings?.pipeline_config ?? ({} as PipelineConfig);
    const current = pc[stepKey] ?? ({} as PipelineStepConfig);
    patchSettings({
      pipeline_config: { ...pc, [stepKey]: { ...current, [field]: value } },
    });
  };

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await invoke("save_settings", { newSettings: settings });
      setSaveMsg({ ok: true, text: "Saved" });
    } catch (e) {
      setSaveMsg({ ok: false, text: String(e).slice(0, 80) });
    }
    setSaving(false);
    setTimeout(() => setSaveMsg(null), 2500);
  };

  // ── Provider / model helpers ──────────────────────────────────────────────

  const handleProviderChange = (provider: string) => {
    const firstModel = PROVIDER_MODELS[provider]?.[0]?.id ?? "";
    const keyEntry = settings?.api_keys?.find((k) => k.provider === provider);
    setParams({ provider, model: firstModel, api_key: keyEntry?.key ?? "" });
  };

  const handleApiKeyChange = (key: string) => {
    setParams({ api_key: key });
    if (settings) {
      const api_keys = [...(settings.api_keys || [])];
      const idx = api_keys.findIndex((k) => k.provider === params.provider);
      if (idx >= 0) api_keys[idx] = { ...api_keys[idx], key };
      else api_keys.push({ provider: params.provider, label: params.provider, key, model: params.model, is_default: false });
      patchSettings({ api_keys });
    }
  };

  const handleTestConnection = async () => {
    setTestResult(null);
    try {
      const result = JSON.parse(await invoke<string>("process_file", {
        action: "run_pipeline_phase",
        argsJson: JSON.stringify({ phase: "test_connection", api_key: params.api_key, provider: params.provider, model: params.model }),
      }));
      setTestResult({ ok: result.ok, msg: result.ok ? `Connected — ${params.model}` : (result.error || "Failed") });
    } catch (e) { setTestResult({ ok: false, msg: String(e).slice(0, 80) }); }
  };

  const tabs: { id: SettingsTab; label: string; icon: string }[] = [
    { id: "model",   label: "Model",   icon: "fa-robot" },
    { id: "tools",   label: "Tools",   icon: "fa-wrench" },
    { id: "prompts", label: "Prompts", icon: "fa-scroll" },
    { id: "agents",  label: "Agents",  icon: "fa-diagram-project" },
  ];

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: t.font.sans }}>

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: t.border.subtle }}>
        <i className="fa-solid fa-gear text-[11px]" style={{ color: t.accent.cyan }} />
        <span className="text-[12px] font-semibold" style={{ color: t.text.secondary }}>Configuration</span>
      </div>

      {/* Tab bar */}
      <div className="flex items-center px-2 pt-2 gap-0.5 flex-wrap">
        {tabs.map((tb) => (
          <button key={tb.id} onClick={() => setTab(tb.id)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium transition-colors cursor-pointer"
            style={{
              background: tab === tb.id ? t.accent.cyanDim : "transparent",
              color: tab === tb.id ? t.accent.cyan : t.text.ghost,
              border: `1px solid ${tab === tb.id ? t.accent.cyanBorder : "transparent"}`,
            }}
          >
            <i className={`fa-solid ${tb.icon} text-[8px]`} />
            {tb.label}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4" style={{ scrollbarWidth: "thin", scrollbarColor: `${t.border.subtle} transparent` }}>

        {/* ══════════════════════════════════════════════════ MODEL TAB */}
        {tab === "model" && <>
          <Section label="Provider">
            <div className="grid grid-cols-3 gap-1">
              {providers.map((p) => (
                <button key={p} onClick={() => handleProviderChange(p)}
                  className="py-1.5 px-1 rounded-lg text-[10px] font-medium transition-colors cursor-pointer capitalize truncate"
                  style={{
                    background: params.provider === p ? t.accent.cyanDim : t.bg.elevated,
                    color: params.provider === p ? t.accent.cyan : t.text.muted,
                    border: `1px solid ${params.provider === p ? t.accent.cyanBorder : t.border.subtle}`,
                  }}
                >{p}</button>
              ))}
            </div>
          </Section>

          {params.provider && (
            <Section label="Model">
              <div className="space-y-0.5 max-h-36 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
                {(PROVIDER_MODELS[params.provider] ?? []).map((m) => (
                  <button key={m.id} onClick={() => setParams({ model: m.id })}
                    className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-[11px] transition-colors cursor-pointer"
                    style={{
                      background: params.model === m.id ? t.accent.cyanDim : "transparent",
                      color: params.model === m.id ? t.accent.cyan : t.text.muted,
                      border: `1px solid ${params.model === m.id ? t.accent.cyanBorder : "transparent"}`,
                    }}
                  >
                    <span>{m.label}</span>
                    {params.model === m.id && <i className="fa-solid fa-check text-[8px]" />}
                  </button>
                ))}
              </div>
            </Section>
          )}

          <Section label="API Key">
            <input type="password" value={params.api_key} onChange={(e) => handleApiKeyChange(e.target.value)}
              placeholder={`${params.provider || "provider"} API key…`}
              className="w-full px-3 py-2 rounded-lg text-[11px] outline-none"
              style={{ background: t.bg.elevated, color: t.text.primary, border: `1px solid ${t.border.default}`, fontFamily: t.font.mono }}
            />
            <div className="flex items-center gap-2 mt-1.5">
              <button onClick={handleTestConnection}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium cursor-pointer"
                style={{ background: t.bg.elevated, color: t.text.muted, border: `1px solid ${t.border.subtle}` }}
              >
                <i className="fa-solid fa-plug text-[8px]" /> Test
              </button>
              {testResult && (
                <span className="text-[10px] truncate" style={{ color: testResult.ok ? t.accent.emerald : t.accent.red }}>
                  <i className={`fa-solid ${testResult.ok ? "fa-check" : "fa-xmark"} mr-1 text-[8px]`} />
                  {testResult.msg}
                </span>
              )}
            </div>
          </Section>

          <Section label="Web Search Keys">
            {([["tavily_api_key", "Tavily"], ["brave_api_key", "Brave Search"], ["firecrawl_api_key", "Firecrawl"]] as const).map(([field, label]) => (
              <div key={field} className="mb-2">
                <div className="text-[9px] mb-0.5" style={{ color: t.text.ghost }}>{label}</div>
                <input type="password" value={(settings?.[field] as string) || ""}
                  onChange={(e) => patchSettings({ [field]: e.target.value })}
                  placeholder={`${label} key…`}
                  className="w-full px-3 py-1.5 rounded-lg text-[10px] outline-none"
                  style={{ background: t.bg.elevated, color: t.text.primary, border: `1px solid ${t.border.default}`, fontFamily: t.font.mono }}
                />
              </div>
            ))}
          </Section>

          <Section label="Generation">
            <SliderField label="Temperature" value={params.temperature} min={0} max={1} step={0.05}
              display={params.temperature.toFixed(2)} onChange={(v) => setParams({ temperature: v })} />
            <SliderField label="Max Tokens" value={params.max_tokens} min={1024} max={65536} step={512}
              display={params.max_tokens.toLocaleString()} onChange={(v) => setParams({ max_tokens: v })} />
          </Section>
        </>}

        {/* ══════════════════════════════════════════════════ TOOLS TAB */}
        {tab === "tools" && <>
          <div className="text-[10px]" style={{ color: t.text.ghost }}>Toggle tools available in chat mode</div>
          {(["primary", "auxiliary"] as const).map((group) => (
            <Section key={group} label={group === "primary" ? "Core Tools" : "Auxiliary Tools"}>
              <div className="space-y-1">
                {RESEARCH_TOOLS.filter((tool) => tool.group === group).map((tool) => {
                  const enabled = params.enabled_tools.includes(tool.id);
                  return (
                    <button key={tool.id} onClick={() => {
                      const next = enabled ? params.enabled_tools.filter((id) => id !== tool.id) : [...params.enabled_tools, tool.id];
                      setParams({ enabled_tools: next });
                    }}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer"
                      style={{ background: enabled ? t.accent.cyanDim : "transparent", border: `1px solid ${enabled ? t.accent.cyanBorder : "transparent"}` }}
                    >
                      <i className={`fa-solid ${tool.icon} text-[10px] w-4 text-center`} style={{ color: enabled ? t.accent.cyan : t.text.ghost }} />
                      <div className="flex-1 text-left">
                        <div className="text-[11px]" style={{ color: enabled ? t.text.primary : t.text.muted }}>{tool.label}</div>
                        <div className="text-[9px]" style={{ color: t.text.ghost }}>{tool.desc}</div>
                      </div>
                      <Toggle on={enabled} />
                    </button>
                  );
                })}
              </div>
            </Section>
          ))}
        </>}

        {/* ══════════════════════════════════════════════════ PROMPTS TAB */}
        {tab === "prompts" && <>
          <Section label="Chat System Prompt">
            <div className="text-[9px] mb-1.5" style={{ color: t.text.ghost }}>
              Defines the AI's persona in chat mode
            </div>
            <textarea
              value={params.system_prompt || ""}
              onChange={(e) => setParams({ system_prompt: e.target.value })}
              rows={6}
              className="w-full px-3 py-2.5 rounded-lg text-[11px] outline-none resize-none leading-relaxed"
              style={{ background: t.bg.elevated, color: t.text.secondary, border: `1px solid ${t.border.default}`, fontFamily: t.font.sans }}
            />
          </Section>

          <div className="border-t my-1" style={{ borderColor: t.border.subtle }} />

          <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: t.text.ghost, fontFamily: t.font.mono }}>
            Pipeline Prompts
          </div>
          <div className="text-[9px] mt-0.5 mb-2" style={{ color: t.text.ghost }}>
            These prompts are loaded from settings and passed to each pipeline phase as the global system context. Per-agent overrides are in the Agents tab.
          </div>

          {PIPELINE_PROMPTS.map(({ key, label }) => (
            <PromptField
              key={key}
              label={label}
              value={settings?.ai_prompts?.[key] ?? ""}
              onChange={(v) => patchPrompts(key, v)}
            />
          ))}
        </>}

        {/* ══════════════════════════════════════════════════ AGENTS TAB */}
        {tab === "agents" && <AgentsTab settings={settings} patchStep={patchPipelineStep} />}
      </div>

      {/* Save bar */}
      <div className="px-4 py-3 border-t" style={{ borderColor: t.border.subtle }}>
        {saveMsg && (
          <div className="text-[10px] mb-2 text-center" style={{ color: saveMsg.ok ? t.accent.emerald : t.accent.red }}>
            <i className={`fa-solid ${saveMsg.ok ? "fa-check" : "fa-xmark"} mr-1 text-[9px]`} />
            {saveMsg.text}
          </div>
        )}
        <button onClick={handleSave} disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[11px] font-medium cursor-pointer disabled:opacity-40"
          style={{ background: t.accent.cyanDim, color: t.accent.cyan, border: `1px solid ${t.accent.cyanBorder}` }}
        >
          {saving
            ? <><i className="fa-solid fa-circle-notch fa-spin text-[9px]" /> Saving…</>
            : <><i className="fa-solid fa-floppy-disk text-[9px]" /> Save All Settings</>
          }
        </button>
      </div>
    </div>
  );
}

// ── Agents Tab ───────────────────────────────────────────────────────────────

function AgentsTab({
  settings,
  patchStep,
}: {
  settings: ZenithSettings | null;
  patchStep: (key: keyof PipelineConfig, field: keyof PipelineStepConfig, value: unknown) => void;
}) {
  const [selectedStep, setSelectedStep] = useState<keyof PipelineConfig>("gatekeeper");
  const pc = settings?.pipeline_config;
  const step = pc?.[selectedStep] ?? ({} as PipelineStepConfig);

  return (
    <>
      {/* Step selector */}
      <div className="flex flex-wrap gap-1 mb-3">
        {PIPELINE_STEPS.map((s) => (
          <button key={s.key} onClick={() => setSelectedStep(s.key)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-medium cursor-pointer transition-colors"
            style={{
              background: selectedStep === s.key ? t.accent.cyanDim : t.bg.elevated,
              color: selectedStep === s.key ? t.accent.cyan : t.text.ghost,
              border: `1px solid ${selectedStep === s.key ? t.accent.cyanBorder : t.border.subtle}`,
            }}
          >
            <i className={`fa-solid ${s.icon} text-[7px]`} />
            {s.label}
          </button>
        ))}
      </div>

      {/* Step config */}
      <Section label="System Prompt Override">
        <div className="text-[9px] mb-1.5" style={{ color: t.text.ghost }}>
          Overrides the global pipeline prompt for this specific agent step. Leave empty to use the global prompt.
        </div>
        <textarea
          value={step.system_prompt ?? ""}
          onChange={(e) => patchStep(selectedStep, "system_prompt", e.target.value)}
          rows={7}
          placeholder="Leave empty to use global pipeline prompt…"
          className="w-full px-3 py-2.5 rounded-lg text-[11px] outline-none resize-none leading-relaxed"
          style={{ background: t.bg.elevated, color: t.text.secondary, border: `1px solid ${t.border.default}`, fontFamily: t.font.sans }}
        />
      </Section>

      <Section label="Model Tier">
        <div className="flex gap-1.5">
          {(["fast", "strong"] as const).map((tier) => (
            <button key={tier} onClick={() => patchStep(selectedStep, "model_tier", tier)}
              className="flex-1 py-1.5 rounded-lg text-[10px] font-medium cursor-pointer capitalize"
              style={{
                background: (step.model_tier ?? "strong") === tier ? t.accent.cyanDim : t.bg.elevated,
                color: (step.model_tier ?? "strong") === tier ? t.accent.cyan : t.text.muted,
                border: `1px solid ${(step.model_tier ?? "strong") === tier ? t.accent.cyanBorder : t.border.subtle}`,
              }}
            >
              {tier === "fast" ? "⚡ Fast" : "🧠 Strong"}
            </button>
          ))}
        </div>
        <div className="text-[9px] mt-1" style={{ color: t.text.ghost }}>
          Fast = cheaper model for screening. Strong = capable model for drafting.
        </div>
      </Section>

      <Section label="Generation">
        <SliderField label="Temperature" value={step.temperature ?? 0.2} min={0} max={1} step={0.05}
          display={(step.temperature ?? 0.2).toFixed(2)} onChange={(v) => patchStep(selectedStep, "temperature", v)} />
        <SliderField label="Max Tokens" value={step.max_tokens ?? 4096} min={512} max={65536} step={512}
          display={(step.max_tokens ?? 4096).toLocaleString()} onChange={(v) => patchStep(selectedStep, "max_tokens", v)} />
      </Section>

      <Section label="Extended Thinking">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px]" style={{ color: t.text.muted }}>Enable Thinking</span>
          <button onClick={() => patchStep(selectedStep, "use_thinking", !(step.use_thinking ?? false))}
            className="cursor-pointer">
            <Toggle on={step.use_thinking ?? false} />
          </button>
        </div>
        {(step.use_thinking ?? false) && (
          <SliderField label="Thinking Budget" value={step.thinking_budget ?? 8192} min={1024} max={32768} step={1024}
            display={`${((step.thinking_budget ?? 8192) / 1024).toFixed(0)}K`}
            onChange={(v) => patchStep(selectedStep, "thinking_budget", v)} />
        )}
      </Section>

      <Section label="Output Format">
        <div className="flex items-center justify-between">
          <span className="text-[11px]" style={{ color: t.text.muted }}>Structured JSON Output</span>
          <button onClick={() => patchStep(selectedStep, "use_structured_output", !(step.use_structured_output ?? false))}
            className="cursor-pointer">
            <Toggle on={step.use_structured_output ?? false} />
          </button>
        </div>
        <div className="text-[9px] mt-1" style={{ color: t.text.ghost }}>
          Forces LLM to return valid JSON. Enable for gatekeeper, query architect, and triage phases.
        </div>
      </Section>
    </>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: t.text.ghost, fontFamily: t.font.mono }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function SliderField({
  label, value, min, max, step, display, onChange,
}: { label: string; value: number; min: number; max: number; step: number; display: string; onChange: (v: number) => void }) {
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px]" style={{ color: t.text.muted }}>{label}</span>
        <span className="text-[10px]" style={{ color: t.accent.cyan, fontFamily: t.font.mono }}>{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 rounded-full appearance-none cursor-pointer"
        style={{ accentColor: t.accent.cyan }}
      />
    </div>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <div className="w-9 h-5 rounded-full flex items-center transition-all px-0.5"
      style={{ background: on ? t.accent.cyan : t.border.default }}
    >
      <div className="w-4 h-4 rounded-full bg-white shadow transition-transform"
        style={{ transform: on ? "translateX(16px)" : "translateX(0px)" }} />
    </div>
  );
}

function PromptField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-lg overflow-hidden mb-2" style={{ borderColor: t.border.subtle }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 cursor-pointer"
        style={{ background: t.bg.elevated }}
      >
        <span className="text-[11px]" style={{ color: t.text.secondary }}>{label}</span>
        <i className={`fa-solid fa-chevron-${open ? "up" : "down"} text-[8px]`} style={{ color: t.text.ghost }} />
      </button>
      {open && (
        <div className="px-3 pt-0 pb-3" style={{ background: t.bg.surface }}>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={8}
            className="w-full px-3 py-2.5 rounded-lg text-[11px] outline-none resize-none leading-relaxed mt-2"
            style={{ background: t.bg.elevated, color: t.text.secondary, border: `1px solid ${t.border.default}`, fontFamily: t.font.sans }}
          />
          <div className="text-[9px] mt-1" style={{ color: t.text.ghost }}>
            Loaded from Settings → passed to Python as <code style={{ fontFamily: t.font.mono }}>system_prompt</code> for this study design.
          </div>
        </div>
      )}
    </div>
  );
}
