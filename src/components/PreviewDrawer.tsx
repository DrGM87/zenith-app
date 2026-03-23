import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useZenithStore, type PreviewPane } from "../store";
import { formatFileSize, getExtensionColor } from "../utils";
import { SpotlightCard } from "./ReactBits";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff", "svg", "ico"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "ogv", "m4v"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "flac", "aac", "m4a", "wma"]);
const CODE_EXTS = new Set(["js", "ts", "tsx", "jsx", "py", "rs", "css", "html", "xml", "json", "yaml", "yml", "toml", "sh", "bat", "ps1", "sql", "go", "java", "c", "cpp", "h", "hpp", "rb", "php"]);
const TEXT_EXTS = new Set(["txt", "md", "log", "csv", "tsv", "ini", "cfg", "conf", "env"]);
const DATA_EXTS = new Set(["csv", "tsv", "json"]);

function getPreviewCategory(ext: string): "image" | "video" | "audio" | "code" | "text" | "data" | "pdf" | "unknown" {
  const e = ext.toLowerCase();
  if (IMAGE_EXTS.has(e)) return "image";
  if (VIDEO_EXTS.has(e)) return "video";
  if (AUDIO_EXTS.has(e)) return "audio";
  if (e === "pdf") return "pdf";
  if (DATA_EXTS.has(e)) return "data";
  if (CODE_EXTS.has(e)) return "code";
  if (TEXT_EXTS.has(e)) return "text";
  return "unknown";
}

function getLanguageLabel(ext: string): string {
  const map: Record<string, string> = {
    js: "JavaScript", ts: "TypeScript", tsx: "TSX", jsx: "JSX", py: "Python",
    rs: "Rust", css: "CSS", html: "HTML", xml: "XML", json: "JSON",
    yaml: "YAML", yml: "YAML", toml: "TOML", sh: "Shell", bat: "Batch",
    ps1: "PowerShell", sql: "SQL", go: "Go", java: "Java", c: "C",
    cpp: "C++", h: "C Header", hpp: "C++ Header", rb: "Ruby", php: "PHP",
  };
  return map[ext.toLowerCase()] || ext.toUpperCase();
}

