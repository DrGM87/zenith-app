export const PRICING: Record<string, Record<string, { input: number; output: number }>> = {
  openai: { "gpt-4.1-nano": { input: 0.10, output: 0.40 }, "gpt-4o-mini": { input: 0.15, output: 0.60 }, "gpt-4.1-mini": { input: 0.40, output: 1.60 }, "o3-mini": { input: 1.10, output: 4.40 }, "o4-mini": { input: 1.10, output: 4.40 }, "gpt-4.1": { input: 2.00, output: 8.00 }, "gpt-4o": { input: 2.50, output: 10.00 }, "gpt-image-1.5": { input: 0.133, output: 0 } },
  anthropic: { "claude-haiku-4-5-20250514": { input: 1.00, output: 5.00 }, "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 }, "claude-opus-4-20250918": { input: 5.00, output: 25.00 } },
  google: { "gemini-3.1-flash-lite-preview": { input: 0.15, output: 0.60 }, "gemini-3-flash-preview": { input: 0.50, output: 3.00 }, "gemini-2.5-pro": { input: 1.25, output: 10.00 }, "gemini-3.1-pro-preview": { input: 2.00, output: 12.00 }, "gemini-3.1-flash-image-preview": { input: 0.067, output: 0 }, "gemini-3-pro-image-preview": { input: 0.134, output: 0 } },
  deepseek: { "deepseek-chat": { input: 0.27, output: 1.10 }, "deepseek-reasoner": { input: 0.55, output: 2.19 } },
  groq: { "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 }, "llama-3.1-8b-instant": { input: 0.05, output: 0.08 }, "gemma2-9b-it": { input: 0.20, output: 0.20 } },
};

export const IMAGE_GEN_MODEL_IDS = new Set(["gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview", "gpt-image-1.5"]);
