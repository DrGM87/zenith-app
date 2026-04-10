import type { CSSProperties, ReactNode } from "react";

interface ShinyTextProps {
  children: ReactNode;
  enabled?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Seconds per full sweep cycle */
  speed?: number;
  /** Base text color */
  baseColor?: string;
  /** Shine peak color */
  shineColor?: string;
}

let _injected = false;
function injectStyles() {
  if (_injected || typeof document === "undefined") return;
  _injected = true;
  const s = document.createElement("style");
  s.textContent = `
    @keyframes shiny-sweep {
      0%   { background-position: 200% center; }
      100% { background-position: -200% center; }
    }
  `;
  document.head.appendChild(s);
}

export function ShinyText({
  children,
  enabled = true,
  className = "",
  style = {},
  speed = 3.5,
  baseColor = "currentColor",
  shineColor = "rgba(255,255,255,0.85)",
}: ShinyTextProps) {
  if (!enabled) {
    return (
      <span className={className} style={style}>
        {children}
      </span>
    );
  }

  injectStyles();

  const shinyStyle: CSSProperties = {
    ...style,
    backgroundImage: `linear-gradient(90deg, ${baseColor} 0%, ${baseColor} 35%, ${shineColor} 50%, ${baseColor} 65%, ${baseColor} 100%)`,
    backgroundSize: "200% auto",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    animation: `shiny-sweep ${speed}s linear infinite`,
    display: "inline-block",
  };

  return (
    <span className={className} style={shinyStyle}>
      {children}
    </span>
  );
}
