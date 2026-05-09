interface MagicRingsProps {
  color?: string;
  color2?: string;
  color3?: string;
  size?: number;
}

export function MagicRings({ color = "#8b5cf6", color2 = "#22d3ee", color3 = "#ec4899", size = 12 }: MagicRingsProps) {
  return (
    <div className="magic-rings" style={{ width: size, height: size }}>
      <div className="magic-ring-core" style={{ background: `linear-gradient(135deg, ${color}, ${color2})`, boxShadow: `0 0 ${size * 0.6}px ${color}, 0 0 ${size * 0.3}px ${color2}` }} />
      <div className="magic-ring-r1" style={{ borderColor: color }} />
      <div className="magic-ring-r2" style={{ borderColor: color2 }} />
      <div className="magic-ring-r3" style={{ borderColor: color3 }} />
    </div>
  );
}
