import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { PaperResult } from "../../stores/useResearchStore";
import { THEME as t } from "./shared/constants";

interface PaperBrowserProps {
  papers: PaperResult[];
  acquiredDois: Set<string>;
}

type SortKey = "title" | "year" | "citations";

export function PaperBrowser({ papers, acquiredDois }: PaperBrowserProps) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("citations");
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);

  const sources = useMemo(() => {
    const s = new Set<string>();
    papers.forEach((p) => { if (p.source) s.add(p.source); });
    return Array.from(s);
  }, [papers]);

  const filtered = useMemo(() => {
    let list = papers;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.title.toLowerCase().includes(q) || (p.abstract || "").toLowerCase().includes(q));
    }
    if (sourceFilter) {
      list = list.filter((p) => p.source === sourceFilter);
    }
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "title") cmp = a.title.localeCompare(b.title);
      else if (sortBy === "year") cmp = (Number(a.year) || 0) - (Number(b.year) || 0);
      else cmp = (a.citations || 0) - (b.citations || 0);
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [papers, search, sortBy, sortAsc, sourceFilter]);

  const handleSort = (key: SortKey) => {
    if (sortBy === key) setSortAsc(!sortAsc);
    else { setSortBy(key); setSortAsc(false); }
  };

  if (papers.length === 0) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: t.text.ghost }}>
        <div className="text-center">
          <i className="fa-solid fa-book-open text-3xl mb-3 block" style={{ color: t.text.ghost }} />
          <span className="text-[12px]">No papers found yet</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: t.font.sans }}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: t.border.subtle }}>
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg flex-1"
          style={{ background: t.bg.elevated, border: `1px solid ${t.border.subtle}` }}
        >
          <i className="fa-solid fa-magnifying-glass text-[9px]" style={{ color: t.text.ghost }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter papers..."
            className="bg-transparent text-[11px] placeholder:opacity-30 outline-none flex-1"
            style={{ color: t.text.secondary }}
          />
        </div>

        {/* Source filters */}
        <div className="flex items-center gap-1">
          <button onClick={() => setSourceFilter(null)}
            className="px-2 py-1 rounded-md text-[9px] font-medium transition-colors cursor-pointer"
            style={{ background: !sourceFilter ? t.accent.cyanDim : "transparent", color: !sourceFilter ? t.accent.cyan : t.text.ghost, border: `1px solid ${!sourceFilter ? t.accent.cyanBorder : "transparent"}` }}
          >All</button>
          {sources.map((s) => (
            <button key={s} onClick={() => setSourceFilter(sourceFilter === s ? null : s)}
              className="px-2 py-1 rounded-md text-[9px] font-medium transition-colors cursor-pointer"
              style={{ background: sourceFilter === s ? t.accent.cyanDim : "transparent", color: sourceFilter === s ? t.accent.cyan : t.text.ghost, border: `1px solid ${sourceFilter === s ? t.accent.cyanBorder : "transparent"}` }}
            >{s}</button>
          ))}
        </div>

        <span className="text-[10px]" style={{ color: t.text.ghost, fontFamily: t.font.mono }}>
          {filtered.length}/{papers.length}
        </span>
      </div>

      {/* Header row */}
      <div className="flex items-center gap-2 px-4 py-2 text-[9px] font-semibold uppercase tracking-wider border-b"
        style={{ borderColor: t.border.subtle, color: t.text.ghost, fontFamily: t.font.mono }}
      >
        <div className="w-5" />
        <button onClick={() => handleSort("title")} className="flex-1 text-left cursor-pointer hover:opacity-80">
          Title {sortBy === "title" && <i className={`fa-solid fa-chevron-${sortAsc ? "up" : "down"} text-[7px] ml-1`} />}
        </button>
        <button onClick={() => handleSort("year")} className="w-14 text-center cursor-pointer hover:opacity-80">
          Year {sortBy === "year" && <i className={`fa-solid fa-chevron-${sortAsc ? "up" : "down"} text-[7px] ml-1`} />}
        </button>
        <button onClick={() => handleSort("citations")} className="w-14 text-center cursor-pointer hover:opacity-80">
          Cites {sortBy === "citations" && <i className={`fa-solid fa-chevron-${sortAsc ? "up" : "down"} text-[7px] ml-1`} />}
        </button>
        <div className="w-16 text-center">Source</div>
      </div>

      {/* Paper list */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: `${t.border.subtle} transparent` }}>
        {filtered.map((paper, idx) => {
          const acquired = acquiredDois.has(paper.doi);
          const expanded = expandedIdx === idx;

          return (
            <div key={idx}>
              <button
                onClick={() => setExpandedIdx(expanded ? null : idx)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors cursor-pointer border-b"
                style={{
                  borderColor: t.border.subtle,
                  background: expanded ? t.bg.elevated : "transparent",
                }}
                onMouseEnter={(e) => { if (!expanded) e.currentTarget.style.background = t.bg.hover; }}
                onMouseLeave={(e) => { if (!expanded) e.currentTarget.style.background = "transparent"; }}
              >
                {/* Status dot */}
                <div className="w-5 flex justify-center">
                  <i className={`fa-solid ${acquired ? "fa-file-pdf" : paper.doi ? "fa-circle" : "fa-minus"} text-[8px]`}
                    style={{ color: acquired ? t.accent.emerald : paper.doi ? `${t.accent.amber}66` : t.text.ghost }}
                  />
                </div>

                {/* Title */}
                <span className="flex-1 text-[11px] truncate" style={{ color: t.text.secondary }}>
                  {paper.title}
                </span>

                {/* Year */}
                <span className="w-14 text-center text-[10px]" style={{ color: t.text.muted, fontFamily: t.font.mono }}>
                  {paper.year || "—"}
                </span>

                {/* Citations */}
                <span className="w-14 text-center text-[10px]" style={{ color: paper.citations > 50 ? t.accent.cyan : t.text.muted, fontFamily: t.font.mono }}>
                  {paper.citations || "—"}
                </span>

                {/* Source */}
                <span className="w-16 text-center text-[9px] px-1.5 py-0.5 rounded"
                  style={{ background: t.bg.elevated, color: t.text.ghost, fontFamily: t.font.mono }}
                >
                  {(paper.source || "").replace("Semantic Scholar", "S2")}
                </span>
              </button>

              {/* Expanded detail */}
              <AnimatePresence>
                {expanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden border-b"
                    style={{ borderColor: t.border.subtle, background: t.bg.surface }}
                  >
                    <div className="px-6 py-4 pl-11">
                      {/* Authors */}
                      <div className="text-[10px] mb-2" style={{ color: t.text.muted }}>
                        {(paper.authors || []).slice(0, 5).join(", ")}
                        {(paper.authors || []).length > 5 && ` +${(paper.authors || []).length - 5} more`}
                      </div>

                      {/* Abstract */}
                      {paper.abstract && (
                        <p className="text-[11px] leading-relaxed mb-3 select-text" style={{ color: t.text.tertiary }}>
                          {paper.abstract}
                        </p>
                      )}

                      {/* Meta */}
                      <div className="flex items-center gap-3 text-[10px]" style={{ fontFamily: t.font.mono }}>
                        {paper.doi && (
                          <span style={{ color: t.text.ghost }}>DOI: {paper.doi}</span>
                        )}
                        {paper.url && (
                          <a href={paper.url} target="_blank" rel="noreferrer"
                            className="flex items-center gap-1 cursor-pointer transition-colors"
                            style={{ color: t.accent.cyan }}
                          >
                            <i className="fa-solid fa-external-link text-[8px]" /> Open
                          </a>
                        )}
                        {acquired && (
                          <span className="flex items-center gap-1" style={{ color: t.accent.emerald }}>
                            <i className="fa-solid fa-check text-[8px]" /> PDF acquired
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
