import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useResearchStore } from "../../stores/useResearchStore";
import { THEME as t } from "./shared/constants";

// ── Phase metadata ────────────────────────────────────────────────────────────

const PHASE_META: Record<string, { icon: string; label: string; group: string; phaseKey: string }> = {
  validating:           { icon: "fa-shield-halved",       label: "Gatekeeper",            group: "Entry",      phaseKey: "validate" },
  generating_queries:   { icon: "fa-diagram-project",     label: "Query Architect",       group: "Search",     phaseKey: "generate_queries" },
  harvesting:           { icon: "fa-seedling",            label: "Multi-DB Harvester",    group: "Search",     phaseKey: "harvest" },
  triaging:             { icon: "fa-filter",              label: "Title/Abstract Screen", group: "Screen",     phaseKey: "triage" },
  acquiring:            { icon: "fa-download",            label: "PDF Acquisitor",        group: "Acquire",    phaseKey: "acquire" },
  extracting:           { icon: "fa-file-pdf",            label: "PDF Text Extractor",    group: "Parse",      phaseKey: "extract" },
  ingesting:            { icon: "fa-database",            label: "Vector Ingestor",       group: "Store",      phaseKey: "ingest" },
  blueprinting:         { icon: "fa-sitemap",             label: "Blueprint Architect",   group: "Synthesize", phaseKey: "blueprint" },
  drafting:             { icon: "fa-pen-nib",             label: "Section Drafter",       group: "Synthesize", phaseKey: "draft" },
  generating_figures:   { icon: "fa-chart-bar",           label: "Chart Generator",       group: "Synthesize", phaseKey: "generate_figures" },
  citation_verifying:   { icon: "fa-check-double",        label: "Citation Verifier",     group: "Verify",     phaseKey: "citation_verify" },
  guidelines_checking:  { icon: "fa-clipboard-check",     label: "Guidelines Checker",    group: "Verify",     phaseKey: "guidelines_check" },
  smoothing:            { icon: "fa-wand-magic-sparkles", label: "Prose Smoother",        group: "Polish",     phaseKey: "smooth" },
  compiling:            { icon: "fa-file-export",         label: "Reference Compiler",    group: "Polish",     phaseKey: "compile_refs" },
};

const GROUP_COLORS: Record<string, string> = {
  Entry:      t.accent.cyan,
  Search:     "#818cf8",
  Screen:     "#c084fc",
  Acquire:    "#fb923c",
  Parse:      "#facc15",
  Store:      "#2dd4bf",
  Synthesize: t.accent.emerald,
  Verify:     t.accent.amber,
  Polish:     "#f472b6",
};

const LEVEL_ICON: Record<string, string> = {
  success: "fa-check-circle",
  error:   "fa-circle-xmark",
  warn:    "fa-triangle-exclamation",
  info:    "fa-circle-dot",
};

const LEVEL_COLOR = (level: string) => ({
  success: t.accent.emerald,
  error:   t.accent.red,
  warn:    t.accent.amber,
  info:    t.text.ghost,
}[level] ?? t.text.ghost);

// ── Component ─────────────────────────────────────────────────────────────────

interface AgentActivityFeedProps {
  onRetry?: () => void;
  onContinue?: (fromPhase: string) => void;
}

