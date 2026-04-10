import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useResearchStore } from "../../stores/useResearchStore";
import { THEME as t } from "./shared/constants";
import { fmtCost } from "./shared/helpers";

// Individual quick-export formats (single file)
const QUICK_FORMATS = [
  { id: "markdown", label: "Markdown", icon: "fa-file-lines", ext: ".md" },
  { id: "latex",    label: "LaTeX",    icon: "fa-file-code",  ext: ".tex" },
  { id: "bibtex",   label: "BibTeX",   icon: "fa-quote-right", ext: ".bib" },
  { id: "json",     label: "JSON",     icon: "fa-file-code",  ext: ".json" },
];

interface HeaderBarProps {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onExport: (format: string) => void;
  onNew: () => void;
  isExporting?: boolean;
}

export function HeaderBar({
  leftCollapsed, rightCollapsed, onToggleLeft, onToggleRight,
  onExport, onNew, isExporting = false,
}: HeaderBarProps) {
  const { viewMode, setViewMode, activeThread, renameThread } = useResearchStore();
  const thread = activeThread();
  const [showExport, setShowExport] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState("");

  const doExport = (fmt: string) => {
    if (isExporting) return;
    onExport(fmt);
    setShowExport(false);
  };

  return (
    <header
      className="flex items-center gap-3 px-4 py-2 border-b select-none relative z-40"
      style={{
        background: `linear-gradient(180deg, ${t.bg.elevated} 0%, ${t.bg.surface} 100%)`,
        borderColor: t.border.subtle,
        fontFamily: t.font.sans,
      }}
    >
      {/* Bottom scan-line accent */}
      <div className="absolute inset-x-0 bottom-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent 0%, ${t.accent.cyan}20 50%, transparent 100%)` }} />

      {/* Left sidebar toggle */}
      <button onClick={onToggleLeft}
        title={leftCollapsed ? "Show sidebar" : "Hide sidebar"}
        className="w-7 h-7 rounded-md flex items-center justify-center transition-all duration-200 cursor-pointer"
        style={{ color: t.text.muted, background: leftCollapsed ? t.accent.cyanDim : "transparent" }}
      >
        <i className={`fa-solid ${leftCollapsed ? "fa-bars" : "fa-chevron-left"} text-[10px]`} />
      </button>

      {/* Mode toggle pill */}
      <div className="flex rounded-lg overflow-hidden" style={{ border: `1px solid ${t.border.subtle}`, background: t.bg.void }}>
        {([
          { mode: "chat" as const,     label: "Chat",     icon: "fa-comments", color: t.accent.cyan },
          { mode: "pipeline" as const, label: "Pipeline", icon: "fa-bolt",     color: t.accent.emerald },
        ]).map(({ mode, label, icon, color }) => (
          <button key={mode} onClick={() => setViewMode(mode)}
            className="px-3 py-1.5 text-[11px] font-medium transition-all duration-200 cursor-pointer relative"
            style={{
              color: viewMode === mode ? color : t.text.muted,
              background: viewMode === mode ? `${color}12` : "transparent",
            }}
          >
            {viewMode === mode && (
              <motion.div layoutId="mode-indicator" className="absolute inset-x-0 bottom-0 h-[2px] rounded-full" style={{ background: color }} />
            )}
            <i className={`fa-solid ${icon} text-[9px] mr-1.5`} />{label}
          </button>
        ))}
      </div>

      {/* Thread title (double-click to rename) */}
      <div className="flex-1 flex items-center gap-2.5 min-w-0">
        <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: t.accent.cyanDim }}>
          <i className="fa-solid fa-dna text-[10px]" style={{ color: t.accent.cyan }} />
        </div>
        {editing ? (
          <input
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onBlur={() => { if (editVal.trim() && thread) renameThread(thread.id, editVal.trim()); setEditing(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { if (editVal.trim() && thread) renameThread(thread.id, editVal.trim()); setEditing(false); }
              if (e.key === "Escape") setEditing(false);
            }}
            className="bg-transparent border-b px-1 py-0.5 text-sm outline-none flex-1 select-text"
            style={{ color: t.text.primary, borderColor: t.accent.cyan }}
            autoFocus
          />
        ) : (
          <span
            className="text-[13px] font-medium truncate cursor-pointer hover:opacity-80 transition-opacity"
            style={{ color: t.text.primary }}
            onDoubleClick={() => { if (thread) { setEditing(true); setEditVal(thread.title); } }}
            title="Double-click to rename"
          >
            {thread?.title || "New Research"}
          </span>
        )}
      </div>

      {/* Thread cost badge */}
      {(thread?.total_cost ?? 0) > 0 && (
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] flex-shrink-0"
          style={{ background: t.accent.cyanDim, color: t.accent.cyan, border: `1px solid ${t.accent.cyanBorder}`, fontFamily: t.font.mono }}
        >
          <i className="fa-solid fa-coins text-[8px]" />
          {fmtCost(thread!.total_cost)}
        </div>
      )}

      <div className="w-px h-5 flex-shrink-0" style={{ background: t.border.subtle }} />

      {/* Export dropdown */}
      <div className="relative flex-shrink-0">
        <button
          onClick={() => !isExporting && setShowExport(!showExport)}
          disabled={isExporting}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ color: showExport ? t.accent.cyan : t.text.muted, background: showExport ? t.accent.cyanDim : "transparent" }}
        >
          {isExporting
            ? <><i className="fa-solid fa-circle-notch fa-spin text-[9px]" /> Exporting…</>
            : <><i className="fa-solid fa-arrow-up-from-bracket text-[9px]" /> Export</>
          }
        </button>

        <AnimatePresence>
          {showExport && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-1.5 z-50 rounded-xl overflow-hidden shadow-2xl"
              style={{ background: t.bg.elevated, border: `1px solid ${t.border.default}`, minWidth: 220 }}
            >
              {/* ── Full Package (primary) ─────────────────────────────── */}
              <div className="p-2">
                <button
                  onClick={() => doExport("snapshot")}
                  className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all text-left"
                  style={{ background: t.accent.emeraldDim, border: `1px solid ${t.accent.emeraldBorder}` }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = `${t.accent.emerald}20`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = t.accent.emeraldDim; }}
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: t.accent.emeraldDim, border: `1px solid ${t.accent.emeraldBorder}` }}>
                    <i className="fa-solid fa-box-archive text-[12px]" style={{ color: t.accent.emerald }} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold" style={{ color: t.accent.emerald }}>Export Full Package</div>
                    <div className="text-[10px] leading-relaxed mt-0.5" style={{ color: `${t.accent.emerald}99` }}>
                      Folder with PDF, DOCX, figures, references, BibTeX, logs &amp; chat history
                    </div>
                  </div>
                </button>
              </div>

              {/* ── Divider ────────────────────────────────────────────── */}
              <div className="flex items-center gap-2 px-3 pb-1">
                <div className="flex-1 h-px" style={{ background: t.border.subtle }} />
                <span className="text-[9px] uppercase tracking-wider" style={{ color: t.text.ghost, fontFamily: t.font.mono }}>Quick Export</span>
                <div className="flex-1 h-px" style={{ background: t.border.subtle }} />
              </div>

              {/* ── Individual formats ─────────────────────────────────── */}
              {QUICK_FORMATS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => doExport(f.id)}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-[11px] transition-colors cursor-pointer"
                  style={{ color: t.text.secondary }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = t.bg.hover; e.currentTarget.style.color = t.text.primary; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = t.text.secondary; }}
                >
                  <i className={`fa-solid ${f.icon} text-[10px] w-4 text-center`} style={{ color: t.text.ghost }} />
                  {f.label}
                  <span className="ml-auto text-[9px]" style={{ color: t.text.ghost, fontFamily: t.font.mono }}>{f.ext}</span>
                </button>
              ))}
              <div className="h-1" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* New thread button */}
      <button
        onClick={onNew}
        title="New research thread"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all cursor-pointer flex-shrink-0"
        style={{ background: t.accent.cyanDim, color: t.accent.cyan, border: `1px solid ${t.accent.cyanBorder}` }}
      >
        <i className="fa-solid fa-plus text-[9px]" /> New
      </button>

      <div className="w-px h-5 flex-shrink-0" style={{ background: t.border.subtle }} />

      {/* Right (Settings) toggle */}
      <button
        onClick={onToggleRight}
        title="Settings"
        className="w-7 h-7 rounded-md flex items-center justify-center transition-all duration-200 cursor-pointer flex-shrink-0"
        style={{ color: t.text.muted, background: !rightCollapsed ? t.accent.cyanDim : "transparent" }}
      >
        <i className={`fa-solid ${rightCollapsed ? "fa-sliders" : "fa-chevron-right"} text-[10px]`} />
      </button>
    </header>
  );
}
