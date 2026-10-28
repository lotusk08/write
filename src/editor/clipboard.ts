import { docToMarkdown } from "../lib/markdown.ts";
import { docToHtml, htmlToDoc } from "./bridge.ts";
import type { JSONContent } from "./doc.ts";

/** Marks a copy made in this editor, so pasting it here brings its photos back as they were. */
const OWN = "data-write-blocks";

/** Where the last copy made in the editor is remembered, so a tab can tell it from one made anywhere else. */
const COPIED = "write:copied";

let copied = "";

/** What a page's own copy and its selection share, whitespace aside — the browser breaks lines where the selection does not — hashed. */
function print(text: string): string {
  const flat = text.replace(/\s+/g, "");
  let hash = 0x811c9dc5;
  for (let index = 0; index < flat.length; index += 1) {
    hash = Math.imul(hash ^ flat.charCodeAt(index), 0x01000193);
  }
  return flat ? `${flat.length}:${(hash >>> 0).toString(36)}` : "";
}

/**
 * Remembers the text of a copy made in this editor, in every tab. Any page can write the editor's own markup — a raw
 * HTML block, an attribute list, the mark of a copy made here — into what it puts on the clipboard; only a paste whose
 * text is that of the last copy made here is read with it.
 */
export function rememberCopy(text: string): void {
  copied = print(text);
  try {
    localStorage.setItem(COPIED, copied);
  } catch {
  }
}

/** Whether a paste's text is that of the last copy made in this editor. */
export function copiedHere(text: string): boolean {
  let last = copied;
  try {
    last = localStorage.getItem(COPIED) ?? copied;
  } catch {
  }
  return last !== "" && print(text) === last;
}

/** What a copy holds that the browser's own copy would lose: a photo, a gallery, a player. */
export const MEDIA = "figure[data-image], [data-gallery], [data-embed]";

/**
 * Blocks copied from the post: as the editor's own HTML, marked, which keeps a stored photo's `local:` address where
 * the browser would copy the page's passing blob URL, and as Markdown for anywhere else.
 */
export function clipboardOf(nodes: Node[]): { html: string; text: string } {
  const holder = document.createElement("div");
  holder.append(...nodes.map((node) => node.cloneNode(true)));
  const doc = htmlToDoc(holder.innerHTML);
  const text = docToMarkdown(doc);
  rememberCopy(text);
  return { html: `<div ${OWN}="">${docToHtml(doc)}</div>`, text };
}

/** The blocks of a copy made here, read back as they were; null for anything copied elsewhere. */
export function copiedBlocks(html: string, text: string): JSONContent | null {
  if (!html.includes(OWN) || !copiedHere(text)) {
    return null;
  }
  const marked = new DOMParser().parseFromString(html, "text/html").body.querySelector(`[${OWN}]`);
  return marked ? htmlToDoc(marked.innerHTML) : null;
}
