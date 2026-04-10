import { useEffect, useRef } from "react";

interface AuroraBgProps {
  enabled?: boolean;
}

export function AuroraBg({ enabled = true }: AuroraBgProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled || !ref.current) return;
    const el = ref.current;

    let frame: number;
    let t = 0;

    const tick = () => {
      t += 0.003;
      const x1 = 20 + Math.sin(t * 0.7) * 10;
      const y1 = 25 + Math.cos(t * 0.5) * 8;
      const x2 = 80 + Math.cos(t * 0.8) * 8;
      const y2 = 20 + Math.sin(t * 0.6) * 10;
      const x3 = 55 + Math.sin(t * 0.4) * 12;
      const y3 = 75 + Math.cos(t * 0.9) * 6;
      const x4 = 30 + Math.cos(t * 0.6) * 10;
      const y4 = 60 + Math.sin(t * 0.7) * 8;

      el.style.background = [
        `radial-gradient(ellipse 70% 55% at ${x1}% ${y1}%, rgba(34,211,238,0.07) 0%, transparent 55%)`,
        `radial-gradient(ellipse 55% 70% at ${x2}% ${y2}%, rgba(139,92,246,0.06) 0%, transparent 55%)`,
        `radial-gradient(ellipse 65% 45% at ${x3}% ${y3}%, rgba(16,185,129,0.05) 0%, transparent 55%)`,
        `radial-gradient(ellipse 50% 60% at ${x4}% ${y4}%, rgba(245,158,11,0.04) 0%, transparent 55%)`,
      ].join(", ");

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 0,
        willChange: "background",
      }}
    />
  );
}
