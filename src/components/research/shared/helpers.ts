import { invoke } from "@tauri-apps/api/core";
import { PRICING } from "./constants";
import type { ZenithSettings } from "./types";

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function fmtCost(n: number): string {
  return `$${n.toFixed(4)}`;
}

export function estimateCost(provider: string, mdl: string, inputTokens: number, outputTokens: number): number {
  const rates = PRICING[provider]?.[mdl] || { input: 1.0, output: 2.0 };
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

export async function trackTokenUsage(provider: string, _model: string, inputTokens: number, outputTokens: number, cost: number) {
  try {
    const s = await invoke<ZenithSettings>("get_settings");
    const tu = s.token_usage ?? { entries: [], total_input_tokens: 0, total_output_tokens: 0, total_cost_usd: 0 };
    const entries = [...tu.entries];
    const idx = entries.findIndex((e) => e.provider === provider);
    if (idx >= 0) {
      entries[idx] = { ...entries[idx], input_tokens: entries[idx].input_tokens + inputTokens, output_tokens: entries[idx].output_tokens + outputTokens, cost_usd: entries[idx].cost_usd + cost };
    } else {
      entries.push({ provider, input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: cost });
    }
    await invoke("save_settings", { newSettings: { ...s, token_usage: { entries, total_input_tokens: tu.total_input_tokens + inputTokens, total_output_tokens: tu.total_output_tokens + outputTokens, total_cost_usd: tu.total_cost_usd + cost } } });
  } catch (e) { console.error("trackTokenUsage:", e); }
}
