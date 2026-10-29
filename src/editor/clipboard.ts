import { docToMarkdown } from "../lib/markdown.ts";
import { docToHtml, htmlToDoc } from "./bridge.ts";
import type { JSONContent } from "./doc.ts";

const OWN = "data-write-blocks";

const COPIED = "write:copied";

let copied = "";

function print(text: string): string {
  const flat = text.replace(/^[ \t]*(?:[-*+•◦▪]|\d{1,9}[.)])[ \t]+/gm, "").replace(/\s+/g, "");
  let hash = 0x811c9dc5;
  for (let index = 0; index < flat.length; index += 1) {
    hash = Math.imul(hash ^ flat.charCodeAt(index), 0x01000193);
  }
  return flat ? `${flat.length}:${(hash >>> 0).toString(36)}` : "";
}

export function rememberCopy(text: string): void {
  copied = print(text);
  try {
    localStorage.setItem(COPIED, copied);
  } catch {
  }
}

export function copiedHere(text: string): boolean {
  let last = copied;
  try {
    last = localStorage.getItem(COPIED) ?? copied;
  } catch {
  }
  return last !== "" && print(text) === last;
}

export const MEDIA = "figure[data-image], [data-gallery], [data-embed]";

export function clipboardOf(nodes: Node[]): { html: string; text: string } {
  const holder = document.createElement("div");
  holder.append(...nodes.map((node) => node.cloneNode(true)));
  const doc = htmlToDoc(holder.innerHTML);
  const text = docToMarkdown(doc);
  rememberCopy(text);
  return { html: `<div ${OWN}="">${docToHtml(doc)}</div>`, text };
}

export function copiedBlocks(html: string, text: string): JSONContent | null {
  if (!html.includes(OWN) || !copiedHere(text)) {
    return null;
  }
  const marked = new DOMParser().parseFromString(html, "text/html").body.querySelector(`[${OWN}]`);
  return marked ? htmlToDoc(marked.innerHTML) : null;
}
