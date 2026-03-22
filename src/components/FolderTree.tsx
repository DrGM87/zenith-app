import { motion, AnimatePresence } from "framer-motion";
import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatFileSize, getFileIcon, getExtensionColor } from "../utils";
import { useZenithStore } from "../store";

interface DirEntry {
  name: string;
  path: string;
  is_directory: boolean;
  size: number;
  extension: string;
}

interface FolderTreeProps {
  path: string;
  name: string;
  depth?: number;
}

export function FolderTree({ path, name, depth = 0 }: FolderTreeProps) {
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const toggle = useCallback(async () => {
    if (!expanded && !loaded) {
      setLoading(true);
      try {
        const result = await invoke<DirEntry[]>("list_directory", { path });
        setEntries(result);
        setLoaded(true);
      } catch (e) {
        console.error("Failed to list directory:", e);
      } finally {
        setLoading(false);
      }
    }
    setExpanded((v) => !v);
  }, [expanded, loaded, path]);

  const dirs = entries.filter((e) => e.is_directory);
  const files = entries.filter((e) => !e.is_directory);

  return (
    <div style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
      <button
        onClick={toggle}
        className="flex items-center gap-2 w-full px-2 py-1 rounded-md text-left hover:bg-white/5 transition-colors group"
      >
        <motion.i
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          className="fa-solid fa-chevron-right text-[8px] text-white/30 w-3 text-center"
        />
        <i className={`fa-solid ${expanded ? "fa-folder-open" : "fa-folder"} text-[11px] text-amber-400/70`} />
        <span className="text-[12px] font-medium text-white/80 truncate flex-1">{name}</span>
        {loading && <i className="fa-solid fa-spinner fa-spin text-[9px] text-white/30" />}
        {loaded && !loading && (
          <span className="text-[10px] text-white/25">{entries.length}</span>
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="border-l border-white/5 ml-[7px]">
              {dirs.map((d) => (
                <FolderTree
                  key={d.path}
                  path={d.path}
                  name={d.name}
                  depth={depth + 1}
                />
              ))}
              {files.map((f) => (
                <FileEntry key={f.path} entry={f} />
              ))}
              {loaded && entries.length === 0 && (
                <div className="px-2 py-1 text-[10px] text-white/20 italic ml-3">
                  Empty folder
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FileEntry({ entry }: { entry: DirEntry }) {
  const extColor = getExtensionColor(entry.extension);
  const { stageFile } = useZenithStore();
  const [staged, setStaged] = useState(false);

  const handleStage = async () => {
    await stageFile(entry.path);
    setStaged(true);
    setTimeout(() => setStaged(false), 1500);
  };

  return (
    <div className="flex items-center gap-2 px-2 py-0.5 ml-3 rounded-md hover:bg-white/5 transition-colors group/file">
      <span className="text-[11px] leading-none">{getFileIcon(entry.extension, false)}</span>
      <span className="text-[11px] text-white/70 truncate flex-1">{entry.name}</span>
      {entry.extension && (
        <span
          className="text-[8px] font-bold uppercase px-1 rounded"
          style={{ color: extColor, background: `${extColor}15` }}
        >
          {entry.extension}
        </span>
      )}
      <span className="text-[10px] text-white/25">{formatFileSize(entry.size)}</span>
      <button
        onClick={handleStage}
        className="opacity-0 group-hover/file:opacity-100 px-1.5 py-0.5 rounded text-[9px] font-medium text-cyan-400 hover:bg-cyan-500/15 transition-all"
        title="Stage this file"
      >
        {staged ? <i className="fa-solid fa-check" /> : <i className="fa-solid fa-plus" />}
      </button>
    </div>
  );
}
