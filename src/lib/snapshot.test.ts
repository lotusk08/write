// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { keepSnapshot, restoreSnapshots, type Draft } from "./db.ts";

const draft = (id: string, text: string, updatedAt: number) =>
  ({ id, title: "", slug: "", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }, meta: {}, createdAt: 0, updatedAt }) as unknown as Draft;

beforeEach(() => localStorage.clear());

describe("snapshots kept when the page is left", () => {
  it("brings back edits newer than the stored draft and forgets every snapshot", async () => {
    const put: Draft[] = [];
    keepSnapshot("a", { doc: draft("a", "typed last", 0).doc }, 200);
    keepSnapshot("b", { doc: draft("b", "older", 0).doc }, 50);
    const restored = await restoreSnapshots([draft("a", "saved", 100), draft("b", "saved", 100)], async (next) => {
      put.push(next);
      return next.id;
    });
    expect(restored.find((item) => item.id === "a")?.doc).toEqual(draft("a", "typed last", 0).doc);
    expect(restored.find((item) => item.id === "a")?.updatedAt).toBe(200);
    expect(restored.find((item) => item.id === "b")?.doc).toEqual(draft("b", "saved", 0).doc);
    expect(put.map((item) => item.id)).toEqual(["a"]);
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it("keeps nothing when there is nothing to keep, and skips a snapshot it cannot read", async () => {
    keepSnapshot("a", { shareToken: "x" });
    localStorage.setItem("write:unsaved:b", "{not json");
    expect(await restoreSnapshots([draft("b", "saved", 1)], async () => "b")).toHaveLength(1);
    expect(localStorage.getItem("write:unsaved:a")).toBeNull();
  });
});
