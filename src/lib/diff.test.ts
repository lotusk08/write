import { describe, expect, it } from "vitest";
import { diffLines } from "./diff.ts";

describe("diffLines", () => {
  it("finds nothing in equal text", () => {
    expect(diffLines("a\nb", "a\nb")).toEqual({ added: 0, removed: 0, hunks: [] });
  });

  it("counts and groups changes with context", () => {
    const before = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].join("\n");
    const after = ["1", "2", "three", "4", "5", "6", "7", "8", "9", "10", "11"].join("\n");
    const diff = diffLines(before, after);
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(1);
    expect(diff.hunks).toHaveLength(2);
    expect(diff.hunks[0].map((line) => line.kind + line.text)).toEqual([" 1", " 2", "-3", "+three", " 4", " 5"]);
    expect(diff.hunks[1].map((line) => line.kind + line.text)).toEqual([" 9", " 10", "+11"]);
  });

  it("merges changes whose context overlaps", () => {
    const diff = diffLines("a\nb\nc\nd\ne", "A\nb\nc\nD\ne");
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0].map((line) => line.kind + line.text)).toEqual(["-a", "+A", " b", " c", "-d", "+D", " e"]);
  });

  it("handles a new file", () => {
    expect(diffLines("", "x\ny").added).toBe(2);
  });
});
