import { useEffect, useRef } from "react";

interface SquaresBgProps {
  enabled?: boolean;
  squareSize?: number;
  speed?: number;
}

export function SquaresBg({ enabled = true, squareSize = 38, speed = 0.4 }: SquaresBgProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame: number;
    let t = 0;
    let mx = -9999, my = -9999;

    const resize = () => {
      canvas.width = canvas.offsetWidth * devicePixelRatio;
      canvas.height = canvas.offsetHeight * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
    };

    const onMouse = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      mx = e.clientX - r.left;
      my = e.clientY - r.top;
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMouse);

    const W = () => canvas.offsetWidth;
    const H = () => canvas.offsetHeight;

    const draw = () => {
      ctx.clearRect(0, 0, W(), H());
      t += speed * 0.004;

      const cols = Math.ceil(W() / squareSize) + 2;
      const rows = Math.ceil(H() / squareSize) + 2;

      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const x = c * squareSize;
          const y = r * squareSize;
          const cx = x + squareSize / 2;
          const cy = y + squareSize / 2;

          // Wave shimmer
          const wave = (Math.sin(c * 0.6 + t) * Math.cos(r * 0.6 + t * 0.8) + 1) * 0.5;
          // Mouse glow
          const dist = Math.hypot(cx - mx, cy - my);
          const proximity = Math.max(0, 1 - dist / 180);

          const alpha = wave * 0.025 + proximity * 0.10;

          if (alpha > 0.003) {
            ctx.fillStyle = `rgba(34,211,238,${alpha.toFixed(3)})`;
            ctx.fillRect(x + 1, y + 1, squareSize - 2, squareSize - 2);
          }

          // Grid lines
          ctx.strokeStyle = `rgba(255,255,255,${(0.03 + proximity * 0.04).toFixed(3)})`;
          ctx.lineWidth = 0.5;
          ctx.strokeRect(x, y, squareSize, squareSize);
        }
      }

      frame = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouse);
    };
  }, [enabled, squareSize, speed]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
        opacity: 0.7,
      }}
    />
  );
}
