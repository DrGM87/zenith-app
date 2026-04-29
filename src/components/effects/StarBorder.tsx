import { type ReactNode, type CSSProperties } from "react";

interface StarBorderProps {
  children: ReactNode;
  enabled?: boolean;
  color?: string;
  speed?: string;
  radius?: number;
  style?: CSSProperties;
}

export function StarBorder({ children, enabled = true, color = "#22d3ee", speed = "4s", radius = 0, style }: StarBorderProps) {
  if (!enabled) return <div style={style}>{children}</div>;
  return (
    <div style={{ ...style, position: "relative", borderRadius: radius }}>
      <div style={{
        position: "absolute", inset: -1, borderRadius: radius + 1,
        background: `conic-gradient(from 0deg, transparent 0%, ${color}44 25%, ${color}88 50%, transparent 75%)`,
        animation: `glow-rotate ${speed} linear infinite`, filter: "blur(1px)", zIndex: -1,
      }} />
      {children}
    </div>
  );
}
