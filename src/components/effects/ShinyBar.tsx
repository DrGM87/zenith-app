interface ShinyBarProps {
  className?: string;
  color1?: string;
  color2?: string;
}

export function ShinyBar({ className = "", color1 = "rgba(139,92,246,0.2)", color2 = "rgba(34,211,238,0.35)" }: ShinyBarProps) {
  return (
    <div
      className={`shiny-bar ${className}`}
      style={{
        background: `linear-gradient(90deg, ${color1} 0%, ${color2} 50%, ${color1} 100%)`,
        backgroundSize: "200% 100%",
      }}
    />
  );
}
