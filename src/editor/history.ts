export interface Caret {
  start: number;
  end: number;
}

export interface Snapshot {
  doc: string;
  caret: Caret | null;
}

const MERGING = new Set(["type", "delete"]);
const PAUSE_MS = 1500;
const LONGEST_MS = 8000;
const LIMIT = 200;

export class History {
  private undos: Snapshot[] = [];
  private redos: Snapshot[] = [];
  private kind: string | null = null;
  private started = 0;
  private last = 0;

  get canUndo(): boolean {
    return this.undos.length > 0;
  }

  get canRedo(): boolean {
    return this.redos.length > 0;
  }

  before(kind: string, take: () => Snapshot, now = Date.now()): void {
    const merging = kind === this.kind && MERGING.has(kind) && now - this.last < PAUSE_MS && now - this.started < LONGEST_MS;
    this.last = now;
    if (merging) {
      return;
    }
    this.kind = kind;
    this.started = now;
    const state = take();
    if (this.undos.at(-1)?.doc !== state.doc) {
      this.undos.push(state);
      if (this.undos.length > LIMIT) {
        this.undos.shift();
      }
    }
  }

  changed(): void {
    this.redos = [];
  }

  seal(): void {
    this.kind = null;
  }

  clear(): void {
    this.undos = [];
    this.redos = [];
    this.kind = null;
  }

  undo(take: () => Snapshot, apply: (state: Snapshot) => void): boolean {
    return this.step(this.undos, this.redos, take, apply);
  }

  redo(take: () => Snapshot, apply: (state: Snapshot) => void): boolean {
    return this.step(this.redos, this.undos, take, apply);
  }

  private step(from: Snapshot[], to: Snapshot[], take: () => Snapshot, apply: (state: Snapshot) => void): boolean {
    const now = take();
    while (from.length && from.at(-1)!.doc === now.doc) {
      from.pop();
    }
    const target = from.pop();
    if (!target) {
      return false;
    }
    if (to.at(-1)?.doc !== now.doc) {
      to.push(now);
    }
    this.kind = null;
    apply(target);
    return true;
  }
}

const BLOCKS = "p, h1, h2, h3, h4, h5, h6, li, pre, td, th, figcaption, dt, dd, [data-collapsible-summary]";

type Unit = { node: Node; kind: "text" | "br" | "block"; size: number };

function unitsIn(root: HTMLElement): Unit[] {
  const units: Unit[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) =>
      node.nodeType === 1 && (node as Element).getAttribute("contenteditable") === "false" ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3) {
      units.push({ node, kind: "text", size: (node as Text).length });
    } else if (node.nodeName === "BR") {
      units.push({ node, kind: "br", size: 1 });
    } else if ((node as Element).matches(BLOCKS)) {
      units.push({ node, kind: "block", size: 1 });
    }
  }
  return units;
}

const indexIn = (node: Node): number => Array.prototype.indexOf.call(node.parentNode!.childNodes, node) as number;

function endOf(unit: Unit): [Node, number] {
  return unit.kind === "text" ? [unit.node, unit.size] : unit.kind === "br" ? [unit.node.parentNode!, indexIn(unit.node) + 1] : [unit.node, 0];
}

function offsetOf(units: Unit[], container: Node, offset: number): number {
  const point = document.createRange();
  point.setStart(container, offset);
  let total = 0;
  for (const unit of units) {
    if (unit.node === container && unit.kind === "text") {
      return total + offset;
    }
    if (point.comparePoint(...endOf(unit)) > 0) {
      break;
    }
    total += unit.size;
  }
  return total;
}

export function readCaret(root: HTMLElement): Caret | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return null;
  }
  const units = unitsIn(root);
  return { start: offsetOf(units, range.startContainer, range.startOffset), end: offsetOf(units, range.endContainer, range.endOffset) };
}

function pointAt(root: HTMLElement, units: Unit[], offset: number): [Node, number] {
  let total = 0;
  let blockStart: [Node, number] | null = null;
  for (const unit of units) {
    if (unit.kind === "text" && offset <= total + unit.size) {
      return [unit.node, offset - total];
    }
    if (unit.kind === "br" && offset === total) {
      return [unit.node.parentNode!, indexIn(unit.node)];
    }
    if (unit.kind === "block" && blockStart) {
      return blockStart;
    }
    total += unit.size;
    if (unit.kind === "block" && offset === total) {
      blockStart = [unit.node, 0];
    }
  }
  return blockStart ?? [root, root.childNodes.length];
}

export function placeCaretAt(root: HTMLElement, caret: Caret | null): void {
  const units = unitsIn(root);
  const range = document.createRange();
  if (caret) {
    range.setStart(...pointAt(root, units, caret.start));
    range.setEnd(...pointAt(root, units, caret.end));
  } else {
    range.selectNodeContents(root.firstElementChild ?? root);
    range.collapse(true);
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
