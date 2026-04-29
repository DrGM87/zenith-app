import { type ReactNode } from "react";

interface ShinyTextProps {
  children?: ReactNode;
  enabled?: boolean;
  speed?: number;
  baseColor?: string;
  shineColor?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function ShinyText({ children, enabled = true, speed = 4, baseColor = "#e2e8f0", shineColor = "#ffffff", className = "", style }: ShinyTextProps) {
  if (!enabled) return <span className={className} style={style}>{children}</span>;
  return (
    <span
      className={`shiny-text ${className}`}
      style={{
        ...style,
        backgroundImage: `linear-gradient(120deg, ${baseColor} 0%, ${baseColor} 35%, ${shineColor} 50%, ${baseColor} 65%, ${baseColor} 100%)`,
        backgroundSize: "200% auto",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
        animationDuration: `${speed}s`,
      }}
    >
      {children}
    </span>
  );
}
