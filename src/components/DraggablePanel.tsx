import { motion } from "framer-motion";
import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import { BorderGlow } from "./ReactBits";

interface DraggablePanelProps {
  title: string;
  icon?: string;
  iconColor?: string;
  children: ReactNode;
  width?: number;
  minWidth?: number;
  minHeight?: number;
  accent?: string;
  radius?: number;
  glowEnabled?: boolean;
  glowSpeed?: number;
  badge?: string;
  onClose: () => void;
  onMinimize?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
  initialPosition?: { x: number; y: number };
  resizable?: boolean;
  zIndex?: number;
  className?: string;
}

export function DraggablePanel({
  title,
  icon = "fa-solid fa-window-maximize",
  iconColor,
  children,
  width = 340,
  minWidth = 280,
  minHeight = 200,
  accent = "#6366f1",
  radius = 18,
  glowEnabled = true,
  glowSpeed = 3,
  badge,
  onClose,
  onMinimize,
  pinned = false,
  onTogglePin,
  initialPosition,
  resizable = true,
  zIndex = 100,
  className = "",
}: DraggablePanelProps) {
  const [minimized, setMinimized] = useState(false);
  const [pos, setPos] = useState(initialPosition || { x: 0, y: 0 });
  const [size, setSize] = useState({ w: width, h: 480 });
  const dragRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const dragState = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, select, input, textarea")) return;
    e.preventDefault();
    dragState.current = { startX: e.clientX, startY: e.clientY, posX: pos.x, posY: pos.y };

    const onMove = (ev: MouseEvent) => {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;
      setPos({ x: dragState.current.posX + dx, y: dragState.current.posY + dy });
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [pos]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startW: size.w, startH: size.h };

    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = ev.clientX - resizeRef.current.startX;
      const dy = ev.clientY - resizeRef.current.startY;
      setSize({
        w: Math.max(minWidth, resizeRef.current.startW + dx),
        h: Math.max(minHeight, resizeRef.current.startH + dy),
      });
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [size, minWidth, minHeight]);

  const handleMinimize = useCallback(() => {
    if (onMinimize) onMinimize();
    else setMinimized((m) => !m);
  }, [onMinimize]);

  useEffect(() => {
    setSize((s) => ({ ...s, w: width }));
  }, [width]);

  return (
    <motion.div
      ref={dragRef}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1, x: pos.x, y: pos.y }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className={`shrink-0 ${className}`}
      style={{
        width: size.w,
        height: minimized ? "auto" : size.h,
        zIndex,
        position: "relative",
        userSelect: "none",
      }}
    >
      <BorderGlow
        color1={`${accent}55`}
        color2="rgba(139,92,246,0.3)"
        borderRadius={radius}
        speed={glowSpeed}
        enabled={glowEnabled}
      >
        <div
          className="w-full h-full flex flex-col overflow-hidden"
          style={{
            background: "rgb(12, 12, 18)",
            borderRadius: `${radius}px`,
            border: "1px solid rgba(255, 255, 255, 0.06)",
            boxShadow: "0 8px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03) inset",
          }}
        >
          {/* Title Bar — draggable */}
          <div
            className="flex items-center justify-between px-3 py-2 cursor-move select-none"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
            onMouseDown={handleDragStart}
          >
            <div className="flex items-center gap-2 min-w-0">
              <i className={`${icon} text-[11px]`} style={{ color: iconColor || accent }} />
              <span className="text-[12px] font-bold text-white/90 tracking-wide truncate">{title}</span>
              {badge && (
                <span className="text-[9px] text-white/30 font-medium shrink-0">{badge}</span>
              )}
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              {onTogglePin && (
                <button
                  onClick={onTogglePin}
                  className={`p-1 rounded-md transition-colors ${pinned ? "text-amber-400/70 hover:text-amber-400" : "text-white/20 hover:text-white/50"} hover:bg-white/5`}
                  title={pinned ? "Unpin" : "Pin"}
                >
                  <i className={`fa-solid fa-thumbtack text-[9px] ${pinned ? "" : "rotate-45"}`} />
                </button>
              )}
              <button
                onClick={handleMinimize}
                className="p-1 rounded-md text-white/20 hover:text-white/50 hover:bg-white/5 transition-colors"
                title="Minimize"
              >
                <i className="fa-solid fa-minus text-[9px]" />
              </button>
              <button
                onClick={onClose}
                className="p-1 rounded-md text-white/30 hover:text-red-400/80 hover:bg-red-500/10 transition-colors"
                title="Close"
              >
                <i className="fa-solid fa-xmark text-[10px]" />
              </button>
            </div>
          </div>

          {/* Content */}
          {!minimized && (
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              {children}
            </div>
          )}

          {/* Resize handle */}
          {resizable && !minimized && (
            <div
              className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize opacity-0 hover:opacity-100 transition-opacity"
              onMouseDown={handleResizeStart}
              style={{ zIndex: 10 }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" className="text-white/20">
                <path d="M14 14L8 14M14 14L14 8M14 14L6 6" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
            </div>
          )}
        </div>
      </BorderGlow>
    </motion.div>
  );
}
