import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => `asset://${p}`),
}));

describe("Store (initial state)", () => {
  it("has expected initial state shape", async () => {
    const { useZenithStore } = await import("../store");
    const state = useZenithStore.getState();

    expect(state.items).toEqual([]);
    expect(state.isExpanded).toBe(false);
    expect(state.isDragOver).toBe(false);
    expect(state.settings).toBeNull();
    expect(state.clipboardStack).toEqual([]);
    expect(state.isStackMode).toBe(false);
    expect(state.selectedIds).toBeInstanceOf(Set);
    expect(state.previewPanes).toEqual([]);
    expect(state.batchRenameMode).toBe(false);
    expect(state.isStudioOpen).toBe(false);
    expect(typeof state.loadTags).toBe("function");
    expect(typeof state.setItemTag).toBe("function");
    expect(typeof state.removeItemTag).toBe("function");
    expect(typeof state.loadPresets).toBe("function");
    expect(typeof state.savePreset).toBe("function");
    expect(typeof state.deletePreset).toBe("function");
    expect(typeof state.stageFile).toBe("function");
    expect(typeof state.removeItem).toBe("function");
    expect(typeof state.clearAll).toBe("function");
  });
});

describe("Store (selection)", () => {
  it("toggleSelect adds and removes IDs", async () => {
    const { useZenithStore } = await import("../store");
    const { toggleSelect } = useZenithStore.getState();

    toggleSelect("item-1");
    expect(useZenithStore.getState().selectedIds.has("item-1")).toBe(true);

    toggleSelect("item-1");
    expect(useZenithStore.getState().selectedIds.has("item-1")).toBe(false);
  });

  it("clearSelection empties the set", async () => {
    const { useZenithStore } = await import("../store");
    const { toggleSelect, clearSelection } = useZenithStore.getState();

    toggleSelect("a");
    toggleSelect("b");
    clearSelection();
    expect(useZenithStore.getState().selectedIds.size).toBe(0);
  });
});

describe("Store (clipboard stack)", () => {
  it("pushToStack adds items", async () => {
    const { useZenithStore } = await import("../store");
    const { pushToStack, clearStack } = useZenithStore.getState();

    clearStack();
    pushToStack("hello");
    pushToStack("world");
    expect(useZenithStore.getState().clipboardStack).toEqual(["hello", "world"]);
  });
});

describe("Store (rename states)", () => {
  it("setRenameState adds and removes rename state", async () => {
    const { useZenithStore } = await import("../store");
    const { setRenameState } = useZenithStore.getState();

    setRenameState("test-1", {
      itemId: "test-1", path: "/test", originalName: "test.txt",
      originalStem: "test", extension: ".txt",
      suggestions: [{ stem: "new_name", full_name: "new_name.txt", new_path: "/new_name.txt" }],
      activeIndex: 0, loading: false,
    });
    expect(useZenithStore.getState().renameStates["test-1"]).toBeDefined();

    setRenameState("test-1", null);
    expect(useZenithStore.getState().renameStates["test-1"]).toBeUndefined();
  });
});

describe("Store (tags)", () => {
  it("loadPresets sets presets from localStorage", async () => {
    const { useZenithStore } = await import("../store");
    const { loadPresets } = useZenithStore.getState();
    loadPresets();
    expect(useZenithStore.getState().presets).toEqual([]);
  });
});
