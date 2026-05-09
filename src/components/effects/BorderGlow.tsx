import { type ReactNode } from "react";

interface BorderGlowProps {
  children: ReactNode;
  className?: string;
  color1?: string;
  color2?: string;
  speed?: number;
  intensity?: number;
  borderRadius?: number;
  enabled?: boolean;
}

export function BorderGlow({ children, className = "", color1 = "rgba(139,92,246,0.5)", color2 = "rgba(34,211,238,0.5)", speed = 4, intensity = 1, borderRadius = 20, enabled = true }: BorderGlowProps) {
  return (
    <div className={`border-glow-wrapper ${className}`} style={{ borderRadius }}>
      {enabled && (
        <div
          className="border-glow-ring"
          style={{
            borderRadius,
            // @ts-expect-error CSS custom properties
            "--glow-color-1": color1,
            "--glow-color-2": color2,
            "--glow-speed": `${speed}s`,
            "--glow-intensity": intensity,
          }}
        />
      )}
      <div className="border-glow-inner" style={{ borderRadius }}>
        {children}
      </div>
    </div>
  );
}
