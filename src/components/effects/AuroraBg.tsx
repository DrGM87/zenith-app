import { type ReactNode } from "react";

interface AuroraBgProps { enabled?: boolean; children?: ReactNode; }

export function AuroraBg({ enabled = true, children }: AuroraBgProps) {
  if (!enabled) return children ?? null;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
      <div style={{
        position: "absolute", inset: "-50%",
        background: "radial-gradient(ellipse 40% 50% at 30% 40%, rgba(139,92,246,0.06), transparent 70%), radial-gradient(ellipse 35% 45% at 70% 60%, rgba(34,211,238,0.05), transparent 70%), radial-gradient(ellipse 50% 35% at 50% 30%, rgba(236,72,153,0.04), transparent 70%)",
        animation: "aurora-drift 12s ease-in-out infinite alternate",
      }} />
      <div style={{
        position: "absolute", inset: "-50%",
        background: "radial-gradient(ellipse 30% 40% at 60% 35%, rgba(34,211,238,0.04), transparent 70%), radial-gradient(ellipse 45% 30% at 35% 65%, rgba(139,92,246,0.05), transparent 70%)",
        animation: "aurora-drift-alt 10s ease-in-out infinite alternate-reverse",
      }} />
      {children}
    </div>
  );
}
