import type { JSONContent } from "./doc.ts";
import { embedFromUrl } from "./blog.ts";
import { docToHtml, htmlToDoc } from "./bridge.ts";
import { insertEmbed, notify } from "./commands.ts";
import { markdownToDoc } from "../lib/import.ts";

const BLOCKS = "address, article, aside, blockquote, details, div, dl, figure, footer, h1, h2, h3, h4, h5, h6, header, hr, li, ol, p, pre, section, table, ul";
const SEMANTIC = "a, b, strong, i, em, u, s, del, strike, mark, sup, sub, code, pre, h1, h2, h3, h4, h5, h6, ul, ol, li, table, blockquote, img, hr";
const BOLD = /font-weight:\s*(?:bold|[7-9]00)/i;
const NOT_BOLD = /font-weight:\s*(?:normal|[1-4]00)/i;
const STYLES: [RegExp, string][] = [
  [BOLD, "strong"],
  [/font-style:\s*italic/i, "em"],
  [/text-decoration[^;]*line-through/i, "s"],
  [/text-decoration[^;]*underline/i, "u"],
  [/vertical-align:\s*super/i, "sup"],
  [/vertical-align:\s*sub/i, "sub"],
];
const SAFE_HREF = /^(?:https?:|mailto:|tel:|[/#?.]|[^:]*$)/i;
const MARKDOWN_LINE = /^ {0,3}(?:#{1,6}[ \t]|[-*+][ \t]+\S|\d{1,9}[.)][ \t]+\S|>|```|~~~|\|.*\|[ \t]*$|-{3,}[ \t]*$)/m;
const MARKDOWN_INLINE = /\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|`[^`\n]+`|!?\[[^\]\n]+\]\([^)\s]+\)/;

function unwrap(element: Element): void {
  element.replaceWith(...element.childNodes);
}

function wordLists(body: HTMLElement): void {
  let list = null as HTMLElement | null;
  for (const paragraph of [...body.querySelectorAll("p")]) {
    const style = paragraph.getAttribute("style") ?? "";
    if (!/mso-list:/i.test(style) && !/MsoListParagraph/.test(paragraph.className)) {
      list = null;
      continue;
    }
    const marker = paragraph.querySelector('[style*="mso-list:Ignore" i], [style*="mso-list: Ignore" i]');
    const ordered = /^\s*\(?[0-9a-zA-Z]{1,4}[.)]/.test(marker?.textContent ?? "");
    marker?.remove();
    const tag = ordered ? "ol" : "ul";
    if (list?.tagName.toLowerCase() !== tag || list.nextElementSibling !== paragraph) {
      list = body.ownerDocument.createElement(tag);
      paragraph.before(list);
    }
    const item = body.ownerDocument.createElement("li");
    item.append(...paragraph.childNodes);
    paragraph.remove();
    list.append(item);
  }
}

function clipboardBody(html: string): HTMLElement {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  [...body.querySelectorAll("*")]
    .filter((node) => /^(?:meta|style|script|link|title|o:p)$/i.test(node.tagName))
    .forEach((node) => node.remove());
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) {
    comments.push(walker.currentNode);
  }
  comments.forEach((comment) => comment.parentNode?.removeChild(comment));
  wordLists(body);
  for (const element of [...body.querySelectorAll("b, strong")]) {
    if (NOT_BOLD.test(element.getAttribute("style") ?? "")) {
      unwrap(element);
    }
  }
  for (const span of [...body.querySelectorAll("span[style], font[style]")]) {
    const style = span.getAttribute("style") ?? "";
    const tags = STYLES.filter(([test, tag]) => test.test(style) && !(tag === "u" && span.closest("a"))).map(([, tag]) => tag);
    if (!tags.length) {
      unwrap(span);
      continue;
    }
    const outer = body.ownerDocument.createElement(tags[0]);
    let inner = outer;
    for (const tag of tags.slice(1)) {
      inner = inner.appendChild(body.ownerDocument.createElement(tag));
    }
    inner.append(...span.childNodes);
    span.replaceWith(outer);
  }
  body.querySelectorAll("a u").forEach(unwrap);
  for (const element of [...body.querySelectorAll("*")].reverse()) {
    if (!element.matches(BLOCKS) && element.querySelector(`:scope > :is(${BLOCKS})`)) {
      unwrap(element);
    }
  }
  for (const figure of [...body.querySelectorAll("figure")]) {
    const img = figure.querySelector("img");
    const caption = figure.querySelector("figcaption")?.textContent?.trim();
    if (img && caption) {
      img.setAttribute("title", caption);
    }
    figure.querySelector("figcaption")?.remove();
  }
  for (const link of [...body.querySelectorAll("a[href]")]) {
    if (!SAFE_HREF.test(link.getAttribute("href") ?? "")) {
      link.removeAttribute("href");
    }
  }
  if (body.querySelector(`:scope > :is(${BLOCKS})`)) {
    body.querySelectorAll(":scope > br").forEach((br) => br.remove());
  }
  body.querySelectorAll("[style]").forEach((element) => element.removeAttribute("style"));
  return body;
}

function plainDoc(text: string): JSONContent {
  return {
    type: "doc",
    content: text
      .split(/\n{2,}/)
      .filter((part) => part.trim())
      .map((part) => ({
        type: "paragraph",
        content: part.split("\n").flatMap((line, index) => [
          ...(index ? [{ type: "hardBreak" }] : []),
          ...(line ? [{ type: "text", text: line }] : []),
        ]),
      })),
  };
}

/** Clipboard contents as the editor's own HTML, built from the doc model, so a paste carries only what the blog can show. */
export function pastedHtml(html: string, text: string): string | null {
  const plain = text.replace(/\r\n?/g, "\n");
  const body = html ? clipboardBody(html) : null;
  const rich = body !== null && body.querySelector(SEMANTIC) !== null;
  const doc = rich
    ? htmlToDoc(body.innerHTML)
    : MARKDOWN_LINE.test(plain) || MARKDOWN_INLINE.test(plain)
      ? markdownToDoc(plain)
      : plainDoc(plain || (body?.textContent ?? ""));
  if (!doc.content?.length) {
    return null;
  }
  const out = docToHtml(doc);
  const single = doc.content.length === 1 && doc.content[0].type === "paragraph" && !doc.content[0].attrs;
  return single ? out.replace(/^<p>([\s\S]*)<\/p>$/, "$1") : out;
}

const TEXTBLOCK = "p, h1, h2, h3, h4, h5, h6, li, td, th, summary, pre, div";

function isBlock(node: Node | null): node is Element {
  return node instanceof Element && node.matches(BLOCKS);
}

function blockAround(node: Node, root: HTMLElement): Element {
  for (let at: Node | null = node; at && at !== root; at = at.parentNode) {
    if (at instanceof Element && at.matches(TEXTBLOCK)) {
      return at;
    }
  }
  let top = node as ChildNode;
  while (top.parentNode && top.parentNode !== root) {
    top = top.parentNode as unknown as ChildNode;
  }
  const run: ChildNode[] = [top];
  while (run[0].previousSibling && !isBlock(run[0].previousSibling)) {
    run.unshift(run[0].previousSibling);
  }
  while (run[run.length - 1].nextSibling && !isBlock(run[run.length - 1].nextSibling)) {
    run.push(run[run.length - 1].nextSibling!);
  }
  const paragraph = document.createElement("p");
  run[0].before(paragraph);
  paragraph.append(...run);
  return paragraph;
}

function blank(node: ParentNode): boolean {
  return !node.textContent?.trim() && !(node instanceof Element ? node : null)?.querySelector("img") && [...node.childNodes].every((child) => child.nodeName === "BR" || !child.textContent);
}

function placeCaret(parent: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(parent, offset);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

/** Puts pasted blocks where the caret is: the first paragraph joins the line, the rest follow it, and what came after the caret closes the last. */
function insertBlocks(root: HTMLElement, range: Range, fragment: DocumentFragment): void {
  if (range.startContainer === root) {
    const paragraph = document.createElement("p");
    root.insertBefore(paragraph, root.childNodes[range.startOffset] ?? null);
    range.setStart(paragraph, 0);
    range.collapse(true);
  }
  const block = blockAround(range.startContainer, root);
  if (block.matches("li, td, th, summary")) {
    const inline = document.createDocumentFragment();
    [...fragment.childNodes].forEach((node, index) => {
      if (index) {
        inline.append(document.createElement("br"));
      }
      inline.append(...(isBlock(node) ? [...node.childNodes] : [node]));
    });
    const end = inline.lastChild;
    range.insertNode(inline);
    if (end) {
      placeCaret(end.parentNode!, [...end.parentNode!.childNodes].indexOf(end as ChildNode) + 1);
    }
    return;
  }
  const after = document.createRange();
  after.setStart(range.startContainer, range.startOffset);
  after.setEnd(block, block.childNodes.length);
  const rest = after.extractContents();
  if (blank(block)) {
    block.replaceChildren();
  }
  const nodes = [...fragment.childNodes];
  if (nodes[0]?.nodeName === "P" && !block.matches("pre")) {
    block.append(...nodes.shift()!.childNodes);
  }
  let last: Element = block;
  for (const node of nodes) {
    last.after(node);
    last = node as Element;
  }
  if (last.nodeName !== "P" && !last.matches("h1, h2, h3, h4, h5, h6") || last.getAttribute("contenteditable") === "false") {
    const paragraph = document.createElement("p");
    last.after(paragraph);
    last = paragraph;
  }
  const offset = last.childNodes.length;
  if (!blank(rest)) {
    last.append(rest);
  }
  if (!last.childNodes.length) {
    last.append(document.createElement("br"));
  }
  placeCaret(last, Math.min(offset, last.childNodes.length));
}

/**
 * Pastes as the editor's own HTML, built from the doc model. A link to a
 * player the blog embeds, pasted alone with nothing selected, becomes that
 * embed; with text selected it stays a paste, which may be meant as a link.
 * Text, anything pasted into code (as escaped HTML: WebKit's `insertText` splits a code block
 * at each newline), and inline HTML go in through the browser's own commands,
 * so undo takes them back. Blocks go in by hand and are not undoable: Chrome's
 * `insertHTML` wraps blocks it merges into a line in inline styles and turns a
 * line break in the first of them into a paragraph.
 */
export function pasteClipboard(event: ClipboardEvent): boolean {
  const data = event.clipboardData;
  const root = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
  if (!data || !root || !range || !root.contains(range.startContainer)) {
    return false;
  }
  const text = data.getData("text/plain").replace(/\r\n?/g, "\n");
  const start = range.startContainer;
  const inCode = (start instanceof Element ? start : start.parentElement)?.closest("pre, code");
  const html = inCode ? null : pastedHtml(data.getData("text/html"), text);
  if (!inCode && html === null) {
    return false;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  const embed = !inCode && /^https?:\/\/\S+$/.test(text.trim()) && range.collapsed ? embedFromUrl(text) : null;
  if (embed) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return insertEmbed(root, embed);
  }
  if (inCode) {
    document.execCommand("insertHTML", false, escapeHtml(text));
    return true;
  }
  if (html === escapeHtml(text)) {
    document.execCommand("insertText", false, text);
    return true;
  }
  const template = document.createElement("template");
  template.innerHTML = html ?? "";
  if (![...template.content.childNodes].some(isBlock)) {
    document.execCommand("insertHTML", false, html ?? "");
    return true;
  }
  range.deleteContents();
  insertBlocks(root, range, template.content);
  notify(root);
  return true;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
