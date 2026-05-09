import { useState, useEffect, type ReactNode } from "react";
import { motion, useMotionValue } from "framer-motion";

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
