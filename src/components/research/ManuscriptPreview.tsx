import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { THEME as t } from "./shared/constants";

interface GeneratedFigure {
  index?: number;
  caption?: string;
  description?: string;
  chart_type?: string;
  path?: string;
  size?: number;
  image_base64?: string;
}

interface GeneratedTable {
  index?: number;
  caption?: string;
  description?: string;
  markdown?: string;
  size?: number;
}

interface ManuscriptPreviewProps {
  manuscript: string;
  bibliography: string;
  figures: GeneratedFigure[];
  tables: GeneratedTable[];
  onToast: (msg: string) => void;
}

type PreviewTab = "manuscript" | "figures" | "tables" | "bibliography";

export function ManuscriptPreview({ manuscript, bibliography, figures, tables, onToast }: ManuscriptPreviewProps) {
  const [tab, setTab] = useState<PreviewTab>("manuscript");

  const tabs: { id: PreviewTab; label: string; icon: string; count?: number }[] = [
    { id: "manuscript", label: "Manuscript", icon: "fa-file-lines" },
    { id: "figures", label: "Figures", icon: "fa-chart-bar", count: figures.length },
    { id: "tables", label: "Tables", icon: "fa-table", count: tables.length },
    { id: "bibliography", label: "Bibliography", icon: "fa-quote-right" },
  ];

  if (!manuscript && figures.length === 0 && tables.length === 0) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: t.text.ghost }}>
        <div className="text-center">
          <i className="fa-solid fa-file-lines text-3xl mb-3 block" />
          <span className="text-[12px]">Manuscript will appear here when the pipeline completes.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: t.font.sans }}>
      {/* Tab bar */}
      <div className="flex items-center px-4 border-b" style={{ borderColor: t.border.subtle }}>
        {tabs.map((tb) => (
          <button key={tb.id} onClick={() => setTab(tb.id)}
            className="relative flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium transition-colors cursor-pointer"
            style={{ color: tab === tb.id ? t.text.primary : t.text.muted }}
          >
            <i className={`fa-solid ${tb.icon} text-[9px]`} />
            {tb.label}
            {(tb.count ?? 0) > 0 && (
              <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: t.bg.elevated, color: t.text.ghost, fontFamily: t.font.mono }}>
                {tb.count}
              </span>
            )}
            {tab === tb.id && (
              <div className="absolute inset-x-0 bottom-0 h-[2px] rounded-full" style={{ background: t.accent.cyan }} />
            )}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => {
            const content = tab === "bibliography" ? bibliography : manuscript;
            if (content) { navigator.clipboard.writeText(content); onToast("Copied!"); }
          }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] transition-colors cursor-pointer"
          style={{ color: t.text.muted }}
          onMouseEnter={(e) => { e.currentTarget.style.color = t.accent.cyan; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = t.text.muted; }}
        >
          <i className="fa-solid fa-copy text-[9px]" /> Copy
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: `${t.border.subtle} transparent` }}>

        {/* Manuscript */}
        {tab === "manuscript" && (
          <div className="px-8 py-6 max-w-3xl mx-auto">
            {manuscript ? (
              <div className="prose prose-invert prose-sm max-w-none select-text"
                style={{ color: t.text.secondary, lineHeight: 1.8, fontFamily: t.font.sans }}
              >
                <ManuscriptRenderer text={manuscript} />
              </div>
            ) : (
              <div className="text-center py-12" style={{ color: t.text.ghost }}>
                <i className="fa-solid fa-pen-nib text-2xl mb-2 block" />
                <span className="text-[12px]">Draft in progress...</span>
              </div>
            )}
          </div>
        )}

        {/* Figures */}
        {tab === "figures" && (
          <div className="p-4">
            {figures.length > 0 ? (
              <div className="grid grid-cols-2 gap-4">
                {figures.map((fig, i) => (
                  <div key={i} className="rounded-xl overflow-hidden border"
                    style={{ background: t.bg.surface, borderColor: t.border.subtle }}
                  >
                    <div className="px-3 py-2 border-b" style={{ borderColor: t.border.subtle }}>
                      <div className="text-[10px] font-semibold" style={{ color: t.accent.amber, fontFamily: t.font.mono }}>
                        Figure {fig.index || i + 1}
                      </div>
                      <div className="text-[11px] mt-0.5 truncate" style={{ color: t.text.secondary }}>
                        {fig.caption || fig.description || "Generated figure"}
                      </div>
                    </div>
                    <div className="p-3">
                      {fig.image_base64 ? (
                        <img src={`data:image/png;base64,${fig.image_base64}`} alt={fig.caption || "Figure"} className="w-full rounded-lg" />
                      ) : (
                        <div className="h-32 flex items-center justify-center rounded-lg" style={{ background: t.bg.elevated }}>
                          <div className="text-center">
                            <i className={`fa-solid ${fig.chart_type === "pie" ? "fa-chart-pie" : fig.chart_type === "line" ? "fa-chart-line" : "fa-chart-bar"} text-2xl mb-1`}
                              style={{ color: `${t.accent.cyan}40` }}
                            />
                            <div className="text-[9px]" style={{ color: t.text.ghost }}>{fig.chart_type || "chart"}</div>
                          </div>
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-2 text-[9px]" style={{ color: t.text.ghost, fontFamily: t.font.mono }}>
                        <span>{fig.chart_type}</span>
                        <span>{((fig.size || 0) / 1024).toFixed(0)} KB</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12" style={{ color: t.text.ghost }}>
                <i className="fa-solid fa-chart-bar text-2xl mb-2 block" />
                <span className="text-[12px]">No figures generated yet</span>
              </div>
            )}
          </div>
        )}

        {/* Tables */}
        {tab === "tables" && (
          <div className="p-4 space-y-4">
            {tables.length > 0 ? tables.map((tbl, i) => (
              <div key={i} className="rounded-xl overflow-hidden border" style={{ background: t.bg.surface, borderColor: t.border.subtle }}>
                <div className="px-3 py-2 border-b" style={{ borderColor: t.border.subtle }}>
                  <div className="text-[10px] font-semibold" style={{ color: t.accent.emerald, fontFamily: t.font.mono }}>
                    Table {tbl.index || i + 1}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: t.text.secondary }}>
                    {tbl.caption || tbl.description}
                  </div>
                </div>
                {tbl.markdown && (
                  <div className="p-3 overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
                    <pre className="text-[10px] whitespace-pre select-text" style={{ color: t.text.muted, fontFamily: t.font.mono }}>
                      {tbl.markdown}
                    </pre>
                  </div>
                )}
              </div>
            )) : (
              <div className="text-center py-12" style={{ color: t.text.ghost }}>
                <i className="fa-solid fa-table text-2xl mb-2 block" />
                <span className="text-[12px]">No tables generated yet</span>
              </div>
            )}
          </div>
        )}

        {/* Bibliography */}
        {tab === "bibliography" && (
          <div className="px-8 py-6 max-w-3xl mx-auto">
            {bibliography ? (
              <pre className="text-[11px] leading-relaxed whitespace-pre-wrap select-text" style={{ color: t.text.muted, fontFamily: t.font.mono }}>
                {bibliography}
              </pre>
            ) : (
              <div className="text-center py-12" style={{ color: t.text.ghost }}>
                <i className="fa-solid fa-quote-right text-2xl mb-2 block" />
                <span className="text-[12px]">Bibliography not yet compiled</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Markdown renderer — react-markdown + remark-gfm (full GFM: tables, strikethrough, etc.) ──

function ManuscriptRenderer({ text }: { text: string }) {
  return (
    <div className="zenith-prose select-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Override citation superscripts like [1] to look nice
          sup: ({ children }) => (
            <sup style={{ color: t.accent.cyan, fontSize: "0.7em", cursor: "default" }}>{children}</sup>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
