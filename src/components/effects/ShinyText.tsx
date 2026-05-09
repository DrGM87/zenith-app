import { type ReactNode } from "react";

interface ShinyTextProps {
  children?: ReactNode;
  text?: string;
  enabled?: boolean;
  speed?: number;
  color?: string;
  baseColor?: string;
  shineColor?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function ShinyText({
  children,
  text,
  enabled = true,
  speed = 4,
  color,
  baseColor = "#e2e8f0",
  shineColor = "#ffffff",
  className = "",
  style,
}: ShinyTextProps) {
  const displayColor = color ?? baseColor;
  const content = text ?? children;

  if (!enabled) {
    return (
      <span className={className} style={style}>
        {content}
      </span>
    );
  }

  return (
    <span
      className={`shiny-text ${className}`}
      style={{
        ...style,
        backgroundImage: `linear-gradient(120deg, ${displayColor} 0%, ${displayColor} 35%, ${shineColor} 50%, ${displayColor} 65%, ${displayColor} 100%)`,
        backgroundSize: "200% auto",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
        animationDuration: `${speed}s`,
      }}
    >
      {content}
    </span>
  );
}
