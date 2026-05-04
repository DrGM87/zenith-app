import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { motion, AnimatePresence } from "framer-motion";

interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  year: string;
  genre: string;
  cover_url: string;
  shazam_url: string;
  discovered_at: number;
  note: string;
}

export function MusicDiscoveryPage() {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<MusicTrack>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadTracks = useCallback(async () => {
    setLoading(true);
    try {
      const t = await invoke<MusicTrack[]>("get_music_discovery");
      setTracks(t);
    } catch { setTracks([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    invoke<{ appearance: { theme: string } }>("get_settings").then((s) => {
      document.documentElement.setAttribute("data-theme", s.appearance.theme === "light" ? "light" : "dark");
    }).catch(() => {});
    loadTracks();
    const unlisten = listen<string>("theme-changed", (ev) => {
      document.documentElement.setAttribute("data-theme", ev.payload === "light" ? "light" : "dark");
    });
    return () => { unlisten.then((f) => f()); };
  }, [loadTracks]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const startEdit = (track: MusicTrack) => {
    setEditingId(track.id);
    setEditForm({ title: track.title, artist: track.artist, album: track.album, year: track.year, genre: track.genre, note: track.note });
  };

  const saveTrack = async () => {
    const current = tracks.find((t) => t.id === editingId);
    if (!current) return;
    const updated: MusicTrack = { ...current, ...editForm };
    try {
      await invoke("save_music_track", { track: updated });
      await loadTracks();
      setEditingId(null);
      showToast("Saved");
    } catch (e) { showToast(String(e)); }
  };

  const deleteTrack = async (id: string) => {
    try {
      await invoke("delete_music_track", { id });
      await loadTracks();
      showToast("Removed");
    } catch (e) { showToast(String(e)); }
  };

  const fmtDate = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return "Today";
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const accent = "#ec4899";

  return (
    <div className="flex flex-col h-screen w-full select-none" style={{ background: "var(--zen-bg-base)", color: "var(--zen-text-primary)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b shrink-0" style={{ borderColor: "var(--zen-border-default)" }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(236,72,153,0.12)" }}>
            <i className="fa-solid fa-music text-sm" style={{ color: accent }} />
          </div>
          <div>
            <h1 className="text-[15px] font-bold zenith-brand" style={{ color: "var(--zen-text-primary)" }}>Music Discovery</h1>
            <p className="text-[10px]" style={{ color: "var(--zen-text-tertiary)" }}>{tracks.length} track{tracks.length !== 1 ? "s" : ""} discovered</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4" style={{ scrollbarWidth: "thin" }}>
        {loading ? (
          <div className="flex items-center justify-center h-full"><i className="fa-solid fa-spinner fa-spin text-2xl" style={{ color: "var(--zen-text-muted)" }} /></div>
        ) : tracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "rgba(236,72,153,0.08)" }}>
              <i className="fa-solid fa-microphone-lines text-2xl" style={{ color: accent, opacity: 0.5 }} />
            </div>
            <div className="text-center">
              <p className="text-[14px] font-medium" style={{ color: "var(--zen-text-muted)" }}>No tracks discovered yet</p>
              <p className="text-[11px] mt-1" style={{ color: "var(--zen-text-tertiary)" }}>Click the mic button in the main Zenith panel to identify music playing around you</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 max-w-3xl mx-auto">
            {tracks.map((track) => (
              <motion.div key={track.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="rounded-xl overflow-hidden p-4" style={{ background: "var(--zen-bg-surface)", border: "1px solid var(--zen-border-default)" }}>
                {editingId === track.id ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <input value={editForm.title || ""} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} placeholder="Title" className="w-full px-3 py-2 rounded-lg text-[13px] font-semibold outline-none" style={{ background: "var(--zen-bg-elevated)", border: "1px solid var(--zen-border-default)", color: "var(--zen-text-primary)" }} autoFocus />
                      <input value={editForm.artist || ""} onChange={(e) => setEditForm({ ...editForm, artist: e.target.value })} placeholder="Artist" className="w-full px-3 py-2 rounded-lg text-[13px] outline-none" style={{ background: "var(--zen-bg-elevated)", border: "1px solid var(--zen-border-default)", color: "var(--zen-text-secondary)" }} />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <input value={editForm.album || ""} onChange={(e) => setEditForm({ ...editForm, album: e.target.value })} placeholder="Album" className="px-3 py-2 rounded-lg text-[12px] outline-none" style={{ background: "var(--zen-bg-elevated)", border: "1px solid var(--zen-border-default)", color: "var(--zen-text-secondary)" }} />
                      <input value={editForm.year || ""} onChange={(e) => setEditForm({ ...editForm, year: e.target.value })} placeholder="Year" className="px-3 py-2 rounded-lg text-[12px] outline-none" style={{ background: "var(--zen-bg-elevated)", border: "1px solid var(--zen-border-default)", color: "var(--zen-text-secondary)" }} />
                      <input value={editForm.genre || ""} onChange={(e) => setEditForm({ ...editForm, genre: e.target.value })} placeholder="Genre" className="px-3 py-2 rounded-lg text-[12px] outline-none" style={{ background: "var(--zen-bg-elevated)", border: "1px solid var(--zen-border-default)", color: "var(--zen-text-secondary)" }} />
                    </div>
                    <textarea value={editForm.note || ""} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} placeholder="Personal note..." rows={2} className="w-full px-3 py-2 rounded-lg text-[12px] outline-none resize-none" style={{ background: "var(--zen-bg-elevated)", border: "1px solid var(--zen-border-default)", color: "var(--zen-text-muted)" }} />
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditingId(null)} className="px-4 py-2 rounded-lg text-[12px] font-medium transition-colors" style={{ color: "var(--zen-text-muted)" }}>Cancel</button>
                      <button onClick={saveTrack} className="px-4 py-2 rounded-lg text-[12px] font-medium text-white transition-colors" style={{ background: accent }}>Save</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-4">
                    {track.cover_url ? (
                      <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0" style={{ background: "var(--zen-bg-elevated)" }}>
                        <img src={track.cover_url} alt={track.title} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLElement).style.display = "none"; }} />
                      </div>
                    ) : (
                      <div className="w-16 h-16 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(236,72,153,0.08)" }}>
                        <i className="fa-solid fa-music text-lg" style={{ color: accent, opacity: 0.4 }} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold truncate" style={{ color: "var(--zen-text-primary)" }}>{track.title}</p>
                          <p className="text-[12px] mt-0.5" style={{ color: accent, opacity: 0.8 }}>{track.artist}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => startEdit(track)} className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors" style={{ color: "var(--zen-text-tertiary)" }} title="Edit"><i className="fa-solid fa-pen text-xs" /></button>
                          <button onClick={() => deleteTrack(track.id)} className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-red-500/10" style={{ color: "var(--zen-text-muted)" }} title="Remove"><i className="fa-solid fa-trash text-xs" /></button>
                        </div>
                      </div>
                      {(track.album || track.year || track.genre) && (
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {track.album && <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "var(--zen-bg-elevated)", color: "var(--zen-text-secondary)" }}>{track.album}</span>}
                          {track.year && <span className="text-[10px]" style={{ color: "var(--zen-text-tertiary)" }}>{track.year}</span>}
                          {track.genre && <span className="text-[10px]" style={{ color: "var(--zen-accent-cyan)" }}>{track.genre}</span>}
                        </div>
                      )}
                      {track.note && <p className="text-[11px] mt-2 leading-relaxed line-clamp-3" style={{ color: "var(--zen-text-muted)", fontStyle: "italic" }}>{track.note}</p>}
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-[9px]" style={{ color: "var(--zen-text-tertiary)" }}>{fmtDate(track.discovered_at)}</span>
                        {track.shazam_url && (
                          <a href={track.shazam_url} target="_blank" rel="noopener noreferrer" className="text-[9px] underline transition-colors" style={{ color: "var(--zen-accent-cyan)" }}>Open in Shazam <i className="fa-solid fa-up-right-from-square text-[6px] ml-0.5" /></a>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-[12px] font-medium shadow-lg z-50"
            style={{ background: accent, color: "#fff" }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
