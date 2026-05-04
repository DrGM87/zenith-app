import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface ComponentDef {
  type: string;
  id?: string;
  [key: string]: unknown;
}

interface ScriptWindowContent {
  title: string;
  components: ComponentDef[];
  width?: number;
  height?: number;
  pinned?: boolean;
  collapse_delay?: number;
}

const BASE = "http://127.0.0.1:7890";

function sendEvent(event: Record<string, unknown>) {
  const body = JSON.stringify(event);
  fetch(`${BASE}/window/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }).catch(() => {});
}

/* ─── Component renderers ─── */

function SLabel({ c }: { c: ComponentDef }) {
  const style = c.style as string | undefined;
  const cls =
    style === "heading"
      ? "text-base font-bold text-white/95"
      : style === "muted"
        ? "text-xs text-white/40"
        : style === "success"
          ? "text-sm text-emerald-400"
          : style === "error"
            ? "text-sm text-red-400"
            : style === "warning"
              ? "text-sm text-amber-400"
              : "text-sm text-white/80";
  return <p className={cls}>{String(c.text ?? "")}</p>;
}

function SButton({ c }: { c: ComponentDef }) {
  const variant = (c.variant as string) || "default";
  const disabled = c.disabled as boolean | undefined;
  const loading = c.loading as boolean | undefined;
  const base =
    "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
  const variants: Record<string, string> = {
    primary: "bg-cyan-500/80 hover:bg-cyan-400 text-black",
    danger: "bg-red-500/70 hover:bg-red-400 text-white",
    success: "bg-emerald-500/70 hover:bg-emerald-400 text-black",
    default: "bg-white/8 hover:bg-white/15 text-white/80",
  };
  return (
    <button
      className={`${base} ${variants[variant] || variants.default}`}
      disabled={disabled || loading}
      onClick={() => sendEvent({ type: "click", id: c.id })}
    >
      {loading ? (
        <span className="flex items-center gap-1.5">
          <i className="fa-solid fa-spinner fa-spin text-[10px]" />
          {String(c.label ?? "")}
        </span>
      ) : (
        String(c.label ?? "")
      )}
    </button>
  );
}

function SInput({ c }: { c: ComponentDef }) {
  const isPassword = c.password as boolean | undefined;
  return (
    <div className="flex flex-col gap-1">
      {Boolean(c.label) && (
        <label className="text-[11px] text-white/50 font-medium uppercase tracking-wider">
          {String(c.label ?? "")}
        </label>
      )}
      <input
        type={isPassword ? "password" : "text"}
        className="bg-white/5 border border-white/8 rounded-lg px-3 py-1.5 text-sm text-white/90 outline-none focus:border-cyan-500/50 placeholder:text-white/20"
        placeholder={c.placeholder as string}
        defaultValue={c.value as string}
        onBlur={(e) =>
          sendEvent({ type: "change", id: c.id, value: e.target.value })
        }
        onKeyDown={(e) => {
          if (e.key === "Enter")
            sendEvent({
              type: "change",
              id: c.id,
              value: (e.target as HTMLInputElement).value,
            });
        }}
      />
    </div>
  );
}

function SMultiline({ c }: { c: ComponentDef }) {
  return (
    <div className="flex flex-col gap-1">
      {Boolean(c.label) && (
        <label className="text-[11px] text-white/50 font-medium uppercase tracking-wider">
          {String(c.label ?? "")}
        </label>
      )}
      <textarea
        className="bg-white/5 border border-white/8 rounded-lg px-3 py-2 text-sm text-white/90 outline-none focus:border-cyan-500/50 resize-none placeholder:text-white/20"
        rows={(c.rows as number) || 4}
        placeholder={c.placeholder as string}
        defaultValue={c.value as string}
        readOnly={c.readonly as boolean}
        onBlur={(e) =>
          sendEvent({ type: "change", id: c.id, value: e.target.value })
        }
      />
    </div>
  );
}

function SSelect({ c }: { c: ComponentDef }) {
  const options = (c.options as { label: string; value: string }[]) || [];
  return (
    <div className="flex flex-col gap-1">
      {Boolean(c.label) && (
        <label className="text-[11px] text-white/50 font-medium uppercase tracking-wider">
          {String(c.label ?? "")}
        </label>
      )}
      <select
        className="bg-white/5 border border-white/8 rounded-lg px-3 py-1.5 text-sm text-white/90 outline-none focus:border-cyan-500/50"
        defaultValue={c.value as string}
        onChange={(e) =>
          sendEvent({ type: "change", id: c.id, value: e.target.value })
        }
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#1a1a2e] text-white">
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function SToggle({ c }: { c: ComponentDef }) {
  const [on, setOn] = useState(c.value as boolean);
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-white/80">{String(c.label ?? "")}</span>
      <button
        className={`w-9 h-5 rounded-full transition-colors relative ${on ? "bg-cyan-500" : "bg-white/15"}`}
        onClick={() => {
          const next = !on;
          setOn(next);
          sendEvent({ type: "change", id: c.id, value: next });
        }}
      >
        <div
          className={`w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-transform ${on ? "translate-x-[18px]" : "translate-x-[3px]"}`}
        />
      </button>
    </div>
  );
}

function SSlider({ c }: { c: ComponentDef }) {
  const [val, setVal] = useState(c.value as number);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between">
        <label className="text-[11px] text-white/50 font-medium uppercase tracking-wider">
          {c.label as string}
        </label>
        <span className="text-[11px] text-cyan-400 font-mono">{val}</span>
      </div>
      <input
        type="range"
        min={c.min as number}
        max={c.max as number}
        step={c.step as number}
        value={val}
        className="w-full accent-cyan-500"
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          setVal(v);
          sendEvent({ type: "change", id: c.id, value: v });
        }}
      />
    </div>
  );
}

function SProgress({ c }: { c: ComponentDef }) {
  const pct = (c.value as number) || 0;
  return (
    <div className="flex flex-col gap-1">
      {Boolean(c.label) && (
        <span className="text-[11px] text-white/50">{String(c.label ?? "")}</span>
      )}
      <div className="h-2 rounded-full bg-white/8 overflow-hidden">
        <div
          className="h-full rounded-full bg-cyan-500 transition-all duration-300"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function SStat({ c }: { c: ComponentDef }) {
  return (
    <div className="text-center p-2 bg-white/4 rounded-lg border border-white/6">
      <div className="text-lg font-bold text-cyan-400">{String(c.value ?? "")}</div>
      <div className="text-[10px] text-white/40 uppercase tracking-wider">
        {String(c.label ?? "")}
      </div>
    </div>
  );
}

function SDivider() {
  return <hr className="border-white/6 my-1" />;
}

function SGrid({ c }: { c: ComponentDef }) {
  const cols = (c.columns as number) || 2;
  const children = (c.children as ComponentDef[]) || [];
  return (
    <div
      className="gap-2"
      style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {children.map((child, i) => (
        <RenderComponent key={child.id || `g-${i}`} c={child} />
      ))}
    </div>
  );
}

function SCard({ c }: { c: ComponentDef }) {
  const children = (c.children as ComponentDef[]) || [];
  return (
    <div className="bg-white/4 border border-white/6 rounded-xl p-3 flex flex-col gap-2">
      {Boolean(c.title) && (
        <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">
          {String(c.title ?? "")}
        </span>
      )}
      {children.map((child, i) => (
        <RenderComponent key={child.id || `c-${i}`} c={child} />
      ))}
    </div>
  );
}

function SText({ c }: { c: ComponentDef }) {
  return (
    <div className="text-sm text-white/70 leading-relaxed whitespace-pre-wrap select-text">
      {String(c.text ?? "")}
    </div>
  );
}

function SButtonGroup({ c }: { c: ComponentDef }) {
  const children = (c.children as ComponentDef[]) || [];
  return (
    <div className="flex gap-2 flex-wrap">
      {children.map((child, i) => (
        <RenderComponent key={child.id || `bg-${i}`} c={child} />
      ))}
    </div>
  );
}

function SSpacer({ c }: { c: ComponentDef }) {
  return <div style={{ height: (c.height as number) || 8 }} />;
}

function RenderComponent({ c }: { c: ComponentDef }) {
  switch (c.type) {
    case "label":
      return <SLabel c={c} />;
    case "button":
      return <SButton c={c} />;
    case "input":
      return <SInput c={c} />;
    case "multiline":
      return <SMultiline c={c} />;
    case "select":
      return <SSelect c={c} />;
    case "toggle":
      return <SToggle c={c} />;
    case "slider":
      return <SSlider c={c} />;
    case "progress":
      return <SProgress c={c} />;
    case "stat":
      return <SStat c={c} />;
    case "divider":
      return <SDivider />;
    case "grid":
      return <SGrid c={c} />;
    case "card":
      return <SCard c={c} />;
    case "text":
      return <SText c={c} />;
    case "button_group":
      return <SButtonGroup c={c} />;
    case "spacer":
      return <SSpacer c={c} />;
    default:
      return null;
  }
}

/* ─── Main ScriptWindow ─── */

export function ScriptWindow() {
  const [content, setContent] = useState<ScriptWindowContent | null>(null);
  const [pinned, setPinned] = useState(false);
  const [visible, setVisible] = useState(true);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadContent = useCallback(async () => {
    try {
      const c = await invoke<ScriptWindowContent | null>(
        "get_script_window_content"
      );
      setContent(c);
      if (c?.pinned) setPinned(true);
    } catch (e) {
      console.error("Failed to load script window content:", e);
    }
  }, []);

  const scheduleCollapse = useCallback(() => {
    if (pinned) return;
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    const delay = content?.collapse_delay ?? 8000;
    collapseTimer.current = setTimeout(() => setVisible(false), delay);
  }, [pinned, content?.collapse_delay]);

  const handleMouseEnter = () => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    setVisible(true);
  };

  const handleMouseLeave = () => {
    scheduleCollapse();
  };

  useEffect(() => {
    loadContent();
    const unlisten = listen("script-window-update", () => loadContent());
    const unlistenTheme = listen<string>("theme-changed", (ev) => {
      document.documentElement.setAttribute("data-theme", ev.payload === "light" ? "light" : "dark");
    });
    const poll = setInterval(loadContent, 800);
    return () => {
      unlisten.then((f) => f());
      unlistenTheme.then((f) => f());
      clearInterval(poll);
    };
  }, [loadContent]);

  useEffect(() => {
    if (content && !pinned) scheduleCollapse();
    return () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
    };
  }, [content, pinned, scheduleCollapse]);

  const handleClose = async () => {
    try {
      await invoke("close_script_window");
      getCurrentWindow().close();
    } catch (e) {
      console.error("Failed to close:", e);
    }
  };

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    if (next && collapseTimer.current) clearTimeout(collapseTimer.current);
    if (!next) scheduleCollapse();
  };

  const components = Array.isArray(content?.components)
    ? (content.components as ComponentDef[])
    : [];

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden select-none transition-opacity duration-300"
      style={{
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        background: "rgba(18, 18, 24, 0.95)",
        backdropFilter: "blur(40px) saturate(180%)",
        WebkitBackdropFilter: "blur(40px) saturate(180%)",
        borderRadius: "16px",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        boxShadow:
          "0 32px 64px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05) inset",
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Title bar */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between px-4 py-2.5 shrink-0"
        style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}
      >
        <div className="flex items-center gap-2" data-tauri-drag-region>
          <i className="fa-solid fa-terminal text-cyan-400 text-xs" />
          <span className="text-[12px] font-semibold text-white/80 tracking-wide uppercase">
            {content?.title || "Script"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={togglePin}
            className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${pinned ? "text-cyan-400 bg-cyan-500/20" : "text-white/30 hover:text-white/60"}`}
            title={pinned ? "Unpin" : "Pin open"}
          >
            <i className={`fa-solid fa-thumbtack text-[9px] ${pinned ? "" : "rotate-45"}`} />
          </button>
          <button
            onClick={handleClose}
            className="w-6 h-6 rounded-full flex items-center justify-center text-white/30 hover:text-white hover:bg-red-500/60 transition-colors"
          >
            <i className="fa-solid fa-xmark text-[10px]" />
          </button>
        </div>
      </div>

      {/* Component area */}
      <div className="flex-1 overflow-auto p-4 flex flex-col gap-2.5">
        {components.length > 0 ? (
          components.map((c, i) => (
            <RenderComponent key={c.id || `comp-${i}`} c={c} />
          ))
        ) : (
          <div className="flex items-center justify-center h-full text-white/20 text-sm">
            <div className="text-center">
              <i className="fa-solid fa-code text-2xl mb-2 block opacity-30" />
              <p>Waiting for script...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
