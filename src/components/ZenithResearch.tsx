import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
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

import {
  AuroraBg,
  SquaresBg,
  GlowOrbs,
  ClickSpark,
  SpotlightCard,
  ShinyText,
  GradientText,
  StarBorder,
  FloatingParticles,
} from "./research/effects";

// ── Shell ────────────────────────────────────────────────────────────────────

const FX_KEY = "zenith_fx_enabled";
const THEME_KEY = "zenith_theme";

export function ZenithResearch() {
  const {
    viewMode, params, setParams, loadThreads, pipeline,
    createThread, resetPipeline, setViewMode, activeThread,
  } = useResearchStore();

  const [settings, setSettings] = useState<ZenithSettings | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [captchaUrl, setCaptchaUrl] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [fxEnabled, setFxEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem(FX_KEY) !== "false"; } catch { return true; }
  });
  const [isDark, setIsDark] = useState<boolean>(() => {
    try { return localStorage.getItem(THEME_KEY) !== "light"; } catch { return true; }
  });

  const toggleFx = useCallback(() => {
    setFxEnabled(v => {
      const next = !v;
      try { localStorage.setItem(FX_KEY, String(next)); } catch { /* */ }
      return next;
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setIsDark(v => {
      const next = !v;
      try { localStorage.setItem(THEME_KEY, next ? "dark" : "light"); } catch { /* */ }
      document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
      return next;
    });
  }, []);

  // Apply theme on mount
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  }, []);

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

  // ── New Thread ─────────────────────────────────────────────────────────────

  const handleNew = useCallback(() => {
    createThread();
    resetPipeline();
    setViewMode("chat");
  }, [createThread, resetPipeline, setViewMode]);

  // ── Toast ──────────────────────────────────────────────────────────────────

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  }, []);

  // ── Export ─────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async (formatId: string) => {
    if (isExporting) return;

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
            query: p.query || thread?.messages.find((m: { role: string }) => m.role === "user")?.content?.slice(0, 200) || "Research",
            study_design: p.studyDesign || "systematic_review",
            logs: p.logs || [],
            thread_title: thread?.title || "Zenith Research Export",
            draft_sections: p.draftSections || [],
            messages: (thread?.messages || []).map((m: { role: string; content: string; type: string; data?: unknown; tool_used?: string; timestamp: number }) => ({
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
          await invoke("reveal_in_folder", { path: result.folder });
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
        await invoke("reveal_in_folder", { path: result.path });
      } else {
        showToast(`Export failed: ${result.error ?? "unknown"}`);
      }
    } catch (e) {
      showToast(`Export failed: ${String(e)}`);
    } finally {
      setIsExporting(false);
    }
  }, [pipeline, activeThread, showToast, isExporting]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const isActive = pipeline.phase !== "idle" && pipeline.phase !== "complete" && pipeline.phase !== "error";

  return (
    <ClickSpark enabled={fxEnabled}>
      <div
        className="flex flex-col h-screen w-full"
        style={{ background: t.bg.void, fontFamily: t.font.sans, position: "relative", overflow: "hidden" }}
      >
        {/* ── Background layer stack ─────────────────────────────────────── */}
        <AuroraBg enabled={fxEnabled} />
        <GlowOrbs enabled={fxEnabled} />
        <SquaresBg enabled={fxEnabled} squareSize={40} speed={0.3} />
        <FloatingParticles enabled={fxEnabled} count={22} />

        {/* ── Vignette overlay for depth ─────────────────────────────────── */}
        {fxEnabled && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `radial-gradient(ellipse 90% 90% at 50% 50%, transparent 40%, rgba(6,8,13,0.55) 100%)`,
              pointerEvents: "none",
              zIndex: 0,
            }}
          />
        )}

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{ position: "relative", zIndex: 10, flexShrink: 0 }}>
          {fxEnabled ? (
            <StarBorder
              enabled={fxEnabled && isActive}
              color={isActive ? t.accent.cyan : t.accent.emerald}
              speed="4s"
              radius={0}
              style={{ display: "block" }}
            >
              <HeaderBar
                leftCollapsed={leftCollapsed}
                rightCollapsed={!rightOpen}
                onToggleLeft={() => setLeftCollapsed((v) => !v)}
                onToggleRight={() => setRightOpen((v) => !v)}
                onExport={handleExport}
                onNew={handleNew}
                isExporting={isExporting}
              />
            </StarBorder>
          ) : (
            <HeaderBar
              leftCollapsed={leftCollapsed}
              rightCollapsed={!rightOpen}
              onToggleLeft={() => setLeftCollapsed((v) => !v)}
              onToggleRight={() => setRightOpen((v) => !v)}
              onExport={handleExport}
              onNew={handleNew}
              isExporting={isExporting}
            />
          )}
        </div>

        {/* ── Main area ──────────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0 overflow-hidden" style={{ position: "relative", zIndex: 5 }}>

          {/* Left sidebar */}
          <AnimatePresence initial={false}>
            {!leftCollapsed && (
              <SpotlightCard
                enabled={fxEnabled}
                spotColor="rgba(34,211,238,0.05)"
                spotRadius={300}
              >
                <ThreadSidebar onNew={handleNew} />
              </SpotlightCard>
            )}
          </AnimatePresence>

          {/* Central panel */}
          <SpotlightCard
            enabled={fxEnabled}
            spotColor="rgba(139,92,246,0.06)"
            spotRadius={450}
            style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}
          >
            {viewMode === "chat" ? (
              <ChatView settings={settings} />
            ) : (
              <PipelineView settings={settings} onToast={showToast} setCaptchaUrl={setCaptchaUrl} />
            )}
          </SpotlightCard>

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

        {/* ── Status bar ─────────────────────────────────────────────────── */}
        <StatusBar
          phase={pipeline.phase}
          progress={pipeline.progress}
          statusMessage={pipeline.statusMessage}
          tokens={pipeline.totalTokens}
          papersCount={pipeline.papers.length}
          fxEnabled={fxEnabled}
          onToggleFx={toggleFx}
          isDark={isDark}
          onToggleTheme={toggleTheme}
        />

        {/* ── CAPTCHA dialog ─────────────────────────────────────────────── */}
        <AnimatePresence>
          {captchaUrl && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center"
              style={{ background: "rgba(0,0,0,0.80)", backdropFilter: "blur(8px)" }}
            >
              <motion.div
                initial={{ scale: 0.88, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.88, opacity: 0, y: 20 }}
                transition={{ type: "spring", stiffness: 380, damping: 28 }}
                style={{
                  background: t.bg.elevated,
                  border: fxEnabled ? "1px solid rgba(34,211,238,0.20)" : `1px solid ${t.border.default}`,
                  borderRadius: 16,
                  maxWidth: 480,
                  width: "90%",
                  overflow: "hidden",
                  position: "relative",
                  boxShadow: fxEnabled ? "0 0 60px rgba(34,211,238,0.08), 0 25px 50px rgba(0,0,0,0.5)" : "0 25px 50px rgba(0,0,0,0.5)",
                }}
              >
                {fxEnabled && (
                  <div style={{
                    position: "absolute",
                    inset: 0,
                    background: "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(34,211,238,0.06), transparent 70%)",
                    pointerEvents: "none",
                  }} />
                )}
                <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: t.border.subtle }}>
                  <div className="flex items-center gap-2">
                    <div style={{
                      width: 24, height: 24, borderRadius: 6,
                      background: fxEnabled ? "rgba(245,158,11,0.15)" : "transparent",
                      border: `1px solid rgba(245,158,11,0.25)`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <i className="fa-solid fa-shield-halved text-[10px]" style={{ color: t.accent.amber }} />
                    </div>
                    <span className="text-[13px] font-semibold" style={{ color: t.text.primary }}>
                      {fxEnabled
                        ? <ShinyText enabled speed={4} baseColor={t.text.primary} shineColor="rgba(255,255,255,0.9)">CAPTCHA Required</ShinyText>
                        : "CAPTCHA Required"}
                    </span>
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
                    style={{
                      background: t.bg.surface,
                      border: fxEnabled ? "1px solid rgba(34,211,238,0.12)" : `1px solid ${t.border.subtle}`,
                    }}>
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
                      className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[11px] font-medium cursor-pointer select-none transition-all"
                      style={{
                        background: fxEnabled ? "linear-gradient(135deg, rgba(245,158,11,0.15), rgba(245,158,11,0.08))" : t.accent.amberDim,
                        color: t.accent.amber,
                        border: "1px solid rgba(245,158,11,0.25)",
                      }}
                    >
                      <i className="fa-solid fa-external-link text-[9px]" /> Open in Browser
                    </button>
                    <button onClick={() => setCaptchaUrl(null)}
                      className="px-4 py-2 rounded-lg text-[11px] font-medium cursor-pointer select-none transition-all"
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

        {/* ── Toast ──────────────────────────────────────────────────────── */}
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast}
              initial={{ opacity: 0, y: 20, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 28 }}
              className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full text-[11px] font-medium shadow-xl pointer-events-none select-none"
              style={{
                background: fxEnabled
                  ? "linear-gradient(135deg, rgba(15,21,32,0.98), rgba(21,29,46,0.98))"
                  : t.bg.elevated,
                color: t.text.primary,
                border: fxEnabled
                  ? "1px solid rgba(34,211,238,0.22)"
                  : `1px solid ${t.border.default}`,
                backdropFilter: "blur(12px)",
                boxShadow: fxEnabled
                  ? "0 0 24px rgba(34,211,238,0.12), 0 8px 24px rgba(0,0,0,0.4)"
                  : "0 8px 24px rgba(0,0,0,0.4)",
              }}
            >
              {fxEnabled ? (
                <GradientText
                  enabled
                  gradient="linear-gradient(90deg, #e2e8f0, #22d3ee, #e2e8f0)"
                  animate={false}
                >
                  {toast}
                </GradientText>
              ) : toast}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ClickSpark>
  );
}

