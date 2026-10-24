import { docToMarkdown } from "../lib/markdown.ts";
import { docToHtml, htmlToDoc } from "./bridge.ts";
import type { JSONContent } from "./doc.ts";

/** Marks a copy made in this editor, so pasting it here brings its photos back as they were. */
const OWN = "data-write-blocks";

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
  return { html: `<div ${OWN}="">${docToHtml(doc)}</div>`, text: docToMarkdown(doc) };
}

/** The blocks of a copy made here, read back as they were; null for anything copied elsewhere. */
export function copiedBlocks(html: string): JSONContent | null {
  if (!html.includes(OWN)) {
    return null;
  }
  const marked = new DOMParser().parseFromString(html, "text/html").body.querySelector(`[${OWN}]`);
  return marked ? htmlToDoc(marked.innerHTML) : null;
}
