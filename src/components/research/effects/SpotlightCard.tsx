import { useRef, useCallback, type CSSProperties, type ReactNode } from "react";

interface SpotlightCardProps {
  children: ReactNode;
  enabled?: boolean;
  className?: string;
  style?: CSSProperties;
  spotColor?: string;
  spotRadius?: number;
}

export function SpotlightCard({
  children,
  enabled = true,
  className = "",
  style = {},
  spotColor = "rgba(34,211,238,0.07)",
  spotRadius = 380,
}: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!enabled || !ref.current || !overlayRef.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    overlayRef.current.style.background = `radial-gradient(${spotRadius}px circle at ${x}px ${y}px, ${spotColor}, transparent 70%)`;
    overlayRef.current.style.opacity = "1";
  }, [enabled, spotColor, spotRadius]);

  const onLeave = useCallback(() => {
    if (!enabled || !overlayRef.current) return;
    overlayRef.current.style.opacity = "0";
  }, [enabled]);

  return (
    <div
      ref={ref}
      className={className}
      style={{ position: "relative", ...style }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      {enabled && (
        <div
          ref={overlayRef}
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            transition: "opacity 0.25s ease",
            pointerEvents: "none",
            zIndex: 1,
            borderRadius: "inherit",
          }}
        />
      )}
      <div style={{ position: "relative", zIndex: 2, width: "100%", height: "100%", display: "contents" }}>
        {children}
      </div>
    </div>
  );
}
