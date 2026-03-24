import { motion, AnimatePresence } from "framer-motion";
import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useZenithStore, type StudioFolder, type StudioPlanItem } from "../store";
import { BorderGlow } from "./ReactBits";

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
      <button onClick={() => onToggle(item.id)} className="flex-shrink-0" title={item.enabled ? "Exclude" : "Include"}>
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
        <span className="text-[8px] text-amber-400/50 flex-shrink-0">renamed</span>
      )}
      {item.poster_url && (
        <span className="text-[8px] text-emerald-400/50 flex-shrink-0">+poster</span>
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
    settings, clearAll, items,
  } = useZenithStore();

  const accent = settings?.appearance?.accent_color || "#6366f1";
  const radius = settings?.appearance?.corner_radius ?? 18;
  const glowEnabled = settings?.appearance?.border_glow !== false;
  const glowSpeed = settings?.appearance?.border_glow_speed ?? 3;

  const [undoable, setUndoable] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string, duration = 3000) => {
    setToast(msg);
    setTimeout(() => setToast(null), duration);
  }, []);

  const enabledItems = studioPlan?.folders.flatMap((f) => f.items.filter((i) => i.enabled)) ?? [];
  const totalEnabled = enabledItems.length;

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
      showToast(`Reverted ${r.reverted} files.`);
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
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="absolute right-0 top-0 bottom-0 z-50 flex"
      style={{ width: "min(380px, 55vw)" }}
    >
      <BorderGlow color1={`${accent}55`} color2="rgba(139,92,246,0.3)" borderRadius={radius} speed={glowSpeed} enabled={glowEnabled}>
        <div
          className="w-full h-full flex flex-col overflow-hidden"
          style={{
            background: "rgb(12, 12, 18)",
            borderRadius: `${radius}px`,
            border: "1px solid rgba(255, 255, 255, 0.06)",
            boxShadow: "-16px 0 48px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.03) inset",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b border-white/5">
            <div className="flex items-center gap-2">
              <i className="fa-solid fa-wand-magic-sparkles text-[12px]" style={{ color: accent }} />
              <span className="text-[13px] font-bold text-white/90 tracking-wide">Review Studio</span>
              {studioPlan && (
                <span className="text-[10px] text-white/30 font-medium">
                  {totalEnabled}/{studioPlan.total_items} items
                </span>
              )}
            </div>
            <button
              onClick={handleClose}
              className="p-1 rounded-md text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
            >
              <i className="fa-solid fa-xmark text-[11px]" />
            </button>
          </div>

          {/* Progress bar */}
          <AnimatePresence>
            {studioProgress && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="px-4 py-2 border-b border-white/5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-white/50 font-medium">{studioProgress.message}</span>
                  <span className="text-[10px] text-white/30">{studioProgress.current}/{studioProgress.total}</span>
                </div>
                <div className="h-1 rounded-full bg-white/5 overflow-hidden">
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

          {/* Grouping Options */}
          {studioPlan && (
            <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5">
              <div className="flex items-center gap-1.5">
                <i className="fa-solid fa-image text-[9px] text-emerald-400/60" />
                <select
                  value={studioGroupImages}
                  onChange={(e) => setStudioGroupImages(e.target.value as "date" | "vision")}
                  className="bg-white/5 border border-white/8 rounded px-1.5 py-0.5 text-[10px] text-white/70 outline-none focus:border-white/20 cursor-pointer"
                >
                  <option value="date">By Date</option>
                  <option value="vision">By AI Vision</option>
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <i className="fa-solid fa-file-lines text-[9px] text-blue-400/60" />
                <select
                  value={studioGroupDocs}
                  onChange={(e) => setStudioGroupDocs(e.target.value as "category" | "type" | "date")}
                  className="bg-white/5 border border-white/8 rounded px-1.5 py-0.5 text-[10px] text-white/70 outline-none focus:border-white/20 cursor-pointer"
                >
                  <option value="category">By Category</option>
                  <option value="type">By Type</option>
                  <option value="date">By Date</option>
                </select>
              </div>
            </div>
          )}

          {/* Body: Tree View */}
          <div className="flex-1 overflow-y-auto px-3 py-2 scrollbar-thin">
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
                className="mx-4 mb-2 px-3 py-1.5 rounded-lg text-[10px] font-medium text-center"
                style={{ background: `${accent}20`, color: accent }}
              >
                {toast}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Footer: Execute / Undo */}
          <div className="px-4 pb-4 pt-2 border-t border-white/5 space-y-2">
            {undoable && (
              <button
                onClick={handleUndo}
                className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors"
              >
                <i className="fa-solid fa-rotate-left text-[10px]" /> Undo Last Operation
              </button>
            )}
            <button
              onClick={handleExecute}
              disabled={!studioPlan || totalEnabled === 0 || studioExecuting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold tracking-wide transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: `linear-gradient(135deg, ${accent}, #a78bfa)`,
                color: "#fff",
                boxShadow: totalEnabled > 0 ? `0 4px 20px ${accent}40` : "none",
              }}
            >
              {studioExecuting ? (
                <><i className="fa-solid fa-spinner fa-spin text-[11px]" /> Executing...</>
              ) : (
                <><i className="fa-solid fa-rocket text-[11px]" /> Execute Plan ({totalEnabled})</>
              )}
            </button>
          </div>
        </div>
      </BorderGlow>
    </motion.div>
  );
}
