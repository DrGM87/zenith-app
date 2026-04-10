import { useRef, useCallback, type CSSProperties, type ReactNode } from "react";

interface GlareHoverProps {
  children: ReactNode;
  enabled?: boolean;
  className?: string;
  style?: CSSProperties;
  glareColor?: string;
  glareOpacity?: number;
  glareSize?: number;
}

export function GlareHover({
  children,
  enabled = true,
  className = "",
  style = {},
  glareColor = "255,255,255",
  glareOpacity = 0.10,
  glareSize = 350,
}: GlareHoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!enabled || !ref.current || !glareRef.current || !tiltRef.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const dx = (x - cx) / cx;
    const dy = (y - cy) / cy;

    // Glare
    glareRef.current.style.background = `radial-gradient(${glareSize}px circle at ${x}px ${y}px, rgba(${glareColor},${glareOpacity}), transparent 70%)`;
    glareRef.current.style.opacity = "1";

    // Subtle tilt
    tiltRef.current.style.transform = `perspective(800px) rotateX(${-dy * 2}deg) rotateY(${dx * 2}deg)`;
  }, [enabled, glareColor, glareOpacity, glareSize]);

  const onLeave = useCallback(() => {
    if (!enabled || !glareRef.current || !tiltRef.current) return;
    glareRef.current.style.opacity = "0";
    tiltRef.current.style.transform = "perspective(800px) rotateX(0deg) rotateY(0deg)";
  }, [enabled]);

  if (!enabled) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={className}
      style={{ position: "relative", ...style }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <div
        ref={tiltRef}
        style={{ transition: "transform 0.15s ease", transformStyle: "preserve-3d", height: "100%" }}
      >
        {children}
      </div>
      <div
        ref={glareRef}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0,
          transition: "opacity 0.2s ease",
          borderRadius: "inherit",
          zIndex: 10,
        }}
      />
    </div>
  );
}
