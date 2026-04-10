import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  alpha: number;
  alphaDir: number;
  color: string;
}

interface FloatingParticlesProps {
  enabled?: boolean;
  count?: number;
}

const COLORS = [
  "34,211,238",
  "139,92,246",
  "16,185,129",
  "245,158,11",
];

export function FloatingParticles({ enabled = true, count = 28 }: FloatingParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame: number;

    const resize = () => {
      canvas.width = canvas.offsetWidth * devicePixelRatio;
      canvas.height = canvas.offsetHeight * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
    };

    resize();
    window.addEventListener("resize", resize);

    const W = () => canvas.offsetWidth;
    const H = () => canvas.offsetHeight;

    const particles: Particle[] = Array.from({ length: count }, () => ({
      x: Math.random() * W(),
      y: Math.random() * H(),
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25 - 0.1,
      r: 1 + Math.random() * 2,
      alpha: Math.random() * 0.4 + 0.1,
      alphaDir: Math.random() > 0.5 ? 1 : -1,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));

    const draw = () => {
      ctx.clearRect(0, 0, W(), H());

      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.alpha += p.alphaDir * 0.003;

        if (p.alpha > 0.55) { p.alphaDir = -1; }
        if (p.alpha < 0.05) {
          p.alphaDir = 1;
          if (p.y < -10) {
            p.y = H() + 10;
            p.x = Math.random() * W();
          }
        }

        if (p.x < -10) p.x = W() + 10;
        if (p.x > W() + 10) p.x = -10;
        if (p.y < -20) p.y = H() + 20;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);

        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
        grd.addColorStop(0, `rgba(${p.color},${p.alpha})`);
        grd.addColorStop(1, `rgba(${p.color},0)`);
        ctx.fillStyle = grd;
        ctx.fill();
      });

      frame = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [enabled, count]);

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
      }}
    />
  );
}
