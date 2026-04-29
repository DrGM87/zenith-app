import { describe, it, expect } from "vitest";
import { formatFileSize, getFileIcon, getExtensionColor } from "../utils";

describe("formatFileSize", () => {
  it("returns 0 B for zero", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });

  it("formats bytes", () => {
    expect(formatFileSize(500)).toBe("500 B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(2048)).toBe("2.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("formats gigabytes", () => {
    expect(formatFileSize(3.5 * 1024 * 1024 * 1024)).toBe("3.5 GB");
  });

  it("formats terabytes", () => {
    expect(formatFileSize(2 * 1024 ** 4)).toBe("2.0 TB");
  });
});

describe("getFileIcon", () => {
  it("returns folder icon for directories", () => {
    expect(getFileIcon("", true)).toBe("📁");
  });

  it("returns image icon for png", () => {
    expect(getFileIcon("png", false)).toBe("🖼️");
  });

  it("returns music icon for mp3", () => {
    expect(getFileIcon("mp3", false)).toBe("🎵");
  });

  it("returns pdf icon for pdf", () => {
    expect(getFileIcon("pdf", false)).toBe("📄");
  });

  it("returns code icon for ts", () => {
    expect(getFileIcon("ts", false)).toBe("💠");
  });

  it("returns default icon for unknown extension", () => {
    expect(getFileIcon("xyz", false)).toBe("📄");
  });

  it("is case insensitive", () => {
    expect(getFileIcon("PNG", false)).toBe("🖼️");
  });
});

describe("getExtensionColor", () => {
  it("returns cyan for png", () => { expect(getExtensionColor("png")).toBe("#22d3ee"); });
  it("returns red for pdf", () => { expect(getExtensionColor("pdf")).toBe("#ef4444"); });
  it("returns slate for unknown", () => { expect(getExtensionColor("xyz")).toBe("#64748b"); });
  it("is case insensitive", () => { expect(getExtensionColor("PNG")).toBe("#22d3ee"); });
});

describe("formatFileSize edge cases", () => {
  it("handles exactly 1 KB", () => { expect(formatFileSize(1024)).toBe("1.0 KB"); });
  it("handles exactly 1 MB", () => { expect(formatFileSize(1048576)).toBe("1.0 MB"); });
  it("handles exactly 1 GB", () => { expect(formatFileSize(1073741824)).toBe("1.0 GB"); });
  it("handles fractional bytes (rounds)", () => { expect(formatFileSize(1536)).toBe("1.5 KB"); });
  it("handles very large sizes without overflow", () => {
    const result = formatFileSize(5 * 1024 ** 4);
    expect(result).toContain("TB");
  });
});

describe("getFileIcon edge cases", () => {
  it("handles empty extension with directory false", () => { expect(getFileIcon("", false)).toBe("📄"); });
  it("handles directory always returns folder icon", () => { expect(getFileIcon("", true)).toBe("📁"); });
  it("handles directory ignores extension", () => { expect(getFileIcon("pdf", true)).toBe("📁"); });
  it("handles uppercase extensions", () => { expect(getFileIcon("MP4", false)).toBe("🎬"); });
});
