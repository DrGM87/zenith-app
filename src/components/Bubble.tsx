import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { useZenithStore } from "../store";
import { StagedItemCard } from "./StagedItemCard";
import { PreviewDrawer } from "./PreviewDrawer";
import { useMagneticHover } from "../hooks/useMagneticHover";
import { BorderGlow, SoftAurora, MagicRings } from "./ReactBits";

export function Bubble() {
  const {
    items,
    isExpanded,
    isDragOver,
    settings,
    clipboardStack,
    isStackMode,
    selectedIds,
    setExpanded,
    setDragOver,
    setStackMode,
    clearStack,
    copyStack,
    selectAll,
    clearSelection,
    stageFile,
    stageText,
    clearAll,
    loadItems,
    loadSettings,
    trackTokenUsage,
    renameUndoCount,
    renameRedoCount,
    refreshRenameCounts,
    setBatchRenameMode,
  } = useZenithStore();

  const [zipping, setZipping] = useState(false);
  const [merging, setMerging] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [undoable, setUndoable] = useState(false);
  const [batchProcessing, setBatchProcessing] = useState<string | null>(null);
  const [footerToast, setFooterToast] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [showQrInput, setShowQrInput] = useState(false);
  const [qrText, setQrText] = useState("");

  const selectedItems = items.filter((i) => selectedIds.has(i.id));
  const selectedPaths = selectedItems.filter((i) => i.path.length > 0).map((i) => i.path);

  const getDefaultApiKey = () => {
    const keys = settings?.api_keys ?? [];
    const def = keys.find((k: { is_default: boolean }) => k.is_default) || keys[0];
    return def ? { api_key: def.key, provider: def.provider, model: def.model } : {};
  };

  const allPaths = items.filter((i) => i.path.length > 0).map((i) => i.path);
  const textDocItems = items.filter((i) => {
    const ext = i.extension.toLowerCase();
    return i.path.length > 0 && (ext === "pdf" || ["txt","md","log","csv","json","xml","html"].includes(ext));
  });

  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const ap = settings?.appearance;
  const bh = settings?.behavior;
  const sc = settings?.shortcuts;

  const accent = ap?.accent_color ?? "#22d3ee";
  const radius = ap?.corner_radius ?? 20;
  const fontSize = ap?.font_size ?? 13;
  const collapseDelay = bh?.collapse_delay_ms ?? 1200;
  const glowEnabled = ap?.border_glow !== false;
  const glowSpeed = ap?.border_glow_speed ?? 4;
  const auroraEnabled = ap?.aurora_bg !== false;
  const auroraSpeed = ap?.aurora_speed ?? 8;

  const spring = useMemo(() => {
    const speed = ap?.animation_speed ?? 1;
    return { type: "spring" as const, stiffness: 400 * speed, damping: 30 * Math.sqrt(speed) };
  }, [ap?.animation_speed]);

  const expand = useCallback(() => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
    setExpanded(true);
    invoke("resize_window", { expanded: true });
  }, [setExpanded]);

  const scheduleCollapse = useCallback(() => {
    if (pinned) return;
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => {
      setExpanded(false);
      setDragOver(false);
      invoke("resize_window", { expanded: false });
    }, collapseDelay);
  }, [setExpanded, setDragOver, collapseDelay, pinned]);

  useEffect(() => {
    loadItems();
    loadSettings();
    refreshRenameCounts();
    invoke("resize_window", { expanded: false });

    const unlisten = listen<{ paths: string[] }>("tauri://drag-drop", (event) => {
      const paths = event.payload.paths;
      if (paths && paths.length > 0) {
        expand();
        paths.forEach((p) => stageFile(p));
      }
      setDragOver(false);
    });

    const unlistenEnter = listen("tauri://drag-enter", () => {
      expand();
      setDragOver(true);
    });

    const unlistenLeave = listen("tauri://drag-leave", () => {
      setDragOver(false);
      scheduleCollapse();
    });

    const unlistenBlur = listen("window-blur", () => {
      if (bh?.auto_collapse_on_blur !== false) scheduleCollapse();
    });

    const unlistenSettingsChanged = listen("settings-changed", () => {
      loadSettings();
    });

    const unlistenItemsChanged = listen("items-changed", () => {
      loadItems();
    });

    const shortcut = sc?.stage_clipboard || "CmdOrCtrl+Shift+V";
    register(shortcut, async () => {
      try {
        const text = await readText();
        if (text && text.trim().length > 0) {
          expand();
          const store = useZenithStore.getState();
          if (store.isStackMode) {
            store.pushToStack(text.trim());
          } else {
            stageText(text.trim());
          }
        }
      } catch (e) {
        console.error("Clipboard read failed:", e);
      }
    }).catch((e) => console.error("Failed to register shortcut:", e));

    return () => {
      unlisten.then((f) => f());
      unlistenEnter.then((f) => f());
      unlistenLeave.then((f) => f());
      unlistenBlur.then((f) => f());
      unlistenSettingsChanged.then((f) => f());
      unlistenItemsChanged.then((f) => f());
      unregister(shortcut).catch(() => {});
    };
  }, [expand, loadItems, loadSettings, scheduleCollapse, setDragOver, stageFile, stageText, sc?.stage_clipboard, bh?.auto_collapse_on_blur]);

  // ── Ctrl+V paste handler when panel is open (v4 Task 2.1) ──
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (!isExpanded) return;
      // Don't intercept if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (text && text.length > 0) {
        const store = useZenithStore.getState();
        if (store.isStackMode) {
          store.pushToStack(text);
        } else {
          stageText(text);
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [isExpanded, stageText]);

  const magnetic = useMagneticHover({ strength: 0.25, radius: 120 });

  const handleZipAll = useCallback(async () => {
    const paths = items.filter((i) => i.path.length > 0).map((i) => i.path);
    if (paths.length === 0) return;
    setZipping(true);
    try {
      const argsJson = JSON.stringify({ paths, name: "zenith_bundle" });
      const resultStr = await invoke<string>("process_file", { action: "zip_files", argsJson });
      const result = JSON.parse(resultStr);
      if (result.ok && result.path) {
        await stageFile(result.path);
        setFooterToast("Zipped!");
        setTimeout(() => setFooterToast(null), 2000);
      }
    } catch (e) {
      console.error("Zip failed:", e);
    } finally {
      setZipping(false);
    }
  }, [items, stageFile]);

  const pdfItems = items.filter((i) => i.extension.toLowerCase() === "pdf" && i.path.length > 0);

  const handleMergePdfs = useCallback(async () => {
    const paths = pdfItems.map((i) => i.path);
    if (paths.length < 2) return;
    setMerging(true);
    try {
      const argsJson = JSON.stringify({ paths, name: "merged" });
      const resultStr = await invoke<string>("process_file", { action: "merge_pdf", argsJson });
      const result = JSON.parse(resultStr);
      if (result.ok && result.path) {
        await stageFile(result.path);
        setFooterToast(`Merged ${paths.length} PDFs!`);
        setTimeout(() => setFooterToast(null), 2000);
      } else {
        setFooterToast(result.error || "Merge failed");
        setTimeout(() => setFooterToast(null), 3000);
      }
    } catch (e) {
      console.error("Merge PDFs failed:", e);
      setFooterToast(String(e));
      setTimeout(() => setFooterToast(null), 3000);
    } finally {
      setMerging(false);
    }
  }, [pdfItems, stageFile]);

  return (
    <div className="w-full h-full flex flex-col items-end justify-end">
      <AnimatePresence>
        {isExpanded ? (
          <motion.div
            ref={bubbleRef}
            key="expanded"
            initial={{ opacity: 0, scale: 0.85, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 30 }}
            transition={spring}
            onMouseEnter={expand}
            onMouseLeave={scheduleCollapse}
            className="w-full flex flex-col"
            style={{ maxHeight: "calc(100vh - 24px)" }}
          >
          <BorderGlow color1={`${accent}66`} color2="rgba(139,92,246,0.4)" borderRadius={radius} speed={glowSpeed} enabled={glowEnabled}>
          <div
            className="w-full flex flex-col overflow-hidden relative"
            style={{
              maxHeight: "calc(100vh - 24px)",
              background: "rgb(14, 14, 20)",
              borderRadius: `${radius}px`,
              border: "1px solid rgba(255, 255, 255, 0.06)",
              boxShadow: "0 32px 64px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.03) inset",
            }}
          >
            {auroraEnabled && <SoftAurora color1={`${accent}18`} color2="rgba(139,92,246,0.10)" color3="rgba(236,72,153,0.05)" speed={auroraSpeed} />}
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <div className="flex items-center gap-2.5">
                <MagicRings color={accent} color2="#ec4899" color3="#f59e0b" size={21} />
                <span style={{ fontSize: `${fontSize}px` }} className="font-semibold text-white/90 tracking-wide uppercase">
                  Zenith
                </span>
                <span style={{ fontSize: `${fontSize - 2}px` }} className="text-white/30 font-medium">
                  {items.length} {items.length === 1 ? "item" : "items"}
                </span>
              </div>

              <div className="flex items-center gap-1">
                {items.length > 0 && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={clearAll}
                    className="text-[11px] font-medium text-white/40 hover:text-red-400 px-2.5 py-1 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <i className="fa-solid fa-trash-can mr-1 text-[9px]" />
                    Clear all
                  </motion.button>
                )}
                {/* Undo/Redo rename buttons */}
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  disabled={renameUndoCount === 0}
                  onClick={async () => {
                    try {
                      const r = JSON.parse(await invoke<string>("undo_last_rename"));
                      if (r.undone) {
                        setFooterToast(`Undo: restored ${r.restored_path.split(/[\\/]/).pop()}`);
                        setTimeout(() => setFooterToast(null), 2500);
                        refreshRenameCounts();
                        loadItems();
                      }
                    } catch (e) { setFooterToast(String(e)); setTimeout(() => setFooterToast(null), 3000); }
                  }}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${renameUndoCount > 0 ? "text-white/50 hover:text-white/90 hover:bg-white/5" : "text-white/15 cursor-not-allowed"}`}
                  title={`Undo rename (${renameUndoCount})`}
                >
                  <i className="fa-solid fa-rotate-left text-[11px]" />
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  disabled={renameRedoCount === 0}
                  onClick={async () => {
                    try {
                      const r = JSON.parse(await invoke<string>("redo_last_rename"));
                      if (r.redone) {
                        setFooterToast(`Redo: renamed to ${r.new_path.split(/[\\/]/).pop()}`);
                        setTimeout(() => setFooterToast(null), 2500);
                        refreshRenameCounts();
                        loadItems();
                      }
                    } catch (e) { setFooterToast(String(e)); setTimeout(() => setFooterToast(null), 3000); }
                  }}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${renameRedoCount > 0 ? "text-white/50 hover:text-white/90 hover:bg-white/5" : "text-white/15 cursor-not-allowed"}`}
                  title={`Redo rename (${renameRedoCount})`}
                >
                  <i className="fa-solid fa-rotate-right text-[11px]" />
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setPinned(!pinned)}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${pinned ? "text-cyan-400 bg-cyan-500/15" : "text-white/30 hover:text-white/70 hover:bg-white/5"}`}
                  title={pinned ? "Unpin panel" : "Pin panel open"}
                >
                  <i className={`fa-solid fa-thumbtack text-[12px] ${pinned ? "" : "rotate-45"}`} />
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.1, rotate: 45 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => invoke("open_settings")}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/5 transition-colors"
                >
                  <i className="fa-solid fa-gear text-[13px]" />
                </motion.button>
              </div>
            </div>

            {/* Drop zone indicator */}
            <AnimatePresence>
              {isDragOver && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mx-3 mb-2"
                >
                  <div
                    className="border-2 border-dashed rounded-xl p-6 flex items-center justify-center"
                    style={{
                      borderColor: `${accent}66`,
                      background: `${accent}0d`,
                    }}
                  >
                    <motion.p
                      animate={{ opacity: [0.5, 1, 0.5] }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                      className="text-[13px] font-medium"
                      style={{ color: `${accent}cc` }}
                    >
                      <i className="fa-solid fa-cloud-arrow-down mr-2" />
                      Drop files here
                    </motion.p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Items list */}
            <div
              className="flex-1 overflow-y-auto px-2 pb-3"
              style={{ maxHeight: "440px" }}
            >
              {items.length === 0 && !isDragOver ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center py-16 gap-3"
                >
                  <motion.div
                    animate={{ y: [0, -6, 0] }}
                    transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}
                    className="text-2xl opacity-30"
                  >
                    <i className="fa-regular fa-folder-open" />
                  </motion.div>
                  <p className="text-[13px] text-white/25 text-center leading-relaxed">
                    Drag files here to stage them
                    <br />
                    <span className="text-[11px] text-white/15">
                      or hover to expand
                    </span>
                  </p>
                </motion.div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {items.map((item, i) => (
                    <StagedItemCard key={item.id} item={item} index={i} />
                  ))}
                </AnimatePresence>
              )}
            </div>

            {/* Batch action bar for multi-select */}
            <AnimatePresence>
              {selectedIds.size > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mx-3 mb-1"
                >
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-cyan-300 font-medium">
                        {selectedIds.size} selected
                      </span>
                      <button onClick={selectAll} className="text-[10px] text-white/30 hover:text-white/60 transition-colors">All</button>
                      <button onClick={clearSelection} className="text-[10px] text-white/30 hover:text-white/60 transition-colors">None</button>
                    </div>
                    <div className="flex items-center gap-1">
                      {selectedPaths.length >= 1 && (
                        <>
                          <button
                            disabled={batchProcessing !== null}
                            onClick={async () => {
                              setBatchProcessing("zip");
                              try {
                                const argsJson = JSON.stringify({ paths: selectedPaths, name: "zenith_selected" });
                                const r = JSON.parse(await invoke<string>("process_file", { action: "zip_files", argsJson }));
                                if (r.ok && r.path) { await stageFile(r.path); setFooterToast("Zipped selected!"); }
                                else setFooterToast(r.error || "Failed");
                              } catch (e) { setFooterToast(String(e)); }
                              finally { setBatchProcessing(null); setTimeout(() => setFooterToast(null), 2000); }
                            }}
                            className="px-2 py-0.5 rounded text-[10px] font-medium text-amber-300 hover:bg-amber-500/15 transition-colors disabled:opacity-40"
                            title="Zip selected"
                          >
                            {batchProcessing === "zip" ? <i className="fa-solid fa-spinner fa-spin text-[9px]" /> : <i className="fa-solid fa-file-zipper text-[9px] mr-1" />}
                            Zip
                          </button>
                          <button
                            disabled={batchProcessing !== null}
                            onClick={async () => {
                              try {
                                await invoke("email_files", { paths: selectedPaths, to: "", subject: `Zenith: ${selectedPaths.length} files`, body: "" });
                                setFooterToast("Email client opened!");
                              } catch (e) { setFooterToast(String(e)); }
                              setTimeout(() => setFooterToast(null), 2000);
                            }}
                            className="px-2 py-0.5 rounded text-[10px] font-medium text-violet-300 hover:bg-violet-500/15 transition-colors disabled:opacity-40"
                            title="Email selected"
                          >
                            <i className="fa-solid fa-envelope text-[9px] mr-1" />Email
                          </button>
                        </>
                      )}
                      {selectedPaths.length >= 1 && (
                          <button
                            disabled={batchProcessing !== null}
                            onClick={async () => {
                              const vtKey = settings?.vt_api_key;
                              if (!vtKey) { setFooterToast("Set VirusTotal API key in Settings"); setTimeout(() => setFooterToast(null), 2500); return; }
                              setBatchProcessing("batch_scan");
                              let safe = 0, mal = 0, unk = 0;
                              for (const p of selectedPaths) {
                                try {
                                  const argsJson = JSON.stringify({ path: p, vt_api_key: vtKey });
                                  const r = JSON.parse(await invoke<string>("process_file", { action: "scan_virustotal", argsJson }));
                                  if (r.ok && r.verdict === "safe") safe++;
                                  else if (r.ok && r.verdict === "malicious") mal++;
                                  else unk++;
                                } catch { unk++; }
                              }
                              setFooterToast(`Scan: ${safe} safe, ${mal} malicious, ${unk} unknown`);
                              setBatchProcessing(null);
                              setTimeout(() => setFooterToast(null), 4000);
                            }}
                            className="px-2 py-0.5 rounded text-[10px] font-medium text-cyan-300 hover:bg-cyan-500/15 transition-colors disabled:opacity-40"
                            title="VirusTotal scan selected"
                          >
                            {batchProcessing === "batch_scan" ? <i className="fa-solid fa-spinner fa-spin text-[9px]" /> : <i className="fa-solid fa-shield-halved text-[9px] mr-1" />}
                            Scan
                          </button>
                      )}
                      {selectedPaths.length >= 2 && (
                          <button
                            disabled={batchProcessing !== null}
                            onClick={async () => {
                              setBatchProcessing("batch_rename");
                              const apiKey = getDefaultApiKey();
                              if (!apiKey.api_key) { setFooterToast("Set API key in Settings"); setTimeout(() => setFooterToast(null), 2500); setBatchProcessing(null); return; }
                              setBatchRenameMode(true);
                              for (const it of selectedItems.filter((i) => i.path.length > 0)) {
                                useZenithStore.getState().setRenameState(it.id, { itemId: it.id, path: it.path, originalName: it.name, originalStem: it.name.replace(/\.[^.]+$/, ""), extension: it.extension ? `.${it.extension}` : "", suggestions: [], activeIndex: 0, loading: true });
                                try {
                                  const argsJson = JSON.stringify({ path: it.path, ...apiKey, system_prompt: settings?.ai_prompts?.smart_rename });
                                  const resultStr = await invoke<string>("process_file", { action: "smart_rename", argsJson });
                                  const result = JSON.parse(resultStr);
                                  if (result.token_usage) trackTokenUsage(result.token_usage.provider, result.token_usage.model, result.token_usage.input_tokens, result.token_usage.output_tokens);
                                  if (result.ok && result.suggestions?.length > 0) {
                                    useZenithStore.getState().setRenameState(it.id, { itemId: it.id, path: it.path, originalName: result.original_name, originalStem: result.original_stem, extension: result.extension, suggestions: result.suggestions, activeIndex: 0, loading: false });
                                  } else {
                                    useZenithStore.getState().setRenameState(it.id, null);
                                  }
                                } catch { useZenithStore.getState().setRenameState(it.id, null); }
                              }
                              setBatchProcessing(null);
                              setFooterToast(`Batch rename: review suggestions on each card`);
                              setTimeout(() => setFooterToast(null), 3000);
                            }}
                            className="px-2 py-0.5 rounded text-[10px] font-medium text-purple-300 hover:bg-purple-500/15 transition-colors disabled:opacity-40"
                            title="AI Batch Rename selected"
                          >
                            {batchProcessing === "batch_rename" ? <i className="fa-solid fa-spinner fa-spin text-[9px]" /> : <i className="fa-solid fa-wand-magic-sparkles text-[9px] mr-1" />}
                            Rename
                          </button>
                      )}
                      {selectedItems.filter((i) => i.extension.toLowerCase() === "pdf").length >= 2 && (
                        <button
                          disabled={batchProcessing !== null}
                          onClick={async () => {
                            setBatchProcessing("merge");
                            try {
                              const pdfPaths = selectedItems.filter((i) => i.extension.toLowerCase() === "pdf").map((i) => i.path);
                              const argsJson = JSON.stringify({ paths: pdfPaths, name: "merged_selected" });
                              const r = JSON.parse(await invoke<string>("process_file", { action: "merge_pdf", argsJson }));
                              if (r.ok && r.path) { await stageFile(r.path); setFooterToast(`Merged ${pdfPaths.length} PDFs!`); }
                              else setFooterToast(r.error || "Failed");
                            } catch (e) { setFooterToast(String(e)); }
                            finally { setBatchProcessing(null); setTimeout(() => setFooterToast(null), 2000); }
                          }}
                          className="px-2 py-0.5 rounded text-[10px] font-medium text-red-300 hover:bg-red-500/15 transition-colors disabled:opacity-40"
                          title="Merge selected PDFs"
                        >
                          {batchProcessing === "merge" ? <i className="fa-solid fa-spinner fa-spin text-[9px]" /> : <i className="fa-solid fa-file-pdf text-[9px] mr-1" />}
                          Merge
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Preview Drawer */}
            <PreviewDrawer />

            {/* Clipboard stack banner */}
            <AnimatePresence>
              {isStackMode && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mx-3 mb-1"
                >
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
                    <div className="flex items-center gap-2">
                      <i className="fa-solid fa-layer-group text-violet-400 text-[10px]" />
                      <span className="text-[11px] text-violet-300 font-medium">
                        Stack: {clipboardStack.length} clip{clipboardStack.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => { copyStack(); setFooterToast("Stack copied!"); setTimeout(() => setFooterToast(null), 2000); }}
                        disabled={clipboardStack.length === 0}
                        className="px-2 py-0.5 rounded text-[10px] font-medium text-violet-300 hover:bg-violet-500/20 transition-colors disabled:opacity-30"
                      >
                        Copy All
                      </button>
                      <button
                        onClick={clearStack}
                        className="px-2 py-0.5 rounded text-[10px] font-medium text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* QR from text panel (file-less) */}
            <AnimatePresence>
              {showQrInput && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 py-2 flex items-center gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                    <i className="fa-solid fa-qrcode text-[11px] text-violet-400" />
                    <input
                      type="text"
                      value={qrText}
                      onChange={(e) => setQrText(e.target.value)}
                      placeholder="Enter URL or text for QR code..."
                      className="flex-1 bg-white/5 border border-white/10 rounded-md px-2 py-1 text-[11px] text-white/80 placeholder:text-white/20 outline-none focus:border-violet-500/50"
                      onKeyDown={async (e) => {
                        if (e.key === "Enter" && qrText.trim()) {
                          try {
                            const argsJson = JSON.stringify({ url: qrText.trim() });
                            const r = JSON.parse(await invoke<string>("process_file", { action: "url_to_qr", argsJson }));
                            if (r.ok && r.path) { await stageFile(r.path); setFooterToast("QR code generated!"); }
                            else setFooterToast(r.error || "QR failed");
                          } catch (err) { setFooterToast(String(err)); }
                          setQrText("");
                          setShowQrInput(false);
                          setTimeout(() => setFooterToast(null), 3000);
                        }
                      }}
                    />
                    <button
                      disabled={!qrText.trim()}
                      onClick={async () => {
                        if (!qrText.trim()) return;
                        try {
                          const argsJson = JSON.stringify({ url: qrText.trim() });
                          const r = JSON.parse(await invoke<string>("process_file", { action: "url_to_qr", argsJson }));
                          if (r.ok && r.path) { await stageFile(r.path); setFooterToast("QR code generated!"); }
                          else setFooterToast(r.error || "QR failed");
                        } catch (err) { setFooterToast(String(err)); }
                        setQrText("");
                        setShowQrInput(false);
                        setTimeout(() => setFooterToast(null), 3000);
                      }}
                      className="px-2 py-1 rounded-md text-[10px] font-medium text-violet-300 hover:bg-violet-500/20 transition-colors disabled:opacity-30"
                    >
                      Generate
                    </button>
                    <button onClick={() => { setShowQrInput(false); setQrText(""); }} className="text-white/30 hover:text-white/60">
                      <i className="fa-solid fa-xmark text-[10px]" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Footer */}
            <div
              className="px-4 py-2.5 flex items-center justify-between relative"
              style={{
                borderTop: "1px solid rgba(255, 255, 255, 0.05)",
                background: "rgba(0, 0, 0, 0.2)",
              }}
            >
              <span className="text-[10px] text-white/20 font-medium tracking-widest uppercase">
                <i className="fa-solid fa-layer-group mr-1" />
                Staging Area
              </span>
              <div className="flex items-center gap-2">
                {/* Clipboard stack toggle */}
                <button
                  onClick={() => setStackMode(!isStackMode)}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    isStackMode
                      ? "text-violet-400 bg-violet-500/15"
                      : "text-white/25 hover:text-white/50"
                  }`}
                  title="Clipboard stacking mode"
                >
                  <i className="fa-solid fa-clipboard-list text-[9px]" />
                </button>
                {/* Zip all */}
                {items.filter((i) => i.path.length > 0).length >= 2 && (
                  <button
                    onClick={handleZipAll}
                    disabled={zipping}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-white/25 hover:text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-40"
                    title="Zip all files"
                  >
                    {zipping ? <i className="fa-solid fa-spinner fa-spin text-[9px]" /> : <i className="fa-solid fa-file-zipper text-[9px]" />}
                  </button>
                )}
                {/* Merge PDFs */}
                {pdfItems.length >= 2 && (
                  <button
                    onClick={handleMergePdfs}
                    disabled={merging}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                    title={`Merge ${pdfItems.length} PDFs`}
                  >
                    {merging ? <i className="fa-solid fa-spinner fa-spin text-[9px]" /> : <i className="fa-solid fa-file-pdf text-[9px]" />}
                  </button>
                )}
                {/* Auto-Organize */}
                {allPaths.length >= 3 && (
                  <button
                    disabled={organizing}
                    onClick={async () => {
                      const apiKey = getDefaultApiKey();
                      if (!apiKey.api_key) { setFooterToast("Set an API key first"); setTimeout(() => setFooterToast(null), 2000); return; }
                      setOrganizing(true);
                      try {
                        const argsJson = JSON.stringify({ paths: allPaths, system_prompt: settings?.ai_prompts?.auto_organize, ...apiKey });
                        const r = JSON.parse(await invoke<string>("process_file", { action: "auto_organize", argsJson }));
                        if (r.token_usage) trackTokenUsage(r.token_usage.provider, r.token_usage.model, r.token_usage.input_tokens, r.token_usage.output_tokens);
                        if (r.ok && r.moves) {
                          const moveResult = JSON.parse(await invoke<string>("move_files", { movesJson: JSON.stringify(r.moves) }));
                          const moved = JSON.parse(moveResult).moved || 0;
                          setUndoable(true);
                          setFooterToast(`${moved} files organized!`);
                          clearAll();
                          setTimeout(() => { setFooterToast(null); }, 5000);
                        } else {
                          setFooterToast(r.error || "Organize failed");
                          setTimeout(() => setFooterToast(null), 3000);
                        }
                      } catch (e) { setFooterToast(String(e)); setTimeout(() => setFooterToast(null), 3000); }
                      finally { setOrganizing(false); }
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-white/25 hover:text-purple-400 hover:bg-purple-500/10 transition-colors disabled:opacity-40"
                    title="Auto-organize files with AI"
                  >
                    {organizing ? <i className="fa-solid fa-spinner fa-spin text-[9px]" /> : <i className="fa-solid fa-wand-magic-sparkles text-[9px]" />}
                  </button>
                )}
                {/* Smart Sort */}
                {allPaths.length >= 2 && (
                  <button
                    disabled={batchProcessing !== null}
                    onClick={async () => {
                      const apiKey = getDefaultApiKey();
                      if (!apiKey.api_key) { setFooterToast("Set an API key first"); setTimeout(() => setFooterToast(null), 2000); return; }
                      setBatchProcessing("sort");
                      try {
                        const argsJson = JSON.stringify({ paths: allPaths, system_prompt: settings?.ai_prompts?.smart_sort, ...apiKey });
                        const r = JSON.parse(await invoke<string>("process_file", { action: "smart_sort", argsJson }));
                        if (r.token_usage) trackTokenUsage(r.token_usage.provider, r.token_usage.model, r.token_usage.input_tokens, r.token_usage.output_tokens);
                        if (r.ok && r.categories) {
                          const cats = Object.keys(r.categories).length;
                          setFooterToast(`Sorted into ${cats} categories`);
                        } else setFooterToast(r.error || "Sort failed");
                      } catch (e) { setFooterToast(String(e)); }
                      finally { setBatchProcessing(null); setTimeout(() => setFooterToast(null), 3000); }
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-white/25 hover:text-cyan-400 hover:bg-cyan-500/10 transition-colors disabled:opacity-40"
                    title="Smart Sort files by category"
                  >
                    {batchProcessing === "sort" ? <i className="fa-solid fa-spinner fa-spin text-[9px]" /> : <i className="fa-solid fa-arrow-down-a-z text-[9px]" />}
                  </button>
                )}
                {/* Super Summary */}
                {textDocItems.length >= 2 && (
                  <button
                    disabled={batchProcessing !== null}
                    onClick={async () => {
                      const apiKey = getDefaultApiKey();
                      if (!apiKey.api_key) { setFooterToast("Set an API key first"); setTimeout(() => setFooterToast(null), 2000); return; }
                      setBatchProcessing("summary");
                      try {
                        const paths = textDocItems.map((i) => i.path);
                        const argsJson = JSON.stringify({ paths, system_prompt: settings?.ai_prompts?.super_summary, ...apiKey });
                        const r = JSON.parse(await invoke<string>("process_file", { action: "super_summary", argsJson }));
                        if (r.token_usage) trackTokenUsage(r.token_usage.provider, r.token_usage.model, r.token_usage.input_tokens, r.token_usage.output_tokens);
                        if (r.ok && r.path) { await stageFile(r.path); setFooterToast(`Summary of ${r.docs_processed} docs!`); }
                        else setFooterToast(r.error || "Failed");
                      } catch (e) { setFooterToast(String(e)); }
                      finally { setBatchProcessing(null); setTimeout(() => setFooterToast(null), 3000); }
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-white/25 hover:text-violet-400 hover:bg-violet-500/10 transition-colors disabled:opacity-40"
                    title="Super Summary of all docs"
                  >
                    {batchProcessing === "summary" ? <i className="fa-solid fa-spinner fa-spin text-[9px]" /> : <i className="fa-solid fa-book-open text-[9px]" />}
                  </button>
                )}
                {/* PDF to CSV batch */}
                {(() => {
                  const pdfItems = (selectedItems.length > 1 ? selectedItems : items).filter((i) => i.extension.toLowerCase() === "pdf" && i.path);
                  if (pdfItems.length < 1) return null;
                  return (
                    <button
                      disabled={batchProcessing !== null}
                      onClick={async () => {
                        const apiKey = getDefaultApiKey();
                        if (!apiKey.api_key) { setFooterToast("Set an API key first"); setTimeout(() => setFooterToast(null), 2000); return; }
                        setBatchProcessing("pdf_csv");
                        try {
                          const paths = pdfItems.map((i) => i.path);
                          const argsJson = JSON.stringify({ paths, ...apiKey });
                          const r = JSON.parse(await invoke<string>("process_file", { action: "pdf_to_csv", argsJson }));
                          if (r.token_usage) trackTokenUsage(r.token_usage.provider, r.token_usage.model, r.token_usage.input_tokens, r.token_usage.output_tokens);
                          if (r.ok && r.path) { await stageFile(r.path); setFooterToast(`CSV: ${r.rows} rows from ${r.docs_processed} PDFs`); }
                          else setFooterToast(r.error || "Failed");
                        } catch (e) { setFooterToast(String(e)); }
                        finally { setBatchProcessing(null); setTimeout(() => setFooterToast(null), 3000); }
                      }}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-white/25 hover:text-orange-400 hover:bg-orange-500/10 transition-colors disabled:opacity-40"
                      title="Extract PDFs to CSV"
                    >
                      {batchProcessing === "pdf_csv" ? <i className="fa-solid fa-spinner fa-spin text-[9px]" /> : <i className="fa-solid fa-table text-[9px]" />}
                    </button>
                  );
                })()}
                {/* QR from text (file-less) */}
                <button
                  onClick={() => setShowQrInput(!showQrInput)}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${showQrInput ? "text-violet-400 bg-violet-500/15" : "text-white/25 hover:text-violet-400 hover:bg-violet-500/10"}`}
                  title="Generate QR code from text/URL"
                >
                  <i className="fa-solid fa-qrcode text-[9px]" />
                </button>
                {/* Batch Smart Rename */}
                {allPaths.length >= 2 && (
                  <button
                    disabled={batchProcessing !== null}
                    onClick={async () => {
                      const apiKey = getDefaultApiKey();
                      if (!apiKey.api_key) { setFooterToast("Set an API key first"); setTimeout(() => setFooterToast(null), 2000); return; }
                      setBatchProcessing("rename");
                      let count = 0;
                      try {
                        for (const p of allPaths) {
                          const argsJson = JSON.stringify({ path: p, system_prompt: settings?.ai_prompts?.smart_rename, ...apiKey });
                          const r = JSON.parse(await invoke<string>("process_file", { action: "smart_rename", argsJson }));
                          if (r.token_usage) trackTokenUsage(r.token_usage.provider, r.token_usage.model, r.token_usage.input_tokens, r.token_usage.output_tokens);
                          if (r.ok) count++;
                        }
                        setFooterToast(`Renamed ${count}/${allPaths.length} files`);
                      } catch (e) { setFooterToast(String(e)); }
                      finally { setBatchProcessing(null); setTimeout(() => setFooterToast(null), 3000); }
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-white/25 hover:text-pink-400 hover:bg-pink-500/10 transition-colors disabled:opacity-40"
                    title="AI Rename all files"
                  >
                    {batchProcessing === "rename" ? <i className="fa-solid fa-spinner fa-spin text-[9px]" /> : <i className="fa-solid fa-wand-magic-sparkles text-[9px]" />}
                  </button>
                )}
                {/* Undo organize */}
                {undoable && (
                  <button
                    onClick={async () => {
                      try {
                        const r = JSON.parse(await invoke<string>("undo_moves"));
                        setFooterToast(`Reverted ${r.reverted} files`);
                        setUndoable(false);
                      } catch (e) { setFooterToast(String(e)); }
                      setTimeout(() => setFooterToast(null), 3000);
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors"
                    title="Undo last organize"
                  >
                    <i className="fa-solid fa-rotate-left text-[9px]" /> Undo
                  </button>
                )}
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" />
                <span className="text-[10px] text-white/25">Ready</span>
              </div>
              {/* Footer toast */}
              <AnimatePresence>
                {footerToast && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    className="absolute -top-8 right-4 px-2.5 py-1 rounded-md bg-black/90 text-[10px] text-white/80 font-medium whitespace-nowrap z-50"
                  >
                    {footerToast}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          </BorderGlow>
          </motion.div>
        ) : (
          /* Collapsed pill with magnetic hover */
          <motion.div
            key="collapsed"
            ref={magnetic.ref as React.RefObject<HTMLDivElement>}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={spring}
            onMouseEnter={expand}
            onMouseLeave={() => { scheduleCollapse(); magnetic.onMouseLeave(); }}
            onMouseMove={magnetic.onMouseMove}
            whileHover={{ scale: 1.08 }}
            className="cursor-pointer select-none"
            style={{ ...magnetic.style }}
          >
          <BorderGlow color1={`${accent}55`} color2="rgba(139,92,246,0.35)" borderRadius={Math.min(radius, 16)} speed={glowSpeed} enabled={glowEnabled}>
          <div
            className="flex items-center gap-2 px-3 py-2 relative overflow-hidden"
            style={{
              background: "rgb(14, 14, 20)",
              borderRadius: `${Math.min(radius, 16)}px`,
              border: "1px solid rgba(255, 255, 255, 0.06)",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
            }}
          >
            <MagicRings color={accent} color2="#ec4899" color3="#f59e0b" size={18} />
            {items.length > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                style={{ color: `${accent}cc`, background: `${accent}1a` }}
              >
                {items.length}
              </motion.span>
            )}
          </div>
          </BorderGlow>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
