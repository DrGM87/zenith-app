import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useResearchStore } from "../../stores/useResearchStore";
import { THEME as t } from "./shared/constants";

const PHASE_META: Record<string, { icon: string; label: string; group: string }> = {
  validating:         { icon: "fa-shield-halved",    label: "Gatekeeper",         group: "Entry" },
  generating_queries: { icon: "fa-diagram-project",  label: "Query Architect",    group: "Search" },
  harvesting:         { icon: "fa-seedling",         label: "Multi-DB Harvester", group: "Search" },
  triaging:           { icon: "fa-filter",           label: "Title-Abstract Screener", group: "Screen" },
  acquiring:          { icon: "fa-download",         label: "PDF Acquisitor",     group: "Acquire" },
  extracting:         { icon: "fa-file-pdf",         label: "PDF Text Extractor", group: "Parse" },
  ingesting:          { icon: "fa-database",         label: "Vector Ingestor",    group: "Store" },
  blueprinting:       { icon: "fa-sitemap",          label: "Blueprint Architect", group: "Synthesize" },
  drafting:           { icon: "fa-pen-nib",          label: "Section Drafter",    group: "Synthesize" },
  generating_figures: { icon: "fa-chart-bar",        label: "Chart Generator",    group: "Synthesize" },
  citation_verifying: { icon: "fa-check-double",     label: "Citation Verifier",  group: "Verify" },
  guidelines_checking:{ icon: "fa-clipboard-check",  label: "Guidelines Checker", group: "Verify" },
  smoothing:          { icon: "fa-wand-magic-sparkles", label: "Prose Smoother",  group: "Polish" },
  compiling:          { icon: "fa-file-export",      label: "LaTeX Compiler",     group: "Polish" },
};

const GROUP_COLORS: Record<string, string> = {
  Entry: t.accent.cyan,
  Search: "#818cf8",
  Screen: "#c084fc",
  Acquire: "#fb923c",
  Parse: "#facc15",
  Store: "#2dd4bf",
  Synthesize: t.accent.emerald,
  Verify: t.accent.amber,
  Polish: "#f472b6",
};

export function AgentActivityFeed() {
  const { pipeline } = useResearchStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const phases = Object.keys(PHASE_META);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [pipeline.phase, pipeline.logs.length]);

  const currentIdx = phases.indexOf(pipeline.phase);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ fontFamily: t.font.sans }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: t.border.subtle }}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: pipeline.active ? t.accent.emerald : t.text.ghost, boxShadow: pipeline.active ? `0 0 8px ${t.accent.emerald}` : "none" }} />
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: t.text.secondary, fontFamily: t.font.mono }}>
            Agent Activity
          </span>
        </div>
        {pipeline.active && (
          <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: t.accent.emeraldDim, color: t.accent.emerald, fontFamily: t.font.mono }}>
            {pipeline.progress}%
          </span>
        )}
      </div>

      {/* Timeline */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3" style={{ scrollbarWidth: "thin", scrollbarColor: `${t.border.subtle} transparent` }}>
        <div className="relative">
          {/* Vertical connector line */}
          <div className="absolute left-[15px] top-3 bottom-3 w-px" style={{ background: `linear-gradient(180deg, ${t.border.default}, transparent)` }} />

          <AnimatePresence initial={false}>
            {phases.map((phaseId, idx) => {
              const meta = PHASE_META[phaseId];
              const isActive = phaseId === pipeline.phase;
              const isDone = idx < currentIdx || pipeline.phase === "complete";
              const isPending = idx > currentIdx && pipeline.phase !== "complete";
              const groupColor = GROUP_COLORS[meta.group] || t.accent.cyan;
              const phaseLogs = pipeline.logs.filter((l) => {
                const phaseLabels = [meta.label.toLowerCase(), phaseId.replace(/_/g, " ")];
                return phaseLabels.some((pl) => l.phase.toLowerCase().includes(pl.split(" ")[0]));
              });

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
                      className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-[11px] transition-all duration-300"
                      style={{
                        background: isDone ? `${groupColor}20` : isActive ? `${groupColor}25` : t.bg.surface,
                        border: `1px solid ${isDone ? `${groupColor}40` : isActive ? `${groupColor}50` : t.border.subtle}`,
                        color: isDone || isActive ? groupColor : t.text.ghost,
                        boxShadow: isActive ? `0 0 12px ${groupColor}30` : "none",
                      }}
                    >
                      {isDone ? <i className="fa-solid fa-check text-[10px]" /> : <i className={`fa-solid ${meta.icon} text-[10px]`} />}
                    </div>
                    {isActive && (
                      <div className="absolute -inset-1 rounded-xl animate-ping" style={{ background: `${groupColor}10`, border: `1px solid ${groupColor}20` }} />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pb-3">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[11px] font-medium" style={{ color: isDone || isActive ? t.text.primary : t.text.muted }}>
                        {meta.label}
                      </span>
                      <span className="text-[8px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-semibold"
                        style={{ background: `${groupColor}15`, color: groupColor, fontFamily: t.font.mono }}
                      >
                        {meta.group}
                      </span>
                    </div>

                    {/* Log entries for this phase */}
                    {(isDone || isActive) && phaseLogs.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {phaseLogs.slice(-3).map((log, li) => (
                          <div key={li} className="flex items-start gap-1.5 text-[10px]" style={{ fontFamily: t.font.mono }}>
                            <i className={`fa-solid ${
                              log.level === "success" ? "fa-check" :
                              log.level === "error" ? "fa-xmark" :
                              log.level === "warn" ? "fa-exclamation" :
                              "fa-circle"
                            } text-[7px] mt-[4px]`} style={{
                              color: log.level === "success" ? t.accent.emerald :
                                     log.level === "error" ? t.accent.red :
                                     log.level === "warn" ? t.accent.amber :
                                     t.text.ghost,
                            }} />
                            <span className="flex-1 break-words" style={{
                              color: log.level === "success" ? `${t.accent.emerald}aa` :
                                     log.level === "error" ? `${t.accent.red}bb` :
                                     log.level === "warn" ? `${t.accent.amber}aa` :
                                     t.text.tertiary,
                            }}>
                              {log.message.length > 120 ? log.message.slice(0, 117) + "..." : log.message}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* Progress bar */}
      {(pipeline.active || pipeline.phase === "complete") && (
        <div className="px-4 py-2.5 border-t" style={{ borderColor: t.border.subtle }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] truncate" style={{ color: t.text.muted, fontFamily: t.font.mono }}>
              {pipeline.statusMessage || "Preparing..."}
            </span>
          </div>
          <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: t.bg.surface }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: pipeline.phase === "error" ? t.accent.red : `linear-gradient(90deg, ${t.accent.cyan}, ${t.accent.emerald})` }}
              animate={{ width: `${pipeline.progress}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
