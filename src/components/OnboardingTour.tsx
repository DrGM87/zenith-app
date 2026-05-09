import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const STEPS = [
  {
    title: "Welcome to Zenith",
    icon: "fa-solid fa-cube",
    iconColor: "#66c0dc",
    description: "Your intelligent file staging and organization tool. Drag, drop, rename, and organize files with AI assistance.",
  },
  {
    title: "Stage Files Instantly",
    icon: "fa-solid fa-download",
    iconColor: "#7ec99c",
    description: "Drag files here or use Ctrl+Shift+V to stage from clipboard. Zenith creates a temporary workspace for quick file operations.",
  },
  {
    title: "AI-Powered Tools",
    icon: "fa-solid fa-wand-magic-sparkles",
    iconColor: "#9d8fd4",
    description: "Rename files intelligently, extract text, summarize documents, translate content, and organize entire folders — all with AI.",
  },
  {
    title: "Batch Operations",
    icon: "fa-solid fa-layer-group",
    iconColor: "#e0b878",
    description: "Select multiple files to zip, email, rename, convert, or organize them together. Look for the toolbar when items are selected.",
  },
  {
    title: "Keyboard Shortcuts",
    icon: "fa-solid fa-keyboard",
    iconColor: "#f87171",
    description: "Press ? anytime to see all shortcuts. Ctrl+Shift+Z toggles the window, Ctrl+Shift+V stages clipboard content.",
  },
];

export function OnboardingTour() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const seen = localStorage.getItem("zenith_onboarding_seen");
    if (!seen) {
      setVisible(true);
      localStorage.setItem("zenith_onboarding_seen", "1");
    }
  }, []);

  const current = STEPS[step];

  if (!visible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9998] flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
        onClick={() => setVisible(false)}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="flex flex-col items-center gap-4 p-8 rounded-2xl text-center"
          style={{
            background: "var(--zen-bg-surface)",
            border: "1px solid var(--zen-border-default)",
            boxShadow: "0 16px 64px rgba(0,0,0,0.6)",
            maxWidth: 420,
            width: "90vw",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Step indicator */}
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  className="rounded-full transition-all"
                  style={{
                    width: i === step ? 16 : 6,
                    height: 6,
                    background: i === step ? "var(--zen-accent-cyan)" : "rgba(255,255,255,0.1)",
                    borderRadius: 3,
                  }}
                />
              ))}
            </div>
            <span style={{ color: "var(--zen-text-secondary)", fontSize: 11 }}>
              Step {step + 1} of {STEPS.length}
            </span>
          </div>

          {/* Icon */}
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: `${current.iconColor}15`, border: `1px solid ${current.iconColor}30` }}
          >
            <i className={`${current.icon} text-2xl`} style={{ color: current.iconColor }} />
          </div>

          {/* Text */}
          <h2 className="text-[16px] font-bold" style={{ color: "var(--zen-text-primary)" }}>
            {current.title}
          </h2>
          <p className="text-[12px] leading-relaxed" style={{ color: "var(--zen-text-secondary)", maxWidth: 320 }}>
            {current.description}
          </p>

          {/* Actions */}
          <div className="flex gap-2 mt-2">
            {step < STEPS.length - 1 ? (
              <>
                <button
                  onClick={() => setVisible(false)}
                  className="px-4 py-1.5 rounded-lg text-[11px] font-medium"
                  style={{ color: "var(--zen-text-muted)", background: "transparent" }}
                >
                  Skip
                </button>
                {step > 0 && (
                  <button
                    onClick={() => setStep((s) => s - 1)}
                    className="px-4 py-1.5 rounded-lg text-[11px] font-medium"
                    style={{ color: "var(--zen-text-secondary)", background: "var(--zen-bg-elevated)" }}
                  >
                    Back
                  </button>
                )}
                <button
                  onClick={() => setStep(s => s + 1)}
                  className="px-5 py-1.5 rounded-lg text-[11px] font-medium"
                  style={{ color: "var(--zen-bg-void)", background: "var(--zen-accent-cyan)" }}
                >
                  Next
                </button>
              </>
            ) : (
              <button
                onClick={() => setVisible(false)}
                className="px-6 py-1.5 rounded-lg text-[11px] font-medium"
                style={{ color: "var(--zen-bg-void)", background: "var(--zen-accent-cyan)" }}
              >
                Get Started
              </button>
            )}
          </div>
          {step === STEPS.length - 1 && (
            <p style={{ fontSize: 10, color: "var(--zen-text-muted)", marginTop: 8 }}>
              Tip: Press <kbd style={{ background: "var(--zen-bg-elevated)", padding: "1px 4px", borderRadius: 3, fontSize: 9, border: "1px solid var(--zen-border-default)" }}>?</kbd> anytime to see keyboard shortcuts
            </p>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
