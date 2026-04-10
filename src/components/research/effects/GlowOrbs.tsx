import { useEffect, useRef } from "react";

interface GlowOrbsProps {
  enabled?: boolean;
}

const ORBS = [
  { x: 15,  y: 20,  r: 220, color: "34,211,238",  duration: 9,  delay: 0   },
  { x: 82,  y: 18,  r: 180, color: "139,92,246",  duration: 11, delay: 2   },
  { x: 68,  y: 72,  r: 260, color: "16,185,129",  duration: 10, delay: 4   },
  { x: 28,  y: 78,  r: 160, color: "245,158,11",  duration: 13, delay: 1.5 },
  { x: 50,  y: 45,  r: 140, color: "139,92,246",  duration: 8,  delay: 3   },
];

export function GlowOrbs({ enabled = true }: GlowOrbsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled || !containerRef.current) return;
    const container = containerRef.current;

    let frame: number;
    const starts = ORBS.map((_, i) => performance.now() - i * 1500);

    const tick = (now: number) => {
      const children = container.children;
      ORBS.forEach((orb, i) => {
        const el = children[i] as HTMLDivElement;
        if (!el) return;
        const elapsed = (now - starts[i]) / 1000;
        const cycle = elapsed / orb.duration;
        const dx = Math.sin(cycle * Math.PI * 2) * 18;
        const dy = Math.cos(cycle * Math.PI * 2 * 0.7) * 14;
        const scale = 0.92 + Math.sin(cycle * Math.PI * 2 * 1.3) * 0.08;
        el.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${scale})`;
      });
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}
    >
      {ORBS.map((orb, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${orb.x}%`,
            top: `${orb.y}%`,
            width: orb.r * 2,
            height: orb.r * 2,
            borderRadius: "50%",
            background: `radial-gradient(circle at 40% 40%, rgba(${orb.color},0.10) 0%, rgba(${orb.color},0.04) 40%, transparent 70%)`,
            willChange: "transform",
          }}
        />
      ))}
    </div>
  );
}
