import type { CSSProperties, ReactNode } from "react";

interface GradientTextProps {
  children: ReactNode;
  enabled?: boolean;
  className?: string;
  style?: CSSProperties;
  gradient?: string;
  animate?: boolean;
  speed?: number;
}

let _injected = false;
function injectStyles() {
  if (_injected || typeof document === "undefined") return;
  _injected = true;
  const s = document.createElement("style");
  s.textContent = `
    @keyframes gradient-text-shift {
      0%   { background-position: 0% 50%; }
      50%  { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
  `;
  document.head.appendChild(s);
}

export function GradientText({
  children,
  enabled = true,
  className = "",
  style = {},
  gradient = "linear-gradient(135deg, #22d3ee 0%, #8b5cf6 50%, #10b981 100%)",
  animate = true,
  speed = 4,
}: GradientTextProps) {
  if (!enabled) {
    return (
      <span className={className} style={style}>
        {children}
      </span>
    );
  }

  injectStyles();

  const gradientStyle: CSSProperties = {
    ...style,
    background: gradient,
    backgroundSize: animate ? "200% 200%" : "100%",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    display: "inline-block",
    ...(animate
      ? { animation: `gradient-text-shift ${speed}s ease infinite` }
      : {}),
  };

  return (
    <span className={className} style={gradientStyle}>
      {children}
    </span>
  );
}