export function AgentActivityFeed({ onRetry, onContinue }: AgentActivityFeedProps) {
  const { pipeline } = useResearchStore();
  const stepsScrollRef = useRef<HTMLDivElement>(null);
  const logScrollRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"steps" | "log">("steps");
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);

  const phases = Object.keys(PHASE_META);
  const currentIdx = phases.indexOf(pipeline.phase);
  const isError = pipeline.phase === "error";
  const isComplete = pipeline.phase === "complete";
  const isStopped = !pipeline.active && (isError || isComplete);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (tab === "steps") {
      stepsScrollRef.current?.scrollTo({ top: stepsScrollRef.current.scrollHeight, behavior: "smooth" });
    } else {
      logScrollRef.current?.scrollTo({ top: logScrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [pipeline.phase, pipeline.logs.length, tab]);

  // Auto-switch to log tab on error to show full details
  useEffect(() => {
    if (isError) setTab("log");
  }, [isError]);

  return (
    <div className="flex flex-col h-full overflow-hidden select-none" style={{ fontFamily: t.font.sans }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: t.border.subtle }}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full flex-shrink-0 transition-all" style={{
            background: pipeline.active ? t.accent.emerald : isError ? t.accent.red : isComplete ? t.accent.cyan : t.text.ghost,
            boxShadow: pipeline.active ? `0 0 8px ${t.accent.emerald}60` : "none",
          }} />
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: t.text.secondary, fontFamily: t.font.mono }}>
            {pipeline.active ? "Running" : isError ? "Failed" : isComplete ? "Complete" : "Agents"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {pipeline.active && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: t.accent.emeraldDim, color: t.accent.emerald, fontFamily: t.font.mono }}>
              {pipeline.progress}%
            </span>
          )}
          {/* Tab switcher */}
          {(pipeline.logs.length > 0 || isError) && (
            <div className="flex rounded-md overflow-hidden ml-2" style={{ border: `1px solid ${t.border.subtle}` }}>
              {([
                { id: "steps" as const, icon: "fa-list-check", title: "Step view" },
                { id: "log" as const, icon: "fa-terminal", title: "Full log" },
              ]).map(({ id, icon, title }) => (
                <button key={id} onClick={() => setTab(id)} title={title}
                  className="w-6 h-6 flex items-center justify-center cursor-pointer transition-all"
                  style={{
                    background: tab === id ? t.accent.cyanDim : "transparent",
                    color: tab === id ? t.accent.cyan : t.text.ghost,
                  }}
                >
                  <i className={`fa-solid ${icon} text-[9px]`} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Error banner */}
      {isError && pipeline.error && (
        <div className="mx-3 mt-2 mb-1 px-3 py-2.5 rounded-lg flex-shrink-0"
          style={{ background: t.accent.redDim, border: `1px solid ${t.accent.red}30` }}>
          <div className="flex items-start gap-2">
            <i className="fa-solid fa-circle-xmark text-[11px] mt-0.5 flex-shrink-0" style={{ color: t.accent.red }} />
            <div>
              <div className="text-[10px] font-semibold mb-0.5" style={{ color: t.accent.red }}>Pipeline Failed</div>
              <div className="text-[10px] leading-relaxed break-words select-text" style={{ color: `${t.accent.red}bb` }}>
                {pipeline.error}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Steps tab ─────────────────────────────────────────────────────── */}
      {tab === "steps" && (
        <div ref={stepsScrollRef} className="flex-1 overflow-y-auto px-3 py-3"
          style={{ scrollbarWidth: "thin", scrollbarColor: `${t.border.subtle} transparent` }}>
          <div className="relative">
            {/* Vertical connector */}
            <div className="absolute left-[15px] top-3 bottom-3 w-px"
              style={{ background: `linear-gradient(180deg, ${t.border.default}, transparent)` }} />

            <AnimatePresence initial={false}>
              {phases.map((phaseId, idx) => {
                const meta = PHASE_META[phaseId];
                const isActive = phaseId === pipeline.phase;
                const isDone = idx < currentIdx || isComplete;
                const hasFailed = pipeline.failedPhase === meta.phaseKey;
                const isPending = !isDone && !isActive;
                const groupColor = GROUP_COLORS[meta.group] || t.accent.cyan;

                // Collect all log entries for this phase
                const phaseLogs = pipeline.logs.filter((l) => {
                  const phaseLabels = [meta.label.toLowerCase(), phaseId.replace(/_/g, " "), meta.phaseKey.replace(/_/g, " ")];
                  return phaseLabels.some((pl) => l.phase.toLowerCase().includes(pl.split(" ")[0]));
                });

                const isExpanded = expandedPhase === phaseId || isActive;

                return (
                  <motion.div
                    key={phaseId}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: isPending ? 0.3 : 1, x: 0 }}
                    transition={{ delay: idx * 0.02, duration: 0.2 }}
                    className="relative flex gap-3 mb-1"
                  >
                    {/* Node */}
                    <div className="relative z-10 flex-shrink-0 mt-1">
                      <div
                        className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-[11px] transition-all duration-300 cursor-pointer"
                        style={{
                          background: hasFailed ? `${t.accent.red}20` : isDone ? `${groupColor}20` : isActive ? `${groupColor}25` : t.bg.surface,
                          border: `1px solid ${hasFailed ? `${t.accent.red}40` : isDone ? `${groupColor}40` : isActive ? `${groupColor}50` : t.border.subtle}`,
                          color: hasFailed ? t.accent.red : (isDone || isActive) ? groupColor : t.text.ghost,
                          boxShadow: isActive ? `0 0 12px ${groupColor}30` : "none",
                        }}
                        onClick={() => setExpandedPhase(expandedPhase === phaseId ? null : phaseId)}
                        title={`${meta.label} — click to ${isExpanded ? "collapse" : "expand"} logs`}
                      >
                        {hasFailed ? (
                          <i className="fa-solid fa-xmark text-[10px]" />
                        ) : isDone ? (
                          <i className="fa-solid fa-check text-[10px]" />
                        ) : (
                          <i className={`fa-solid ${meta.icon} text-[10px]`} />
                        )}
                      </div>
                      {isActive && (
                        <div className="absolute -inset-1 rounded-xl animate-ping opacity-30"
                          style={{ background: `${groupColor}10`, border: `1px solid ${groupColor}20` }} />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pb-3">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[11px] font-medium cursor-pointer select-text"
                          style={{ color: hasFailed ? t.accent.red : (isDone || isActive) ? t.text.primary : t.text.muted }}
                          onClick={() => setExpandedPhase(expandedPhase === phaseId ? null : phaseId)}
                        >
                          {meta.label}
                        </span>
                        <span className="text-[8px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-semibold"
                          style={{ background: `${groupColor}15`, color: groupColor, fontFamily: t.font.mono }}
                        >
                          {meta.group}
                        </span>
                        {phaseLogs.length > 0 && !isActive && (
                          <span className="text-[8px] cursor-pointer" style={{ color: t.text.ghost }}
                            onClick={() => setExpandedPhase(expandedPhase === phaseId ? null : phaseId)}
                          >
                            {isExpanded ? "▲" : `▼ ${phaseLogs.length}`}
                          </span>
                        )}
                      </div>

                      {/* Log entries for this phase */}
                      <AnimatePresence>
                        {isExpanded && phaseLogs.length > 0 && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="overflow-hidden mt-1 space-y-0.5"
                          >
                            {phaseLogs.map((log, li) => (
                              <div key={li} className="flex items-start gap-1.5 text-[10px]" style={{ fontFamily: t.font.mono }}>
                                <i className={`fa-solid ${LEVEL_ICON[log.level] || "fa-circle-dot"} text-[8px] mt-[3px] flex-shrink-0`}
                                  style={{ color: LEVEL_COLOR(log.level) }} />
                                <span className="flex-1 break-words leading-relaxed select-text"
                                  style={{ color: LEVEL_COLOR(log.level) === t.text.ghost ? t.text.tertiary : LEVEL_COLOR(log.level) + "cc" }}
                                >
                                  {log.message}
                                </span>
                              </div>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Retry step button — shown when this step failed */}
                      {hasFailed && onContinue && (
                        <button
                          onClick={() => onContinue(meta.phaseKey)}
                          className="mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-md text-[9px] font-medium cursor-pointer transition-all"
                          style={{ background: t.accent.amberDim, color: t.accent.amber, border: `1px solid ${t.accent.amber}30` }}
                        >
                          <i className="fa-solid fa-rotate-right text-[8px]" /> Retry from here
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* ── Log tab ───────────────────────────────────────────────────────── */}
      {tab === "log" && (
        <div ref={logScrollRef} className="flex-1 overflow-y-auto px-3 py-2"
          style={{ scrollbarWidth: "thin", scrollbarColor: `${t.border.subtle} transparent` }}>
          {pipeline.logs.length === 0 ? (
            <div className="text-center py-10 text-[11px]" style={{ color: t.text.ghost }}>
              No log entries yet
            </div>
          ) : (
            <div className="space-y-px">
              {pipeline.logs.map((log, i) => (
                <div key={i} className="flex items-start gap-2 py-1 px-2 rounded hover:bg-white/[0.02] group transition-colors">
                  <i className={`fa-solid ${LEVEL_ICON[log.level] || "fa-circle-dot"} text-[8px] mt-[4px] flex-shrink-0`}
                    style={{ color: LEVEL_COLOR(log.level) }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[9px] px-1 py-px rounded uppercase tracking-wider font-semibold"
                        style={{ background: `${LEVEL_COLOR(log.level)}15`, color: LEVEL_COLOR(log.level), fontFamily: t.font.mono }}>
                        {log.phase}
                      </span>
                      <span className="text-[9px]" style={{ color: t.text.ghost, fontFamily: t.font.mono }}>{log.time}</span>
                    </div>
                    <div className="text-[10px] leading-relaxed break-words select-text"
                      style={{ color: log.level === "error" ? `${t.accent.red}cc` : log.level === "warn" ? `${t.accent.amber}cc` : log.level === "success" ? `${t.accent.emerald}aa` : t.text.tertiary }}>
                      {log.message}
                    </div>
                  </div>
                  {/* Copy log line */}
                  <button onClick={() => navigator.clipboard.writeText(`[${log.time}] [${log.phase}] ${log.message}`)}
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-[8px] cursor-pointer flex-shrink-0 mt-0.5 transition-opacity"
                    style={{ color: t.text.ghost }}
                    title="Copy log entry">
                    <i className="fa-solid fa-copy" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Progress bar + actions */}
      {(pipeline.active || isComplete || isError) && (
        <div className="px-4 py-2.5 border-t flex-shrink-0" style={{ borderColor: t.border.subtle }}>
          {/* Progress */}
          {(pipeline.active || isComplete) && (
            <>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] truncate" style={{ color: t.text.muted, fontFamily: t.font.mono }}>
                  {pipeline.statusMessage || (isComplete ? "Complete!" : "Preparing...")}
                </span>
              </div>
              <div className="w-full h-1 rounded-full overflow-hidden mb-2" style={{ background: t.bg.surface }}>
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: `linear-gradient(90deg, ${t.accent.cyan}, ${t.accent.emerald})` }}
                  animate={{ width: `${pipeline.progress}%` }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                />
              </div>
            </>
          )}

          {/* Retry/Continue actions when stopped */}
          {isStopped && (onRetry || onContinue) && (
            <div className="flex gap-2 mt-1">
              {onRetry && (
                <button onClick={onRetry}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[10px] font-medium cursor-pointer transition-all"
                  style={{ background: t.bg.surface, color: t.text.muted, border: `1px solid ${t.border.subtle}` }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = t.accent.cyan; e.currentTarget.style.borderColor = t.accent.cyanBorder; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = t.text.muted; e.currentTarget.style.borderColor = t.border.subtle; }}
                >
                  <i className="fa-solid fa-rotate-right text-[9px]" /> Retry All
                </button>
              )}
              {onContinue && pipeline.lastGoodPhase && isError && (
                <button onClick={() => onContinue(pipeline.lastGoodPhase!)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[10px] font-medium cursor-pointer transition-all"
                  style={{ background: t.accent.amberDim, color: t.accent.amber, border: `1px solid ${t.accent.amber}30` }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = `${t.accent.amber}20`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = t.accent.amberDim; }}
                >
                  <i className="fa-solid fa-forward-step text-[9px]" /> Continue
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