// ── Status Bar ───────────────────────────────────────────────────────────────

function StatusBar({
  phase, progress, statusMessage, tokens, papersCount, fxEnabled, onToggleFx, isDark, onToggleTheme,
}: {
  phase: string; progress: number; statusMessage: string;
  tokens: { input: number; output: number; cost: number };
  papersCount: number;
  fxEnabled: boolean;
  onToggleFx: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
}) {
  const isActive = phase !== "idle" && phase !== "complete" && phase !== "error";
  const isError = phase === "error";

  return (
    <div
      className="flex items-center gap-4 px-4 h-7 border-t flex-shrink-0 select-none"
      style={{
        background: fxEnabled
          ? "linear-gradient(90deg, rgba(15,21,32,0.95), rgba(10,14,23,0.98))"
          : t.bg.surface,
        borderColor: fxEnabled ? "rgba(34,211,238,0.08)" : t.border.subtle,
        fontFamily: t.font.mono,
        position: "relative",
        zIndex: 10,
        backdropFilter: fxEnabled ? "blur(4px)" : undefined,
      }}
    >
      {/* Status dot + text */}
      <div className="flex items-center gap-1.5">
        {isActive && (
          <div style={{ position: "relative", width: 8, height: 8 }}>
            <div
              className="absolute inset-0 rounded-full"
              style={{ background: t.accent.cyan, animation: "ping 1.5s cubic-bezier(0,0,0.2,1) infinite", opacity: 0.4 }}
            />
            <div className="absolute inset-0.5 rounded-full" style={{ background: t.accent.cyan }} />
            <style>{`@keyframes ping { 0%{transform:scale(1);opacity:.5} 75%,100%{transform:scale(2);opacity:0} }`}</style>
          </div>
        )}
        {isError && (
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: t.accent.red }} />
        )}
        {!isActive && !isError && (
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: fxEnabled ? "rgba(34,211,238,0.3)" : "rgba(255,255,255,0.12)" }} />
        )}

        <span className="text-[9px]" style={{
          color: isActive ? t.accent.cyan : isError ? t.accent.red : "rgba(255,255,255,0.25)",
        }}>
          {isActive
            ? (fxEnabled
              ? <ShinyText enabled speed={2} baseColor={t.accent.cyan} shineColor="rgba(255,255,255,0.9)">{statusMessage || phase}</ShinyText>
              : (statusMessage || phase))
            : isError
              ? (fxEnabled
                ? <GradientText enabled gradient="linear-gradient(90deg,#ef4444,#f59e0b)" animate={false}>Error — see log</GradientText>
                : "Error — see log")
              : "Ready"
          }
        </span>
      </div>

      {/* Progress bar */}
      {isActive && progress > 0 && (
        <div className="flex items-center gap-1.5">
          <div
            className="w-20 h-0.5 rounded-full overflow-hidden"
            style={{ background: fxEnabled ? "rgba(34,211,238,0.12)" : t.border.subtle }}
          >
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progress}%`,
                background: fxEnabled
                  ? "linear-gradient(90deg, #22d3ee, #8b5cf6)"
                  : t.accent.cyan,
                boxShadow: fxEnabled ? "0 0 6px rgba(34,211,238,0.6)" : undefined,
              }}
            />
          </div>
          <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.25)" }}>{progress}%</span>
        </div>
      )}

      <div className="flex-1" />

      {/* Papers count */}
      {papersCount > 0 && (
        <span className="text-[9px]" style={{ color: fxEnabled ? "rgba(34,211,238,0.4)" : "rgba(255,255,255,0.20)" }}>
          {papersCount} papers
        </span>
      )}

      {/* Token counter */}
      {tokens.input + tokens.output > 0 && (
        <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.20)" }}>
          {(tokens.input + tokens.output).toLocaleString()} tok
        </span>
      )}

      {/* Cost */}
      {tokens.cost > 0 && (
        <span className="text-[9px]" style={{
          color: fxEnabled ? undefined : t.accent.emerald,
          ...(fxEnabled ? {} : {}),
        }}>
          {fxEnabled
            ? <GradientText enabled gradient="linear-gradient(90deg,#10b981,#22d3ee)" animate={false}>{fmtCost(tokens.cost)}</GradientText>
            : fmtCost(tokens.cost)}
        </span>
      )}

      {/* ── Theme toggle ─────────────────────────────────────────────────── */}
      <button
        onClick={onToggleTheme}
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        className="cursor-pointer transition-all duration-200 flex items-center gap-1 select-none"
        style={{
          background: "transparent",
          border: `1px solid ${t.border.subtle}`,
          borderRadius: 4,
          padding: "1px 5px",
          color: t.text.ghost,
          fontSize: 8,
          lineHeight: "16px",
        }}
      >
        <i className={`fa-solid ${isDark ? "fa-sun" : "fa-moon"} text-[8px]`} />
        <span style={{ fontSize: 8 }}>{isDark ? "LIGHT" : "DARK"}</span>
      </button>

      {/* ── Effects toggle ────────────────────────────────────────────────── */}
      <button
        onClick={onToggleFx}
        title={fxEnabled ? "Disable visual effects" : "Enable visual effects"}
        className="cursor-pointer transition-all duration-200 flex items-center gap-1 select-none"
        style={{
          background: fxEnabled ? "rgba(34,211,238,0.10)" : "transparent",
          border: `1px solid ${fxEnabled ? "rgba(34,211,238,0.25)" : t.border.subtle}`,
          borderRadius: 4,
          padding: "1px 5px",
          color: fxEnabled ? t.accent.cyan : t.text.ghost,
          fontSize: 8,
          lineHeight: "16px",
        }}
      >
        <i className={`fa-solid fa-wand-magic-sparkles text-[8px]`} />
        <span style={{ fontSize: 8 }}>{fxEnabled ? "FX ON" : "FX OFF"}</span>
      </button>
    </div>
  );
}
