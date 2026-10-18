import { describe, expect, it } from "vitest";
import { fileDate } from "./paths.ts";

describe("fileDate", () => {
  it("reads the day in a post's file name, and only from the name", () => {
    expect(fileDate("src/posts/2026-10-11-trip.md")).toBe("2026-10-11");
    expect(fileDate("src/drafts/2025-01-02-a-b.markdown")).toBe("2025-01-02");
    expect(fileDate("src/drafts/idea.md")).toBe("");
    expect(fileDate("src/posts/2026-10-11.md")).toBe("");
    expect(fileDate("src/2026-10-11-old/post.md")).toBe("");
  });
});
