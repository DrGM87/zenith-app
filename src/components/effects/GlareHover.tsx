import { type ReactNode } from "react";

interface GlareHoverProps {
  children: ReactNode;
  enabled?: boolean;
  className?: string;
  glareOpacity?: number;
}

export function GlareHover({ children, enabled = true, className = "" }: GlareHoverProps) {
  if (!enabled) return <div className={className}>{children}</div>;
  return (
    <div className={`card-spotlight ${className}`} style={{ position: "relative", overflow: "hidden" }}>
      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </div>
  );
}
