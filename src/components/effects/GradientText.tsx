import { type ReactNode } from "react";

interface GradientTextProps {
  children?: ReactNode;
  enabled?: boolean;
  gradient?: string;
  animate?: boolean;
}

export function GradientText({ children, enabled = true, gradient = "linear-gradient(90deg, #e2e8f0, #22d3ee, #e2e8f0)", animate = false }: GradientTextProps) {
  if (!enabled) return <>{children}</>;
  return (
    <span
      style={{
        backgroundImage: gradient,
        backgroundSize: animate ? "200% auto" : "100% auto",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
        animation: animate ? "shiny-slide 3s linear infinite" : undefined,
      }}
    >
      {children}
    </span>
  );
}
