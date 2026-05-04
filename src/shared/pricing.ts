export const PRICING: Record<string, Record<string, { input: number; output: number }>> = {
  deepseek: {
    "deepseek-v4-flash": { input: 0.14, output: 0.28 },
    "deepseek-v4-pro": { input: 0.435, output: 0.87 },
  },
  google: {
    "gemini-3.1-flash-lite-preview": { input: 0.075, output: 0.30 },
    "gemini-3.1-flash-preview": { input: 0.10, output: 0.40 },
    "gemini-3.1-pro-preview": { input: 1.25, output: 5.00 },
    "gemini-3.1-flash-image-preview": { input: 0.067, output: 0 },
    "gemini-3-pro-image-preview": { input: 0.134, output: 0 },
  },
};

export const IMAGE_GEN_MODEL_IDS = new Set(["gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview"]);
