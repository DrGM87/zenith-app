import { motion, AnimatePresence } from "framer-motion";
import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useZenithStore, type StudioFolder, type StudioPlanItem } from "../store";
import { DraggablePanel } from "./DraggablePanel";

const selectStyle: React.CSSProperties = {
  appearance: "none",
  WebkitAppearance: "none",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 6,
  padding: "3px 22px 3px 8px",
  fontSize: 10,
  color: "rgba(255,255,255,0.65)",
  outline: "none",
  cursor: "pointer",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='rgba(255,255,255,0.3)'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 6px center",
  backgroundSize: "8px 5px",
};
const optionStyle: React.CSSProperties = { background: "#1a1a24", color: "#ccc" };

function FolderNode({ folder, accent }: { folder: StudioFolder; accent: string }) {
  const [open, setOpen] = useState(true);
  const { toggleStudioItem, updateStudioItemName } = useZenithStore();
  const enabledCount = folder.items.filter((i) => i.enabled).length;

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors group"
      >
        <i className={`fa-solid fa-chevron-${open ? "down" : "right"} text-[8px] text-white/30 transition-transform`} />
        <span className="text-sm" style={{ color: folder.color }}>{folder.icon}</span>
        <span className="text-[12px] font-semibold text-white/80 truncate flex-1 text-left">{folder.name}</span>
        <span className="text-[9px] text-white/30 font-medium">{enabledCount}/{folder.items.length}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="ml-5 border-l border-white/5 pl-2 space-y-0.5">
              {folder.items.map((item) => (
                <StudioItemRow key={item.id} item={item} accent={accent} onToggle={toggleStudioItem} onRename={updateStudioItemName} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StudioItemRow({
  item, accent, onToggle, onRename,
}: {
  item: StudioPlanItem; accent: string;
  onToggle: (id: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState("");

  const typeIcon: Record<string, string> = {
    music: "fa-solid fa-music",
    video: "fa-solid fa-film",
    image: "fa-solid fa-image",
    document: "fa-solid fa-file-lines",
    other: "fa-solid fa-file",
  };
  const typeColor: Record<string, string> = {
    music: "#a78bfa",
    video: "#f472b6",
    image: "#34d399",
    document: "#60a5fa",
    other: "#94a3b8",
  };

  return (
    <div className={`flex items-center gap-1.5 px-1.5 py-1 rounded-md group hover:bg-white/5 transition-colors ${!item.enabled ? "opacity-35" : ""}`}>
      <button onClick={() => onToggle(item.id)} className="shrink-0" title={item.enabled ? "Exclude" : "Include"}>
        <i className={`fa-${item.enabled ? "solid fa-square-check" : "regular fa-square"} text-[11px]`} style={{ color: item.enabled ? accent : "rgba(255,255,255,0.2)" }} />
      </button>
      <i className={`${typeIcon[item.type] || typeIcon.other} text-[9px]`} style={{ color: typeColor[item.type] || typeColor.other }} />
      {editing ? (
        <input
          autoFocus
          className="flex-1 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-white/90 font-mono outline-none focus:border-white/20"
          value={editVal}
          onChange={(e) => setEditVal(e.target.value)}
          onBlur={() => { if (editVal.trim()) onRename(item.id, editVal.trim()); setEditing(false); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { if (editVal.trim()) onRename(item.id, editVal.trim()); setEditing(false); }
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <span className="flex-1 text-[11px] text-white/70 truncate font-mono" title={`${item.old_name} → ${item.new_name}`}>
          {item.new_name}
        </span>
      )}
      {item.old_name !== item.new_name && !editing && (
        <span className="text-[8px] text-amber-400/50 shrink-0">renamed</span>
      )}
      {item.poster_url && !editing && (
        <span className="text-[8px] text-emerald-400/50 shrink-0" title={item.poster_url}>
          <i className="fa-solid fa-image text-[7px] mr-0.5" />poster
        </span>
      )}
      <button
        onClick={() => { setEditVal(item.new_name.replace(/\.[^.]+$/, "")); setEditing(true); }}
        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-[9px] text-white/40"
        title="Edit name"
      >
        <i className="fa-solid fa-pen text-[8px]" />
      </button>
    </div>
  );
}

export function ReviewStudio() {
  const {
    isStudioOpen, studioPlan, studioProgress, studioExecuting,
    setStudioOpen, setStudioPlan, setStudioProgress, setStudioExecuting,
    studioGroupImages, studioGroupDocs, setStudioGroupImages, setStudioGroupDocs,
    studioVideoHint, studioAudioHint, setStudioVideoHint, setStudioAudioHint,
    settings, clearAll, items, trackTokenUsage,
  } = useZenithStore();

  const accent = settings?.appearance?.accent_color || "#6366f1";
  const radius = settings?.appearance?.corner_radius ?? 18;
  const glowEnabled = settings?.appearance?.border_glow !== false;
  const glowSpeed = settings?.appearance?.border_glow_speed ?? 3;

  const [undoable, setUndoable] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [reanalyzing, setReanalyzing] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, duration = 3000) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), duration);
  }, []);

  const enabledItems = studioPlan?.folders.flatMap((f) => f.items.filter((i) => i.enabled)) ?? [];
  const totalEnabled = enabledItems.length;

  const getDefaultApiKey = useCallback(() => {
    const keys = settings?.api_keys ?? [];
    const def = keys.find((k: { is_default: boolean }) => k.is_default) || keys[0];
    return def ? { api_key: def.key, provider: def.provider, model: def.model } : {};
  }, [settings?.api_keys]);

  const handleReanalyze = useCallback(async () => {
    const allPaths = items.filter((i) => i.path.length > 0).map((i) => i.path);
    if (allPaths.length === 0) return;
    const apiKey = getDefaultApiKey();
    setReanalyzing(true);
    setStudioPlan(null);
    setStudioProgress({ status: "analyzing", current: 0, total: allPaths.length, message: "Re-analyzing with new grouping..." });
    try {
      const walkResult = JSON.parse(await invoke<string>("walk_directory", { pathsJson: JSON.stringify(allPaths) }));
      const flatPaths: string[] = (walkResult.files || []).map((f: { path: string }) => f.path);
      if (flatPaths.length === 0) { setStudioProgress(null); showToast("No files found"); setReanalyzing(false); return; }
      setStudioProgress({ status: "analyzing", current: 0, total: flatPaths.length, message: `Analyzing ${flatPaths.length} files...` });
      const argsJson = JSON.stringify({
        paths: flatPaths,
        system_prompt: settings?.ai_prompts?.auto_organize,
        ...apiKey,
        omdb_key: settings?.omdb_api_key || "",
        imdb_api_key: settings?.imdb_api_key || "",
        audiodb_key: settings?.audiodb_api_key || "",
        group_images_by: studioGroupImages,
        group_docs_by: studioGroupDocs,
        video_hint: studioVideoHint,
        audio_hint: studioAudioHint,
      });
      const r = JSON.parse(await invoke<string>("process_file", { action: "smart_organize_studio", argsJson }));
      if (r.token_usage) trackTokenUsage(r.token_usage.provider, r.token_usage.model, r.token_usage.input_tokens, r.token_usage.output_tokens);
      if (r.ok && r.plan) {
        setStudioPlan(r.plan);
        setStudioProgress(null);
        showToast(`Plan updated: ${r.plan.total_items} items in ${r.plan.folders.length} folders`);
      } else {
        setStudioProgress(null);
        showToast(r.error || "Re-analysis failed");
      }
    } catch (e) {
      setStudioProgress(null);
      showToast(String(e));
    } finally { setReanalyzing(false); }
  }, [items, getDefaultApiKey, settings, studioGroupImages, studioGroupDocs, studioVideoHint, studioAudioHint, setStudioPlan, setStudioProgress, showToast, trackTokenUsage]);

  const handleExecute = useCallback(async () => {
    if (!studioPlan || totalEnabled === 0) return;
    setStudioExecuting(true);
    setStudioProgress({ status: "executing", current: 0, total: totalEnabled, message: "Preparing..." });

    try {
      const moves = enabledItems.map((item) => ({
        old_path: item.old_path,
        new_path: item.new_path,
        poster_url: item.poster_url || "",
        poster_local: item.poster_local || "",
      }));

      const movesJson = JSON.stringify(moves);
      const resultStr = await invoke<string>("execute_studio_plan", { movesJson });
      const result = JSON.parse(resultStr);

      if (result.moved > 0) {
        setUndoable(true);
        showToast(`Organization complete! ${result.moved} files moved.`, 5000);
        clearAll();
        setTimeout(() => {
          setStudioPlan(null);
          setStudioOpen(false);
        }, 2000);
      } else {
        showToast(result.error || "No files were moved.");
      }
    } catch (e) {
      showToast(String(e));
    } finally {
      setStudioExecuting(false);
      setStudioProgress(null);
    }
  }, [studioPlan, totalEnabled, enabledItems, setStudioExecuting, setStudioProgress, showToast, clearAll, setStudioPlan, setStudioOpen]);

  const handleUndo = useCallback(async () => {
    try {
      const r = JSON.parse(await invoke<string>("undo_moves"));
      showToast(`Reverted ${r.reverted} files${r.posters_deleted ? `, ${r.posters_deleted} posters removed` : ""}.`);
      setUndoable(false);
    } catch (e) {
      showToast(String(e));
    }
  }, [showToast]);

  const handleClose = useCallback(() => {
    setStudioOpen(false);
    setStudioPlan(null);
    setStudioProgress(null);
  }, [setStudioOpen, setStudioPlan, setStudioProgress]);

  if (!isStudioOpen) return null;

  return (
    <DraggablePanel
      title="Review Studio"
      icon="fa-solid fa-wand-magic-sparkles"
      iconColor={accent}
      accent={accent}
      radius={radius}
      glowEnabled={glowEnabled}
      glowSpeed={glowSpeed}
      width={340}
      minWidth={300}
      minHeight={300}
      badge={studioPlan ? `${totalEnabled}/${studioPlan.total_items}` : undefined}
      onClose={handleClose}
      resizable
    >

          {/* Progress bar */}
          <AnimatePresence>
            {studioProgress && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="px-3 py-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] text-white/50 font-medium truncate">{studioProgress.message}</span>
                  <span className="text-[9px] text-white/30 shrink-0 ml-2">{studioProgress.current}/{studioProgress.total}</span>
                  <button
                    onClick={async () => { try { await invoke("cancel_all_scripts"); } catch {} setStudioProgress(null); showToast("Cancelled"); }}
                    className="ml-1 px-1.5 py-0.5 rounded text-[8px] font-medium text-red-400/80 hover:text-red-300 hover:bg-red-500/10 transition-colors shrink-0"
                    title="Cancel operation"
                  >
                    <i className="fa-solid fa-stop text-[7px] mr-0.5" />Stop
                  </button>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: `linear-gradient(90deg, ${accent}, #a78bfa)` }}
                    initial={{ width: 0 }}
                    animate={{ width: `${studioProgress.total > 0 ? (studioProgress.current / studioProgress.total) * 100 : 0}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Grouping Options + Re-analyze */}
          <div className="px-3 py-2 space-y-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="flex items-center gap-1.5 mb-1">
              <i className="fa-solid fa-sliders text-[8px]" style={{ color: accent, opacity: 0.6 }} />
              <span className="text-[9px] font-semibold text-white/30 uppercase tracking-wider">Grouping Rules</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="flex flex-col gap-1">
                <span className="text-[8px] text-emerald-400/50 font-medium uppercase tracking-wider px-0.5"><i className="fa-solid fa-image text-[7px] mr-1" />Images</span>
                <select value={studioGroupImages} onChange={(e) => setStudioGroupImages(e.target.value as "date" | "vision")} style={selectStyle}>
                  <option value="date" style={optionStyle}>By Date</option>
                  <option value="vision" style={optionStyle}>By AI Vision</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[8px] text-blue-400/50 font-medium uppercase tracking-wider px-0.5"><i className="fa-solid fa-file-lines text-[7px] mr-1" />Docs</span>
                <select value={studioGroupDocs} onChange={(e) => setStudioGroupDocs(e.target.value as "category" | "type" | "date")} style={selectStyle}>
                  <option value="category" style={optionStyle}>By Category</option>
                  <option value="type" style={optionStyle}>By Type</option>
                  <option value="date" style={optionStyle}>By Date</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[8px] text-pink-400/50 font-medium uppercase tracking-wider px-0.5"><i className="fa-solid fa-film text-[7px] mr-1" />Video</span>
                <select value={studioVideoHint} onChange={(e) => setStudioVideoHint(e.target.value as "auto" | "movie" | "personal")} style={selectStyle}>
                  <option value="auto" style={optionStyle}>Auto-detect</option>
                  <option value="movie" style={optionStyle}>Movie/Series</option>
                  <option value="personal" style={optionStyle}>Personal</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[8px] text-purple-400/50 font-medium uppercase tracking-wider px-0.5"><i className="fa-solid fa-music text-[7px] mr-1" />Audio</span>
                <select value={studioAudioHint} onChange={(e) => setStudioAudioHint(e.target.value as "auto" | "music" | "personal")} style={selectStyle}>
                  <option value="auto" style={optionStyle}>Auto-detect</option>
                  <option value="music" style={optionStyle}>Music</option>
                  <option value="personal" style={optionStyle}>Recording</option>
                </select>
              </div>
            </div>
            {studioPlan && (
              <button
                onClick={handleReanalyze}
                disabled={reanalyzing || studioExecuting}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors disabled:opacity-30"
                style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <i className={`fa-solid ${reanalyzing ? "fa-spinner fa-spin" : "fa-arrows-rotate"} text-[8px]`} />
                {reanalyzing ? "Re-analyzing..." : "Re-analyze with new grouping"}
              </button>
            )}
          </div>

          {/* Body: Tree View */}
          <div
            className="flex-1 overflow-y-auto px-2 py-2"
            style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}
          >
            {studioPlan ? (
              studioPlan.folders.length > 0 ? (
                studioPlan.folders.map((folder) => (
                  <FolderNode key={folder.name} folder={folder} accent={accent} />
                ))
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-white/20 gap-2 py-8">
                  <i className="fa-solid fa-folder-open text-2xl" />
                  <span className="text-[11px]">No organization plan generated yet.</span>
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-white/20 gap-3 py-12">
                <i className="fa-solid fa-spinner fa-spin text-xl" style={{ color: accent }} />
                <span className="text-[11px] text-white/40">Analyzing {items.length} files...</span>
                <span className="text-[9px] text-white/20">Querying APIs, fetching metadata, grouping...</span>
              </div>
            )}
          </div>

          {/* Toast */}
          <AnimatePresence>
            {toast && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="mx-3 mb-2 px-3 py-1.5 rounded-lg text-[10px] font-medium text-center"
                style={{ background: `${accent}20`, color: accent }}
              >
                {toast}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Footer: Execute / Undo */}
          <div className="px-3 pb-3 pt-2 space-y-2" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            {/* Item count summary */}
            {studioPlan && (
              <div className="flex items-center justify-between px-1">
                <span className="text-[9px] text-white/25">{totalEnabled} of {studioPlan.total_items} items selected</span>
                {totalEnabled < studioPlan.total_items && (
                  <span className="text-[8px] text-amber-400/40"><i className="fa-solid fa-circle-info text-[7px] mr-0.5" />{studioPlan.total_items - totalEnabled} excluded</span>
                )}
              </div>
            )}
            {undoable && (
              <button
                onClick={handleUndo}
                className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-colors border border-emerald-500/15 hover:border-emerald-500/25"
                style={{ color: "#34d399", background: "rgba(16,185,129,0.08)" }}
              >
                <i className="fa-solid fa-rotate-left text-[9px]" /> Undo Last Operation
              </button>
            )}
            <button
              onClick={handleExecute}
              disabled={!studioPlan || totalEnabled === 0 || studioExecuting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-bold tracking-wide transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: `linear-gradient(135deg, ${accent}, #a78bfa)`,
                color: "#fff",
                boxShadow: totalEnabled > 0 ? `0 4px 20px ${accent}40` : "none",
              }}
            >
              {studioExecuting ? (
                <><i className="fa-solid fa-spinner fa-spin text-[10px]" /> Executing...</>
              ) : (
                <><i className="fa-solid fa-rocket text-[10px]" /> Execute Plan ({totalEnabled})</>
              )}
            </button>
          </div>
    </DraggablePanel>
  );
}
