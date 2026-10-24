import type { DropSpot } from "./commands.ts";
import { TRANSIENT } from "./bridge.ts";

/** The share of a lone photo's height, at its top and its bottom, that drops above or below it rather than beside it. */
const EDGE = 0.25;

/** The block directly in the post that holds `node`; a preview drawn above its source stands for the source. */
function topBlock(root: HTMLElement, node: Element): HTMLElement | null {
  let block: Element | null = node;
  while (block && block.parentElement !== root) {
    block = block.parentElement;
  }
  while (block?.hasAttribute(TRANSIENT)) {
    block = block.nextElementSibling;
  }
  return block as HTMLElement | null;
}

/** Between blocks the pointer is over the post itself: the block it is beside is the first to end below it. */
function blockAt(root: HTMLElement, y: number): HTMLElement | null {
  const blocks = [...root.children].filter((child) => !child.hasAttribute(TRANSIENT)) as HTMLElement[];
  return blocks.find((block) => block.getBoundingClientRect().bottom > y) ?? blocks[blocks.length - 1] ?? null;
}

/** Which side of a box the pointer is on: across it for a photo in a row, down it for a block. */
function side(box: DOMRect, x: number, y: number, across: boolean): "before" | "after" {
  return (across ? x < box.left + box.width / 2 : y < box.top + box.height / 2) ? "before" : "after";
}

/**
 * Where something dropped at (x, y) lands. A photo — dragged, or a file from the desktop — dropped on a gallery's
 * photo goes beside it, on the side the pointer is; on the gallery's frame, after its last photo; on the middle of a
 * photo alone, beside it, the two becoming a gallery. Anything else lands above or below the block under the pointer,
 * whichever half it is in.
 */
export function dropSpot(root: HTMLElement, x: number, y: number, dragged: HTMLElement | null): DropSpot | null {
  const hit = document.elementFromPoint(x, y);
  if (!hit || !root.contains(hit)) {
    return null;
  }
  const photo = !dragged || dragged.matches("[data-image]");
  const figure = hit.closest<HTMLElement>("figure[data-image]");
  if (photo && figure && root.contains(figure)) {
    const box = figure.getBoundingClientRect();
    const height = (y - box.top) / box.height;
    if (figure.closest("[data-gallery]") || (height > EDGE && height < 1 - EDGE)) {
      return { kind: "photo", ref: figure, side: side(box, x, y, true) };
    }
  }
  const gallery = hit.closest<HTMLElement>("[data-gallery]");
  if (photo && gallery && root.contains(gallery)) {
    const box = gallery.getBoundingClientRect();
    const height = (y - box.top) / box.height;
    const last = [...gallery.querySelectorAll<HTMLElement>("figure[data-image]")].pop();
    if (last && height > EDGE / 2 && height < 1 - EDGE / 2) {
      return { kind: "photo", ref: last, side: "after" };
    }
  }
  const block = hit === root ? blockAt(root, y) : topBlock(root, hit);
  if (!block) {
    return null;
  }
  return { kind: "block", ref: block, side: side(block.getBoundingClientRect(), x, y, false) };
}

/** Draws where a drop would land: an upright bar beside a photo, a line above or below a block. */
export function markSpot(mark: HTMLElement, spot: DropSpot | null): void {
  mark.hidden = !spot;
  if (!spot) {
    return;
  }
  const box = spot.ref.getBoundingClientRect();
  const upright = spot.kind === "photo";
  Object.assign(mark.style, upright
    ? {
        left: `${(spot.side === "before" ? box.left - 6 : box.right + 3)}px`,
        top: `${box.top}px`,
        width: "3px",
        height: `${box.height}px`,
      }
    : {
        left: `${box.left}px`,
        top: `${(spot.side === "before" ? box.top - 6 : box.bottom + 3)}px`,
        width: `${box.width}px`,
        height: "3px",
      });
}
