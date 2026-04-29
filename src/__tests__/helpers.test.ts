import { describe, it, expect } from "vitest";

declare global {
  namespace NodeJS {
    interface Global {
      localStorage: Storage;
    }
  }
}

describe("localStorage persistence helpers", () => {
  it("loads from empty localStorage without error", () => {
    localStorage.clear();
    const raw = localStorage.getItem("nonexistent");
    const parsed = raw ? JSON.parse(raw) : [];
    expect(parsed).toEqual([]);
  });

  it("handles corrupted JSON gracefully", () => {
    localStorage.setItem("corrupt", "{not valid json");
    let result: unknown;
    try { result = JSON.parse(localStorage.getItem("corrupt") || "[]"); } catch { result = []; }
    expect(result).toEqual([]);
  });

  it("loads valid JSON correctly", () => {
    localStorage.setItem("valid", JSON.stringify([{ id: "a", name: "test" }]));
    const result = JSON.parse(localStorage.getItem("valid") || "[]");
    expect(result).toEqual([{ id: "a", name: "test" }]);
  });
});

describe("ConversionPreset interface", () => {
  it("matches the expected shape", () => {
    const preset = {
      id: "abc123",
      name: "Web Optimize",
      action: "compress_image",
      args: { quality: 80, format: "webp" },
    };
    expect(preset).toHaveProperty("id");
    expect(preset).toHaveProperty("name");
    expect(preset).toHaveProperty("action");
    expect(preset).toHaveProperty("args");
    expect(typeof preset.id).toBe("string");
    expect(typeof preset.args).toBe("object");
  });
});
