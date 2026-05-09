import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useZenithStore } from "../store";

export function ErrorToast() {
  const error = useZenithStore((s) => s.zenithError);
  const setError = useZenithStore((s) => s.setZenithError);
  const retryAction = useZenithStore((s) => s.retryAction);

  const [errorQueue, setErrorQueue] = useState<Array<{ message: string; details?: string }>>([]);
  const prevErrorRef = useRef(error);

  useEffect(() => {
    if (error && prevErrorRef.current && error.message !== prevErrorRef.current.message) {
      setErrorQueue((q) => [...q, error]);
    }
    prevErrorRef.current = error;
  }, [error]);

  const dismiss = useCallback(() => {
    const next = errorQueue[0];
    if (next) {
      setErrorQueue((q) => q.slice(1));
      setError(next);
    } else {
      setError(null);
    }
  }, [errorQueue, setError]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(dismiss, 6000);
      return () => clearTimeout(timer);
    }
  }, [error, dismiss]);

  return (
    <AnimatePresence>
      {error && (
        <motion.div
          role="alert"
          aria-live="assertive"
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999,
            maxWidth: "min(90vw, 500px)",
            padding: "12px 20px",
            borderRadius: 12,
            background: "rgba(239, 68, 68, 0.12)",
            border: "1px solid rgba(239, 68, 68, 0.25)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <i className="fa-solid fa-triangle-exclamation" style={{ color: "#f87171", fontSize: 14, marginTop: 1, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#fca5a5", fontSize: 13, fontWeight: 600, marginBottom: error.details ? 4 : 0 }}>
                {error.message}
              </div>
              {error.details && (
                <div style={{ color: "rgba(252,165,165,0.6)", fontSize: 11, lineHeight: 1.4, wordBreak: "break-word" }}>
                  {error.details}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                {retryAction && (
                  <button
                    onClick={() => {
                      const action = retryAction;
                      dismiss();
                      action();
                    }}
                    style={{
                      background: "rgba(59,130,246,0.12)",
                      border: "1px solid rgba(59,130,246,0.2)",
                      borderRadius: 6,
                      padding: "2px 10px",
                      color: "#93c5fd",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    Retry
                  </button>
                )}
                <button
                  onClick={async () => {
                    try {
                      const text = error.details ? `${error.message}\n${error.details}` : error.message;
                      await navigator.clipboard.writeText(text);
                    } catch {}
                  }}
                  style={{ background: "none", border: "none", color: "rgba(252,165,165,0.4)", cursor: "pointer", fontSize: 10, flexShrink: 0 }}
                  aria-label="Copy error details"
                >
                  <i className="fa-solid fa-copy text-[10px]" />
                </button>
              </div>
            </div>
            <button
              onClick={dismiss}
              aria-label="Dismiss error"
              style={{
                background: "none",
                border: "none",
                color: "rgba(252,165,165,0.5)",
                cursor: "pointer",
                padding: "2px 4px",
                fontSize: 14,
                flexShrink: 0,
              }}
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
