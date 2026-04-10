import { useEffect, useRef, useState, useCallback } from "react";

interface Spark {
  id: number;
  x: number;
  y: number;
  color: string;
  ts: number;
}

interface ClickSparkProps {
  enabled?: boolean;
  children: React.ReactNode;
  colors?: string[];
}

const DURATION = 550;
const LINES = 8;
const RADIUS = 36;

const COLORS_DEFAULT = ["#22d3ee", "#8b5cf6", "#10b981", "#f59e0b", "#e2e8f0"];

export function ClickSpark({ enabled = true, children, colors = COLORS_DEFAULT }: ClickSparkProps) {
  const [sparks, setSparks] = useState<Spark[]>([]);
  const idRef = useRef(0);

  const fire = useCallback((e: MouseEvent) => {
    if (!enabled) return;
    const id = idRef.current++;
    const color = colors[id % colors.length];
    setSparks(prev => [...prev, { id, x: e.clientX, y: e.clientY, color, ts: Date.now() }]);
    setTimeout(() => setSparks(prev => prev.filter(s => s.id !== id)), DURATION + 50);
  }, [enabled, colors]);

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener("click", fire);
    return () => document.removeEventListener("click", fire);
  }, [enabled, fire]);

  return (
    <>
      {children}
      {sparks.map(spark => (
        <SparkBurst key={spark.id} x={spark.x} y={spark.y} color={spark.color} />
      ))}
    </>
  );
}

function SparkBurst({ x, y, color }: { x: number; y: number; color: string }) {
  const size = RADIUS * 2 + 20;

  return (
    <svg
      style={{
        position: "fixed",
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        pointerEvents: "none",
        zIndex: 99999,
        overflow: "visible",
      }}
    >
      {Array.from({ length: LINES }, (_, i) => {
        const angle = (i * 360) / LINES - 90;
        const rad = (angle * Math.PI) / 180;
        const cx = size / 2;
        const cy = size / 2;
        const x2 = cx + Math.cos(rad) * RADIUS;
        const y2 = cy + Math.sin(rad) * RADIUS;
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={x2}
            y2={y2}
            stroke={color}
            strokeWidth="1.5"
            strokeLinecap="round"
            style={{
              animation: `spark-line ${DURATION}ms cubic-bezier(0.4,0,0.2,1) forwards`,
              transformOrigin: `${cx}px ${cy}px`,
            }}
          />
        );
      })}
      {/* Center dot */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={3}
        fill={color}
        style={{ animation: `spark-dot ${DURATION}ms ease forwards` }}
      />
      <style>{`
        @keyframes spark-line {
          0%  { stroke-dasharray: 0 ${RADIUS}; stroke-dashoffset: 0; opacity: 1; }
          30% { stroke-dasharray: ${RADIUS * 0.6} ${RADIUS}; stroke-dashoffset: -${RADIUS * 0.1}; opacity: 1; }
          100%{ stroke-dasharray: 0 ${RADIUS}; stroke-dashoffset: -${RADIUS}; opacity: 0; }
        }
        @keyframes spark-dot {
          0%  { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.8); opacity: 0.8; }
          100%{ transform: scale(0); opacity: 0; }
        }
      `}</style>
    </svg>
  );
}
