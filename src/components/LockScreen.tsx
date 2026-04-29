import { motion } from "framer-motion";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface LockScreenProps {
  onUnlocked: () => void;
}

export function LockScreen({ onUnlocked }: LockScreenProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");

  const handleUnlock = async () => {
    if (!password) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("unlock_vault", { password });
      onUnlocked();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!password || password.length < 4) {
      setError("Password must be at least 4 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await invoke("create_vault", { password });
      onUnlocked();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center" style={{ background: "rgba(6,8,13,0.95)", backdropFilter: "blur(12px)" }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="rounded-2xl p-8 w-96 max-w-[95vw]"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 24px 80px rgba(0,0,0,0.5)" }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.25)" }}>
            <i className="fa-solid fa-lock text-violet-400" />
          </div>
          <div>
            <h1 className="text-[16px] font-bold text-white/90">{creating ? "Create Vault" : "Unlock Vault"}</h1>
            <p className="text-[11px] text-white/30">{creating ? "Set a master password to secure your API keys" : "Enter your master password"}</p>
          </div>
        </div>

        <div className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !creating) handleUnlock(); if (e.key === "Enter" && creating) handleCreate(); }}
            placeholder="Master password"
            autoFocus
            className="w-full px-4 py-2.5 rounded-xl text-[13px] text-white/90 placeholder:text-white/20 outline-none font-mono"
            style={{ background: "rgba(255,255,255,0.04)", border: error ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(255,255,255,0.08)" }}
          />

          {creating && (
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              placeholder="Confirm password"
              className="w-full px-4 py-2.5 rounded-xl text-[13px] text-white/90 placeholder:text-white/20 outline-none font-mono"
              style={{ background: "rgba(255,255,255,0.04)", border: error ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(255,255,255,0.08)" }}
            />
          )}

          {error && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="px-3 py-2 rounded-lg text-[12px] text-red-300" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)" }}>
              <i className="fa-solid fa-triangle-exclamation mr-1.5 text-[10px]" />{error}
            </motion.div>
          )}

          <button
            onClick={creating ? handleCreate : handleUnlock}
            disabled={loading || !password}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.8), rgba(34,211,238,0.6))", color: "#fff", boxShadow: "0 4px 16px rgba(139,92,246,0.25)" }}
          >
            {loading ? <><i className="fa-solid fa-spinner fa-spin text-[11px]" />Processing...</> : creating ? <>Create Vault</> : <>Unlock</>}
          </button>
        </div>

        <div className="mt-4 text-center">
          <button onClick={() => { setCreating(!creating); setError(null); setConfirmPassword(""); }}
            className="text-[11px] text-white/25 hover:text-white/50 transition-colors">
            {creating ? "I already have a vault — unlock" : "Create a new vault"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
