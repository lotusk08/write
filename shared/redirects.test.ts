import { describe, expect, it } from "vitest";
import { mergeRedirects, redirectSources } from "./redirects.ts";

const p = (name: string) => `/assets/img/post/${name}.webp`;

describe("mergeRedirects", () => {
  it("appends a move to an empty file, sorted with a trailing newline", () => {
    expect(mergeRedirects("", [[p("b"), p("c")], [p("a"), p("d")]], [])).toBe(`${p("a")} ${p("d")}\n${p("b")} ${p("c")}\n`);
  });

  it("points an old line at the new name rather than chaining", () => {
    expect(mergeRedirects(`${p("a")} ${p("b")}\n`, [[p("b"), p("c")]], [p("c")])).toBe(
      `${p("a")} ${p("c")}\n${p("b")} ${p("c")}\n`,
    );
  });

  it("drops a line whose source this commit creates, and a move back to where it began", () => {
    expect(mergeRedirects(`${p("a")} ${p("b")}\n`, [[p("b"), p("a")]], [p("a")])).toBe(`${p("b")} ${p("a")}\n`);
    expect(mergeRedirects(`${p("x")} ${p("y")}\n`, [], [p("x")])).toBe("");
  });

  it("keeps lines unique and reads sources back", () => {
    const text = mergeRedirects(`${p("a")} ${p("b")}\n${p("a")} ${p("b")}\n`, [], []);
    expect(text).toBe(`${p("a")} ${p("b")}\n`);
    expect(redirectSources(text)).toEqual([p("a")]);
  });
});

describe("mergeRedirects under many renames", () => {
  it("sends every old address straight to each photo's latest name, and merging again changes nothing", () => {
    let seed = 7;
    const random = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
    const current = Array.from({ length: 40 }, (_, index) => p(`photo-${index}`));
    const history = current.map((name) => [name]);
    let text = "";
    let fresh = 0;
    for (let round = 0; round < 300; round++) {
      const moves: [string, string][] = [];
      for (let count = 1 + random(4); count > 0; count--) {
        const index = random(current.length);
        if (moves.some(([from]) => from === current[index])) {
          continue;
        }
        const to = p(`renamed-${fresh++}`);
        moves.push([current[index], to]);
        history[index].push(to);
        current[index] = to;
      }
      const created = moves.map(([, to]) => to);
      text = mergeRedirects(text, moves, created);
      expect(mergeRedirects(text, moves, created)).toBe(text);
    }
    const lines = text.trimEnd().split("\n").map((line) => line.split(" "));
    const sources = new Set(lines.map(([from]) => from));
    expect(lines.every(([from, to]) => from !== to && !sources.has(to))).toBe(true);
    expect([...lines.map((line) => line.join(" "))]).toEqual([...new Set(lines.map((line) => line.join(" ")))].sort());
    const target = new Map(lines.map(([from, to]) => [from, to]));
    history.forEach((names, index) => names.slice(0, -1).forEach((name) => expect(target.get(name)).toBe(current[index])));
  });

  it("ignores blank, short and padded lines it did not write", () => {
    expect(mergeRedirects(`\n  ${p("a")}   ${p("b")}  \n${p("lonely")}\n\n`, [], [])).toBe(`${p("a")} ${p("b")}\n`);
  });
});
