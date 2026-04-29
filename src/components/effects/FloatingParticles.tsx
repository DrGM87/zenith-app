interface FloatingParticlesProps { enabled?: boolean; count?: number; }

export function FloatingParticles({ enabled = true, count = 22 }: FloatingParticlesProps) {
  if (!enabled) return null;
  const particles = Array.from({ length: count }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    top: `${Math.random() * 100}%`,
    size: `${Math.random() * 3 + 1}px`,
    duration: `${Math.random() * 8 + 6}s`,
    delay: `${Math.random() * 5}s`,
    opacity: Math.random() * 0.3 + 0.05,
  }));
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
      {particles.map((p) => (
        <div
          key={p.id}
          style={{
            position: "absolute", left: p.left, top: p.top,
            width: p.size, height: p.size, borderRadius: "50%",
            background: "rgba(139,92,246,0.4)", opacity: p.opacity,
            animation: `float ${p.duration} ease-in-out infinite`,
            animationDelay: p.delay,
          }}
        />
      ))}
    </div>
  );
}
