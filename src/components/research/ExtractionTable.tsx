import { THEME as t } from "./shared/constants";
import type { PICOExtraction } from "./shared/types";

interface ExtractionTableProps {
  extractions: PICOExtraction[];
}

const COLUMNS = [
  { key: "paper_title", label: "Paper", width: "flex-1" },
  { key: "population", label: "Population", width: "w-28" },
  { key: "intervention", label: "Intervention", width: "w-28" },
  { key: "comparator", label: "Comparator", width: "w-24" },
  { key: "outcome", label: "Outcome", width: "w-28" },
  { key: "sample_size", label: "N", width: "w-14" },
  { key: "effect_size", label: "Effect", width: "w-16" },
  { key: "ci", label: "95% CI", width: "w-20" },
  { key: "p_value", label: "p", width: "w-14" },
] as const;

export function ExtractionTable({ extractions }: ExtractionTableProps) {
  if (extractions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: t.text.ghost }}>
        <div className="text-center">
          <i className="fa-solid fa-table text-3xl mb-3 block" style={{ color: t.text.ghost }} />
          <span className="text-[12px]">No extractions yet</span>
          <p className="text-[10px] mt-1" style={{ color: t.text.ghost }}>
            Data extraction runs during Track A (Systematic Review) pipeline.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: t.font.sans }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: t.border.subtle }}>
        <i className="fa-solid fa-table text-[10px]" style={{ color: t.accent.amber }} />
        <span className="text-[11px] font-semibold" style={{ color: t.text.secondary }}>
          PICO Data Extraction
        </span>
        <span className="text-[10px] ml-auto" style={{ color: t.text.ghost, fontFamily: t.font.mono }}>
          {extractions.length} studies
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto" style={{ scrollbarWidth: "thin", scrollbarColor: `${t.border.subtle} transparent` }}>
        <table className="w-full border-collapse min-w-[800px]">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th key={col.key}
                  className={`${col.width} px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-wider border-b sticky top-0`}
                  style={{ borderColor: t.border.default, color: t.text.ghost, background: t.bg.surface, fontFamily: t.font.mono }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {extractions.map((row, i) => (
              <tr key={i}
                className="transition-colors"
                style={{ background: i % 2 === 0 ? "transparent" : t.bg.hover }}
                onMouseEnter={(e) => { e.currentTarget.style.background = t.bg.elevated; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = i % 2 === 0 ? "transparent" : t.bg.hover; }}
              >
                {COLUMNS.map((col) => (
                  <td key={col.key}
                    className={`${col.width} px-3 py-2.5 text-[10px] border-b`}
                    style={{
                      borderColor: t.border.subtle,
                      color: col.key === "paper_title" ? t.text.secondary : t.text.muted,
                      fontFamily: ["sample_size", "effect_size", "ci", "p_value"].includes(col.key) ? t.font.mono : t.font.sans,
                    }}
                  >
                    {row[col.key as keyof PICOExtraction] || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