function PreviewContent({ pane }: { pane: PreviewPane }) {
  const ext = pane.item.extension.toLowerCase();
  const category = getPreviewCategory(ext);

  if (pane.loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <i className="fa-solid fa-spinner fa-spin text-white/30 text-lg" />
          <span className="text-[11px] text-white/30">Loading preview...</span>
        </div>
      </div>
    );
  }

  if (pane.error) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <i className="fa-solid fa-circle-exclamation text-red-400/60 text-lg" />
          <span className="text-[11px] text-red-300/60">{pane.error}</span>
        </div>
      </div>
    );
  }

  // Image preview
  if (category === "image") {
    const src = pane.item.path ? convertFileSrc(pane.item.path) : pane.item.thumbnail || "";
    return (
      <div className="flex-1 flex items-center justify-center p-3 overflow-hidden">
        <img
          src={src}
          alt={pane.item.name}
          className="max-w-full max-h-full object-contain rounded-lg"
          style={{ imageRendering: ext === "png" || ext === "bmp" ? "pixelated" : "auto" }}
          draggable={false}
        />
      </div>
    );
  }

  // Video preview
  if (category === "video") {
    const src = pane.item.path ? convertFileSrc(pane.item.path) : "";
    return (
      <div className="flex-1 flex items-center justify-center p-3 overflow-hidden">
        <video
          src={src}
          controls
          className="max-w-full max-h-full rounded-lg"
          style={{ outline: "none" }}
        />
      </div>
    );
  }

  // Audio preview
  if (category === "audio") {
    const src = pane.item.path ? convertFileSrc(pane.item.path) : "";
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-pink-500/20 to-purple-500/20 flex items-center justify-center">
          <i className="fa-solid fa-music text-2xl text-pink-400/80" />
        </div>
        <span className="text-[12px] text-white/60 font-medium text-center truncate max-w-full">{pane.item.name}</span>
        <audio src={src} controls className="w-full max-w-[280px]" style={{ outline: "none" }} />
      </div>
    );
  }

  // PDF preview (show first page info + link to open)
  if (category === "pdf") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500/20 to-orange-500/20 flex items-center justify-center">
          <i className="fa-solid fa-file-pdf text-2xl text-red-400/80" />
        </div>
        <span className="text-[12px] text-white/60 font-medium text-center truncate max-w-full">{pane.item.name}</span>
        <span className="text-[10px] text-white/30">{formatFileSize(pane.item.size)}</span>
        {pane.content && (
          <div className="w-full max-h-[200px] overflow-auto rounded-lg bg-black/30 p-3">
            <pre className="text-[10px] text-white/50 whitespace-pre-wrap font-mono leading-relaxed">{pane.content.slice(0, 2000)}</pre>
          </div>
        )}
        <button
          onClick={() => invoke("open_file", { path: pane.item.path })}
          className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-red-300 bg-red-500/10 hover:bg-red-500/20 transition-colors"
        >
          <i className="fa-solid fa-up-right-from-square mr-1.5 text-[9px]" />
          Open in viewer
        </button>
      </div>
    );
  }

  // Code preview
  if (category === "code") {
    const lang = getLanguageLabel(ext);
    const lines = (pane.content || "").split("\n");
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-3 py-1.5 flex items-center gap-2 border-b border-white/5">
          <i className="fa-solid fa-code text-[9px] text-cyan-400/60" />
          <span className="text-[9px] text-white/30 font-medium">{lang}</span>
          <span className="text-[9px] text-white/20 ml-auto">{lines.length} lines</span>
        </div>
        <div className="flex-1 overflow-auto p-0">
          <div className="flex">
            <div className="flex flex-col items-end pr-2 pl-2 py-2 select-none border-r border-white/5 bg-white/[0.02]">
              {lines.map((_, i) => (
                <span key={i} className="text-[9px] text-white/15 leading-[18px] font-mono">{i + 1}</span>
              ))}
            </div>
            <pre className="flex-1 p-2 text-[10px] text-white/70 font-mono leading-[18px] whitespace-pre overflow-x-auto">{pane.content}</pre>
          </div>
        </div>
      </div>
    );
  }

  // Data preview (CSV/TSV/JSON)
  if (category === "data" && pane.content) {
    if (ext === "json") {
      try {
        const parsed = JSON.parse(pane.content);
        const formatted = JSON.stringify(parsed, null, 2);
        return (
          <div className="flex-1 overflow-auto p-3">
            <pre className="text-[10px] text-emerald-300/80 font-mono whitespace-pre leading-[18px]">{formatted}</pre>
          </div>
        );
      } catch {
        // fall through to text
      }
    }
    // CSV/TSV table
    const sep = ext === "tsv" ? "\t" : ",";
    const rows = pane.content.split("\n").filter(r => r.trim()).slice(0, 100);
    const headers = rows[0]?.split(sep) || [];
    const dataRows = rows.slice(1);
    return (
      <div className="flex-1 overflow-auto p-2">
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="text-left px-2 py-1.5 text-white/50 font-medium border-b border-white/10 bg-white/[0.03] whitespace-nowrap">{h.trim()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataRows.map((row, ri) => (
              <tr key={ri} className="hover:bg-white/[0.03]">
                {row.split(sep).map((cell, ci) => (
                  <td key={ci} className="px-2 py-1 text-white/40 border-b border-white/5 whitespace-nowrap">{cell.trim()}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length >= 100 && <p className="text-[9px] text-white/20 mt-2 text-center">Showing first 100 rows...</p>}
      </div>
    );
  }

  // Text preview (fallback)
  if (pane.content !== undefined) {
    return (
      <div className="flex-1 overflow-auto p-3">
        <pre className="text-[10px] text-white/60 font-mono whitespace-pre-wrap leading-[18px]">{pane.content}</pre>
      </div>
    );
  }

  // Unknown file type
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4">
      <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center">
        <i className="fa-solid fa-file text-xl text-white/20" />
      </div>
      <span className="text-[12px] text-white/50 font-medium text-center truncate max-w-full">{pane.item.name}</span>
      <span className="text-[10px] text-white/25">{formatFileSize(pane.item.size)}</span>
      <span className="text-[9px] text-white/20">No preview available for .{ext} files</span>
      <button
        onClick={() => invoke("open_file", { path: pane.item.path })}
        className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-white/40 bg-white/5 hover:bg-white/10 transition-colors"
      >
        <i className="fa-solid fa-up-right-from-square mr-1.5 text-[9px]" />
        Open externally
      </button>
    </div>
  );
}

function SinglePreviewPane({ pane, onClose }: { pane: PreviewPane; onClose: () => void }) {
  const { updatePreviewContent, updatePreviewError, setPreviewLoading } = useZenithStore();
  const ext = pane.item.extension.toLowerCase();
  const category = getPreviewCategory(ext);
  const extColor = getExtensionColor(ext);

  const loadContent = useCallback(async () => {
    // Images, video, audio don't need text content loaded
    if (category === "image" || category === "video" || category === "audio") {
      setPreviewLoading(pane.id, false);
      return;
    }
    if (!pane.item.path) {
      // Text item (no file path) — use the name as content
      updatePreviewContent(pane.id, pane.item.name);
      return;
    }
    try {
      const content = await invoke<string>("read_file_preview", { path: pane.item.path });
      updatePreviewContent(pane.id, content);
    } catch (e) {
      updatePreviewError(pane.id, String(e));
    }
  }, [pane.id, pane.item.path, pane.item.name, category, updatePreviewContent, updatePreviewError, setPreviewLoading]);

  useEffect(() => {
    if (pane.loading && pane.content === undefined && !pane.error) {
      loadContent();
    }
  }, [pane.loading, pane.content, pane.error, loadContent]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -20, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -20, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="flex flex-col rounded-xl overflow-hidden min-h-[120px]"
      style={{
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
        maxHeight: "320px",
      }}
    >
    <SpotlightCard className="rounded-xl" spotlightColor="rgba(34,211,238,0.10)">
      {/* Preview header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5" style={{ background: "rgba(0,0,0,0.15)" }}>
        <div
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: extColor }}
        />
        <span className="text-[10px] font-medium text-white/70 truncate flex-1">{pane.item.name}</span>
        <span className="text-[9px] text-white/25 flex-shrink-0">{formatFileSize(pane.item.size)}</span>
        <span className="text-[8px] text-white/20 uppercase px-1.5 py-0.5 rounded bg-white/5 flex-shrink-0">{ext || "TXT"}</span>
        <button
          onClick={() => invoke("open_file", { path: pane.item.path })}
          className="w-5 h-5 rounded flex items-center justify-center text-white/25 hover:text-white/60 hover:bg-white/5 transition-colors flex-shrink-0"
          title="Open externally"
        >
          <i className="fa-solid fa-up-right-from-square text-[8px]" />
        </button>
        <button
          onClick={onClose}
          className="w-5 h-5 rounded flex items-center justify-center text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
          title="Close preview"
        >
          <i className="fa-solid fa-xmark text-[9px]" />
        </button>
      </div>
      {/* Preview body */}
      <PreviewContent pane={pane} />
    </SpotlightCard>
    </motion.div>
  );
}

export function PreviewDrawer() {
  const { previewPanes, closePreview, closeAllPreviews } = useZenithStore();

  if (previewPanes.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        className="overflow-hidden"
      >
        <div
          className="px-3 pt-2 pb-1"
          style={{ borderTop: "1px solid rgba(255, 255, 255, 0.05)" }}
        >
          {/* Drawer header */}
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-1.5">
              <i className="fa-solid fa-eye text-[9px] text-cyan-400/60" />
              <span className="text-[9px] text-white/30 font-medium uppercase tracking-wider">
                Preview ({previewPanes.length})
              </span>
            </div>
            {previewPanes.length > 1 && (
              <button
                onClick={closeAllPreviews}
                className="text-[9px] text-white/20 hover:text-red-400 transition-colors"
              >
                Close all
              </button>
            )}
          </div>
          {/* Preview panes */}
          <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto pb-1">
            <AnimatePresence mode="popLayout">
              {previewPanes.map((pane) => (
                <SinglePreviewPane
                  key={pane.id}
                  pane={pane}
                  onClose={() => closePreview(pane.id)}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
