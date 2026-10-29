import type { JSONContent } from "./doc.ts";
import { embedFromTag, embedFromUrl, isPlayerLink } from "./blog.ts";
import { docToHtml, htmlToDoc } from "./bridge.ts";
import { copiedHere } from "./clipboard.ts";
import { insertEmbed, notify } from "./commands.ts";
import { loadReader, loadedReader } from "../lib/reader.ts";

const BLOCKS = "address, article, aside, blockquote, details, div, dl, figure, footer, h1, h2, h3, h4, h5, h6, header, hr, li, ol, p, pre, section, table, ul";
const SEMANTIC = "a, b, strong, i, em, u, s, del, strike, sup, sub, code, pre, h1, h2, h3, h4, h5, h6, ul, ol, li, table, blockquote, img, hr";
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
const HIDDEN = ["data-raw", "data-raw-inline", "data-ial", "data-block-ial", "data-ial-above", "data-extra", "contenteditable"];
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

function collapseSpace(body: HTMLElement): void {
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) {
    texts.push(walker.currentNode as Text);
  }
  for (const text of texts) {
    if (text.parentElement?.closest('pre, code, textarea, [style*="white-space:pre" i], [style*="white-space: pre" i]')) {
      continue;
    }
    const block = text.parentElement === body || Boolean(text.parentElement?.matches(`${BLOCKS}, td, th`));
    const edge = (node: Node | null) => block && (node === null || node.nodeName === "BR" || isBlock(node));
    let data = text.data.replace(/[\t\n\r ]+/g, " ");
    if (edge(text.previousSibling)) {
      data = data.replace(/^ /, "");
    }
    if (edge(text.nextSibling)) {
      data = data.replace(/ $/, "");
    }
    if (data) {
      text.data = data;
    } else {
      text.remove();
    }
  }
}

function nestLists(body: HTMLElement): void {
  for (const list of [...body.querySelectorAll(":is(ul, ol) > :is(ul, ol)")]) {
    const item = list.previousElementSibling?.tagName === "LI" ? list.previousElementSibling : null;
    if (item) {
      item.append(list);
    } else {
      const wrapper = body.ownerDocument.createElement("li");
      list.replaceWith(wrapper);
      wrapper.append(list);
    }
  }
}

function clipboardBody(html: string, own: boolean): HTMLElement {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  if (!own) {
    for (const element of body.querySelectorAll(HIDDEN.map((name) => `[${name}]`).join(", "))) {
      HIDDEN.forEach((name) => element.removeAttribute(name));
    }
    collapseSpace(body);
  }
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
  nestLists(body);
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
  body.querySelectorAll("a u, mark").forEach(unwrap);
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

interface Clipboard {
  plain: string;
  body: HTMLElement | null;
  rich: boolean;
}

function readClipboard(html: string, text: string): Clipboard {
  const plain = text.replace(/\r\n?/g, "\n");
  const body = html ? clipboardBody(html, copiedHere(plain)) : null;
  return { plain, body, rich: body !== null && body.querySelector(SEMANTIC) !== null };
}

const isMarkdown = ({ plain, rich }: Clipboard) => !rich && (MARKDOWN_LINE.test(plain) || MARKDOWN_INLINE.test(plain));

export function pastedHtml(html: string, text: string): string | null {
  return htmlOf(readClipboard(html, text));
}

function htmlOf(clipboard: Clipboard): string | null {
  const { plain, body, rich } = clipboard;
  const reader = loadedReader();
  const doc = rich
    ? htmlToDoc(body!.innerHTML)
    : isMarkdown(clipboard) && reader
      ? reader.markdownToDoc(plain)
      : plainDoc((plain || (body?.textContent ?? "")).replace(/\n+$/, ""));
  if (!doc.content?.length) {
    return null;
  }
  const out = docToHtml(doc);
  const single = doc.content.length === 1 && doc.content[0].type === "paragraph" && !doc.content[0].attrs;
  return single ? out.replace(/^<p>([\s\S]*)<\/p>$/, "$1") : out;
}

const TEXTBLOCK = "p, h1, h2, h3, h4, h5, h6, li, td, th, pre, div";
const ONE_RUN = "li, td, th, [data-collapsible-summary]";

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

function insertBlocks(root: HTMLElement, range: Range, fragment: DocumentFragment): void {
  if (range.startContainer === root) {
    const paragraph = document.createElement("p");
    root.insertBefore(paragraph, root.childNodes[range.startOffset] ?? null);
    range.setStart(paragraph, 0);
    range.collapse(true);
  }
  const block = blockAround(range.startContainer, root);
  if (block.matches(ONE_RUN)) {
    const title = block.matches("[data-collapsible-summary]");
    const inline = document.createDocumentFragment();
    [...fragment.childNodes].forEach((node, index) => {
      if (index) {
        inline.append(title ? document.createTextNode(" ") : document.createElement("br"));
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

export function pasteClipboard(event: ClipboardEvent): boolean {
  const data = event.clipboardData;
  const root = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
  if (!data || !root || !range || !root.contains(range.startContainer)) {
    return false;
  }
  const text = data.getData("text/plain").replace(/\r\n?/g, "\n");
  const start = range.startContainer;
  const inCode = Boolean((start instanceof Element ? start : start.parentElement)?.closest("pre, code"));
  const tagged = inCode || !range.collapsed ? null : embedFromTag(text);
  if (tagged) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return insertEmbed(root, tagged);
  }
  const clipboard = inCode ? null : readClipboard(data.getData("text/html"), text);
  if (clipboard && isMarkdown(clipboard) && !loadedReader()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void loadReader()
      .catch(() => null)
      .then(() => insertPaste(root, text, htmlOf(clipboard), false));
    return true;
  }
  const html = clipboard ? htmlOf(clipboard) : null;
  if (!inCode && html === null) {
    return false;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  return insertPaste(root, text, html, inCode);
}

function insertPaste(root: HTMLElement, text: string, html: string | null, inCode: boolean): boolean {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !root.contains(range.startContainer) || (!inCode && html === null)) {
    return false;
  }
  const embed = !inCode && isPlayerLink(text) && range.collapsed ? embedFromUrl(text) : null;
  if (embed) {
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
