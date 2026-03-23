import { useRef, useState, useEffect, useCallback, type ReactNode } from "react";
import { motion, useMotionValue } from "framer-motion";

/* ═══════════════════════════════════════════════════════
   SpotlightCard — mouse-tracking radial highlight
   ═══════════════════════════════════════════════════════ */
interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  spotlightColor?: string;
  disabled?: boolean;
}

export function SpotlightCard({ children, className = "", spotlightColor = "rgba(255, 255, 255, 0.08)", disabled = false }: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
    el.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
    el.style.setProperty("--spotlight-color", spotlightColor);
  }, [spotlightColor]);

  return (
    <div ref={ref} className={`${disabled ? '' : 'card-spotlight'} ${className}`} onMouseMove={disabled ? undefined : handleMouseMove}>
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ShinyText — animated gradient shimmer on text
   ═══════════════════════════════════════════════════════ */
interface ShinyTextProps {
  text: string;
  className?: string;
  speed?: number;
  color?: string;
  shineColor?: string;
}

export function ShinyText({ text, className = "", speed = 2, color = "#b5b5b5a0", shineColor = "#ffffff" }: ShinyTextProps) {
  return (
    <span
      className={`shiny-text ${className}`}
      style={{
        backgroundImage: `linear-gradient(120deg, ${color} 0%, ${color} 35%, ${shineColor} 50%, ${color} 65%, ${color} 100%)`,
        backgroundSize: "200% auto",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
        animationDuration: `${speed}s`,
      }}
    >
      {text}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════
   BorderGlow — rotating conic gradient glow border
   ═══════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════
   SoftAurora — CSS animated gradient background
   ═══════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════
   MagicRings — animated concentric ring pulses
   ═══════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════
   Carousel — drag/swipe carousel for multi-page content
   ═══════════════════════════════════════════════════════ */
interface CarouselItem {
  id: string | number;
  content: ReactNode;
}

interface CarouselProps {
  items: CarouselItem[];
  baseWidth?: number;
  autoplay?: boolean;
  autoplayDelay?: number;
  className?: string;
}

const CAROUSEL_GAP = 12;
const CAROUSEL_SPRING = { type: "spring" as const, stiffness: 300, damping: 30 };

export function Carousel({ items, baseWidth = 280, autoplay = false, autoplayDelay = 4000, className = "" }: CarouselProps) {
  const [position, setPosition] = useState(0);
  const x = useMotionValue(0);
  const itemWidth = baseWidth;
  const trackOffset = itemWidth + CAROUSEL_GAP;

  useEffect(() => {
    if (!autoplay || items.length <= 1) return;
    const timer = setInterval(() => {
      setPosition((p) => (p + 1) % items.length);
    }, autoplayDelay);
    return () => clearInterval(timer);
  }, [autoplay, autoplayDelay, items.length]);

  const handleDragEnd = (_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => {
    const dir = info.offset.x < -30 || info.velocity.x < -300 ? 1 : info.offset.x > 30 || info.velocity.x > 300 ? -1 : 0;
    if (dir === 0) return;
    setPosition((p) => Math.max(0, Math.min(p + dir, items.length - 1)));
  };

  if (items.length === 0) return null;

  return (
    <div className={`carousel-container ${className}`} style={{ width: baseWidth + 32 }}>
      <motion.div
        className="carousel-track"
        drag="x"
        dragConstraints={{ left: -trackOffset * (items.length - 1), right: 0 }}
        style={{ x, gap: CAROUSEL_GAP }}
        animate={{ x: -position * trackOffset }}
        transition={CAROUSEL_SPRING}
        onDragEnd={handleDragEnd}
      >
        {items.map((item) => (
          <CarouselCard key={item.id} item={item} width={itemWidth} />
        ))}
      </motion.div>
      {items.length > 1 && (
        <div className="carousel-dots">
          {items.map((_, i) => (
            <motion.div
              key={i}
              className="carousel-dot"
              animate={{ scale: i === position ? 1.3 : 1, opacity: i === position ? 1 : 0.3 }}
              onClick={() => setPosition(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CarouselCard({ item, width }: { item: CarouselItem; width: number }) {
  return (
    <motion.div
      className="carousel-card"
      style={{ width, minWidth: width }}
    >
      {item.content}
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════
   ShinyBar — animated loading bar with gradient
   ═══════════════════════════════════════════════════════ */
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
