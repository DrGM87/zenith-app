interface SquaresBgProps { enabled?: boolean; squareSize?: number; speed?: number; }

export function SquaresBg({ enabled = true, squareSize = 40 }: SquaresBgProps) {
  if (!enabled) return null;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
      <svg width="100%" height="100%" style={{ opacity: 0.04 }}>
        <defs>
          <pattern id="sq" width={squareSize} height={squareSize} patternUnits="userSpaceOnUse">
            <rect width={1} height={1} fill="rgba(255,255,255,0.3)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#sq)" />
      </svg>
    </div>
  );
}
