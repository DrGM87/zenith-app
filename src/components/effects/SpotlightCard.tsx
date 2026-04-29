import { type ReactNode, type CSSProperties } from "react";

interface SpotlightCardProps {
  children: ReactNode;
  enabled?: boolean;
  spotColor?: string;
  spotRadius?: number;
  className?: string;
  style?: CSSProperties;
}

export function SpotlightCard({ children, enabled = true, spotColor = "rgba(255,255,255,0.05)", className = "", style }: SpotlightCardProps) {
  if (!enabled) return <div className={className} style={style}>{children}</div>;
  return (
    <div
      className={`card-spotlight ${className}`}
      style={{
        ...style,
        "--spotlight-color": spotColor,
        position: "relative",
        overflow: "hidden",
      } as CSSProperties}
    >
      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </div>
  );
}
