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
    expect(diffLines("", "x\ny")).toMatchObject({ added: 2, removed: 0 });
  });

  it("finds the fewest changes, as a table of every line against every other does, in memory as long as the lines", () => {
    const common = (a: string[], b: string[]) => {
      let row = new Array<number>(b.length + 1).fill(0);
      for (const line of a) {
        const nextRow = [0];
        b.forEach((other, j) => nextRow.push(line === other ? row[j] + 1 : Math.max(row[j + 1], nextRow[j])));
        row = nextRow;
      }
      return row[b.length];
    };
    let seed = 7;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let round = 0; round < 300; round += 1) {
      const a = Array.from({ length: Math.floor(random() * 30) }, () => "abcde"[Math.floor(random() * 5)]);
      const b = Array.from({ length: Math.floor(random() * 30) }, () => "abcde"[Math.floor(random() * 5)]);
      const diff = diffLines(a.join("\n"), b.join("\n"));
      const kept = a.length - diff.removed;
      expect([kept, b.length - diff.added]).toEqual([common(a, b), common(a, b)]);
    }
    const before = Array.from({ length: 8000 }, (_, at) => `old ${at}`);
    const after = Array.from({ length: 8000 }, (_, at) => (at % 2 ? `old ${at}` : `new ${at}`));
    const diff = diffLines(["same", ...before, "end"].join("\n"), ["same", ...after, "end"].join("\n"));
    expect(diff).toMatchObject({ added: 4000, removed: 4000 });
    expect(diff.hunks[0].slice(0, 4).map((line) => line.kind + line.text)).toEqual([" same", "-old 0", "+new 0", " old 1"]);
  });
});
