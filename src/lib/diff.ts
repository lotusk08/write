export type DiffLine = { kind: " " | "+" | "-"; text: string };

export interface LineDiff {
  added: number;
  removed: number;
  hunks: DiffLine[][];
}

export function diffLines(before: string, after: string, context = 2): LineDiff {
  const all = before.split("\n");
  const next = after.split("\n");
  let head = 0;
  while (head < all.length && head < next.length && all[head] === next[head]) {
    head += 1;
  }
  let tail = 0;
  while (tail < all.length - head && tail < next.length - head && all[all.length - 1 - tail] === next[next.length - 1 - tail]) {
    tail += 1;
  }
  const a = all.slice(head, all.length - tail);
  const b = next.slice(head, next.length - tail);
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const lines: DiffLine[] = all.slice(0, head).map((text) => ({ kind: " ", text }));
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: " ", text: a[i++] });
      j += 1;
    } else if (i < a.length && (j === b.length || table[i + 1][j] >= table[i][j + 1])) {
      lines.push({ kind: "-", text: a[i++] });
    } else {
      lines.push({ kind: "+", text: b[j++] });
    }
  }
  lines.push(...all.slice(all.length - tail).map((text): DiffLine => ({ kind: " ", text })));
  const near = lines.map((_, index) =>
    lines.slice(Math.max(0, index - context), index + context + 1).some((line) => line.kind !== " "),
  );
  const hunks: DiffLine[][] = [];
  lines.forEach((line, index) => {
    if (near[index]) {
      if (!near[index - 1]) {
        hunks.push([]);
      }
      hunks[hunks.length - 1].push(line);
    }
  });
  return {
    added: lines.filter((line) => line.kind === "+").length,
    removed: lines.filter((line) => line.kind === "-").length,
    hunks,
  };
}
