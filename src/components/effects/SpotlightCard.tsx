import { useRef, useCallback, type ReactNode, type CSSProperties } from "react";

interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  spotlightColor?: string;
  disabled?: boolean;
  enabled?: boolean;
  spotColor?: string;
  spotRadius?: number;
  style?: CSSProperties;
}

export function SpotlightCard({
  children,
  className = "",
  spotlightColor,
  disabled,
  enabled = true,
  spotColor,
  spotRadius,
  style,
}: SpotlightCardProps) {
  const isEnabled = disabled === true ? false : enabled;
  const color = spotlightColor ?? spotColor ?? "rgba(255,255,255,0.05)";
  const ref = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const el = ref.current;
      if (!el || !isEnabled) return;
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
      el.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
      el.style.setProperty("--spotlight-color", color);
      if (spotRadius !== undefined) {
        el.style.setProperty("--spotlight-radius", `${spotRadius}px`);
      }
    },
    [color, isEnabled, spotRadius],
  );

  if (!isEnabled) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={`card-spotlight ${className}`}
      style={
        {
          ...style,
          "--spotlight-color": color,
          ...(spotRadius !== undefined ? { "--spotlight-radius": `${spotRadius}px` } : {}),
        } as CSSProperties
      }
      onMouseMove={handleMouseMove}
    >
      {children}
    </div>
  );
}
