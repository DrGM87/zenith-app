import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { AnimatePresence, motion } from "framer-motion";
import { useResearchStore } from "../stores/useResearchStore";
import { THEME as t } from "./research/shared/constants";
import type { ZenithSettings } from "./research/shared/types";
import { fmtCost } from "./research/shared/helpers";

import { HeaderBar } from "./research/HeaderBar";
import { ThreadSidebar } from "./research/ThreadSidebar";
import { ChatView } from "./research/ChatView";
import { PipelineView } from "./research/PipelineView";
import { SettingsPanel } from "./research/SettingsPanel";

// ── Shell ────────────────────────────────────────────────────────────────────

export function ZenithResearch() {
  const {
    viewMode, params, setParams, loadThreads, pipeline,
    createThread, resetPipeline, setViewMode,
  } = useResearchStore();

  const [settings, setSettings] = useState<ZenithSettings | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [captchaUrl, setCaptchaUrl] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  useEffect(() => {
    loadThreads();
    loadSettings();
  }, []);

  useEffect(() => {
    if (settings?.api_keys?.length && !params.provider) {
      const def = settings.api_keys.find((k) => k.is_default) ?? settings.api_keys[0];
      if (def) setParams({ provider: def.provider, model: def.model, api_key: def.key });
    }
  }, [settings]);

  const loadSettings = async () => {
    try {
      const s = await invoke<ZenithSettings>("get_settings");
      setSettings(s);
    } catch { setSettings({ api_keys: [] }); }
  };

  const handleSettingsChange = useCallback((s: ZenithSettings) => setSettings(s), []);

  // ── New Thread (creates, resets pipeline, switches to chat) ────────────────

  const handleNew = useCallback(() => {
    createThread();
    resetPipeline();
    setViewMode("chat");
  }, [createThread, resetPipeline, setViewMode]);

  // ── Toast ──────────────────────────────────────────────────────────────────

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  // ── Export ─────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async (formatId: string) => {
    if (isExporting) return;

    // ── Full snapshot export: folder with all assets ──────────────────────
    if (formatId === "snapshot") {
      const thread = activeThread();
      const p = useResearchStore.getState().pipeline;

      if (!p.manuscript && p.papers.length === 0 && !thread?.messages.length) {
        showToast("Nothing to export — run the pipeline or start a chat first");
        return;
      }

      setIsExporting(true);
      showToast("Exporting package…");

      try {
        const result = JSON.parse(await invoke<string>("process_file", {
          action: "export_research_snapshot",
          argsJson: JSON.stringify({
            manuscript: p.manuscript || "",
            papers: p.relevantPapers.length > 0 ? p.relevantPapers : p.papers,
            bibliography: p.bibliography || "",
            query: p.query || thread?.messages.find((m) => m.role === "user")?.content?.slice(0, 200) || "Research",
            study_design: p.studyDesign || "systematic_review",
            logs: p.logs || [],
            thread_title: thread?.title || "Zenith Research Export",
            draft_sections: p.draftSections || [],
            messages: (thread?.messages || []).map((m) => ({
              role: m.role,
              content: m.content,
              type: m.type,
              data: m.data,
              tool_used: m.tool_used,
              timestamp: m.timestamp,
            })),
            generated_figures: p.generatedFigures || [],
            generated_tables: p.generatedTables || [],
            acquired_pdfs: p.acquiredPdfs || [],
          }),
        })) as { ok: boolean; folder?: string; files?: Array<{ name: string; size: number }>; error?: string };

        if (result.ok && result.folder) {
          const fileCount = result.files?.length ?? 0;
          const totalKB = Math.round((result.files ?? []).reduce((s, f) => s + (f.size ?? 0), 0) / 1024);
          showToast(`✓ Exported ${fileCount} files (${totalKB} KB) — opening folder`);
          await openPath(result.folder);
        } else {
          showToast(`Export failed: ${result.error ?? "unknown error"}`);
        }
      } catch (e) {
        showToast(`Export error: ${String(e)}`);
      } finally {
        setIsExporting(false);
      }
      return;
    }

    // ── Quick single-file export ──────────────────────────────────────────
    const content = formatId === "bibtex" ? pipeline.bibliography : pipeline.manuscript;
    if (!content) { showToast("Nothing to export — run the pipeline first"); return; }
    setIsExporting(true);
    try {
      const thread = activeThread();
      const result = JSON.parse(await invoke<string>("process_file", {
        action: "export_content",
        argsJson: JSON.stringify({
          content,
          format: formatId,
          title: thread?.title || "zenith_export",
        }),
      })) as { ok: boolean; path?: string; error?: string };
      if (result.ok && result.path) {
        showToast(`Saved → ${result.path.split(/[\\/]/).pop()}`);
        await openPath(result.path);
      } else {
        showToast(`Export failed: ${result.error ?? "unknown"}`);
      }
    } catch (e) {
      showToast(`Export failed: ${String(e)}`);
    } finally {
      setIsExporting(false);
    }
  }, [pipeline, activeThread, showToast, isExporting]);

  return (
    <div className="flex flex-col h-screen w-full" style={{ background: t.bg.void, fontFamily: t.font.sans }}>

      {/* Header */}
      <HeaderBar
        leftCollapsed={leftCollapsed}
        rightCollapsed={!rightOpen}
        onToggleLeft={() => setLeftCollapsed((v) => !v)}
        onToggleRight={() => setRightOpen((v) => !v)}
        onExport={handleExport}
        onNew={handleNew}
        isExporting={isExporting}
      />

      {/* Main area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left sidebar — conditionally rendered for true collapse */}
        <AnimatePresence initial={false}>
          {!leftCollapsed && (
            <ThreadSidebar onNew={handleNew} />
          )}
        </AnimatePresence>

        {/* Central panel */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {viewMode === "chat" ? (
            <ChatView settings={settings} />
          ) : (
            <PipelineView settings={settings} onToast={showToast} setCaptchaUrl={setCaptchaUrl} />
          )}
        </div>

        {/* Right settings panel */}
        <AnimatePresence>
          {rightOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="flex-shrink-0 border-l overflow-hidden"
              style={{ borderColor: t.border.subtle, background: t.bg.surface }}
            >
              <SettingsPanel settings={settings} onSettingsChange={handleSettingsChange} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Status bar */}
      <StatusBar
        phase={pipeline.phase}
        progress={pipeline.progress}
        statusMessage={pipeline.statusMessage}
        tokens={pipeline.totalTokens}
        papersCount={pipeline.papers.length}
      />

      {/* CAPTCHA dialog */}
      <AnimatePresence>
        {captchaUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              className="rounded-2xl overflow-hidden shadow-2xl"
              style={{ background: t.bg.elevated, border: `1px solid ${t.border.default}`, maxWidth: 480, width: "90%" }}
            >
              <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: t.border.subtle }}>
                <div className="flex items-center gap-2">
                  <i className="fa-solid fa-shield-halved text-[12px]" style={{ color: t.accent.amber }} />
                  <span className="text-[13px] font-semibold" style={{ color: t.text.primary }}>CAPTCHA Required</span>
                </div>
                <button onClick={() => setCaptchaUrl(null)} className="cursor-pointer opacity-50 hover:opacity-90 transition-opacity" style={{ color: t.text.secondary }}>
                  <i className="fa-solid fa-xmark" />
                </button>
              </div>
              <div className="p-5">
                <p className="text-[12px] mb-4 leading-relaxed" style={{ color: t.text.muted }}>
                  The paper source requires CAPTCHA verification. Open the URL in your browser,
                  complete the challenge, and the download will resume automatically.
                </p>
                <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg"
                  style={{ background: t.bg.surface, border: `1px solid ${t.border.subtle}` }}>
                  <span className="text-[10px] truncate flex-1 select-text" style={{ color: t.text.muted, fontFamily: t.font.mono }}>{captchaUrl}</span>
                  <button onClick={() => { navigator.clipboard.writeText(captchaUrl!); showToast("URL copied"); }}
                    className="text-[9px] cursor-pointer opacity-60 hover:opacity-100 transition-opacity select-none"
                    style={{ color: t.accent.cyan }}>
                    <i className="fa-solid fa-copy" />
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => window.open(captchaUrl, "_blank")}
                    className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[11px] font-medium cursor-pointer select-none"
                    style={{ background: t.accent.amberDim, color: t.accent.amber, border: `1px solid rgba(245,158,11,0.25)` }}
                  >
                    <i className="fa-solid fa-external-link text-[9px]" /> Open in Browser
                  </button>
                  <button onClick={() => setCaptchaUrl(null)}
                    className="px-4 py-2 rounded-lg text-[11px] font-medium cursor-pointer select-none"
                    style={{ background: t.bg.surface, color: t.text.muted, border: `1px solid ${t.border.subtle}` }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.15 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full text-[11px] font-medium shadow-lg pointer-events-none select-none"
            style={{ background: t.bg.elevated, color: t.text.primary, border: `1px solid ${t.border.default}` }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Status Bar ───────────────────────────────────────────────────────────────

function StatusBar({ phase, progress, statusMessage, tokens, papersCount }: {
  phase: string; progress: number; statusMessage: string;
  tokens: { input: number; output: number; cost: number };
  papersCount: number;
}) {
  const isActive = phase !== "idle" && phase !== "complete" && phase !== "error";
  const isError = phase === "error";

  return (
    <div className="flex items-center gap-4 px-4 h-7 border-t flex-shrink-0 select-none"
      style={{ background: t.bg.surface, borderColor: t.border.subtle, fontFamily: t.font.mono }}
    >
      <div className="flex items-center gap-1.5">
        {isActive && <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: t.accent.cyan }} />}
        {isError && <div className="w-1.5 h-1.5 rounded-full" style={{ background: t.accent.red }} />}
        <span className="text-[9px]" style={{
          color: isActive ? t.accent.cyan : isError ? t.accent.red : t.text.ghost
        }}>
          {isActive ? (statusMessage || phase) : isError ? "Error — see log" : "Ready"}
        </span>
      </div>

      {isActive && progress > 0 && (
        <div className="flex items-center gap-1.5">
          <div className="w-20 h-0.5 rounded-full overflow-hidden" style={{ background: t.border.subtle }}>
            <div className="h-full rounded-full transition-all duration-300" style={{ width: `${progress}%`, background: t.accent.cyan }} />
          </div>
          <span className="text-[9px]" style={{ color: t.text.ghost }}>{progress}%</span>
        </div>
      )}

      <div className="flex-1" />

      {papersCount > 0 && (
        <span className="text-[9px]" style={{ color: t.text.ghost }}>{papersCount} papers</span>
      )}
      {tokens.input + tokens.output > 0 && (
        <span className="text-[9px]" style={{ color: t.text.ghost }}>
          {(tokens.input + tokens.output).toLocaleString()} tok
        </span>
      )}
      {tokens.cost > 0 && (
        <span className="text-[9px]" style={{ color: t.accent.emerald }}>{fmtCost(tokens.cost)}</span>
      )}
    </div>
  );
}
