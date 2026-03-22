export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function getFileIcon(extension: string, isDirectory: boolean): string {
  if (isDirectory) return "📁";

  const iconMap: Record<string, string> = {
    png: "🖼️",
    jpg: "🖼️",
    jpeg: "🖼️",
    gif: "🖼️",
    bmp: "🖼️",
    webp: "🖼️",
    svg: "🖼️",
    ico: "🖼️",
    pdf: "📄",
    txt: "📝",
    md: "📝",
    log: "📝",
    html: "🌐",
    htm: "🌐",
    css: "🎨",
    js: "⚡",
    mjs: "⚡",
    ts: "💠",
    tsx: "💠",
    json: "📋",
    xml: "📋",
    zip: "📦",
    rar: "📦",
    "7z": "📦",
    mp3: "🎵",
    wav: "🎵",
    mp4: "🎬",
    avi: "🎬",
    mkv: "🎬",
    doc: "📘",
    docx: "📘",
    xls: "📊",
    xlsx: "📊",
    ppt: "📙",
    pptx: "📙",
    exe: "⚙️",
    rs: "🦀",
    py: "🐍",
  };

  return iconMap[extension.toLowerCase()] || "📄";
}

export function getExtensionColor(extension: string): string {
  const colorMap: Record<string, string> = {
    png: "#22d3ee",
    jpg: "#22d3ee",
    jpeg: "#22d3ee",
    gif: "#a78bfa",
    svg: "#f97316",
    pdf: "#ef4444",
    txt: "#94a3b8",
    md: "#94a3b8",
    html: "#f97316",
    css: "#3b82f6",
    js: "#eab308",
    ts: "#3b82f6",
    tsx: "#3b82f6",
    json: "#a3e635",
    zip: "#f59e0b",
    mp3: "#ec4899",
    mp4: "#8b5cf6",
    rs: "#f97316",
    py: "#22c55e",
    exe: "#6b7280",
  };

  return colorMap[extension.toLowerCase()] || "#64748b";
}
