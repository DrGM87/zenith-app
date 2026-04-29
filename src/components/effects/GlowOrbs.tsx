interface GlowOrbsProps { enabled?: boolean; }

export function GlowOrbs({ enabled = true }: GlowOrbsProps) {
  if (!enabled) return null;
  return (
    <>
      <div style={{ position: "absolute", width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.12), transparent 70%)", top: "-10%", left: "10%", filter: "blur(40px)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", width: 250, height: 250, borderRadius: "50%", background: "radial-gradient(circle, rgba(34,211,238,0.10), transparent 70%)", bottom: "5%", right: "15%", filter: "blur(40px)", pointerEvents: "none" }} />
    </>
  );
}
