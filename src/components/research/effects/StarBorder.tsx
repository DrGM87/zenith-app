import type { CSSProperties, ReactNode } from "react";

interface StarBorderProps {
  children: ReactNode;
  enabled?: boolean;
  className?: string;
  style?: CSSProperties;
  color?: string;
  /** Duration of one full rotation */
  speed?: string;
  /** Border radius for the wrapper */
  radius?: number | string;
}

let _idCounter = 0;

export function StarBorder({
  children,
  enabled = true,
  className = "",
  style = {},
  color = "#22d3ee",
  speed = "3.5s",
  radius = 8,
}: StarBorderProps) {
  if (!enabled) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }

  const id = `sb-${_idCounter++}`;
  const radiusStr = typeof radius === "number" ? `${radius}px` : radius;

  const wrapperStyle: CSSProperties = {
    position: "relative",
    borderRadius: radiusStr,
    ...style,
  };

  return (
    <div className={className} style={wrapperStyle}>
      {/* Rotating conic-gradient border */}
      <div
        style={{
          position: "absolute",
          inset: -1,
          borderRadius: `calc(${radiusStr} + 1px)`,
          overflow: "hidden",
          pointerEvents: "none",
          zIndex: 0,
        }}
      >
        <div
          style={{
            position: "absolute",
            width: "200%",
            height: "200%",
            top: "-50%",
            left: "-50%",
            background: `conic-gradient(
              from 0deg,
              transparent 0%,
              transparent 75%,
              ${color}88 82%,
              ${color} 88%,
              ${color}88 94%,
              transparent 100%
            )`,
            animation: `star-border-rotate-${id} ${speed} linear infinite`,
          }}
        />
      </div>
      {/* Inner content area — fills background to hide the rotating gradient inside */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          borderRadius: `calc(${radiusStr} - 1px)`,
          overflow: "hidden",
          height: "100%",
        }}
      >
        {children}
      </div>
      <style>{`
        @keyframes star-border-rotate-${id} {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
