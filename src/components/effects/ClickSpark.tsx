import { type ReactNode, useCallback } from "react";

interface ClickSparkProps { enabled?: boolean; children: ReactNode; }

export function ClickSpark({ enabled = true, children }: ClickSparkProps) {
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!enabled) return;
    const spark = document.createElement("div");
    spark.style.cssText = `position:fixed;pointer-events:none;width:6px;height:6px;border-radius:50%;background:rgba(139,92,246,0.8);left:${e.clientX - 3}px;top:${e.clientY - 3}px;z-index:9999;animation:click-spark 0.6s ease-out forwards`;
    document.body.appendChild(spark);
    setTimeout(() => spark.remove(), 600);
  }, [enabled]);

  return <div onClick={handleClick}>{children}</div>;
}
