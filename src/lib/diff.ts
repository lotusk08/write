type DiffLine = { kind: " " | "+" | "-"; text: string };

export interface LineDiff {
  added: number;
  removed: number;
  hunks: DiffLine[][];
}

export function diffLines(before: string, after: string, context = 2): LineDiff {
  const all = before ? before.split("\n") : [];
  const next = after ? after.split("\n") : [];
  const ids = new Map<string, number>();
  const id = (text: string) => {
    let found = ids.get(text);
    if (found === undefined) {
      found = ids.size;
      ids.set(text, found);
    }
    return found;
  };
  const ofAll = Int32Array.from(all, id);
  const ofNext = Int32Array.from(next, id);
  const inAll = new Set(ofAll);
  const inNext = new Set(ofNext);
  const aAt = [...ofAll.keys()].filter((at) => inNext.has(ofAll[at]));
  const bAt = [...ofNext.keys()].filter((at) => inAll.has(ofNext[at]));
  const a = Int32Array.from(aAt, (at) => ofAll[at]);
  const b = Int32Array.from(bAt, (at) => ofNext[at]);
  const forward = new Int32Array(a.length + b.length + 2);
  const backward = new Int32Array(a.length + b.length + 2);
  const kept: number[] = [];
  const keep = (aFrom: number, bFrom: number, count: number) => {
    for (let at = 0; at < count; at += 1) {
      kept.push(aAt[aFrom + at], bAt[bFrom + at]);
    }
  };

  const bisect = (aLo: number, aHi: number, bLo: number, bHi: number): [number, number] | null => {
    const n = aHi - aLo;
    const m = bHi - bLo;
    const most = Math.ceil((n + m) / 2);
    const length = 2 * most;
    forward.fill(-1, 0, length + 1);
    backward.fill(-1, 0, length + 1);
    forward[most + 1] = 0;
    backward[most + 1] = 0;
    const delta = n - m;
    const odd = delta % 2 !== 0;
    let forwardStart = 0;
    let forwardEnd = 0;
    let backwardStart = 0;
    let backwardEnd = 0;
    for (let d = 0; d < most; d += 1) {
      for (let k = -d + forwardStart; k <= d - forwardEnd; k += 2) {
        const at = most + k;
        let x = k === -d || (k !== d && forward[at - 1] < forward[at + 1]) ? forward[at + 1] : forward[at - 1] + 1;
        let y = x - k;
        while (x < n && y < m && a[aLo + x] === b[bLo + y]) {
          x += 1;
          y += 1;
        }
        forward[at] = x;
        if (x > n) {
          forwardEnd += 2;
        } else if (y > m) {
          forwardStart += 2;
        } else if (odd) {
          const other = most + delta - k;
          if (other >= 0 && other < length && backward[other] !== -1 && x >= n - backward[other]) {
            return [aLo + x, bLo + y];
          }
        }
      }
      for (let k = -d + backwardStart; k <= d - backwardEnd; k += 2) {
        const at = most + k;
        let x = k === -d || (k !== d && backward[at - 1] < backward[at + 1]) ? backward[at + 1] : backward[at - 1] + 1;
        let y = x - k;
        while (x < n && y < m && a[aHi - 1 - x] === b[bHi - 1 - y]) {
          x += 1;
          y += 1;
        }
        backward[at] = x;
        if (x > n) {
          backwardEnd += 2;
        } else if (y > m) {
          backwardStart += 2;
        } else if (!odd) {
          const other = most + delta - k;
          if (other >= 0 && other < length && forward[other] !== -1 && forward[other] >= n - x) {
            return [aLo + forward[other], bLo + forward[other] - (other - most)];
          }
        }
      }
    }
    return null;
  };

  const walk = (aLo: number, aHi: number, bLo: number, bHi: number): void => {
    let head = 0;
    while (aLo + head < aHi && bLo + head < bHi && a[aLo + head] === b[bLo + head]) {
      head += 1;
    }
    keep(aLo, bLo, head);
    aLo += head;
    bLo += head;
    let tail = 0;
    while (aLo < aHi - tail && bLo < bHi - tail && a[aHi - 1 - tail] === b[bHi - 1 - tail]) {
      tail += 1;
    }
    const split = aLo < aHi - tail && bLo < bHi - tail ? bisect(aLo, aHi - tail, bLo, bHi - tail) : null;
    if (split) {
      walk(aLo, split[0], bLo, split[1]);
      walk(split[0], aHi - tail, split[1], bHi - tail);
    }
    keep(aHi - tail, bHi - tail, tail);
  };
  walk(0, a.length, 0, b.length);

  const lines: DiffLine[] = [];
  const put = (kind: DiffLine["kind"], texts: string[], from: number, to: number) => {
    for (let at = from; at < to; at += 1) {
      lines.push({ kind, text: texts[at] });
    }
  };
  let i = 0;
  let j = 0;
  for (let pair = 0; pair <= kept.length; pair += 2) {
    const aNext = pair < kept.length ? kept[pair] : all.length;
    const bNext = pair < kept.length ? kept[pair + 1] : next.length;
    put("-", all, i, aNext);
    put("+", next, j, bNext);
    put(" ", all, aNext, Math.min(aNext + 1, all.length));
    i = aNext + 1;
    j = bNext + 1;
  }

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
