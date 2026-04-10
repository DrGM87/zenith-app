import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useResearchStore } from "../../stores/useResearchStore";
import { THEME as t } from "./shared/constants";
import { fmtDate, fmtCost } from "./shared/helpers";

interface ThreadSidebarProps {
  onNew: () => void;
}

export function ThreadSidebar({ onNew }: ThreadSidebarProps) {
  const { threads, activeThreadId, switchThread, deleteThread, totalCost } = useResearchStore();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return threads;
    const q = search.toLowerCase();
    return threads.filter((th) => th.title.toLowerCase().includes(q));
  }, [threads, search]);

  const grouped = useMemo(() => {
    const groups: { label: string; threads: typeof threads }[] = [];
    const today: typeof threads = [];
    const yesterday: typeof threads = [];
    const older: typeof threads = [];
    const now = new Date();
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    for (const th of filtered) {
      const d = new Date(th.updated_at);
      if (d.toDateString() === now.toDateString()) today.push(th);
      else if (d.toDateString() === yest.toDateString()) yesterday.push(th);
      else older.push(th);
    }
    if (today.length) groups.push({ label: "Today", threads: today });
    if (yesterday.length) groups.push({ label: "Yesterday", threads: yesterday });
    if (older.length) groups.push({ label: "Older", threads: older });
    return groups;
  }, [filtered]);

  return (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 250, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className="flex flex-col border-r overflow-hidden select-none"
      style={{ background: t.bg.base, borderColor: t.border.subtle, minWidth: 0, fontFamily: t.font.sans }}
    >
      {/* Top bar: search + new button */}
      <div className="px-3 pt-3 pb-2 flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 px-2.5 py-2 rounded-lg"
          style={{ background: t.bg.surface, border: `1px solid ${t.border.subtle}` }}
        >
          <i className="fa-solid fa-magnifying-glass text-[10px]" style={{ color: t.text.ghost }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="bg-transparent text-[12px] placeholder:opacity-40 outline-none flex-1"
            style={{ color: t.text.secondary, fontFamily: t.font.sans }}
          />
          {search && (
            <button onClick={() => setSearch("")} className="cursor-pointer opacity-50 hover:opacity-100" style={{ color: t.text.ghost }}>
              <i className="fa-solid fa-xmark text-[9px]" />
            </button>
          )}
        </div>

        {/* New Thread button */}
        <button
          onClick={onNew}
          title="New research thread"
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 cursor-pointer transition-all"
          style={{ background: t.accent.cyanDim, color: t.accent.cyan, border: `1px solid ${t.accent.cyanBorder}` }}
          onMouseEnter={(e) => { e.currentTarget.style.background = `${t.accent.cyan}25`; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = t.accent.cyanDim; }}
        >
          <i className="fa-solid fa-plus text-[11px]" />
        </button>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-3" style={{ scrollbarWidth: "thin", scrollbarColor: `${t.border.subtle} transparent` }}>
        {grouped.length === 0 && threads.length === 0 && (
          <div className="text-center px-3 py-10">
            <div className="w-12 h-12 mx-auto rounded-xl flex items-center justify-center mb-3"
              style={{ background: t.bg.surface, border: `1px solid ${t.border.subtle}` }}>
              <i className="fa-solid fa-flask text-lg" style={{ color: t.text.ghost }} />
            </div>
            <div className="text-[11px] mb-2" style={{ color: t.text.muted }}>No threads yet</div>
            <button onClick={onNew}
              className="text-[10px] px-3 py-1.5 rounded-lg cursor-pointer transition-all"
              style={{ background: t.accent.cyanDim, color: t.accent.cyan, border: `1px solid ${t.accent.cyanBorder}` }}
            >
              <i className="fa-solid fa-plus text-[9px] mr-1" />Start Research
            </button>
          </div>
        )}

        {grouped.map((group) => (
          <div key={group.label}>
            <div className="text-[9px] font-semibold uppercase tracking-[0.12em] px-2.5 mb-1.5"
              style={{ color: t.text.ghost, fontFamily: t.font.mono }}
            >
              {group.label}
            </div>
            {group.threads.map((th) => {
              const active = th.id === activeThreadId;
              return (
                <button key={th.id}
                  onClick={() => switchThread(th.id)}
                  className="w-full text-left px-2.5 py-2.5 rounded-lg mb-0.5 transition-all duration-150 group cursor-pointer border"
                  style={{
                    background: active ? t.accent.cyanDim : "transparent",
                    borderColor: active ? t.accent.cyanBorder : "transparent",
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = t.bg.hover; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors"
                      style={{ background: active ? t.accent.cyan : t.text.ghost }}
                    />
                    <span className="text-[12px] truncate flex-1" style={{ color: active ? t.text.primary : t.text.secondary }}>
                      {th.title}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteThread(th.id); }}
                      className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded flex items-center justify-center transition-all cursor-pointer"
                      style={{ color: t.text.ghost }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = t.accent.red; e.currentTarget.style.background = t.accent.redDim; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = t.text.ghost; e.currentTarget.style.background = "transparent"; }}
                    >
                      <i className="fa-solid fa-xmark text-[9px]" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-1 pl-3.5">
                    <span className="text-[10px]" style={{ color: t.text.ghost, fontFamily: t.font.mono }}>{fmtDate(th.updated_at)}</span>
                    {th.total_cost > 0 && (
                      <span className="text-[10px]" style={{ color: `${t.accent.cyan}66`, fontFamily: t.font.mono }}>{fmtCost(th.total_cost)}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ))}

        {filtered.length === 0 && threads.length > 0 && (
          <div className="text-center text-[11px] py-10" style={{ color: t.text.ghost }}>
            No threads match "{search}"
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2.5 border-t" style={{ borderColor: t.border.subtle }}>
        <div className="flex items-center justify-between text-[10px]" style={{ fontFamily: t.font.mono }}>
          <span style={{ color: t.text.ghost }}>{threads.length} thread{threads.length !== 1 ? "s" : ""}</span>
          {totalCost() > 0 && (
            <span style={{ color: `${t.accent.cyan}88` }}>{fmtCost(totalCost())} total</span>
          )}
        </div>
      </div>
    </motion.aside>
  );
}
