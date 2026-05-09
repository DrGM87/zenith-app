interface SoftAuroraProps {
  color1?: string;
  color2?: string;
  color3?: string;
  speed?: number;
  className?: string;
}

export function SoftAurora({ color1 = "rgba(139,92,246,0.12)", color2 = "rgba(34,211,238,0.08)", color3 = "rgba(236,72,153,0.06)", speed = 8, className = "" }: SoftAuroraProps) {
  return (
    <div
      className={`soft-aurora ${className}`}
      style={{
        // @ts-expect-error CSS custom properties
        "--aurora-c1": color1,
        "--aurora-c2": color2,
        "--aurora-c3": color3,
        "--aurora-speed": `${speed}s`,
      }}
    />
  );
}
